import * as THREE from 'three';
import { Engine, QUALITY } from './engine.js';
import { Environment } from './environment.js';
import { getTextures } from './textures.js';
import { loadAssets } from './assets.js';
import { PlayMode } from './play.js';
import { THUMB_FILES } from './thumbsList.js';
import { initMaterials, CATALOG, isPoint, isTarget } from './objects.js';
import { Editor, emptyState } from './editor.js';
import { renderThumbs } from './thumbs.js';
import { Minimap } from './minimap.js';
import { hydrateIcons, icon } from './icons.js';
import { playIntro } from './audio.js';
import { sampleState, baseLineState } from './sample.js';
import { nextFrame, wait, DEG, fmtM, esc } from './util.js';
import * as store from './storage.js';
import {
  $, $$, toast, modal, confirmBox, initTooltips, buildLibrary, renderProps, syncProps,
  renderParkur, updateStats, renderMesafe, renderEmniyet, KEYS,
} from './ui.js';

const S = store.loadSettings();
const SAFE = !!window.native?.safeMode;
if (SAFE) S.kalite = 'dusuk';
let engine, env, ed, minimap, thumbs = {};
let docPath = null;
let dirty = false;
let phase = 'splash';
let activeView = null;
let play = null;

function startPlay() {
  if (phase !== 'editor') return;
  if (!play) play = new PlayMode({ engine, editor: ed, env, settings: S, toast, onExit: () => { phase = 'editor'; renderAll(); } });
  phase = 'play';
  play.enter();
  window.__pp.play = play;
}

// ======================= AÇILIŞ =======================
const T0 = performance.now();
const progress = (p, txt) => {
  if (txt) window.native?.bootLog?.(`${Math.round(p * 100)}% ${txt}`);
  $('#spBar').style.width = Math.round(p * 100) + '%';
  $('#spPct').textContent = Math.round(p * 100) + '%';
  if (txt) $('#spTxt').textContent = txt;
};
let skipRequested = false;
$('#splash').addEventListener('click', () => (skipRequested = true));
const clockTick = () => {
  const d = new Date();
  const t = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const st = $('#spTime');
  if (st) st.textContent = t;
  $('#mnClock').textContent = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' }) + ' · ' + t.slice(0, 5);
};
setInterval(clockTick, 1000);

function applyBranding() {
  const u = (S.birlik || '').trim();
  $('#spUnit').textContent = u.toLocaleUpperCase('tr-TR');
  $('#mnUnit').textContent = u.toLocaleUpperCase('tr-TR');
  for (const el of $$('[data-emblem="full"]')) {
    if (S.logo) el.innerHTML = `<img src="${S.logo}" style="width:100%;height:100%;object-fit:contain">`;
    else { el.innerHTML = ''; }
  }
  hydrateIcons();
}

async function boot() {
  hydrateIcons();
  applyBranding();
  clockTick();
  initTooltips();
  setTimeout(() => playIntro(S.ses), 250);
  progress(0.03, 'Yazı tipleri yükleniyor');
  try {
    await Promise.all([document.fonts.load('700 20px Rajdhani'), document.fonts.load('600 20px Rajdhani'), document.fonts.load('400 13px Inter')]);
  } catch (e) { /* */ }
  await nextFrame();

  progress(0.08, 'Grafik motoru başlatılıyor');
  engine = new Engine($('#stage'));
  await nextFrame();

  progress(0.12, 'Fotoğraf dokuları ve modeller yükleniyor');
  try {
    await loadAssets(engine.renderer, (p) => progress(0.12 + p * 0.2));
  } catch (e) {
    console.warn('Varlıklar yüklenemedi, basit görünüm kullanılacak', e);
  }
  const tex = getTextures(engine.renderer);
  initMaterials(tex);
  progress(0.34, 'Gökyüzü ve ışık hesaplanıyor');
  await nextFrame();

  env = new Environment(engine.renderer, engine.scene, tex);
  env.quality = S.kalite;
  await env.setTime(S.saat);
  ed = new Editor(engine, env);
  ed.opts.snap = S.snap;
  engine.initControls();
  engine.setQuality(S.kalite, env);
  window.addEventListener('resize', () => engine.resize());

  progress(0.42, 'Arazi ve poligon inşa ediliyor');
  await nextFrame();
  env.build(30, 45);
  progress(0.62, 'Bitki örtüsü yerleştiriliyor');
  await nextFrame();

  // menü arka planı: fotoğraftaki gibi düz hedef hattı
  ed.opts.labels = false;
  ed.opts.autoDist = false;
  ed.load({ ...emptyState(), items: baseLineState() });

  progress(0.7, 'Eleman kütüphanesi hazırlanıyor');
  // önceden üretilmiş önizlemeler (scripts/make-thumbs.cjs); eksik olanlar çizilir
  const missing = Object.keys(CATALOG).filter((t) => !THUMB_FILES.includes(t));
  for (const t of THUMB_FILES) thumbs[t] = `assets/thumbs/${t}.png`;
  if (missing.length) Object.assign(thumbs, await renderThumbs((p) => progress(0.7 + p * 0.22), missing));
  progress(0.92);
  window.__thumbs = thumbs;
  buildLibrary(thumbs);

  progress(0.95, 'Gölgelendiriciler derleniyor');
  setupSplashCamera();
  engine.start();
  try { await engine.renderer.compileAsync(engine.scene, engine.camera); } catch (e) { engine.renderer.compile(engine.scene, engine.camera); }
  await nextFrame();
  await nextFrame();
  progress(1, 'Hazır');
  // Açılış başarılı: gölgelendiriciler derlendi ve kareler çizildi. Bildirim açılış animasyonundan sonra
  // gönderildiğinde, pencere arka planda kalınca tarayıcı zamanlayıcıları kısıp animasyonu dakikalarca
  // uzatıyor, bildirim gitmiyor ve sonraki açılış yanlışlıkla kalıcı uyumluluk moduna düşüyordu.
  window.native?.booted?.();

  minimap = new Minimap($('#mmCanvas'), ed, engine);
  window.__pp = { engine, env, ed, renderThumbs }; // renderThumbs: önizleme PNG'lerini yeniden üretmek için
  wireEditor();
  wireUI();

  const minShow = 3200;
  while (performance.now() - T0 < minShow && !skipRequested) await wait(50);
  await revealScene();
  showMenu(true);
  const gpu = engine.gpuName();
  if (/Intel|UHD|Iris|Radeon\(TM\) Graphics|Microsoft Basic|SwiftShader/i.test(gpu) && !/NVIDIA|RTX|GTX/i.test(gpu))
    setTimeout(() => modal({ title: 'Ekran kartı uyarısı', ikon: 'alert', width: 600, body: `<div class="about"><p>Program şu an <b>${esc(gpu)}</b> ile çalışıyor. Bu, işlemcinin içindeki zayıf grafik çipi; yüksek grafiklerde kasmanın sebebi budur.</p><p>NVIDIA kartını kullanmak için: <b>Windows Ayarlar → Sistem → Ekran → Grafik</b> → listeden <b>PoligonPro</b>'yu seçin (yoksa <b>Gözat</b> ile PoligonPro.exe'yi ekleyin) → <b>Seçenekler → Yüksek performans</b> → Kaydet. Sonra programı yeniden açın.</p></div>` }), 1500);
  if (SAFE) toast('Program uyumluluk modunda çalışıyor (ekran kartı yerine yazılımla çizim). Ayarlar\'dan değiştirebilirsiniz.', 'ok', 7000);
}

