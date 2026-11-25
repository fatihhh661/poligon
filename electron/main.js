const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win = null;
let dirty = false;

// ---------------- günlük ----------------
// Taşınabilir exe ise günlük exe'nin yanına yazılır (kullanıcı kolayca bulabilsin).
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || null;
function logFiles() {
  const list = [];
  if (portableDir) list.push(path.join(portableDir, 'PoligonPro-gunluk.txt'));
  try { list.push(path.join(app.getPath('userData'), 'PoligonPro-gunluk.txt')); } catch (e) { /* */ }
  return list;
}
function log(msg) {
  const line = `[${new Date().toLocaleString('tr-TR')}] ${msg}\r\n`;
  for (const f of logFiles()) {
    try { fs.appendFileSync(f, line); } catch (e) { /* */ }
  }
}
process.on('uncaughtException', (e) => {
  log('HATA (ana süreç): ' + ((e && e.stack) || e));
  try { dialog.showErrorBox('Poligon Pro - Hata', String((e && e.message) || e)); } catch (x) { /* */ }
});

// ---------------- uyumluluk (güvenli) modu ----------------
// Önceki açılış tamamlanamadıysa (ekran kartı kaynaklı çökme) yazılım çizimine geçilir.
const stateFile = path.join(app.getPath('userData'), 'baslatma.json');
let st = { pending: false, safe: false };
try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (e) { /* ilk açılış */ }
const forceSafe = process.argv.includes('--guvenli');
const forceHw = process.argv.includes('--donanim');
let safeMode = !forceHw && (forceSafe || st.safe || st.pending);
if (st.pending && !st.safe) log('Önceki açılış tamamlanamamış: uyumluluk moduna geçiliyor.');
function saveState(o) {
  st = { ...st, ...o };
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(st)); } catch (e) { /* */ }
}
saveState({ pending: true });

log(`--- Poligon Pro başlatılıyor | Electron ${process.versions.electron} | Windows ${os.release()} | ${os.arch()} | RAM ${(os.totalmem() / 1073741824).toFixed(1)} GB | mod: ${safeMode ? 'UYUMLULUK' : 'normal'}`);

app.commandLine.appendSwitch('disable-gpu-sandbox');
if (safeMode) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
}

function relaunchSafe(reason) {
  if (safeMode) return false;
  log('Ekran kartı sorunu (' + reason + '): uyumluluk modunda yeniden başlatılıyor.');
  saveState({ safe: true, pending: false });
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--donanim').concat('--guvenli') });
  app.exit(0);
  return true;
}

app.on('child-process-gone', (_e, d) => {
  log(`Alt süreç kapandı: ${d.type} / ${d.reason} / kod ${d.exitCode}`);
  if (d.type === 'GPU' && ['crashed', 'launch-failed', 'abnormal-exit', 'oom'].includes(d.reason) && !booted) relaunchSafe('GPU ' + d.reason);
});
app.on('gpu-info-update', () => {});

let booted = false;

function createWindow() {
  log('Pencere oluşturuluyor');
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    show: true,
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
  win.maximize();
  win.loadFile(path.join(__dirname, '..', 'app', 'index.html')).catch((e) => log('Sayfa yüklenemedi: ' + e));
  win.webContents.on('did-finish-load', () => log('Arayüz yüklendi'));
  win.webContents.on('did-fail-load', (_e, code, desc) => log(`Sayfa yükleme hatası: ${code} ${desc}`));
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) log('Arayüz: ' + message); });
  win.webContents.on('render-process-gone', (_e, d) => {
    log(`Arayüz süreci kapandı: ${d.reason} / kod ${d.exitCode}`);
    if (!booted && relaunchSafe('arayüz ' + d.reason)) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'error', buttons: ['Yeniden Başlat', 'Kapat'], title: 'Poligon Pro',
      message: 'Program beklenmedik şekilde durdu.',
      detail: 'Yeniden başlatmayı deneyin. Sorun sürerse PoligonPro-gunluk.txt dosyasını gönderin.',
    });
    if (r === 0) win.reload(); else app.quit();
  });
  win.webContents.on('unresponsive', () => log('Arayüz yanıt vermiyor'));
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
  win.on('closed', () => log('Pencere kapatıldı'));
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

ipcMain.handle('save-video', async (_e, { defName, data, ext }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Videoyu Kaydet',
    defaultPath: path.join(app.getPath('videos'), defName || 'parkur.' + (ext || 'mp4')),
    filters: [{ name: ext === 'webm' ? 'WebM Video' : 'MP4 Video', extensions: [ext || 'mp4'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.on('set-dirty', (_e, v) => { dirty = !!v; });
ipcMain.on('get-safe', (e) => { e.returnValue = safeMode; });
ipcMain.on('boot-log', (_e, m) => log('Açılış: ' + m));
ipcMain.on('booted', () => {
  booted = true;
  saveState({ pending: false, safe: safeMode });
  log('Program başarıyla açıldı' + (safeMode ? ' (uyumluluk modu)' : ''));
});
ipcMain.on('set-hw', (_e, on) => {
  // Ayarlardan "donanım hızlandırma" değiştirildi: yeniden başlat
  saveState({ safe: !on, pending: false });
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--guvenli' && a !== '--donanim').concat(on ? '--donanim' : '--guvenli') });
  app.exit(0);
});

app.whenReady().then(() => {
  log('Electron hazır');
  createWindow();
}).catch((e) => {
  log('Başlatma hatası: ' + ((e && e.stack) || e));
  dialog.showErrorBox('Poligon Pro - Başlatma hatası', String((e && e.message) || e));
});
app.on('window-all-closed', () => app.quit());
app.on('quit', (_e, code) => log('Program kapandı (kod ' + code + ')'));
