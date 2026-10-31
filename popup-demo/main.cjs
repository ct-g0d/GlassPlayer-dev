// The same pages as localhost:1007, but the popup becomes a real frameless, always-on-top window.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
require('./serve.cjs');

// Only the two sizes the popup offers. The window can't be resized by hand, and its bottom left corner stays put
const SIZES = ['480x270', '340x84'], CORNER_PX = 72;
ipcMain.on('popup-size', (event, width, height) => {
  const popup = BrowserWindow.fromWebContents(event.sender);
  if (!popup || !SIZES.includes(`${width}x${height}`)) return;
  const bounds = popup.getContentBounds(), top = screen.getDisplayMatching(bounds).workArea.y;
  // The nominal height, because display scaling can report 271 for 270 and that would creep on every switch
  const current = bounds.height < 130 ? 84 : 270;
  popup.setContentBounds({ x: bounds.x, y: Math.max(top, bounds.y + current - height), width, height });
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1040, height: 660, show: false, backgroundColor: '#0b0e14', autoHideMenuBar: true, webPreferences: { backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { width: 480, height: 270, useContentSize: true, show: false, frame: false, thickFrame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, webPreferences: { backgroundThrottling: false, preload: path.join(__dirname, 'preload.cjs') } },
  }));
  win.webContents.on('did-create-window', (popup) => {
    popup.setAlwaysOnTop(true, 'floating');
    popup.once('ready-to-show', () => popup.show());
    // Drag regions swallow mouse events on Windows, so the page can't tell when the pointer reaches the top right corner
    let wasInside = false;
    const watch = setInterval(() => {
      const point = screen.getCursorScreenPoint(), box = popup.getBounds(), right = box.x + box.width;
      const inside = point.x >= right - CORNER_PX && point.x < right && point.y >= box.y && point.y < box.y + CORNER_PX;
      if (inside !== wasInside) popup.webContents.send('popup-corner', inside);
      wasInside = inside;
    }, 80);
    popup.on('closed', () => clearInterval(watch));
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => app.quit());
  win.loadURL('http://localhost:1007/');
});
