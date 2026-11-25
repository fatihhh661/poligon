const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isNative: true,
  saveFile: (o) => ipcRenderer.invoke('save-file', o),
  openFile: () => ipcRenderer.invoke('open-file'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  savePng: (o) => ipcRenderer.invoke('save-png', o),
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
});
