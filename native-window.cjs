// Native Windows animations for frameless Electron windows.
// Windows only plays the minimize / maximize / restore animations for windows that have WS_SYSMENU,
// and Electron leaves that style off frameless windows. This adds it back (measured: 5 -> 11 animation
// frames on minimize, same as Chrome). No-op on other platforms or if koffi is missing.
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

module.exports = function nativeWindowAnimations(win) {
  addSysMenu(win);
  // Electron can rewrite the style when the window state changes, so put it back each time
  for (const ev of ['show', 'restore', 'maximize', 'unmaximize', 'leave-full-screen']) win.on(ev, () => addSysMenu(win));
};
