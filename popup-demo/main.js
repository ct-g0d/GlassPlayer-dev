// The main window owns the audio. BroadcastChannel stands in for Electron IPC or Tauri events.
const $ = (id) => document.getElementById(id);
const channel = new BroadcastChannel('gp-popup');
const audio = new Audio();
const time = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const cover = (a, b) => `linear-gradient(135deg,hsl(${a} 70% 62%),hsl(${b} 62% 34%))`;
const BAR_COUNT = 28;

const tracks = [
  { title: '清晨的玻璃', artist: 'Demo Track', accent: 'hsl(225 62% 54%)', cover: cover(205, 245), chords: [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 294]] },
  { title: 'Peregrine Lake', artist: 'Demo Track', accent: 'hsl(190 60% 42%)', cover: cover(165, 215), chords: [[262, 330, 392], [220, 262, 330], [175, 220, 262], [196, 247, 392]] },
  { title: 'Final Pressing', artist: 'Demo Track', accent: 'hsl(350 62% 54%)', cover: cover(28, 340), chords: [[147, 220, 294], [175, 220, 349], [131, 196, 262], [165, 196, 247]] },
];
const ORDERS = ['sequence', 'shuffle', 'one'], ORDER_NAMES = { sequence: '顺序播放', shuffle: '随机播放', one: '单曲循环' };
let index = 0, audioContext = null, analyser = null, popup = null, order = 'sequence', shuffleHistory = [];

// Three short synth loops, so the demo plays without any music files
async function renderChords(chords) {
  const rate = 22050, bar = 2, seconds = 32;
  const offline = new OfflineAudioContext(1, rate * seconds, rate);
  for (let t = 0, i = 0; t < seconds; t += bar, i++) {
    chords[i % chords.length].forEach((frequency, voice) => {
      const osc = offline.createOscillator(), gain = offline.createGain();
      osc.type = voice ? 'triangle' : 'sawtooth';
      osc.frequency.value = voice ? frequency : frequency / 2;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(voice ? .16 : .1, t + .08);
      gain.gain.exponentialRampToValueAtTime(.008, t + bar);
      osc.connect(gain).connect(offline.destination);
      osc.start(t); osc.stop(t + bar);
    });
  }
  const samples = (await offline.startRendering()).getChannelData(0);
  const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at, value) => [...value].forEach((char, i) => wav.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF'); wav.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true));
  return URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
}

function publish() {
  const track = tracks[index], current = audio.currentTime || 0, duration = audio.duration || 0, playing = !audio.paused;
  channel.postMessage({ type: 'state', track: { title: track.title, artist: track.artist, cover: track.cover }, playing, current, duration, accent: track.accent, order });
  document.documentElement.style.setProperty('--accent', track.accent);
  $('title').textContent = track.title;
  $('artist').textContent = track.artist;
  $('cover').style.background = track.cover;
  $('play').textContent = playing ? '暂停' : '播放';
  $('order').textContent = ORDER_NAMES[order];
  $('now').textContent = time(current);
  $('end').textContent = time(duration);
  $('seek').value = duration ? current / duration * 1000 : 0;
}

async function load(next, play) {
  index = (next + tracks.length) % tracks.length;
  const track = tracks[index];
  track.url ||= await renderChords(track.chords);
  audio.src = track.url;
  publish();
  if (play) await start();
}

async function start() {
  if (!audioContext) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = .86;
    audioContext.createMediaElementSource(audio).connect(analyser).connect(audioContext.destination);
  }
  await audioContext.resume();
  await audio.play();
}

function nextIndex() {
  if (order !== 'shuffle' || tracks.length < 2) return index + 1;
  let pick;
  do pick = Math.floor(Math.random() * tracks.length); while (pick === index);
  shuffleHistory.push(index);
  return pick;
}

const commands = {
  toggle: () => audio.paused ? start() : audio.pause(),
  next: () => load(nextIndex(), !audio.paused),
  prev: () => load(order === 'shuffle' && shuffleHistory.length ? shuffleHistory.pop() : index - 1, !audio.paused),
  order: () => { order = ORDERS[(ORDERS.indexOf(order) + 1) % ORDERS.length]; shuffleHistory = []; publish(); },
  seek: (value) => { audio.currentTime = value; publish(); },
};

function setPopupOpen(open) { $('popup').textContent = open ? '关闭弹窗' : '打开弹窗'; }

channel.onmessage = ({ data }) => {
  if (data.type === 'cmd') commands[data.cmd]?.(data.value);
  else if (data.type === 'hello') publish();
  else if (data.type === 'opened') { setPopupOpen(true); publish(); }
  else if (data.type === 'closed') { setPopupOpen(false); popup = null; }
};

['play', 'pause', 'timeupdate', 'loadedmetadata', 'seeked'].forEach((name) => audio.addEventListener(name, publish));
audio.addEventListener('ended', () => { if (order === 'one') { audio.currentTime = 0; start(); } else load(nextIndex(), true); });

// A timer, not requestAnimationFrame: animation frames stop while the main window is hidden, and the popup must keep moving
const frequencies = new Uint8Array(128);
let quiet = true;
setInterval(() => {
  if (!analyser || audio.paused) {
    if (!quiet) channel.postMessage({ type: 'levels', levels: new Array(BAR_COUNT).fill(0) });
    quiet = true;
    return;
  }
  quiet = false;
  analyser.getByteFrequencyData(frequencies);
  channel.postMessage({ type: 'levels', levels: Array.from({ length: BAR_COUNT }, (_, i) => frequencies[Math.floor(Math.pow(i / BAR_COUNT, 1.6) * 90)] / 255) });
}, 33);

$('play').onclick = commands.toggle;
$('next').onclick = commands.next;
$('order').onclick = commands.order;
$('prev').onclick = commands.prev;
$('seek').oninput = () => { if (audio.duration) commands.seek($('seek').value / 1000 * audio.duration); };
$('files').onchange = async ({ target }) => {
  const first = tracks.length;
  const added = await Promise.all([...target.files].map(async (file, i) => {
    const tags = await readTags(file), hue = (i * 67 + 300) % 360;
    return {
      title: tags.title, artist: tags.artist, url: URL.createObjectURL(file),
      cover: tags.cover ? `url("${tags.cover}") center/cover no-repeat` : cover(hue, (hue + 50) % 360),
      accent: (tags.cover && await coverAccent(tags.cover)) || `hsl(${hue} 60% 54%)`,
    };
  }));
  tracks.push(...added);
  if (target.files.length) await load(first, true);
  target.value = '';
};
$('popup').onclick = () => {
  if (popup && !popup.closed) { popup.close(); return; }
  popup = window.open('popup.html', 'gpPopup', 'popup,width=480,height=270');
  if (!popup) $('note').textContent = '弹窗被浏览器拦截了，请允许后再试。';
};
load(0, false);
