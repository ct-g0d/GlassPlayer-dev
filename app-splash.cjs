// The loading screen every app window opens with: the app's own icon, name and a spinner on the app's own background, held over
// the page until everything has loaded (fonts, images, the scripts' first rendering, the GPU warm-up), then faded into the app.
// Kept apart from Mac X's start-up screen on purpose: that one is black, full-screen, with the Apple logo and a filling bar.
// The window stays hidden until the loading screen is drawn, so the half-built page is never seen.
// Same file in Mac X and every standalone app; usage, right after creating a window with `show: false`:
//   require('./app-splash.cjs')(win, { name: 'CinemaX', icon: path.join(__dirname, 'app-icon.png') })
// `plate: true` for an icon that isn't a full square, as the launcher marks it (Glass Player, War Plan)
const fs = require('node:fs');
const path = require('node:path');

const MIME = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
function iconURL(file) {
  try {
    if (!file || !fs.existsSync(file)) return '';
    const ext = path.extname(file).toLowerCase();
    if (ext === '.ico') {   // a .ico in an <img> shows a small 16-32px picture: take its largest PNG frame (256px) instead
      const b = fs.readFileSync(file);
      const frames = Array.from({ length: b.readUInt16LE(4) }, (_, i) => 6 + 16 * i)
        .map((o) => ({ w: b[o] || 256, size: b.readUInt32LE(o + 8), at: b.readUInt32LE(o + 12) }))
        .filter((f) => b.toString('latin1', f.at + 1, f.at + 4) === 'PNG').sort((x, y) => y.w - x.w);
      if (frames[0]) return `data:image/png;base64,${b.subarray(frames[0].at, frames[0].at + frames[0].size).toString('base64')}`;
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromPath(file);
      return img.isEmpty() ? '' : img.toDataURL({ scaleFactor: Math.max(...img.getScaleFactors(), 1) });
    }
    return MIME[ext] ? `data:${MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}` : '';
  } catch { return ''; }
}

