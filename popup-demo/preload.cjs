const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gpWindow', {
  setSize: (width, height) => ipcRenderer.send('popup-size', width, height),
  onCorner: (listener) => ipcRenderer.on('popup-corner', (_, inside) => listener(inside)),
});
