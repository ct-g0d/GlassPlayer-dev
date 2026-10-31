// The popup is only a remote: it plays no audio, it shows what the main window sends and sends commands back.
const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel('gp-popup');
const framed = window.parent !== window;
const FULL = [480, 270], MINI = [340, 84], MOVE_MS = 600, CORNER_PX = 72;
const ORDER_NAMES = { sequence: '顺序播放', shuffle: '随机播放', one: '单曲循环' };
const time = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
let duration = 0, seeking = false, mini = false, switching = false, shownTitle = null, accent = '#5c7fa8';

document.documentElement.classList.toggle('framed', framed);
const command = (cmd, value) => channel.postMessage({ type: 'cmd', cmd, value });

// A title too long for the sheet drifts back and forth
function fitTitle() {
  const box = $('title'), text = $('titleText'), overflow = text.scrollWidth - box.clientWidth;
  box.classList.toggle('long', overflow > 1);
  box.style.setProperty('--distance', `${-overflow - 18}px`);
  box.style.setProperty('--travel', `${Math.max(3, overflow / 28)}s`);
}

// The window buttons only appear while the pointer is in the top right corner of the window
const setCorner = (inside) => $('root').classList.toggle('awake', inside);
document.addEventListener('pointermove', ({ clientX, clientY }) => {
  const box = $('root').getBoundingClientRect(), [width, height] = mini ? MINI : FULL;
  setCorner(clientX >= box.left + width - CORNER_PX && clientX < box.left + width && clientY >= box.bottom - height && clientY < box.bottom - height + CORNER_PX);
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => setCorner(false));
window.gpWindow?.onCorner(setCorner);

function showState({ track, playing, current, duration: total, accent: color, order }) {
  duration = total || 0;
  if (track.title !== shownTitle) { shownTitle = track.title; $('titleText').textContent = track.title; fitTitle(); }
  $('artist').textContent = track.artist;
  if ($('art').dataset.source !== track.cover) {
    $('art').dataset.source = track.cover;
    $('art').style.background = $('thumb').style.background = track.cover;
  }
  accent = color;
  document.documentElement.style.setProperty('--accent', color);
  $('root').classList.toggle('playing', playing);
  $('play').setAttribute('aria-label', playing ? '暂停' : '播放');
  $('end').textContent = time(duration);
  $('order').querySelectorAll('svg').forEach((icon) => icon.classList.toggle('on', icon.dataset.order === order));
  $('order').title = ORDER_NAMES[order];
  $('order').setAttribute('aria-label', ORDER_NAMES[order]);
  if (!seeking) { $('now').textContent = time(current); $('fill').style.width = `${duration ? current / duration * 100 : 0}%`; }
}

// Liquid glass refraction: a map that bends what's behind the sheet near its rounded edge and leaves the middle clear
const lensIds = new Map();
function lensFor(width, height, radius) {
  const size = `${width}x${height}`;
  if (lensIds.has(size)) return lensIds.get(size);
  const bezel = Math.min(11, height / 2), canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'), map = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + .5 - width / 2, py = y + .5 - height / 2;
      const qx = Math.abs(px) - (width / 2 - radius), qy = Math.abs(py) - (height / 2 - radius);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inset = radius - outside - Math.min(Math.max(qx, qy), 0);
      const edge = Math.max(0, Math.min(1, 1 - inset / bezel)), strength = edge * edge;
      let nx = 0, ny = 0;
      if (qx > 0 && qy > 0) { nx = Math.sign(px) * qx / outside; ny = Math.sign(py) * qy / outside; }
      else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      const at = (y * width + x) * 4;
      map.data[at] = 128 - nx * strength * 127;
      map.data[at + 1] = 128 - ny * strength * 127;
      map.data[at + 2] = 128;
      map.data[at + 3] = 255;
    }
  }
  ctx.putImageData(map, 0, 0);
  const id = `lens${size}`;
  $('lensDefs').insertAdjacentHTML('beforeend', `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" color-interpolation-filters="sRGB">
    <feImage href="${canvas.toDataURL()}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="${height < 90 ? 12 : 8}" result="soft"/>
    <feDisplacementMap in="soft" in2="map" scale="30" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`);
  lensIds.set(size, id);
  return id;
}
function applyLens() {
  const panel = $('panel');
  if (panel.offsetWidth && panel.offsetHeight) panel.style.backdropFilter = `url(#${lensFor(panel.offsetWidth, panel.offsetHeight, parseFloat(getComputedStyle(panel).borderTopLeftRadius))})`;
}

