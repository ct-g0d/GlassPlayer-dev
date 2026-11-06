/**
 * Glass Player - Electron Preload Script
 * 
 * Exposes window.glassAPI and window.electronAPI via contextBridge:
 * - Window controls: minimize, maximize, unmaximize, close, isMaximized
 * - Vault methods: getPath, getManifest, read, write, getStats
 * - Platform & environment metadata: platform, arch, isElectron, versions
 * - Popup demo helper: gpWindow
 */

const { contextBridge, ipcRenderer } = require('electron');

const glassAPI = Object.freeze({
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  unmaximize: () => ipcRenderer.invoke('window-unmaximize'),
  close: () => ipcRenderer.invoke('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  // Vault methods
  vault: Object.freeze({
    getPath: () => ipcRenderer.invoke('vault-get-path'),
    getManifest: () => ipcRenderer.invoke('vault-get-manifest'),
    read: (docName) => ipcRenderer.invoke('vault-read', docName),
    write: (docName, data, base) => ipcRenderer.invoke('vault-write', docName, data, base),
    getStats: () => ipcRenderer.invoke('vault-get-stats')
  }),

  // The remembered music folder (Settings → Default Music Folder): read, choose with the system dialog, list its songs
  music: Object.freeze({
    get: () => ipcRenderer.invoke('music-folder-get'),
    choose: () => ipcRenderer.invoke('music-folder-choose'),
    scan: () => ipcRenderer.invoke('music-folder-scan')
  }),

  // Platform and environment information
  platform: process.platform,
  arch: process.arch,
  isElectron: true,
  versions: Object.freeze({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  })
});

// Expose on both window.glassAPI and window.electronAPI
contextBridge.exposeInMainWorld('glassAPI', glassAPI);
contextBridge.exposeInMainWorld('electronAPI', glassAPI);

// Nexus's one theme (theme-sync.cjs): the launcher's Settings → Theme, followed live
// (the PiP popup runs sandboxed, where this file can't be required: it has no theme of its own to follow)
try { contextBridge.exposeInMainWorld('nexusTheme', require('./theme-sync.cjs').preload(ipcRenderer)); } catch {}

// Popup / PiP floating window helper
contextBridge.exposeInMainWorld('gpWindow', {
  setSize: (width, height) => ipcRenderer.send('popup-size', width, height),
  onCorner: (listener) => ipcRenderer.on('popup-corner', (_, inside) => listener(inside))
});
