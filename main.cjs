/**
 * Glass Player - Electron Main Process
 * 
 * Features:
 * - Registers custom 'app' scheme with standard, secure, stream, supportFetchAPI, corsEnabled
 * - Intercepts 'app://glassplayer/db/*' and delegates to glassplayer-vault.cjs
 * - Serves static assets from application root (index.html, build/app.js, app.css, etc.)
 * - Implements RFC 7233 Range headers (HTTP 206 Partial Content) for high-performance audio streaming
 * - Frameless BrowserWindow with acrylic / glass background material
 * - IPC handlers for window controls, vault persistence, and PiP/popup windows
 */

const { app, BrowserWindow, protocol, ipcMain, screen, dialog } = require('electron');
require('./userdata-d.cjs')(app, 'glassplayer');   // Chromium profile (Local Storage, IndexedDB, caches) on D (D:/Nexus/UserData), not C
require('./gpu-warmup.cjs')(app);   // first animations smooth: shaders compiled as each page loads
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { Readable } = require('node:stream');
const vault = require('./glassplayer-vault.cjs');

// 1. Register privileged 'app' scheme prior to app ready
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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.bin': 'application/octet-stream'
};

let mainWindow = null;

/* The music folder: chosen once in Settings (a native folder dialog), remembered in data/music-folder.json, listed again at
   every start-up so the library is there without picking anything. Its songs are served as app://glassplayer/music/<path>
   through the same range-capable handler as the app's own files, and nothing outside the folder can be reached that way */
const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg|aac|wma|opus)$/i;
const musicFolderFile = () => path.join(__dirname, 'data', 'music-folder.json');
function musicFolder() {
  try {
    const dir = JSON.parse(fs.readFileSync(musicFolderFile(), 'utf8')).path;
    return dir && fs.statSync(dir).isDirectory() ? dir : null;
  } catch { return null; }
}
async function rememberMusicFolder(dir) {
  await fsp.mkdir(path.dirname(musicFolderFile()), { recursive: true });
  const tmp = musicFolderFile() + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify({ path: dir, savedAt: Date.now() }, null, 2), 'utf8');
  await fsp.rename(tmp, musicFolderFile());
}
async function scanMusicFolder(root) {
  const out = [];
  async function visit(dir) {
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && AUDIO_EXT.test(entry.name)) {
        try { const s = await fsp.stat(full); out.push({ rel: path.relative(root, full).split(path.sep).join('/'), name: entry.name, size: s.size, lastModified: Math.round(s.mtimeMs) }); } catch {}
      }
    }
  }
  await visit(root);
  return { path: root, name: path.basename(root), files: out };
}

function setupProtocolHandler() {
  vault.init({ appRoot: __dirname });

  protocol.handle('app', async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      let pathname = decodeURIComponent(parsedUrl.pathname);

      // a) Intercept /db/* and delegate to glassplayer-vault.cjs
      if (pathname.startsWith('/db/') || pathname.startsWith('db/') || pathname === '/db' || pathname === 'db') {
        return await vault.handleProtocolRequest(request);
      }

      let safePath, filePath;
      if (pathname.startsWith('/music/')) {
        // a2) A song in the remembered music folder, and only inside it
        const root = musicFolder();
        if (!root) return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        safePath = path.normalize(pathname.slice('/music/'.length));
        filePath = path.join(root, safePath);
        const normalizedRoot = path.normalize(root).replace(/[\\/]+$/, '') + path.sep;
        if (!path.normalize(filePath).startsWith(normalizedRoot) || !AUDIO_EXT.test(filePath)) {
          return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
        }
      } else {
        // b) Serve static files from app root
        if (pathname.startsWith('/')) pathname = pathname.slice(1);
        safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
        if (!safePath || safePath === '.' || safePath === '/') {
          safePath = 'index.html';
        }

        // Prevent raw filesystem inspection into internal data directory
        if (/^data([\\/]|$)/i.test(safePath)) {
          return new Response('Not Found', { status: 404, statusText: 'Not Found' });
        }

        filePath = path.join(__dirname, safePath);
        const normalizedAppRoot = path.normalize(__dirname);
        const normalizedFilePath = path.normalize(filePath);

        // Path traversal security check
        if (!normalizedFilePath.startsWith(normalizedAppRoot)) {
          return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
        }
      }

      let stats;
      try {
        stats = await fsp.stat(filePath);
        if (stats.isDirectory()) {
          const indexPath = path.join(filePath, 'index.html');
          stats = await fsp.stat(indexPath);
          safePath = path.join(safePath, 'index.html');
        }
      } catch {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }

      const totalSize = stats.size;
      const ext = path.extname(safePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      // c) Implement RFC 7233 Range headers (HTTP 206 Partial Content) for audio streaming
      const rangeHeader = request.headers.get('range') || request.headers.get('Range');
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
        if (match) {
          let start = match[1] ? parseInt(match[1], 10) : undefined;
          let end = match[2] ? parseInt(match[2], 10) : undefined;

          if (start === undefined && end !== undefined) {
            // Suffix byte range: bytes=-500 (last 500 bytes)
            start = Math.max(0, totalSize - end);
            end = totalSize - 1;
          } else if (start !== undefined && end === undefined) {
            // Prefix byte range: bytes=500- (from byte 500 to end)
            end = totalSize - 1;
          }

          if (start === undefined || end === undefined || isNaN(start) || isNaN(end) || start > end || start >= totalSize) {
            return new Response(null, {
              status: 416,
              statusText: 'Range Not Satisfiable',
              headers: {
                'Content-Range': `bytes */${totalSize}`,
                'Accept-Ranges': 'bytes'
              }
            });
          }

          end = Math.min(end, totalSize - 1);
          const chunkSize = end - start + 1;
          const nodeStream = fs.createReadStream(filePath, { start, end });
          const webStream = Readable.toWeb(nodeStream);

          return new Response(webStream, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Range': `bytes ${start}-${end}/${totalSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(chunkSize),
              'Content-Type': mimeType,
              'Cache-Control': 'no-cache'
            }
          });
        }
      }

      // Full static file stream (HTTP 200 OK)
      const nodeStream = fs.createReadStream(filePath);
      const webStream = Readable.toWeb(nodeStream);

      return new Response(webStream, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(totalSize),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (err) {
      console.error('[GP Protocol] Request error:', request.url, err);
      return new Response('Internal Server Error', { status: 500 });
    }
  });
}

