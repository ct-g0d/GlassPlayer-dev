// Native Windows animations for frameless Electron windows.
// Windows only plays the minimize / maximize / restore animations for windows that have WS_SYSMENU,
// and Electron leaves that style off frameless windows. This adds it back (measured: 5 -> 11 animation
// frames on minimize, same as Chrome). No-op on other platforms or if koffi is missing.
// It also gives the window Planner's taskbar identity (below).
// Same file in Mac X and every standalone app; usage: require('./native-window.cjs')(win)

const GWL_STYLE = -16;
const WS_SYSMENU = 0x80000n;
const SWP_FRAMECHANGED_ONLY = 0x0001 | 0x0002 | 0x0004 | 0x0020; // NOSIZE | NOMOVE | NOZORDER | FRAMECHANGED

let user32;
function api() {
  if (user32 !== undefined) return user32;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    user32 = {
      getStyle: lib.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
      setStyle: lib.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
      setPos: lib.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    };
  } catch (err) {
    console.warn('[native-window] koffi unavailable, native animations stay off:', err.message);
    user32 = null;
  }
  return user32;
}

function addSysMenu(win) {
  if (process.platform !== 'win32' || win.isDestroyed()) return;
  const u = api();
  if (!u) return;
  const buf = win.getNativeWindowHandle();
  const hwnd = buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
  const style = BigInt(u.getStyle(hwnd, GWL_STYLE));
  if (style & WS_SYSMENU) return;
  u.setStyle(hwnd, GWL_STYLE, style | WS_SYSMENU);
  u.setPos(hwnd, 0, 0, 0, 0, 0, SWP_FRAMECHANGED_ONLY);
}

/* One product, Planner: every window of Mac X and of each app carries the same Windows app identity, so they all sit under one
   taskbar button, shown with Planner's icon and name (a pinned button starts Planner). The apps keep their own names inside */
const fs = require('node:fs');
const path = require('node:path');
const PLANNER_EXE = 'D:\\Dev\\Nexus\\Planner\\Planner.exe';
const PLANNER_ICON = [path.join(__dirname, 'planner.ico'), 'D:/Dev/Nexus/assets/icons/planner.ico'].find((f) => fs.existsSync(f));
// The whole process too, so a window that never comes through here (a pop-up) still groups with the rest
try { if (process.platform === 'win32') require('electron').app.setAppUserModelId('Planner'); } catch {}
function plannerIdentity(win) {
  if (process.platform !== 'win32' || win.isDestroyed()) return;
  try {
    win.setAppDetails({ appId: 'Planner', relaunchDisplayName: 'Planner', relaunchCommand: `"${PLANNER_EXE}"`,
      ...(PLANNER_ICON ? { appIconPath: PLANNER_ICON, appIconIndex: 0 } : {}) });
  } catch (err) { console.warn('[native-window] could not set the Planner identity:', err.message); }
}

module.exports = function nativeWindowAnimations(win) {
  plannerIdentity(win);
  addSysMenu(win);
  // Electron can rewrite the style when the window state changes, so put it back each time
  for (const ev of ['show', 'restore', 'maximize', 'unmaximize', 'leave-full-screen']) win.on(ev, () => addSysMenu(win));
};