let cineT = 0;
function setupSplashCamera() {
  engine.controls.enabled = false;
  const cam = engine.camera;
  const p0 = new THREE.Vector3(-10, 1.4, 16), p1 = new THREE.Vector3(3, 9.5, -6);
  const l0 = new THREE.Vector3(0, 1.2, -43), l1 = new THREE.Vector3(0, 0.5, -40);
  cineT = 0;
  engine.cinematic = (dt) => {
    cineT += dt;
    const k = Math.min(1, cineT / 9);
    const e = 1 - Math.pow(1 - k, 2.2);
    cam.position.lerpVectors(p0, p1, e);
    const l = l0.clone().lerp(l1, e);
    cam.lookAt(l);
    engine.controls.target.copy(l);
  };
  engine.cinematic(0);
}

async function revealScene() {
  cineT = 0;
  const sp = $('#splash');
  sp.classList.add('reveal');
  $('.sp-title').classList.add('sweep');
  await waitOrSkip(skipRequested ? 600 : 2800);
}
async function waitOrSkip(ms) {
  const t = performance.now();
  skipRequested = false;
  while (performance.now() - t < ms && !skipRequested) await wait(40);
}

// ======================= MENÜ =======================
function showMenu(fromSplash = false) {
  phase = 'menu';
  ed.enabled = false;
  ed.setMode('sec');
  $('#app').classList.add('is-hidden');
  $('#stage').appendChild(engine.renderer.domElement);
  engine.container = $('#stage');
  engine.resize();
  engine.controls.enabled = false;
  if (!fromSplash) {
    // menü arka planı için temel hattı göster
    ed.load({ ...emptyState(), items: baseLineState() });
  }
  engine.cinematic = null;
  engine.setSelected([]);
  ed.setLabelsVisible(false);
  ed.opts.autoDist = false;
  ed.refreshAuto();
  engine.startAutoOrbit(new THREE.Vector3(0, 3, -26), 38, 6.5, 0.035);
  const sp = $('#splash');
  if (!sp.classList.contains('fade-out')) {
    sp.classList.add('fade-out');
    setTimeout(() => sp.remove(), 1100);
  }
  $('#menu').classList.remove('is-hidden');
  // devam et
  const auto = store.ls.get('pp.autosave');
  const dv = $('#mnDevam');
  if (auto && auto.state && auto.state.items?.length) {
    dv.classList.remove('is-hidden');
    $('#mnDevamTxt').textContent = `“${auto.state.bilgi?.ad || 'Parkur'}” · ${new Date(auto.time).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`;
  } else dv.classList.add('is-hidden');
  renderRecent();
}

function renderRecent() {
  const list = store.getRecent();
  const el = $('#recentList');
  if (!list.length) {
    el.innerHTML = `<div class="rc-empty">Henüz kaydedilmiş parkur yok.<br><small>Kaydettiğiniz parkurlar burada önizlemeleriyle listelenir.</small></div>`;
    return;
  }
  el.innerHTML = list.map((r) => `<div class="rc" data-path="${esc(r.path)}"><img src="${r.thumb || ''}"><div><b>${esc(r.name)}</b><small>${new Date(r.date).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</small><br><small>${esc(r.path)}</small></div></div>`).join('');
}

