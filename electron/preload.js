const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isNative: true,
  saveFile: (o) => ipcRenderer.invoke('save-file', o),
  openFile: () => ipcRenderer.invoke('open-file'),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  savePng: (o) => ipcRenderer.invoke('save-png', o),
  saveVideo: (o) => ipcRenderer.invoke('save-video', o),
  setDirty: (v) => ipcRenderer.send('set-dirty', v),
  safeMode: ipcRenderer.sendSync('get-safe'),
  bootLog: (m) => ipcRenderer.send('boot-log', m),
  booted: () => ipcRenderer.send('booted'),
  setHw: (on) => ipcRenderer.send('set-hw', on),
});
