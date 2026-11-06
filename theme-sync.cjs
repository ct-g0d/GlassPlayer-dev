// One theme for Mac X and every app: the launcher's Settings → Theme (dark, light, or 'sun' = System Time: light from sunrise to
// sunset at the saved place, else 06:00-18:00). The setting lives in the launcher's hub.settings.json (D:\Nexus\data, or NEXUS_DATA);
// each app's main process reads it, watches it and tells its windows, so a change anywhere reaches every open app within a second or two.
// Same file in Mac X and every app (the build scripts copy it); usage:
//   main process:  require('./theme-sync.cjs').main(ipcMain, BrowserWindow)
//   preload:       const nexusTheme = require('./theme-sync.cjs').preload(ipcRenderer)   then expose it to the page as window.nexusTheme
// Page API: mode() 'dark'|'light'|'sun', resolved() 'dark'|'light' (the sun worked out now), get() { theme, place },
//           subscribe(cb) cb(resolved, { theme, place, lang }) when the setting changes or the sun flips it, set(mode) writes the shared setting.
// Language rides the same state: lang() 'en'|'zh' (the launcher's Settings → Language), setLang(l) writes it; subscribe also fires when it changes.
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(process.env.NEXUS_DATA || 'D:/Nexus/data', 'hub.settings.json');
const MODES = ['dark', 'light', 'sun'];
const LANGS = ['en', 'zh'];

const clean = (j) => {
  const t = j?.theme, p = j?.place;
  return { theme: t === 'system' ? 'sun' : MODES.includes(t) ? t : 'dark', lang: j?.lang === 'zh' ? 'zh' : 'en', place: p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { lat: p.lat, lon: p.lon } : null };
};

/* The sun at `place`: the moments it crosses an altitude on the given day, after SunCalc. This is kit.js's sunTimes(), line for line
   (apps/kit.js), so every app flips at the same moment as the launcher. Without a place a plain 6am/6pm day stands in */
function sunTimes(date, place) {
  const p = place, rad = Math.PI / 180, J1970 = 2440588, J2000 = 2451545;
  const plain = (h) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(h), (h % 1) * 60);
  const fallback = { dawn: plain(5.5), sunrise: plain(6), goldenEnd: plain(7), golden: plain(17), sunset: plain(18), dusk: plain(18.5) };
  if (!p) return fallback;
  const lw = -p.lon * rad, phi = p.lat * rad, d = date / 864e5 - .5 + J1970 - J2000, n = Math.round(d - 9e-4 - lw / (2 * Math.PI));
  const transit = (ds, M, L) => J2000 + ds + .0053 * Math.sin(M) - .0069 * Math.sin(2 * L);
  const ds = 9e-4 + lw / (2 * Math.PI) + n, M = rad * (357.5291 + .98560028 * ds);
  const L = M + rad * (1.9148 * Math.sin(M) + .02 * Math.sin(2 * M) + 3e-4 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L)), noon = transit(ds, M, L);
  const at = (deg) => {
    const w = Math.acos((Math.sin(deg * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    const set = transit(9e-4 + (w + lw) / (2 * Math.PI) + n, M, L), day = (j) => new Date((j + .5 - J1970) * 864e5);
    return [day(noon - (set - noon)), day(set)];
  };
  const [[dawn, dusk], [sunrise, sunset], [goldenEnd, golden]] = [-6, -.833, 6].map(at);
  return isNaN(dawn) || isNaN(goldenEnd) ? fallback : { dawn, sunrise, goldenEnd, golden, sunset, dusk };
}
// 'dark' or 'light' for a setting, now (kit.js hubTheme())
function resolve(state, now = new Date()) {
  if (state.theme !== 'sun') return state.theme;
  const { sunrise, sunset } = sunTimes(now, state.place);
  return +now >= +sunrise && +now < +sunset ? 'light' : 'dark';
}

function read() {
  try { return clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { return clean(null); }
}

function main(ipcMain, BrowserWindow) {
  let state = read();
  const tell = () => BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send('nexus:theme', state); });
  const refresh = () => {
    const next = read();
    if (JSON.stringify(next) !== JSON.stringify(state)) { state = next; tell(); }
  };
  // Polled, not fs.watch: the launcher saves by writing a temporary file and renaming it over this one, which a watch can miss on Windows
  fs.watchFile(FILE, { interval: 1000, persistent: false }, refresh);
  ipcMain.on('nexus:theme:get', (e) => { e.returnValue = state; });
  // An app with its own picker writes the shared setting: only `theme` (or `lang`) changes, everything else in the file stays
  const write = (key, value) => {
    let json = {};
    try { json = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch {}
    if (json[key] === value) return true;
    json[key] = value;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(json, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
    refresh();
    return true;
  };
  ipcMain.handle('nexus:theme:set', async (_e, mode) => MODES.includes(mode) && write('theme', mode));
  ipcMain.handle('nexus:lang:set', async (_e, lang) => LANGS.includes(lang) && write('lang', lang));
}

function preload(ipcRenderer) {
  let state = clean(null);
  try { state = ipcRenderer.sendSync('nexus:theme:get') || state; } catch {}
  const subs = new Set();
  let shown = resolve(state);
  const tellPage = () => subs.forEach((cb) => { try { cb(shown, state); } catch (e) { console.error('[nexus-theme]', e); } });
  ipcRenderer.on('nexus:theme', (_e, next) => { state = next; shown = resolve(state); tellPage(); });   // the setting changed
  setInterval(() => { const now = resolve(state); if (now !== shown) { shown = now; tellPage(); } }, 20000);   // System Time: the sun can flip it with nothing else changing
  return {
    mode: () => state.theme,
    resolved: () => resolve(state),
    get: () => state,
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    set: (mode) => ipcRenderer.invoke('nexus:theme:set', mode),
    lang: () => state.lang,
    setLang: (lang) => ipcRenderer.invoke('nexus:lang:set', lang),
  };
}

module.exports = { main, preload, resolve, sunTimes, read };