// ======================= EDİTÖR =======================
function enterEditor(state, { path = null, view = 'genel' } = {}) {
  phase = 'editor';
  $('#menu').classList.add('is-hidden');
  $('#app').classList.remove('is-hidden');
  const vp = $('#viewport');
  vp.prepend(engine.renderer.domElement);
  engine.container = vp;
  engine.stopAutoOrbit();
  engine.cinematic = null;
  engine.controls.enabled = true;
  ed.enabled = true;
  ed.opts.labels = $('[data-cmd="etiket"]').classList.contains('on');
  ed.opts.autoDist = $('[data-cmd="oto"]').classList.contains('on');
  ed.load(state);
  ed.undoStack = [];
  ed.redoStack = [];
  docPath = path;
  setDirty(false);
  requestAnimationFrame(() => {
    engine.resize();
    setView(view, true);
  });
  renderAll();
  if (S.ilkTur) setTimeout(welcomeTour, 900);
}

function setDirty(v) {
  dirty = v;
  $('#docDirty').classList.toggle('on', v);
  window.native?.setDirty?.(v);
}

function renderAll() {
  $('#docName').textContent = ed.state.bilgi.ad || 'Parkur';
  renderProps(ed, thumbs);
  renderParkur(ed);
  renderMesafe(ed);
  renderEmniyet(ed);
  updateStatus();
}

function updateStatus() {
  const A = ed.analyze();
  $('#stSummary').innerHTML = `<b>${A.targets.length}</b> hedef · <b>${A.atim}</b> atım · <b>${A.points.length}</b> atış noktası`;
  $('#stQuality').innerHTML = `Grafik: <b>${QUALITY[engine.quality].ad}</b> · <span title="Kullanılan ekran kartı">${esc(engine.gpuName())}</span>`;
}

let autosaveTimer = null;
function wireEditor() {
  ed.on('select', () => {
    renderProps(ed, thumbs);
  });
  ed.on('change', (x = {}) => {
    if (phase !== 'editor') return;
    if (!x.load) setDirty(true);
    $('#docName').textContent = ed.state.bilgi.ad || 'Parkur';
    renderProps(ed, thumbs);
    const pk = $('#tab-parkur');
    if (x.load || (!x.info && !pk.contains(document.activeElement))) renderParkur(ed);
    else updateStats(ed);
    renderMesafe(ed);
    renderEmniyet(ed);
    updateStatus();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => store.ls.set('pp.autosave', { state: ed.state, path: docPath, time: Date.now() }), 800);
  });
  ed.on('live', () => syncProps(ed));
  ed.on('mode', (m, type) => {
    $$('.tbtn.mode').forEach((b) => b.classList.toggle('on', b.dataset.cmd === m || (m === 'yerlestir' && false)));
    $$('.lib-item').forEach((el) => el.classList.toggle('on', m === 'yerlestir' && el.dataset.type === ed.placeType));
    const chip = $('#hud-mode');
    if (m === 'yerlestir' && ed.placeType) {
      chip.innerHTML = `<b>${esc(CATALOG[ed.placeType].ad)}</b> — sahnede yerine tıklayın · <kbd>Shift</kbd> art arda · <kbd>Esc</kbd> iptal`;
      chip.classList.remove('is-hidden');
    } else if (m === 'olc') {
      chip.innerHTML = ed.measureA ? 'Bitiş noktasına tıklayın · <kbd>Esc</kbd> iptal' : 'ÖLÇÜM — başlangıç noktasına tıklayın · <kbd>Esc</kbd> çıkış';
      chip.classList.remove('is-hidden');
    } else chip.classList.add('is-hidden');
  });
  ed.on('cursor', (p) => {
    $('#stCoord').innerHTML = p ? `X: <b>${fmtM(p.x)}</b> · Atış hattından: <b>${fmtM(-p.z)}</b>` : 'X: — · Atış hattından: —';
  });

  // pusula + harita + fps
  let acc = 0;
  engine.onFrame.push((dt) => {
    if (phase !== 'editor') return;
    acc += dt;
    const c = engine.camera.position, t = engine.controls.target;
    const ang = Math.atan2(t.x - c.x, t.z - c.z);
    $('.cmp-arrow').style.transform = `rotate(${(ang - Math.PI) / DEG}deg)`;
    if (acc > 1 / 20) {
      acc = 0;
      minimap.draw();
      $('#stFps').textContent = Math.round(engine.fps) + ' FPS';
    }
  });
}

