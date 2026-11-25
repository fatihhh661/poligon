/** Dosya işlemleri: Electron'da yerel diyaloglar, tarayıcıda indirme/yükleme. */
const N = () => window.native || null;

const ls = {
  get(k, def = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kota */ }
  },
};
export { ls };

export const DEFAULT_SETTINGS = { kalite: 'yuksek', saat: 'ogle', ses: true, birlik: '', logo: null, snap: 0.1, ilkTur: true };
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...(ls.get('pp.settings') || {}) }; }
export function saveSettings(s) { ls.set('pp.settings', s); }

export function safeName(s) { return (s || 'parkur').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'parkur'; }

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/** Kaydet. path verilirse doğrudan yazar; yoksa diyalog açar. Dönen: kaydedilen yol | 'indirildi' | null */
export async function saveParkur(state, path = null) {
  const data = JSON.stringify(state, null, 1);
  const n = N();
  if (n) return await n.saveFile({ path, defName: safeName(state.bilgi.ad) + '.parkur', data, kind: 'parkur' });
  download(safeName(state.bilgi.ad) + '.parkur', new Blob([data], { type: 'application/json' }));
  return 'indirildi';
}

export async function openParkur(fileInput) {
  const n = N();
  if (n) {
    const r = await n.openFile();
    if (!r) return null;
    return { path: r.path, data: JSON.parse(r.data) };
  }
  return new Promise((resolve) => {
    fileInput.value = '';
    fileInput.onchange = async () => {
      const f = fileInput.files[0];
      if (!f) return resolve(null);
      try { resolve({ path: null, data: JSON.parse(await f.text()) }); } catch (e) { resolve({ error: true }); }
    };
    fileInput.click();
  });
}

export async function readParkur(path) {
  const n = N();
  if (!n) return null;
  const d = await n.readFile(path);
  return d ? JSON.parse(d) : null;
}

export async function savePng(name, dataUrl) {
  const n = N();
  if (n) return await n.savePng({ defName: safeName(name) + '.png', dataUrl });
  const blob = await (await fetch(dataUrl)).blob();
  download(safeName(name) + '.png', blob);
  return 'indirildi';
}

export function getRecent() { return ls.get('pp.recent', []); }
export function pushRecent(entry) {
  const list = getRecent().filter((r) => r.path !== entry.path);
  list.unshift(entry);
  ls.set('pp.recent', list.slice(0, 6));
}
export function removeRecent(path) { ls.set('pp.recent', getRecent().filter((r) => r.path !== path)); }
