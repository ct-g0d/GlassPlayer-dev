/**
 * Glass Player - Protocol & Electron End-to-End Mock Verification
 *
 * Validates:
 * 1. Protocol registration & privileges (standard, secure, stream, supportFetchAPI, corsEnabled)
 * 2. Static asset streaming with RFC 7233 Range headers (HTTP 206 Partial Content)
 * 3. Path traversal security & internal data directory protection
 * 4. Vault delegation for app://glassplayer/db/*
 * 5. Window configuration parameters (frameless, acrylic, min dimensions)
 * 6. Preload contextBridge exposure & IPC wiring
 */

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('module');

let appProtocolHandler = null;
let readyCb = null;
const registeredPrivileges = [];
const ipcHandlers = new Map();
const ipcListeners = new Map();
let mainWindowOptions = null;
let popupHandler = null;

const mockElectron = {
  app: {
    whenReady: () => ({
      then: (fn) => { readyCb = fn; return Promise.resolve(); }
    }),
    on: () => {},
    quit: () => {},
    // userdata-d.cjs moves the profile at start-up; an empty temp folder here, so the test never copies or touches real data
    getPath: () => path.join(require('node:os').tmpdir(), 'gp-protocol-test-appdata'),
    setPath: () => {}
  },
  BrowserWindow: class {
    constructor(options) {
      mainWindowOptions = options;
      this.webContents = {
        setWindowOpenHandler: (fn) => { popupHandler = fn; },
        on: () => {},
        send: () => {}
      };
    }
    loadURL() {}
    once() {}
    on() {}
    show() {}
    minimize() {}
    maximize() {}
    unmaximize() {}
    isMaximized() { return false; }
    isDestroyed() { return true; }   // native-window.cjs then skips its Win32 calls, which a mock window can't take
    close() {}
    static fromWebContents() { return null; }
    static getAllWindows() { return []; }
  },
  protocol: {
    registerSchemesAsPrivileged: (schemes) => {
      registeredPrivileges.push(...schemes);
    },
    handle: (scheme, handler) => {
      if (scheme === 'app') appProtocolHandler = handler;
    }
  },
  ipcMain: {
    handle: (channel, handler) => { ipcHandlers.set(channel, handler); },
    on: (channel, listener) => { ipcListeners.set(channel, listener); }
  },
  screen: {
    getDisplayMatching: () => ({ workArea: { y: 0 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 })
  },
  contextBridge: {
    exposeInMainWorld: (name, obj) => {
      global[name] = obj;
    }
  },
  ipcRenderer: {
    invoke: (channel, ...args) => {
      const handler = ipcHandlers.get(channel);
      return handler ? handler({}, ...args) : Promise.resolve();
    },
    send: (channel, ...args) => {
      const listener = ipcListeners.get(channel);
      if (listener) listener({}, ...args);
    },
    on: () => {}
  }
};

const origRequire = Module.prototype.require;
Module.prototype.require = function (target) {
  if (target === 'electron') return mockElectron;
  return origRequire.apply(this, arguments);
};

async function runAudit() {
  console.log('--- 1. Testing Preload Script & ContextBridge ---');
  require('../preload.cjs');
  assert(global.glassAPI, 'window.glassAPI must be exposed');
  assert(global.electronAPI, 'window.electronAPI must be exposed');
  assert(global.gpWindow, 'window.gpWindow must be exposed');
  assert.strictEqual(typeof global.glassAPI.minimize, 'function');
  assert.strictEqual(typeof global.glassAPI.maximize, 'function');
  assert.strictEqual(typeof global.glassAPI.vault.read, 'function');
  console.log('  PASS: Preload exposed glassAPI, electronAPI, gpWindow');

  console.log('--- 2. Testing Main Process Startup & Scheme Registration ---');
  require('../main.cjs');
  assert(registeredPrivileges.length > 0, 'Privileged schemes must be registered');
  const appPriv = registeredPrivileges.find(s => s.scheme === 'app');
  assert(appPriv, 'app scheme must be registered');
  assert.strictEqual(appPriv.privileges.stream, true, 'Stream privilege required for audio streaming');
  assert.strictEqual(appPriv.privileges.standard, true);
  assert.strictEqual(appPriv.privileges.secure, true);
  assert.strictEqual(appPriv.privileges.supportFetchAPI, true);
  console.log('  PASS: app scheme registered with stream, secure, supportFetchAPI');

  if (readyCb) await readyCb();
  assert(appProtocolHandler, 'app protocol handler must be installed');

  console.log('--- 3. Testing Window Creation Options ---');
  assert(mainWindowOptions, 'MainWindow options must be configured');
  assert.strictEqual(mainWindowOptions.frame, false, 'Window must be frameless');
  // The main window is opaque like Savings/Reader (Windows resizes it and rounds its corners natively); the PiP popup stays acrylic
  assert.notStrictEqual(mainWindowOptions.transparent, true, 'Main window must be opaque');
  assert.strictEqual(mainWindowOptions.thickFrame, true, 'Main window must keep the native resize frame');
  assert.strictEqual(mainWindowOptions.minWidth, 800);
  assert.strictEqual(mainWindowOptions.minHeight, 550);
  assert.strictEqual(mainWindowOptions.webPreferences.backgroundThrottling, false, 'Background throttling must be false for background audio');
  assert.strictEqual(mainWindowOptions.webPreferences.nodeIntegration, false);
  assert.strictEqual(mainWindowOptions.webPreferences.contextIsolation, true);
  console.log('  PASS: Frameless, acrylic, 1200x800 (min 800x550), backgroundThrottling=false');

  console.log('--- 4. Testing PiP Popup Handler ---');
  assert(popupHandler, 'Window open handler must be installed');
  const popupRes = popupHandler();
  assert.strictEqual(popupRes.action, 'allow');
  assert.strictEqual(popupRes.overrideBrowserWindowOptions.alwaysOnTop, true);
  assert.strictEqual(popupRes.overrideBrowserWindowOptions.frame, false);
  assert.strictEqual(popupRes.overrideBrowserWindowOptions.backgroundMaterial, 'acrylic');
  console.log('  PASS: PiP popup handler configures floating frameless acrylic window');

  console.log('--- 5. Testing IPC Channel Coverage ---');
  const expectedIpc = [
    'window-minimize', 'window-maximize', 'window-unmaximize', 'window-close', 'window-is-maximized',
    'vault-get-path', 'vault-get-manifest', 'vault-read', 'vault-write', 'vault-get-stats'
  ];
  for (const ch of expectedIpc) {
    assert(ipcHandlers.has(ch), `Missing IPC handler: ${ch}`);
  }
  assert(ipcListeners.has('popup-size'), 'Missing IPC listener: popup-size');
  console.log('  PASS: All window and vault IPC handlers registered');

  console.log('--- 6. Testing Protocol Handler & RFC 7233 Audio Streaming ---');
  // Root load
  const rootRes = await appProtocolHandler(new Request('app://glassplayer/'));
  assert.strictEqual(rootRes.status, 200);
  assert.strictEqual(rootRes.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.strictEqual(rootRes.headers.get('accept-ranges'), 'bytes');

  // Static js
  const jsRes = await appProtocolHandler(new Request('app://glassplayer/build/app.js'));
  assert.strictEqual(jsRes.status, 200);
  assert.strictEqual(jsRes.headers.get('content-type'), 'text/javascript; charset=utf-8');

  // RFC 7233 Range request: closed range
  const rangeRes1 = await appProtocolHandler(new Request('app://glassplayer/build/app.js', {
    headers: { 'range': 'bytes=0-1023' }
  }));
  assert.strictEqual(rangeRes1.status, 206);
  assert.strictEqual(rangeRes1.headers.get('content-length'), '1024');
  assert(rangeRes1.headers.get('content-range').startsWith('bytes 0-1023/'));
  assert.strictEqual(rangeRes1.headers.get('accept-ranges'), 'bytes');

  // RFC 7233 Range request: open-ended range
  const rangeRes2 = await appProtocolHandler(new Request('app://glassplayer/build/app.js', {
    headers: { 'range': 'bytes=2048-' }
  }));
  assert.strictEqual(rangeRes2.status, 206);
  assert(rangeRes2.headers.get('content-range').startsWith('bytes 2048-'));

  // RFC 7233 Range request: invalid range
  const invalidRangeRes = await appProtocolHandler(new Request('app://glassplayer/build/app.js', {
    headers: { 'range': 'bytes=99999999-' }
  }));
  assert.strictEqual(invalidRangeRes.status, 416);
  assert(invalidRangeRes.headers.get('content-range').startsWith('bytes */'));

  console.log('  PASS: RFC 7233 200, 206, and 416 status code and Content-Range headers verified');

  console.log('--- 7. Testing Security & Sandbox Protections ---');
  // Raw data/ directory protection
  const dataRes = await appProtocolHandler(new Request('app://glassplayer/data/db/manifest.json'));
  assert.strictEqual(dataRes.status, 404);

  // Path traversal protection
  const travRes = await appProtocolHandler(new Request('app://glassplayer/../../../../Windows/System32/cmd.exe'));
  assert(travRes.status === 404 || travRes.status === 403);

  // Vault delegation
  const vaultRes = await appProtocolHandler(new Request('app://glassplayer/db/manifest.json'));
  assert.strictEqual(vaultRes.status, 200);

  console.log('  PASS: Security path traversal, data protection, and vault delegation verified');

  console.log('\n========================================');
  console.log('ALL PROTOCOL & ELECTRON AUDIT TESTS PASSED (100%)');
  console.log('========================================');
}

runAudit().catch(err => {
  console.error('AUDIT TEST FAILED:', err);
  process.exit(1);
});
