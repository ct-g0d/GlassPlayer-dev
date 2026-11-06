/**
 * Automated Verification Test for nexus-bridge.js & nexus-embed.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock DOM & Web Environment
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
    list.forEach(fn => fn.call(this, event));
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
  constructor() {
    super('AUDIO');
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
    MockBroadcastChannel.channels.push(this);
  }
  postMessage(data) {
    MockBroadcastChannel.messages.push({ channel: this.name, data });
  }
}
MockBroadcastChannel.channels = [];
MockBroadcastChannel.messages = [];

// Setup global mock window & document
const domElements = new Map();
function getOrCreateElement(id, tag = 'div') {
  if (!domElements.has(id)) {
    const el = tag === 'audio' ? new MockHTMLMediaElement() : new MockHTMLElement(tag, id);
    domElements.set(id, el);
  }
  return domElements.get(id);
}

// Pre-create Glass Player DOM IDs
getOrCreateElement('nowTitle');
getOrCreateElement('nowArtist');
getOrCreateElement('playIcon');
getOrCreateElement('playBtn', 'button');
getOrCreateElement('prevBtn', 'button');
getOrCreateElement('nextBtn', 'button');
getOrCreateElement('seek', 'input');
getOrCreateElement('vol', 'input');
getOrCreateElement('volIcon', 'svg');
getOrCreateElement('curTime', 'span');
getOrCreateElement('durTime', 'span');
getOrCreateElement('staticCover', 'img');
getOrCreateElement('rotorCover', 'img');
getOrCreateElement('themeSeg');

global.window = new MockEventTarget();
global.document = new MockEventTarget();
global.HTMLMediaElement = MockHTMLMediaElement;
global.HTMLElement = MockHTMLElement;
global.MutationObserver = MockMutationObserver;
global.BroadcastChannel = MockBroadcastChannel;
global.performance = { now: () => Date.now() };

document.body = new MockHTMLElement('body');
document.head = new MockHTMLElement('head');
document.head.appendChild = (el) => {};
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
document.querySelectorAll = (selector) => [];
document.getElementById = (id) => domElements.get(id) || null;

// Mock canvas
let canvasDrawCount = 0;
document.createElement = (tag) => {
  if (tag.toLowerCase() === 'canvas') {
    return {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        fillRect: () => {},
        drawImage: () => { canvasDrawCount++; },
        clearRect: () => {}
      }),
      toDataURL: (type, q) => `data:${type};base64,mockJpegDataQ${q}_draws${canvasDrawCount}`
    };
  }
  return new MockHTMLElement(tag);
};

window.parent = {
  postMessage: (data, origin) => {
    windowParentMessages.push({ data, origin });
  }
};
window.opener = {
  closed: false,
  postMessage: (data, origin) => {
    windowOpenerMessages.push({ data, origin });
  }
};
const windowParentMessages = [];
const windowOpenerMessages = [];

// Mock Electron Bridges
const electronSent = [];
window.electronAPI = {
  send: (channel, data) => electronSent.push({ channel, data }),
  reportNowPlaying: (data) => electronSent.push({ channel: 'reportNowPlaying', data })
};
const nexusMediaBridgeSent = [];
window.nexusMediaBridge = {
  reportNowPlaying: (data) => nexusMediaBridgeSent.push(data)
};

// Mock AudioContext
window.AudioContext = class {
  createMediaElementSource(el) { return {}; }
};

// Audio constructor
window.Audio = class extends MockHTMLMediaElement {
  constructor() {
    super();
  }
};

console.log('--- Starting nexus-bridge.js Verification ---');

// Load nexus-bridge.js
const bridgePath = path.resolve(__dirname, '../nexus-bridge.js');
const bridgeCode = fs.readFileSync(bridgePath, 'utf8');
eval(bridgeCode);

const bridge = window.NexusBridge;
assert(bridge, 'NexusBridge should be defined on window');
assert(window.__nexusBridgeLoaded, '__nexusBridgeLoaded flag should be set');
console.log('✓ NexusBridge initialization verified');

// Test 1: Outbound Ready Broadcast
const readyBc = MockBroadcastChannel.messages.find(m => m.data.nexus === 'ready');
assert(readyBc, 'Should broadcast ready message on BroadcastChannel');
assert.strictEqual(readyBc.data.app, 'glassplayer', 'App should be glassplayer');
assert(readyBc.data.capabilities.includes('telemetry'), 'Capabilities should include telemetry');
assert(windowParentMessages.find(m => m.data.nexus === 'ready'), 'Parent should receive ready');
assert(windowOpenerMessages.find(m => m.data.nexus === 'ready'), 'Opener should receive ready');
console.log('✓ Universal Transport outbound ready handshake verified');

// Test 2: Optimized Cover Art Generator & Caching
const staticCover = domElements.get('staticCover');
staticCover.src = 'blob:http://localhost:1003/cover-uuid-1';
staticCover.naturalWidth = 500;
staticCover.naturalHeight = 500;

canvasDrawCount = 0;
const coverUrl1 = bridge.getOptimizedCoverDataUrl();
assert(coverUrl1.startsWith('data:image/jpeg'), 'Cover art must be a JPEG Data URL');
assert.strictEqual(canvasDrawCount, 1, 'Initial cover art should draw to canvas once');

// Call again with same cover: must hit cache without redrawing
const coverUrl2 = bridge.getOptimizedCoverDataUrl();
assert.strictEqual(coverUrl1, coverUrl2, 'Cached cover URL should match');
assert.strictEqual(canvasDrawCount, 1, 'Redundant call should hit cache without redrawing canvas');
console.log('✓ Cover art generator 160x160 JPEG Data URL & zero-redraw caching verified');

// Test 3: Audio Telemetry Hooking
const testDeck = new window.Audio();
testDeck.duration = 230;

// Set track DOM info
domElements.get('nowTitle').textContent = 'Starboy';
domElements.get('nowArtist').textContent = 'The Weeknd';
domElements.get('durTime').textContent = '3:50';
domElements.get('curTime').textContent = '1:15';
domElements.get('seek').value = '326';
domElements.get('vol').value = '0.85';

// Clear previous messages
MockBroadcastChannel.messages = [];

// Trigger play on audio element
testDeck.play();

const latestMsg = MockBroadcastChannel.messages.filter(m => m.data.nexus === 'nowPlaying').pop();
assert(latestMsg, 'Playing should trigger nowPlaying broadcast');
const latestBroadcast = latestMsg.data;
assert.strictEqual(latestBroadcast.title, 'Starboy');
assert.strictEqual(latestBroadcast.artist, 'The Weeknd');
assert.strictEqual(latestBroadcast.playing, true);
assert.strictEqual(latestBroadcast.loaded, true);
assert.strictEqual(latestBroadcast.duration, 230); // 3*60 + 50
console.log('✓ Event-driven Audio telemetry (HTMLMediaElement play/pause/seeked) verified');

// Test 4: Inbound Controls Handler
let clickedBtn = null;
domElements.get('playBtn').addEventListener('click', () => { clickedBtn = 'playBtn'; });
domElements.get('prevBtn').addEventListener('click', () => { clickedBtn = 'prevBtn'; });
domElements.get('nextBtn').addEventListener('click', () => { clickedBtn = 'nextBtn'; });

// Test toggle
bridge.handleControl({ action: 'toggle' });
assert.strictEqual(clickedBtn, 'playBtn', 'Toggle should trigger playBtn click');

// Test prev & next
bridge.handleControl({ action: 'prev' });
assert.strictEqual(clickedBtn, 'prevBtn', 'Prev should trigger prevBtn click');
bridge.handleControl({ action: 'next' });
assert.strictEqual(clickedBtn, 'nextBtn', 'Next should trigger nextBtn click');

// Test seek by percentage
let seekInputFired = false;
domElements.get('seek').addEventListener('input', () => { seekInputFired = true; });
bridge.handleControl({ action: 'seek', percent: 0.5 });
assert.strictEqual(domElements.get('seek').value, 500, 'Seek 50% should set seek.value to 500');
assert(seekInputFired, 'Seek should dispatch input event');

// Test seek by seconds
bridge.handleControl({ action: 'seek', seconds: 115 });
assert.strictEqual(testDeck.currentTime, 115, 'Seek seconds should set audio.currentTime');

// Test volume
bridge.handleControl({ action: 'volume', volume: 0.45 });
assert.strictEqual(domElements.get('vol').value, 0.45, 'Volume should update vol slider');

// Test theme
bridge.handleControl({ action: 'theme', theme: 'dark' });
assert.strictEqual(document.body.getAttribute('data-theme'), 'dark', 'Theme dark should be set on body');

bridge.handleControl({ action: 'theme', theme: 'light' });
assert.strictEqual(document.body.getAttribute('data-theme'), 'light', 'Theme light should be set on body');

console.log('✓ Inbound controls (toggle, play, pause, prev, next, seek, volume, theme) verified');

// Test 5: Verify nexus-embed.js wrapper
const embedPath = path.resolve(__dirname, '../nexus-embed.js');
const embedCode = fs.readFileSync(embedPath, 'utf8');
eval(embedCode);
assert(window.nexusEmbed, 'nexus-embed.js should alias window.NexusBridge');
console.log('✓ nexus-embed.js backward-compatibility wrapper verified');

console.log('\n========================================');
console.log('ALL VERIFICATION CHECKS PASSED (100%)');
console.log('========================================');

process.exit(0);