// Runs in the page. Puts the loading screen up at once and resolves when it's drawn; then lifts it when the page is ready.
function cover(opts) {
  if (window.__appSplash) return Promise.resolve();
  const host = document.createElement('app-splash');
  window.__appSplash = host;
  const root = host.attachShadow({ mode: 'closed' });   // the page's own styles (Tailwind, kit.css) can't reach inside
  // The launcher's theme, not the page's: resolved in the main process (theme-sync.cjs: dark, light, or sunrise to sunset) so the first frame is right.
  // Its own tokens (Mac X's index.html / kit.css): dark #0e0e10 with #f5f5f7 ink, light #f5f5f7 with #1d1d1f ink
  const [r, g, b] = opts.theme === 'light' ? [245, 245, 247] : [14, 14, 16];
  const bg = `rgb(${r},${g},${b})`;
  const light = opts.theme === 'light';
  const ink = light ? '29,29,31' : '245,245,247';
  const spokes = Array.from({ length: 12 }, (_, i) =>
    `<i style="transform:rotate(${i * 30}deg) translateY(-6.5px);animation-delay:${(i - 12) / 12}s"></i>`).join('');
  root.innerHTML = `<style>
    /* A hair short of opaque: Chromium skips drawing what an opaque layer covers, and the GPU warm-up needs the page drawn under it */
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: ${bg};
      opacity: .996; -webkit-app-region: drag; cursor: default; user-select: none; contain: strict;
      transition: opacity .6s ease-in-out; }
    /* Into the app with an even fade, as Mac X's start-up screen lifts */
    :host(.done) { opacity: 0; }
    .mid { display: flex; flex-direction: column; align-items: center; transform: translateY(-4%);
      animation: in .45s cubic-bezier(.2,.8,.2,1) both; }
    /* The icon as its launcher tile draws it: a squircle, art that isn't a full square on a light plate */
    .icon { width: 88px; height: 88px; border-radius: 23%; overflow: hidden; background: rgba(${ink},.08);
      box-shadow: 0 10px 28px rgba(0,0,0,${light ? .16 : .45}), 0 0 0 .5px rgba(${ink},.1); }
    .icon img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .icon.plate { background: linear-gradient(180deg, #fdfdfe, #e4e4ea); }
    .icon.plate img { width: 80%; height: 80%; margin: 10%; object-fit: contain; }
    .name { margin-top: 18px; font: 600 15px/1.2 Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; letter-spacing: -.01em; color: rgba(${ink},.92); }
    /* The macOS spinning-spokes indicator, small, under the name: nothing like the start-up screen's bar */
    .spin { position: relative; width: 20px; height: 20px; margin-top: 22px; }
    .spin i { position: absolute; left: 9px; top: 7px; width: 2px; height: 6px; border-radius: 1px; background: rgb(${ink});
      transform-origin: 1px 3px; opacity: .15; animation: spoke 1s linear infinite; }
    @keyframes spoke { 0% { opacity: .85; } 100% { opacity: .15; } }
    @keyframes in { from { opacity: 0; transform: translateY(-4%) scale(.94); } }
    @media (prefers-reduced-motion: reduce) { .mid { animation: none; } }
  </style><div class="mid"><div class="icon${opts.plate ? ' plate' : ''}">${opts.icon ? `<img src="${opts.icon}" alt="">` : ''}</div>
    <div class="name"></div><div class="spin">${spokes}</div></div>`;
  root.querySelector('.name').textContent = opts.name || document.title || '';
  document.documentElement.append(host);   // outside <body>, so React or the page redrawing its body never removes it

  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  // Two real frames: the screen has been drawn. A heavy page (War Plan) can hold its first frame back for a second or more, and
  // the screen must neither be shown before it's drawn (a black window) nor lifted before anyone has seen it
  const painted = (cap) => Promise.race([new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))), sleep(cap)]);
  // The main process calls this once the window is on screen
  const shown = new Promise((ok) => { window.__appSplashShown = ok; });
  // Quiet = nothing added to or taken from the page for a moment: the app has finished building itself (its lists, its views,
  // the GPU warm-up's probes coming and going). A clock ticking once a second still leaves quiet gaps
  const quiet = (ms) => new Promise((ok) => {
    let t;
    const mo = new MutationObserver((list) => {
      if (list.every((m) => m.target === host)) return;
      clearTimeout(t); t = setTimeout(done, ms);
    });
    const done = () => { mo.disconnect(); ok(); };
    mo.observe(document.documentElement, { childList: true, subtree: true });
    t = setTimeout(done, ms);
  });
  const loaded = () => document.readyState === 'complete' ? null : new Promise((ok) => addEventListener('load', ok, { once: true }));
  const images = () => Promise.all([...document.images].map((img) => img.complete ? null : img.decode().catch(() => {})));
  const ready = async () => {
    await loaded();
    await document.fonts.ready;
    await sleep(300);   // the GPU warm-up starts two frames after load: let it begin before listening for quiet
    await quiet(350);
    await images();
    await document.fonts.ready;   // fonts that only the later-built parts use
    if (window.appReady) await window.appReady;   // an app that loads more on its own can hold the screen with a promise
  };
  const lift = async () => {
    const loading = Promise.race([ready(), sleep(12000)]).catch(() => {});
    // Counted from the screen's first frame on screen: up for at least a beat, so a fast start shows it rather than flickering it
    await shown;
    await painted(3000);
    const seenAt = performance.now();
    await loading;
    await painted(3000);   // the finished page drawn under the screen before it fades
    const left = 650 - (performance.now() - seenAt);
    if (left > 0) await sleep(left);
    host.classList.add('done');
    host.style.pointerEvents = 'none';
    setTimeout(() => { host.remove(); window.__appSplash = null; }, 700);
  };
  lift();
  return painted(4000);   // drawn while the window is still hidden (it paints while hidden at first), then it's shown
}

module.exports = function appSplash(win, { name = '', icon = '', plate = false } = {}) {
  const opts = { name, icon: iconURL(icon), plate };
  // The window shows once the loading screen is drawn; a show() before that (ready-to-show, a tray click) waits for it
  const show = win.show.bind(win), focus = win.focus.bind(win);
  let covered = false, wanted = false;
  win.show = () => (covered ? show() : (wanted = true));
  const reveal = () => {
    if (covered || win.isDestroyed()) return;
    covered = true;
    win.show = show;
    if (wanted || !win.isVisible()) { show(); focus(); }
  };
  // Shown (or already showing, on a reload): the screen's clock starts now
  const onScreen = () => { reveal(); if (!win.isDestroyed()) win.webContents.executeJavaScript('window.__appSplashShown?.()', true).catch(() => {}); };
  win.webContents.on('dom-ready', () => {
    const url = win.webContents.getURL();
    if (!url || url === 'about:blank') return;   // a window opened blank and sent to its page after
    // The theme is read now, as the screen goes up: the launcher's setting may have changed since the window was made
    let theme = 'dark';
    try { const t = require('./theme-sync.cjs'); theme = t.resolve(t.read()); } catch {}
    const code = `(${cover})(${JSON.stringify({ ...opts, theme })})`;
    win.webContents.executeJavaScript(code, true).then(onScreen, onScreen);
  });
  // Never left hidden: if the page fails to load or the script can't run, show the window anyway
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMainFrame) => { if (isMainFrame && code !== -3) reveal(); });
  setTimeout(reveal, 15000);
};
