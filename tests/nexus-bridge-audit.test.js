/**
 * Comprehensive Technical Audit & Edge-Case Suite for nexus-bridge.js
 * 
 * Tests:
 * 1. Universal Transport Layer (BC, Parent, Opener, Electron, NexusMediaBridge, ipcRenderer, NexusStorage)
 * 2. Zero-Lag Audio Event Traps & Throttled Timeupdate (Immediate play/pause/seeked vs throttled timeupdate)
 * 3. DOM MutationObserver State Synchronization
 * 4. Cover Art Generation (Aspect Ratio Cover Math, Caching, JPEG Export, Error Tolerance)
 * 5. Inbound Control Execution (toggle, play, pause, prev, next, seek variants, volume variants, theme)
 * 6. Edge Cases & Concurrency:
 *    - Dual-deck A/B crossfading state integrity
 *    - Rapid seeking barrage (50 calls in 20ms)
 *    - Rapid volume slider barrage
 *    - Theme toggle race conditions & unknown values
 *    - Out-of-bounds seeks & volumes
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ------------------- MOCK ENVIRONMENT SETUP -------------------

class MockEventTarget {
  constructor() {
    this.listeners = {};
  }
  addEventListener(event, listener, options) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener);
  }
  removeEventListener(event, listener) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== listener);
  }
  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) {
      fn.call(this, event);
    }
    return true;
  }
}

class MockHTMLElement extends MockEventTarget {
  constructor(tagName = 'div', id = '') {
    super();
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '0';
    this.max = '1000';
    this.style = {
      properties: {},
      setProperty(k, v) { this.properties[k] = v; },
      getProperty(k) { return this.properties[k]; }
    };
    this.attributes = {};
    this.classList = {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    };
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.src = '';
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] || null; }
  click() {
    this.dispatchEvent({ type: 'click', target: this });
  }
}

class MockHTMLMediaElement extends MockHTMLElement {
  constructor(tag = 'audio') {
    super(tag);
    this.paused = true;
    this.ended = false;
    this.currentTime = 0;
    this.duration = 180;
    this.volume = 0.7;
    this.muted = false;
  }
  play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent({ type: 'play' });
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.dispatchEvent({ type: 'pause' });
  }
}

class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    MockMutationObserver.instances.push(this);
  }
  observe(target, options) {
    this.target = target;
    this.options = options;
  }
  disconnect() {}
  trigger(mutations = []) {
    this.callback(mutations, this);
  }
}
MockMutationObserver.instances = [];

class MockBroadcastChannel extends MockEventTarget {
  constructor(name) {
    super();
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }
  postMessage(data) {
    MockBroadcastChannel.messages.push({ channel: this.name, data, timestamp: Date.now() });
  }
}
MockBroadcastChannel.instances = [];
MockBroadcastChannel.messages = [];

const domElements = new Map();
function getOrCreateElement(id, tag = 'div') {
  if (!domElements.has(id)) {
    const el = tag === 'audio' ? new MockHTMLMediaElement() : new MockHTMLElement(tag, id);
    domElements.set(id, el);
  }
  return domElements.get(id);
}

// Pre-create standard elements
['nowTitle', 'nowArtist', 'playIcon', 'curTime', 'durTime', 'seek', 'vol', 'volIcon',
 'staticCover', 'rotorCover', 'discRotor', 'themeSeg', 'playBtn', 'prevBtn', 'nextBtn'].forEach(id => {
  const tag = (id === 'playBtn' || id === 'prevBtn' || id === 'nextBtn') ? 'button'
    : (id === 'seek' || id === 'vol') ? 'input'
    : (id === 'staticCover' || id === 'rotorCover') ? 'img'
    : 'div';
  getOrCreateElement(id, tag);
});

// Canvas mock tracking
let canvasOps = [];
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: () => ({
    fillStyle: '',
    fillRect: (x, y, w, h) => { canvasOps.push({ op: 'fillRect', x, y, w, h }); },
    drawImage: (img, dx, dy, dw, dh) => { canvasOps.push({ op: 'drawImage', img, dx, dy, dw, dh }); },
    clearRect: () => {}
  }),
  toDataURL: (format, quality) => {
    canvasOps.push({ op: 'toDataURL', format, quality });
    return `data:${format};base64,auditPayload_q${quality}_len${canvasOps.length}`;
  }
};

// Global mocks
global.window = new MockEventTarget();
global.document = new MockEventTarget();
global.HTMLMediaElement = MockHTMLMediaElement;
global.HTMLElement = MockHTMLElement;
global.MutationObserver = MockMutationObserver;
global.BroadcastChannel = MockBroadcastChannel;
global.performance = { now: () => Date.now() };

document.body = new MockHTMLElement('body');
document.head = new MockHTMLElement('head');
document.head.appendChild = () => {};
document.querySelector = (selector) => {
  if (selector.includes('#themeSeg') && selector.includes('data-v=')) {
    const m = selector.match(/data-v="([^"]+)"/);
    if (m) {
      const v = m[1];
      const btn = new MockHTMLElement('button');
      btn.setAttribute('data-v', v);
      btn.addEventListener('click', () => {
        document.body.setAttribute('data-theme', v);
      });
      return btn;
    }
  }
  if (selector.startsWith('#')) {
    const id = selector.slice(1).split(' ')[0];
    return domElements.get(id) || null;
  }
  return null;
};
document.querySelectorAll = () => [];
document.getElementById = (id) => domElements.get(id) || null;
document.createElement = (tag) => {
  if (tag.toLowerCase() === 'canvas') return mockCanvas;
  return new MockHTMLElement(tag);
};

// Transports
const windowParentMessages = [];
window.parent = {
  postMessage: (data, origin) => windowParentMessages.push({ data, origin })
};
const windowOpenerMessages = [];
window.opener = {
  closed: false,
  postMessage: (data, origin) => windowOpenerMessages.push({ data, origin })
};
window.Audio = class extends MockHTMLMediaElement {
  constructor() {
    super('audio');
  }
};
window.AudioContext = class {
  createMediaElementSource(el) { return {}; }
};
const electronIpcMessages = [];
window.electronAPI = {
  send: (ch, data) => electronIpcMessages.push({ channel: ch, data }),
  reportNowPlaying: (data) => electronIpcMessages.push({ channel: 'reportNowPlaying', data }),
  listeners: {},
  on: function(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  },
  emit: function(event, data) {
    (this.listeners[event] || []).forEach(fn => fn(data));
  }
};
const nexusMediaBridgeCalls = [];
window.nexusMediaBridge = {
  reportNowPlaying: (data) => nexusMediaBridgeCalls.push({ type: 'reportNowPlaying', data }),
  onMediaControl: (fn) => { window.nexusMediaBridge._controlFn = fn; },
  onThemeSync: (fn) => { window.nexusMediaBridge._themeFn = fn; }
};
const ipcRendererMessages = [];
window.ipcRenderer = {
  send: (ch, data) => ipcRendererMessages.push({ channel: ch, data })
};
const nexusStorageStore = new Map();
window.nexusStorage = {
  setItem: (k, v) => nexusStorageStore.set(k, v),
  getItem: (k) => nexusStorageStore.get(k)
};

// Load code
const bridgeCode = fs.readFileSync(path.resolve(__dirname, '../nexus-bridge.js'), 'utf8');
eval(bridgeCode);
const bridge = window.NexusBridge;

console.log('========================================================');
console.log('       EXHAUSTIVE TECHNICAL AUDIT & DEBATE TEST         ');
console.log('========================================================\n');

// ------------------- AUDIT SUITE -------------------

async function runAudit() {
  let passed = 0;
  let total = 0;
  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}`);
      console.error(e);
    }
  }

  // Section 1: Universal Transport Layer Outbound & Inbound
  console.log('--- Section 1: Universal Transport Layer ---');

  test('1.1 BroadcastChannel receives ready handshake', () => {
    const ready = MockBroadcastChannel.messages.find(m => m.data.nexus === 'ready');
    assert(ready, 'BroadcastChannel must receive ready');
    assert.strictEqual(ready.data.app, 'glassplayer');
    assert.deepStrictEqual(ready.data.capabilities, ['telemetry', 'controls', 'coverArt', 'theme']);
  });

  test('1.2 window.parent.postMessage receives handshake', () => {
    const ready = windowParentMessages.find(m => m.data.nexus === 'ready');
    assert(ready, 'parent.postMessage must receive ready');
    assert.strictEqual(ready.origin, '*');
  });

  test('1.3 window.opener.postMessage receives handshake', () => {
    const ready = windowOpenerMessages.find(m => m.data.nexus === 'ready');
    assert(ready, 'opener.postMessage must receive ready');
  });

  test('1.4 window.electronAPI and window.ipcRenderer receive telemetry', () => {
    MockBroadcastChannel.messages = [];
    electronIpcMessages.length = 0;
    ipcRendererMessages.length = 0;
    nexusMediaBridgeCalls.length = 0;

    bridge.broadcastNowPlaying(true);

    assert(electronIpcMessages.some(m => m.channel === 'nexus-media'), 'electronAPI.send(nexus-media) fired');
    assert(electronIpcMessages.some(m => m.channel === 'reportNowPlaying'), 'electronAPI.reportNowPlaying fired');
    assert(ipcRendererMessages.some(m => m.channel === 'nexus:now-playing-update'), 'ipcRenderer send fired');
    assert(nexusMediaBridgeCalls.some(m => m.type === 'reportNowPlaying'), 'nexusMediaBridge fired');
    assert(nexusStorageStore.has('nexus-media-status'), 'nexusStorage.setItem fired');
  });

  test('1.5 Inbound queries (query, ping, handshake) trigger immediate broadcastReady & nowPlaying', () => {
    MockBroadcastChannel.messages = [];
    bridge.handleControl({ nexus: 'query' });
    assert(MockBroadcastChannel.messages.some(m => m.data.nexus === 'ready'), 'query triggers ready');
    assert(MockBroadcastChannel.messages.some(m => m.data.nexus === 'nowPlaying'), 'query triggers nowPlaying');

    MockBroadcastChannel.messages = [];
    bridge.handleControl({ type: 'ping' });
    assert(MockBroadcastChannel.messages.some(m => m.data.nexus === 'ready'), 'ping triggers ready');
  });

  // Section 2: Zero-Lag Audio Event Traps & Throttling
  console.log('\n--- Section 2: Event Traps & Throttling ---');

  const deck = new window.Audio();
  domElements.get('nowTitle').textContent = 'Blinding Lights';
  domElements.get('nowArtist').textContent = 'The Weeknd';
  domElements.get('durTime').textContent = '3:20';
  deck.duration = 200;

  test('2.1 Immediate zero-lag dispatch on play, pause, ended, seeked, volumechange', () => {
    const events = ['play', 'pause', 'seeked', 'volumechange', 'ended'];
    for (const evt of events) {
      MockBroadcastChannel.messages = [];
      deck.dispatchEvent({ type: evt });
      const msg = MockBroadcastChannel.messages.find(m => m.data.nexus === 'nowPlaying');
      assert(msg, `Event "${evt}" must trigger immediate broadcastNowPlaying(true)`);
    }
  });

  test('2.2 Throttled timeupdate drops rapid sub-250ms bursts', () => {
    MockBroadcastChannel.messages = [];
    const startTime = Date.now() + 500;
    global.performance.now = () => startTime;

    // Fire 10 timeupdate events within 50ms (currentTime advances from 10 to 19)
    for (let i = 0; i < 10; i++) {
      global.performance.now = () => startTime + i * 5;
      deck.currentTime = 10 + i;
      deck.dispatchEvent({ type: 'timeupdate' });
    }

    // Only the first one should pass, rest dropped by 250ms throttle
    const timeupdateMsgs = MockBroadcastChannel.messages.filter(m => m.data.nexus === 'nowPlaying');
    assert.strictEqual(timeupdateMsgs.length, 1, `Expected 1 broadcast from 10 bursts within 50ms, got ${timeupdateMsgs.length}`);

    // Advance 300ms: next timeupdate must pass
    global.performance.now = () => startTime + 310;
    deck.currentTime = 25;
    deck.dispatchEvent({ type: 'timeupdate' });
    const timeupdateMsgs2 = MockBroadcastChannel.messages.filter(m => m.data.nexus === 'nowPlaying');
    assert.strictEqual(timeupdateMsgs2.length, 2, 'Timeupdate after 310ms should pass');
  });

  // Section 3: DOM MutationObserver
  console.log('\n--- Section 3: DOM MutationObserver ---');

  test('3.1 DOM mutations trigger state sync', () => {
    MockBroadcastChannel.messages = [];
    domElements.get('nowTitle').textContent = 'Save Your Tears';
    // Trigger mutation observer
    MockMutationObserver.instances.forEach(obs => obs.trigger([]));
    const msg = MockBroadcastChannel.messages.find(m => m.data.nexus === 'nowPlaying');
    assert(msg, 'MutationObserver must trigger broadcast');
    assert.strictEqual(msg.data.title, 'Save Your Tears');
  });

  test('3.2 Unchanged DOM mutations do not emit duplicate digests', () => {
    MockBroadcastChannel.messages = [];
    // Trigger mutation with no state change
    MockMutationObserver.instances.forEach(obs => obs.trigger([]));
    assert.strictEqual(MockBroadcastChannel.messages.length, 0, 'Unchanged state should be deduplicated');
  });

  // Section 4: Cover Art Generator
  console.log('\n--- Section 4: Cover Art Generator ---');

  test('4.1 Aspect Ratio rendering: Square (1:1), Landscape (2:1), Portrait (1:2)', () => {
    const staticCover = domElements.get('staticCover');
    staticCover.src = 'https://example.com/art-square.jpg';
    staticCover.naturalWidth = 400;
    staticCover.naturalHeight = 400;

    canvasOps = [];
    let url = bridge.getOptimizedCoverDataUrl();
    assert(url.startsWith('data:image/jpeg'), 'Must be JPEG Data URL');
    let drawCall = canvasOps.find(op => op.op === 'drawImage');
    assert.deepStrictEqual({ dx: drawCall.dx, dy: drawCall.dy, dw: drawCall.dw, dh: drawCall.dh },
      { dx: 0, dy: 0, dw: 160, dh: 160 }, 'Square image maps 1:1 to 160x160');

    // Landscape (400x200): height fits 160, width scales to 320, dx = -80
    staticCover.src = 'https://example.com/art-landscape.jpg';
    staticCover.naturalWidth = 400;
    staticCover.naturalHeight = 200;
    canvasOps = [];
    url = bridge.getOptimizedCoverDataUrl();
    drawCall = canvasOps.find(op => op.op === 'drawImage');
    assert.deepStrictEqual({ dx: drawCall.dx, dy: drawCall.dy, dw: drawCall.dw, dh: drawCall.dh },
      { dx: -80, dy: 0, dw: 320, dh: 160 }, 'Landscape 2:1 is center-cropped at dx=-80');

    // Portrait (200x400): width fits 160, height scales to 320, dy = -80
    staticCover.src = 'https://example.com/art-portrait.jpg';
    staticCover.naturalWidth = 200;
    staticCover.naturalHeight = 400;
    canvasOps = [];
    url = bridge.getOptimizedCoverDataUrl();
    drawCall = canvasOps.find(op => op.op === 'drawImage');
    assert.deepStrictEqual({ dx: drawCall.dx, dy: drawCall.dy, dw: drawCall.dw, dh: drawCall.dh },
      { dx: 0, dy: -80, dw: 160, dh: 320 }, 'Portrait 1:2 is center-cropped at dy=-80');
  });

  test('4.2 Zero-redraw hash cache on repeated queries', () => {
    canvasOps = [];
    const url1 = bridge.getOptimizedCoverDataUrl();
    const url2 = bridge.getOptimizedCoverDataUrl();
    assert.strictEqual(url1, url2);
    assert.strictEqual(canvasOps.length, 0, 'No canvas redraw operations during cache hit');
  });

  // Section 5: Inbound Controls Execution
  console.log('\n--- Section 5: Inbound Controls Execution ---');

  test('5.1 Seek by seconds, pos (0..1), percent (50), percentage (75), value', () => {
    const seekEl = domElements.get('seek');
    deck.duration = 200;

    bridge.handleControl({ action: 'seek', seconds: 50 });
    assert.strictEqual(deck.currentTime, 50, 'Seek by seconds=50');
    assert.strictEqual(seekEl.value, 250, 'Seek slider should be 250 (50/200 * 1000)');

    bridge.handleControl({ action: 'seek', pos: 0.8 });
    assert.strictEqual(deck.currentTime, 160, 'Seek by pos=0.8');

    bridge.handleControl({ action: 'seek', percent: 25 });
    assert.strictEqual(deck.currentTime, 50, 'Seek by percent=25');

    bridge.handleControl({ action: 'seek', percentage: 90 });
    assert.strictEqual(deck.currentTime, 180, 'Seek by percentage=90');
  });

  test('5.2 Volume 0..1 vs 0..100 and clamping', () => {
    const volEl = domElements.get('vol');
    bridge.handleControl({ action: 'volume', volume: 0.65 });
    assert.strictEqual(volEl.value, 0.65);

    bridge.handleControl({ action: 'volume', volume: 80 });
    assert.strictEqual(volEl.value, 0.8);

    bridge.handleControl({ action: 'volume', volume: 150 }); // Out of bounds high
    assert.strictEqual(volEl.value, 1.0);

    bridge.handleControl({ action: 'volume', volume: -20 }); // Out of bounds low
    assert.strictEqual(volEl.value, 0.0);
  });

  test('5.3 Theme commands and fallback classes', () => {
    bridge.handleControl({ action: 'theme', theme: 'dark' });
    assert.strictEqual(document.body.getAttribute('data-theme'), 'dark');

    bridge.handleControl({ action: 'theme', theme: 'light' });
    assert.strictEqual(document.body.getAttribute('data-theme'), 'light');

    bridge.handleControl({ action: 'theme', theme: 'auto' });
    assert.strictEqual(document.body.getAttribute('data-theme'), 'auto');
  });

  // Section 6: Edge Cases & Concurrency Debate
  console.log('\n--- Section 6: Edge Cases & Concurrency Debate ---');

  test('6.1 Rapid seeking barrage (50 seeks in 20ms)', () => {
    const seekEl = domElements.get('seek');
    let inputEvents = 0;
    seekEl.addEventListener('input', () => { inputEvents++; });

    for (let i = 0; i < 50; i++) {
      bridge.handleControl({ action: 'seek', seconds: i * 2 });
    }
    assert.strictEqual(inputEvents, 50, 'Must handle 50 rapid seeks without crashing');
    assert.strictEqual(deck.currentTime, 98, 'Final seek position must match latest value');
  });

  test('6.2 Dual-deck A/B crossfading scenario check', () => {
    // Deck A is playing
    const deckA = deck;
    deckA.paused = false;
    deckA.currentTime = 195;
    deckA.duration = 200;

    // Deck B enters and plays
    const deckB = new window.Audio();
    deckB.duration = 240;
    deckB.currentTime = 0;
    deckB.play(); // deckB is playing now

    // 3 seconds later, Deck A pauses
    deckA.pause();

    // Verify current state
    const state = bridge.getNowPlayingState();
    // Debate check: Does the state accurately identify playing status?
    assert.strictEqual(state.playing, true, 'Overall playback must remain true when Deck B is playing even if Deck A paused');
  });

  test('6.3 Theme toggle race conditions & unknown values', () => {
    // Rapid toggling between invalid and valid values
    bridge.handleControl({ action: 'theme', theme: 'invalid-cyberpunk-neon' });
    // Should NOT corrupt existing theme 'auto'
    assert.strictEqual(document.body.getAttribute('data-theme'), 'auto');

    bridge.handleControl({ action: 'theme', theme: ' DARK ' }); // Case and whitespace tolerance
    assert.strictEqual(document.body.getAttribute('data-theme'), 'dark');
  });

  console.log(`\n========================================`);
  console.log(`AUDIT RESULTS: ${passed}/${total} TESTS PASSED (${Math.round(passed/total*100)}%)`);
  console.log(`========================================`);
}

runAudit();