function setupIpcHandlers() {
  // Window controls
  ipcMain.handle('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.handle('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return win.isMaximized();
    }
    return false;
  });

  ipcMain.handle('window-unmaximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && win.isMaximized()) win.unmaximize();
  });

  ipcMain.handle('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.handle('window-is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  // Vault persistence methods
  ipcMain.handle('vault-get-path', () => vault.getVaultDir());
  ipcMain.handle('vault-get-manifest', async () => vault.getManifest());
  ipcMain.handle('vault-read', async (_, docName) => vault.readDocument(docName));
  ipcMain.handle('vault-write', async (_, docName, data, base) => vault.writeDocument(docName, data, base));
  ipcMain.handle('vault-get-stats', async () => vault.getStats());

  // Music folder: which one, choose one (native dialog), list its songs
  ipcMain.handle('music-folder-get', () => musicFolder());
  ipcMain.handle('music-folder-choose', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: musicFolder() || app.getPath('music') });
    if (result.canceled || !result.filePaths[0]) return null;
    await rememberMusicFolder(result.filePaths[0]);
    return result.filePaths[0];
  });
  ipcMain.handle('music-folder-scan', async () => { const root = musicFolder(); return root ? scanMusicFolder(root) : null; });

  // Popup PiP sizing & corner monitoring
  const POPUP_SIZES = ['480x270', '340x84'];
  const CORNER_PX = 72;

  ipcMain.on('popup-size', (event, width, height) => {
    const popup = BrowserWindow.fromWebContents(event.sender);
    if (!popup || !POPUP_SIZES.includes(`${width}x${height}`)) return;
    const bounds = popup.getContentBounds();
    const top = screen.getDisplayMatching(bounds).workArea.y;
    const current = bounds.height < 130 ? 84 : 270;
    popup.setContentBounds({
      x: bounds.x,
      y: Math.max(top, bounds.y + current - height),
      width,
      height
    });
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 550,
    // Opaque frameless window like Savings/Reader: Windows resizes it and rounds its corners natively
    frame: false,
    thickFrame: true,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: true
    }
  });

  require('./native-window.cjs')(mainWindow); // native Windows min/max animations
  require('./app-splash.cjs')(mainWindow, { name: 'Glass Player', icon: path.join(__dirname, 'app-icon.ico'), plate: true });   // loading screen until everything has loaded

  // PiP / floating popup window support
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 480,
      height: 270,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      backgroundMaterial: 'acrylic',
      alwaysOnTop: true,
      skipTaskbar: true,
      webPreferences: {
        backgroundThrottling: false,
        preload: path.join(__dirname, 'preload.cjs')
      }
    }
  }));

  mainWindow.webContents.on('did-create-window', (popup) => {
    popup.setAlwaysOnTop(true, 'floating');
    popup.once('ready-to-show', () => popup.show());

    let wasInside = false;
    const watch = setInterval(() => {
      const point = screen.getCursorScreenPoint();
      const box = popup.getBounds();
      const right = box.x + box.width;
      const inside = point.x >= right - 72 && point.x < right && point.y >= box.y && point.y < box.y + 72;
      if (inside !== wasInside) popup.webContents.send('popup-corner', inside);
      wasInside = inside;
    }, 80);
    popup.on('closed', () => clearInterval(watch));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL('app://glassplayer/index.html');
}

// App lifecycle
app.whenReady().then(() => {
  setupProtocolHandler();
  setupIpcHandlers();
  require('./theme-sync.cjs').main(ipcMain, BrowserWindow);   // the theme shared with Nexus and its apps (D:/Nexus/data/hub.settings.json)
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
