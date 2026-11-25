const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let dirty = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#050605',
    title: 'Poligon Pro',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d1014', symbolColor: '#cfd5dc', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  // dış bağlantıları tarayıcıda aç, uygulama içinde gezinmeyi engelle
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
  });
  win.on('close', (e) => {
    if (!dirty) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Kaydetmeden Çık', 'İptal'],
      defaultId: 1,
      cancelId: 1,
      title: 'Poligon Pro',
      message: 'Kaydedilmemiş değişiklikler var.',
      detail: 'Çıkarsanız son değişiklikler dosyaya kaydedilmez (otomatik yedek "Devam Et" ile açılabilir).',
    });
    if (r === 1) e.preventDefault();
  });
}

const docs = () => app.getPath('documents');

ipcMain.handle('save-file', async (_e, { path: p, defName, data }) => {
  let target = p;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Parkuru Kaydet',
      defaultPath: path.join(docs(), defName || 'parkur.parkur'),
      filters: [{ name: 'Parkur Dosyası', extensions: ['parkur'] }],
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, data, 'utf8');
  return target;
});

ipcMain.handle('open-file', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Parkur Aç',
    defaultPath: docs(),
    properties: ['openFile'],
    filters: [{ name: 'Parkur Dosyası', extensions: ['parkur', 'json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return { path: r.filePaths[0], data: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('read-file', async (_e, p) => {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
});

ipcMain.handle('save-png', async (_e, { defName, dataUrl }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Görüntüyü Kaydet',
    defaultPath: path.join(app.getPath('pictures'), defName || 'parkur.png'),
    filters: [{ name: 'PNG Resmi', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return r.filePath;
});

ipcMain.on('set-dirty', (_e, v) => { dirty = !!v; });

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
