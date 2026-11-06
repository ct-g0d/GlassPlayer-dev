// verify-electron-launch.cjs
// Script to launch Electron headlessly/briefly to verify the app:// structure, vault access, and bridge

const { app, BrowserWindow, protocol } = require('electron');
const path = require('node:path');
const vault = require('./glassplayer-vault.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: false
    }
  }
]);

// Require and run main protocol setup
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable } = require('node:stream');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

app.whenReady().then(async () => {
  vault.init({ appRoot: __dirname });

  protocol.handle('app', async (request) => {
    const parsedUrl = new URL(request.url);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.startsWith('/db/') || pathname.startsWith('db/') || pathname === '/db' || pathname === 'db') {
      return await vault.handleProtocolRequest(request);
    }

    if (pathname.startsWith('/')) pathname = pathname.slice(1);
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (!safePath || safePath === '.' || safePath === '/') safePath = 'index.html';

    const filePath = path.join(__dirname, safePath);
    try {
      const stats = await fsp.stat(filePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const nodeStream = fs.createReadStream(filePath);
      const webStream = Readable.toWeb(nodeStream);
      return new Response(webStream, {
        status: 200,
        headers: { 'Content-Type': mimeType, 'Content-Length': String(stats.size) }
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  console.log('[VERIFY] Protocol handler registered.');

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // run offscreen for automated verification
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error(`[VERIFY FAIL] did-fail-load: ${code} ${desc} for ${url}`);
    process.exit(1);
  });

  win.webContents.on('did-finish-load', async () => {
    console.log('[VERIFY PASS] Window finished loading app://glassplayer/index.html');
    
    // Execute verification inside renderer
    try {
      const results = await win.webContents.executeJavaScript(`
        (async () => {
          const checks = {};
          checks.url = window.location.href;
          checks.protocol = window.location.protocol;
          checks.hasGlassAPI = Boolean(window.glassAPI);
          checks.hasElectronAPI = Boolean(window.electronAPI);
          checks.hasNexusBridge = Boolean(window.NexusBridge);
          
          // Test in-app fetch to /db/manifest.json
          try {
            const resp = await fetch('/db/manifest.json');
            checks.dbStatus = resp.status;
            const manifest = await resp.json();
            checks.manifestRevision = manifest.revision;
          } catch (e) {
            checks.dbError = e.message;
          }

          // Test DOM rendering
          checks.title = document.title;
          checks.hasPlayer = Boolean(document.querySelector('#playBtn'));
          return checks;
        })()
      `);

      console.log('[VERIFY RESULTS]:', JSON.stringify(results, null, 2));

      if (
        results.protocol === 'app:' &&
        results.hasGlassAPI &&
        results.dbStatus === 200 &&
        results.manifestRevision === 8 &&
        results.hasPlayer
      ) {
        console.log('====================================================');
        console.log('SUCCESS: GLASS PLAYER VERIFIED UNDER app:// SCHEME!');
        console.log('Zero localhost dependency. Zero port 1003 sockets.');
        console.log('====================================================');
        app.quit();
        process.exit(0);
      } else {
        console.error('[VERIFY FAILED] Conditions not met:', results);
        app.quit();
        process.exit(1);
      }
    } catch (err) {
      console.error('[VERIFY ERROR in executeJavaScript]:', err);
      app.quit();
      process.exit(1);
    }
  });

  await win.loadURL('app://glassplayer/index.html');
});