// Bars ease toward the latest levels by time, gentle on the way up and slower on the way down
const bars = $('bars'), ctx = bars.getContext('2d');
let target = [], shown = [], frame = 0, lastDraw = 0;
function drawBars(now = performance.now()) {
  frame = 0;
  const elapsed = Math.max(8, Math.min(50, now - lastDraw));
  lastDraw = now;
  const scale = devicePixelRatio || 1, width = Math.round(bars.clientWidth * scale), height = Math.round(bars.clientHeight * scale);
  if (bars.width !== width || bars.height !== height) { bars.width = width; bars.height = height; }
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = accent;
  const gap = 3 * scale, barWidth = (width - gap * (target.length - 1)) / target.length, radius = Math.min(barWidth / 2, 5 * scale);
  let moving = false;
  target.forEach((level, i) => {
    const from = shown[i] || 0;
    shown[i] = from + (level - from) * (1 - Math.exp(-elapsed / (level > from ? 130 : 380)));
    if (Math.abs(level - shown[i]) > .002) moving = true;
    const h = shown[i] * height;
    if (h < 1) return;
    ctx.beginPath();
    ctx.roundRect(i * (barWidth + gap), height - h, barWidth, h, [radius, radius, 0, 0]);
    ctx.fill();
  });
  if (moving) frame = requestAnimationFrame(drawBars);
}
function showLevels(levels) { target = levels; if (!frame) frame = requestAnimationFrame(drawBars); }

channel.onmessage = ({ data }) => {
  if (data.type === 'state') showState(data);
  else if (data.type === 'levels') showLevels(data.levels);
};

const seekRatio = (event) => { const box = $('seek').getBoundingClientRect(); return Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)); };
const previewSeek = (ratio) => { $('fill').style.width = `${ratio * 100}%`; $('now').textContent = time(ratio * duration); };
const setSeeking = (on) => { seeking = on; $('root').classList.toggle('seeking', on); };
$('seek').addEventListener('pointerdown', (event) => { setSeeking(true); $('seek').setPointerCapture(event.pointerId); previewSeek(seekRatio(event)); });
$('seek').addEventListener('pointermove', (event) => { if (seeking) previewSeek(seekRatio(event)); });
$('seek').addEventListener('pointerup', (event) => { if (!seeking) return; setSeeking(false); command('seek', seekRatio(event) * duration); });
$('play').onclick = () => command('toggle');
$('prev').onclick = () => command('prev');
$('next').onclick = () => command('next');
$('order').onclick = () => command('order');
$('close').onclick = () => window.close();

function resizeWindow([width, height]) {
  if (framed) return;
  if (window.gpWindow) window.gpWindow.setSize(width, height);
  else window.resizeTo(width, height);
}
// Growing: the window opens up first, then the shape expands into it. Shrinking: the shape shrinks first, then the window follows.
// The shape moves straight away. The content fades out, swaps layout while hidden, and fades back as the shape arrives.
$('size').onclick = () => {
  if (switching) return;
  switching = true;
  const toMini = !mini, html = document.documentElement;
  $('root').classList.add('switching');
  $('panel').style.backdropFilter = '';
  if (!toMini) resizeWindow(FULL);
  mini = toMini;
  html.classList.toggle('mini', mini);
  $('size').setAttribute('aria-label', mini ? '放大' : '缩小');
  setTimeout(() => { html.classList.toggle('compact', mini); fitTitle(); }, 230);
  setTimeout(() => $('root').classList.remove('switching'), MOVE_MS - 220);
  setTimeout(() => {
    if (toMini) resizeWindow(MINI);
    applyLens();
    if (!frame && target.length) frame = requestAnimationFrame(drawBars);
    switching = false;
  }, MOVE_MS + 30);
};

applyLens();
fitTitle();
if (!framed) window.addEventListener('beforeunload', () => channel.postMessage({ type: 'closed' }));
channel.postMessage({ type: framed ? 'hello' : 'opened' });