// ---------------- kamera görünümleri ----------------
function setView(v, instant = false) {
  const { w, d } = ed.state.poligon;
  const cam = engine.camera;
  const tanH = Math.tan((cam.fov * DEG) / 2);
  let pos, tgt;
  const items = ed.state.items;
  const points = items.filter((i) => isPoint(i.type));
  const targets = items.filter((i) => isTarget(i.type) || CATALOG[i.type]?.rol === 'dost');
  engine.onAutoOrbitStop = null;
  switch (v) {
    case 'kus': {
      const H = Math.max((d + 8) / (2 * tanH), (w + 8) / (2 * tanH * cam.aspect)) * 1.02;
      tgt = new THREE.Vector3(0, 0, -d / 2 + 2);
      pos = new THREE.Vector3(0, H, -d / 2 + 2.02);
      break;
    }
    case 'genel':
      tgt = new THREE.Vector3(0, 0, -d * 0.42);
      pos = new THREE.Vector3(w * 0.62, Math.max(13, d * 0.36), 15);
      break;
    case 'atici': {
      const cur = ed.cur();
      const p = cur && isPoint(cur.type) ? cur : points[0] || { x: 0, z: 0, rot: 0 };
      const r = p.rot || 0;
      const fx = -Math.sin(r), fz = -Math.cos(r);
      pos = new THREE.Vector3(p.x - fx * 0.2, 1.65, p.z - fz * 0.2);
      tgt = new THREE.Vector3(p.x + fx * 14, 1.2, p.z + fz * 14);
      if (!points.length) toast('Atış noktası olmadığından atış hattı merkezinden bakılıyor.', 'ok', 3000);
      break;
    }
    case 'hedef': {
      if (!targets.length) {
        tgt = new THREE.Vector3(0, 1, 0);
        pos = new THREE.Vector3(0, 1.8, -d + 2);
        break;
      }
      const c = ed.centroid(targets);
      const zmin = Math.min(...targets.map((t) => t.z));
      const pc = ed.centroid(points) || new THREE.Vector3(0, 0, 0);
      pos = new THREE.Vector3(c.x, 1.8, zmin - 3);
      tgt = new THREE.Vector3(pc.x, 1.1, pc.z);
      break;
    }
    case 'yan':
      tgt = new THREE.Vector3(0, 1, -d / 2);
      pos = new THREE.Vector3(w / 2 + Math.max(18, d * 0.45), 6, -d / 2 + 4);
      break;
    case 'drone':
      engine.startAutoOrbit(new THREE.Vector3(0, 0, -d / 2), Math.max(w, d) * 0.85, Math.max(12, d * 0.32), 0.09);
      engine.onAutoOrbitStop = () => markView(null);
      markView('drone');
      return;
  }
  markView(v);
  if (instant) {
    engine.camera.position.copy(pos);
    engine.controls.target.copy(tgt);
    engine.controls.update();
  } else engine.flyTo(pos, tgt, 1.2);
}
function markView(v) {
  activeView = v;
  $$('#viewDock button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
}

function focusSelected() {
  const it = ed.cur();
  if (!it) return;
  const c = it.type === 'olcu' ? new THREE.Vector3((it.a.x + it.b.x) / 2, 0.5, (it.a.z + it.b.z) / 2) : new THREE.Vector3(it.x, 0.8, it.z);
  const off = engine.camera.position.clone().sub(engine.controls.target).normalize().multiplyScalar(it.type === 'olcu' ? 14 : 6.5);
  if (off.y < 1.5) off.y = 2.5;
  engine.flyTo(c.clone().add(off), c, 0.9);
  markView(null);
}
function gotoItem(id) {
  ed.select(id);
  focusSelected();
}

// ---------------- dosya işlemleri ----------------
async function guardDirty() {
  if (!dirty) return true;
  return confirmBox('Kaydedilmemiş değişiklikler var. Devam ederseniz bu değişiklikler kaybolacak (otomatik yedek saklanır).', 'Devam et', true);
}

async function newDoc() {
  if (phase === 'editor' && !(await guardDirty())) return;
  const st = emptyState();
  st.bilgi.birlik = S.birlik || '';
  enterEditor(st);
  toast('Yeni parkur oluşturuldu. Kütüphaneden eleman sürükleyerek başlayın.');
}

async function openDoc() {
  if (phase === 'editor' && !(await guardDirty())) return;
  const r = await store.openParkur($('#fileIn'));
  if (!r) return;
  if (r.error || !r.data || !Array.isArray(r.data.items)) return toast('Dosya okunamadı: geçerli bir parkur dosyası değil.', 'err');
  enterEditor(r.data, { path: r.path });
  if (r.path) store.pushRecent({ path: r.path, name: r.data.bilgi?.ad || 'Parkur', date: Date.now(), thumb: await smallThumb() });
  toast(`“${esc(ed.state.bilgi.ad)}” açıldı.`);
}

async function openRecent(path) {
  try {
    const data = await store.readParkur(path);
    if (!data) throw new Error('yok');
    enterEditor(data, { path });
  } catch (e) {
    toast('Dosya bulunamadı veya okunamadı. Listeden kaldırıldı.', 'err');
    store.removeRecent(path);
    renderRecent();
  }
}

async function saveDoc(as = false) {
  if (phase !== 'editor') return;
  try {
    const r = await store.saveParkur(ed.state, as ? null : docPath);
    if (!r) return;
    if (r !== 'indirildi') {
      docPath = r;
      store.pushRecent({ path: r, name: ed.state.bilgi.ad, date: Date.now(), thumb: await smallThumb() });
    }
    setDirty(false);
    toast(r === 'indirildi' ? 'Parkur dosyası indirildi.' : `Kaydedildi: ${esc(r)}`);
  } catch (e) {
    toast('Kaydetme başarısız: ' + esc(e.message || e), 'err');
  }
}

async function smallThumb() {
  try {
    const url = engine.capture(480, 270);
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 135;
    c.getContext('2d').drawImage(img, 0, 0, 240, 135);
    return c.toDataURL('image/jpeg', 0.75);
  } catch (e) { return null; }
}

async function exportPng() {
  toast('Görüntü hazırlanıyor...', 'ok', 1200);
  await nextFrame();
  const W = 2560, H = 1440;
  const url = engine.capture(W, H);
  const img = new Image();
  img.src = url;
  await img.decode();
  // bilgi şeridi ekle
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const bh = 120;
  const grd = g.createLinearGradient(0, H - bh - 60, 0, H);
  grd.addColorStop(0, 'rgba(8,10,12,0)');
  grd.addColorStop(0.4, 'rgba(8,10,12,0.75)');
  grd.addColorStop(1, 'rgba(8,10,12,0.92)');
  g.fillStyle = grd;
  g.fillRect(0, H - bh - 60, W, bh + 60);
  let x = 48;
  if (S.logo) {
    try {
      const li = new Image();
      li.src = S.logo;
      await li.decode();
      const s = 84 / Math.max(li.width, li.height);
      g.drawImage(li, x, H - bh + 10, li.width * s, li.height * s);
      x += li.width * s + 24;
    } catch (e) { /* */ }
  }
  const b = ed.state.bilgi;
  const A = ed.analyze();
  g.fillStyle = '#d6a646';
  g.fillRect(x, H - bh + 14, 6, 76);
  g.fillStyle = '#f3efe4';
  g.font = '700 52px Rajdhani';
  g.fillText(`${b.no ? 'PARKUR ' + b.no + ' · ' : ''}${(b.ad || '').toLocaleUpperCase('tr-TR')}`, x + 24, H - bh + 58);
  g.font = '600 26px Rajdhani';
  g.fillStyle = '#b9b3a2';
  g.fillText([b.birlik || S.birlik, b.tarih, `${A.targets.length} hedef · ${A.atim} atım · ${A.points.length} atış noktası`].filter(Boolean).join('   ·   '), x + 24, H - bh + 96);
  g.textAlign = 'right';
  g.font = '700 26px Rajdhani';
  g.fillStyle = 'rgba(243,239,228,0.55)';
  g.fillText('POLİGON PRO', W - 48, H - 40);
  const out = c.toDataURL('image/png');
  const r = await store.savePng((b.ad || 'parkur') + ' - görünüm', out);
  if (r) toast(r === 'indirildi' ? 'PNG indirildi.' : `PNG kaydedildi: ${esc(r)}`);
}

// ---------------- ayarlar / hakkında / tur ----------------
async function openSettings() {
  const body = `
    <div class="sec"><div class="sec-title">GRAFİK</div>
      <div class="fld"><label>Grafik kalitesi</label><div class="seg" id="setQ">${Object.entries(QUALITY).map(([k, q]) => `<button data-v="${k}" class="${engine.quality === k ? 'on' : ''}">${q.ad}</button>`).join('')}</div>
      <small style="color:var(--muted)">Ultra: ortam gölgelemesi (AO) ve en keskin gölgeler. Yavaş bilgisayarlarda Orta önerilir.</small></div>
      <div class="fld"><label>Günün saati</label><div class="seg" id="setT">${[['sabah', 'Sabah'], ['ogle', 'Öğle'], ['aksam', 'Akşam Üstü']].map(([k, n]) => `<button data-v="${k}" class="${S.saat === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    </div>
    <div class="sec"><div class="sec-title">KURUM</div>
      <div class="fld"><label>Birlik / merkez adı (açılışta, menüde ve çıktılarda görünür)</label><input type="text" id="setUnit" value="${esc(S.birlik)}" placeholder="Örn: ... Eğitim Merkezi Komutanlığı"></div>
      <div class="fld"><label>Logo</label><div class="logo-prev"><img id="setLogoImg" src="${S.logo || ''}" style="${S.logo ? '' : 'visibility:hidden'}"><button class="btn" id="setLogoBtn">Logo seç...</button><button class="btn danger" id="setLogoDel">Kaldır</button></div></div>
    </div>
    <div class="sec"><div class="sec-title">DİĞER</div>
      <div class="fld"><label>Açılış sesi</label><div class="seg" id="setS"><button data-v="1" class="${S.ses ? 'on' : ''}">Açık</button><button data-v="0" class="${!S.ses ? 'on' : ''}">Kapalı</button></div></div>
      ${window.native ? `<div class="fld"><label>Donanım hızlandırma (ekran kartı)</label><div class="seg" id="setHw"><button data-v="1" class="${!SAFE ? 'on' : ''}">Açık</button><button data-v="0" class="${SAFE ? 'on' : ''}">Kapalı (uyumluluk)</button></div><small style="color:var(--muted)">Değiştirildiğinde program yeniden başlar. Program açılmıyor veya çöküyorsa Kapalı seçin.</small></div>` : ''}
      <div class="fld"><label>Hoş geldiniz ipuçları</label><div class="seg" id="setTour"><button data-v="1" class="${S.ilkTur ? 'on' : ''}">Göster</button><button data-v="0" class="${!S.ilkTur ? 'on' : ''}">Gösterme</button></div></div>
    </div>`;
  await modal({
    title: 'Ayarlar', ikon: 'sliders', body, width: 560, buttons: [{ text: 'Tamam', primary: true }],
    onOpen: (m) => {
      const seg = (id, fn) => m.querySelector(id).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-v]');
        if (!b) return;
        m.querySelectorAll(id + ' button').forEach((x) => x.classList.toggle('on', x === b));
        fn(b.dataset.v);
        store.saveSettings(S);
      });
      seg('#setQ', (v) => {
        S.kalite = v;
        const treesChanged = env.quality !== v;
        env.quality = v;
        engine.setQuality(v, env);
        if (treesChanged) env.build(ed.state.poligon.w, ed.state.poligon.d);
        updateStatus();
      });
      seg('#setT', async (v) => { S.saat = v; await env.setTime(v); });
      seg('#setS', (v) => (S.ses = v === '1'));
      seg('#setTour', (v) => (S.ilkTur = v === '1'));
      if (m.querySelector('#setHw')) seg('#setHw', async (v) => {
        const on = v === '1';
        if (on === !SAFE) return;
        if (await confirmBox('Program yeniden başlatılacak. Kaydedilmemiş değişiklikler otomatik yedekte saklanır.', 'Yeniden başlat')) {
          store.ls.set('pp.autosave', { state: ed.state, path: docPath, time: Date.now() });
          setDirty(false);
          window.native.setHw(on);
        }
      });
      m.querySelector('#setUnit').addEventListener('input', (e) => { S.birlik = e.target.value; store.saveSettings(S); applyBranding(); });
      m.querySelector('#setLogoBtn').onclick = () => {
        const fi = $('#logoIn');
        fi.value = '';
        fi.onchange = () => {
          const f = fi.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => {
            const img = new Image();
            img.onload = () => {
              const s = Math.min(1, 256 / Math.max(img.width, img.height));
              const c = document.createElement('canvas');
              c.width = Math.round(img.width * s);
              c.height = Math.round(img.height * s);
              c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
              S.logo = c.toDataURL('image/png');
              store.saveSettings(S);
              m.querySelector('#setLogoImg').src = S.logo;
              m.querySelector('#setLogoImg').style.visibility = '';
              applyBranding();
            };
            img.src = rd.result;
          };
          rd.readAsDataURL(f);
        };
        fi.click();
      };
      m.querySelector('#setLogoDel').onclick = () => {
        S.logo = null;
        store.saveSettings(S);
        m.querySelector('#setLogoImg').style.visibility = 'hidden';
        applyBranding();
      };
    },
  });
}

function openAbout() {
  modal({
    title: 'Poligon Pro Hakkında', ikon: 'info', width: 600,
    body: `<div class="about"><p><b style="font:700 20px var(--head);letter-spacing:.1em">POLİGON <span style="color:var(--accent)">PRO</span></b> · Sürüm 1.0</p>
      <p>Atış parkurlarını sahaya gitmeden önce 3D ortamda tasarlamak, mesafeleri ölçmek, emniyet kontrolü yapmak ve personele sunmak için geliştirilmiş masaüstü programı.</p>
      <p style="font-size:12px;color:var(--muted)">Asker modeli: "Soldier Full Tactical Gear" – DanlyVostok (CC BY 4.0, Sketchfab). Tüfek: "Classic M4" – jeandiz (CC BY 4.0, Sketchfab). Dokular, gökyüzleri ve çevre modelleri: Poly Haven (CC0). Hareket kayıtları: Carnegie Mellon Üniversitesi Hareket Yakalama Veritabanı (mocap.cs.cmu.edu), BVH dönüşümü: B. Hahne; "The 100STYLE Dataset" – Ian Mason, Sebastian Starke, Taku Komura (CC BY 4.0, zenodo.org/records/8127870); tüfekli hareketler: Adobe Mixamo.</p>
      <p>Program tamamen <b>çevrimdışı</b> çalışır; hiçbir veri internete gönderilmez. Parkurlar bilgisayarınızda <b>.parkur</b> dosyası olarak saklanır.</p>
      <div class="sec-title" style="margin-top:16px">KLAVYE VE FARE</div>${KEYS}</div>`,
  });
}

async function welcomeTour() {
  if (phase !== 'editor' || !S.ilkTur) return;
  const r = await modal({
    title: 'Hoş geldiniz', ikon: 'target', width: 600,
    body: `<div class="about">
      <p><b>1. Eleman ekleyin:</b> Soldaki kütüphaneden hedef, tahta paravan, kaide gibi elemanları sahneye sürükleyip bırakın.</p>
      <p><b>2. Düzenleyin:</b> Elemanı sürükleyerek taşıyın. Turuncu halkayı çevirerek döndürün, mavi uçlardan uzatıp kısaltın.</p>
      <p><b>3. Mesafe:</b> Üstteki <b>Ölç</b> aracıyla iki nokta arasına oklu mesafe çizin. <b>Mesafeler</b> açıkken atış noktası–hedef uzaklıkları otomatik gösterilir.</p>
      <p><b>4. Bakış açıları:</b> Alttaki düğmelerle kuşbakışı, atıcı gözü, hedef arkası ve drone turu görünümlerine geçin.</p>
      <p><b>5. Kaydedin:</b> Ctrl+S ile parkuru kaydedin, PNG ile yüksek çözünürlüklü görüntü alın.</p></div>`,
    buttons: [{ text: 'Bir daha gösterme', value: 'never' }, { text: 'Başlayalım', primary: true, value: 'ok' }],
  });
  if (r === 'never') { S.ilkTur = false; store.saveSettings(S); }
}

// ---------------- arayüz bağlantıları ----------------
function wireUI() {
  // menü
  $('#mnCards').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'yeni') newDoc();
    else if (a === 'ac') openDoc();
    else if (a === 'ornek') { enterEditor(sampleState(), { view: 'genel' }); toast('Örnek parkur yüklendi: Kademeli Taarruz'); }
    else if (a === 'devam') {
      const auto = store.ls.get('pp.autosave');
      if (auto?.state) enterEditor(auto.state, { path: auto.path || null });
    } else if (a === 'ayarlar') openSettings();
    else if (a === 'hakkinda') openAbout();
  });
  $('#recentList').addEventListener('click', (e) => {
    const r = e.target.closest('.rc');
    if (r) openRecent(r.dataset.path);
  });

  // araç çubuğu
  $('#toolbar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    const c = b.dataset.cmd;
    if (c === 'menu') { if (await guardDirty()) { setDirty(false); showMenu(); } }
    else if (c === 'yeni') newDoc();
    else if (c === 'ac') openDoc();
    else if (c === 'kaydet') saveDoc(false);
    else if (c === 'geri') ed.undo() || toast('Geri alınacak işlem yok.', 'ok', 1400);
    else if (c === 'ileri') ed.redo() || toast('İleri alınacak işlem yok.', 'ok', 1400);
    else if (c === 'sec') ed.setMode('sec');
    else if (c === 'olc') ed.setMode(ed.mode === 'olc' ? 'sec' : 'olc');
    else if (c === 'oto') { ed.opts.autoDist = !ed.opts.autoDist; b.classList.toggle('on', ed.opts.autoDist); ed.refreshAuto(); }
    else if (c === 'etiket') { ed.setLabelsVisible(!ed.opts.labels); b.classList.toggle('on', ed.opts.labels); }
    else if (c === 'png') exportPng();
    else if (c === 'uygula') startPlay();
    else if (c === 'ayarlar') openSettings();
  });
  $('[data-cmd="oto"]').classList.add('on');
  $('[data-cmd="etiket"]').classList.add('on');
  $('[data-cmd="sec"]').classList.add('on');
  const snapSel = $('#snapSel');
  snapSel.value = String(S.snap);
  snapSel.addEventListener('change', () => { ed.opts.snap = +snapSel.value; S.snap = +snapSel.value; store.saveSettings(S); });

  // görünümler
  $('#viewDock').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });

  // sekmeler
  $('#sideTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    $$('#sideTabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
  });

  // özellikler paneli
  const op = $('#tab-ozellik');
  op.addEventListener('change', (e) => {
    const t = e.target, it = ed.cur();
    if (!it) return;
    const num = parseFloat(String(t.value).replace(',', '.'));
    if (t.dataset.f) {
      const f = t.dataset.f;
      if (f === 'x' && isFinite(num)) ed.setProp(it.id, 'x', num);
      else if (f === 'ileri' && isFinite(num)) ed.setProp(it.id, 'z', -num);
      else if (f === 'rotr' && isFinite(num)) ed.setProp(it.id, 'rot', num * DEG);
      else if (f === 'etiket') ed.setProp(it.id, 'etiket', t.value.trim());
    } else if (t.dataset.p) {
      const d = CATALOG[it.type].params.find((p) => p.k === t.dataset.p);
      if (d.tip === 'sayi') {
        if (!isFinite(num)) return;
        ed.setParam(it.id, d.k, Math.min(d.max, Math.max(d.min, num)));
      } else ed.setParam(it.id, d.k, t.value);
    } else if (t.dataset.m) {
      if (!isFinite(num)) return;
      const k = t.dataset.m;
      const pt = { ...it[k[0]] };
      if (k[1] === 'x') pt.x = num; else pt.z = -num;
      ed.setProp(it.id, k[0], pt);
    }
  });
  op.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.f === 'rotr') {
      const it = ed.cur();
      const v = +t.value;
      $('#rotOut').textContent = v + '°';
      it.rot = v * DEG;
      ed.objs.get(it.id).rotation.y = it.rot;
      ed.refreshGizmo();
      ed.refreshAuto();
    }
  });
  op.addEventListener('pointerdown', (e) => {
    if (e.target.dataset.f === 'rotr') ed.snapshot();
  });
  op.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) {
      const row = e.target.closest('[data-goto]');
      if (row) gotoItem(row.dataset.goto);
      return;
    }
    const it = ed.cur();
    if (b.dataset.act === 'del') ed.deleteSelected();
    else if (b.dataset.act === 'dup') ed.duplicateSelected();
    else if (b.dataset.act === 'focus') focusSelected();
    else if (b.dataset.p && it) ed.setParam(it.id, b.dataset.p, b.dataset.v);
    else if (b.dataset.c && it) ed.setProp(it.id, 'renk', b.dataset.c);
  });

  // parkur paneli
  const pk = $('#tab-parkur');
  pk.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.b) ed.setInfo(t.dataset.b, t.value);
    else if (t.dataset.r) {
      const v = parseFloat(t.value);
      if (!isFinite(v)) return;
      const w = t.dataset.r === 'w' ? v : ed.state.poligon.w;
      const d = t.dataset.r === 'd' ? v : ed.state.poligon.d;
      ed.setRange(w, d);
      toast('Poligon ölçüleri güncellendi.');
    }
  });
  pk.addEventListener('input', (e) => {
    if (e.target.dataset.b === 'ad') $('#docName').textContent = e.target.value || 'Parkur';
  });
  for (const id of ['#tab-mesafe', '#tab-emniyet']) {
    $(id).addEventListener('click', (e) => {
      const row = e.target.closest('[data-goto]');
      if (row) gotoItem(row.dataset.goto);
    });
  }
  $('#tab-emniyet').addEventListener('change', (e) => {
    if (e.target.dataset.e) {
      const v = parseFloat(e.target.value);
      if (isFinite(v)) { ed.snapshot(); ed.state.emniyet.celikMin = v; ed.changed(); }
    }
  });

  // kütüphane: tıkla veya sürükle-bırak
  const lib = $('#libList');
  let dragEl = null;
  lib.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.lib-item');
    if (!item || e.button !== 0 || phase !== 'editor') return;
    e.preventDefault();
    const type = item.dataset.type;
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const canvas = engine.renderer.domElement;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        dragging = true;
        ed.setMode('yerlestir', type);
        dragEl = document.createElement('img');
        dragEl.src = thumbs[type];
        dragEl.style.cssText = 'position:fixed;width:110px;pointer-events:none;z-index:99;opacity:.9;filter:drop-shadow(0 8px 16px #000);transform:translate(-50%,-60%)';
        document.body.appendChild(dragEl);
      }
      if (!dragging) return;
      const over = document.elementFromPoint(ev.clientX, ev.clientY) === canvas;
      dragEl.style.left = ev.clientX + 'px';
      dragEl.style.top = ev.clientY + 'px';
      dragEl.style.display = over ? 'none' : '';
      if (over) ed.externalDragMove(ev);
      else if (ed.ghost) ed.ghost.visible = false;
    };
    const upH = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', upH);
      if (dragEl) { dragEl.remove(); dragEl = null; }
      if (!dragging) {
        ed.setMode(ed.mode === 'yerlestir' && ed.placeType === type ? 'sec' : 'yerlestir', type);
        return;
      }
      const over = document.elementFromPoint(ev.clientX, ev.clientY) === canvas;
      if (over) ed.externalDrop(ev);
      else { ed.externalDrag = false; ed.setMode('sec'); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upH);
  });

  // klavye
  document.addEventListener('keydown', (e) => {
    if (phase !== 'editor' || $('#modalRoot').children.length) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); ed.undo(); }
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); ed.redo(); }
    else if (ctrl && k === 's') { e.preventDefault(); saveDoc(e.shiftKey); }
    else if (ctrl && k === 'o') { e.preventDefault(); openDoc(); }
    else if (ctrl && k === 'n') { e.preventDefault(); newDoc(); }
    else if (ctrl && k === 'd') { e.preventDefault(); ed.duplicateSelected(); }
    else if (ctrl) return;
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); ed.deleteSelected(); }
    else if (k === 'escape') { if (ed.mode !== 'sec') ed.setMode('sec'); else ed.select(null); }
    else if (k === 'q') ed.rotateSel(e.shiftKey ? 5 : 15);
    else if (k === 'e') ed.rotateSel(e.shiftKey ? -5 : -15);
    else if (k === 'm') ed.setMode(ed.mode === 'olc' ? 'sec' : 'olc');
    else if (k === 'v') ed.setMode('sec');
    else if (k === 'f') focusSelected();
    else if (k === 'p') startPlay();
    else if (['1', '2', '3', '4', '5', '6'].includes(k)) setView(['kus', 'genel', 'atici', 'hedef', 'yan', 'drone'][+k - 1]);
    else if (k.startsWith('arrow') && ed.cur()) {
      e.preventDefault();
      const s = e.shiftKey ? 1 : 0.1;
      // kameraya göre yönler
      const c = engine.camera.position, t = engine.controls.target;
      const f = new THREE.Vector3(t.x - c.x, 0, t.z - c.z).normalize();
      const snapDir = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z));
      const r = new THREE.Vector3(-snapDir.z, 0, snapDir.x);
      const v = k === 'arrowup' ? snapDir : k === 'arrowdown' ? snapDir.clone().negate() : k === 'arrowright' ? r : r.clone().negate();
      ed.nudge(v.x * s, v.z * s);
    }
  });

  window.native?.onBeforeClose?.(() => dirty);
}

boot().catch((err) => {
  console.error(err);
  const t = $('#spTxt');
  const webgl = /webgl|context/i.test(String(err.message || err));
  if (t) t.textContent = webgl ? 'Ekran kartı (3D) başlatılamadı. Ekran kartı sürücüsünü güncelleyin.' : 'Başlatma hatası: ' + (err.message || err);
});
