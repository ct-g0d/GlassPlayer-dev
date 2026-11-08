// Keeps everything an app writes on D instead of C: its Chromium profile (Local Storage, IndexedDB, caches; C:\Users\<you>\AppData\
// Roaming before), its temp files and those of the tools it runs (ffmpeg, yt-dlp), its logs and crash dumps, and what it saves
// for you (screenshots, exports, downloads: D:\Dev\Nexus\Downloads, not C:\Users\<you>\Downloads).
// Call it first, before app is ready and before anything else asks for a path. The first launch after the move copies the old
// profile across (through a temporary folder, so a copy that fails halfway is tried again next time instead of leaving half a
// profile); the copy on C is left as it was.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.NEXUS_USERDATA || 'D:/Dev/Nexus/UserData';   // movable like NEXUS_DATA (a test run uses its own)
const DOWNLOADS = process.env.NEXUS_DOWNLOADS || path.join(path.dirname(ROOT), 'Downloads');
const SKIP = /[\\/](Singleton\w*|lockfile|DevToolsActivePort)$/;   // per-run lock files, not data

module.exports = function keepUserDataOnD(app, name) {
  const target = path.join(ROOT, name);
  const old = path.join(app.getPath('appData'), name);
  try {
    if (!fs.existsSync(target) && fs.existsSync(old)) {
      const tmp = target + '.copying';
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.cpSync(old, tmp, { recursive: true, filter: (src) => !SKIP.test(src) });
      fs.renameSync(tmp, target);
    }
  } catch (err) {
    console.error('[userdata] could not copy', old, 'to', target, err);
  }
  app.setPath('userData', target);

  // Temp: set in the environment, so Chromium's own processes and every tool the app starts (they inherit it) use it too
  const temp = path.join(ROOT, 'Temp');
  const cache = path.join(ROOT, 'cache');   // yt-dlp and other tools keep their cache under XDG_CACHE_HOME (else ~/.cache on C)
  try { for (const dir of [temp, cache, DOWNLOADS]) fs.mkdirSync(dir, { recursive: true }); } catch {}
  process.env.TEMP = process.env.TMP = temp;
  process.env.XDG_CACHE_HOME = cache;
  app.setPath('temp', temp);
  app.setPath('downloads', DOWNLOADS);
  app.setPath('logs', path.join(target, 'logs'));
  app.setPath('crashDumps', path.join(target, 'Crashpad'));
};
