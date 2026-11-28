import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { loadCharacterTextures } from './characterLook.js';

/** Fotoğraf tabanlı (Poly Haven, CC0) dokular, gökyüzleri ve modeller. */
export const A = { pbr: {}, tex: {}, models: {}, anims: {}, ok: false };

const PBR = ['gravel', 'berm', 'grass', 'forest', 'rock', 'plywood', 'wood', 'roof', 'concrete', 'sand'];
const MODELS = ['barrel', 'tyre', 'table', 'crate', 'ammo', 'rock1', 'rock2', 'shrub', 'soldier', 'rifle', 'pistol', 'mark', 'm4'];

let aniso = 8;
const tl = new THREE.TextureLoader();
function tex(url, srgb = true) {
  return new Promise((res, rej) => {
    tl.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      res(t);
    }, undefined, rej);
  });
}

export async function loadAssets(renderer, onProgress = () => {}) {
  aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const jobs = [];
  for (const k of PBR) {
    jobs.push(async () => {
      const [map, normalMap, arm] = await Promise.all([
        tex(`assets/tex/${k}_diff.jpg`), tex(`assets/tex/${k}_nor.jpg`, false), tex(`assets/tex/${k}_arm.jpg`, false),
      ]);
      A.pbr[k] = { map, normalMap, arm };
    });
  }
  jobs.push(async () => { A.mocap = await loadMotionLibrary(); });
  // karakterin yüksek çözünürlüklü (KTX2) dokuları; yüklenemezse eski görünüm
  jobs.push(async () => { A.charHD = await loadCharacterTextures(renderer); });
  jobs.push(async () => { A.tex.branch = await tex('assets/tex/branch.png'); });
  jobs.push(async () => { A.tex.twigNor = await tex('assets/tex/twig_nor.jpg', false); });
  jobs.push(async () => { A.tex.bark = await tex('assets/tex/bark_diff.jpg'); });
  jobs.push(async () => { A.tex.barkNor = await tex('assets/tex/bark_nor.jpg', false); });
  const gl = new GLTFLoader();
  for (const k of MODELS) {
    jobs.push(async () => {
      // asker: deri ağırlıkları onarılmış ayrı sürüm (mark-deri.glb) varsa o; geliştirici seçimi
      // localStorage 'pp.deri' = 'orijinal' orijinal ağırlıklara döner. Orijinal dosya hiç değişmez.
      let file = `assets/models/${k}.glb`;
      if (k === 'mark') {
        let want = 'duzeltilmis';
        try { want = localStorage.getItem('pp.deri') || want; } catch (e) { /* */ }
        if (want !== 'orijinal') file = 'assets/models/mark-deri.glb';
      }
      let g;
      try { g = await gl.loadAsync(file); } catch (e) {
        if (!file.includes('mark-deri')) throw e;
        file = `assets/models/${k}.glb`; // onarılmış sürüm bu kurulumda yoksa orijinal
        g = await gl.loadAsync(file);
      }
      if (k === 'mark') A.deri = file.includes('mark-deri') ? 'duzeltilmis' : 'orijinal';
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          if (o.material.map) o.material.map.anisotropy = aniso;
        }
      });
      if (k === 'mark') {
        // model +Z'ye bakıyor; -Z'ye çevir (kök dönüşü Rig tarafından sıfırlandığı için ara grup)
        const w = new THREE.Group();
        w.name = 'yonDuzelt';
        w.rotation.y = Math.PI;
        for (const c of [...g.scene.children]) w.add(c);
        g.scene.add(w);
      }
      A.models[k] = g.scene;
      A.anims[k] = g.animations;
    });
  }
  let done = 0;
  await Promise.all(jobs.map((j) => j().then(() => onProgress(++done / jobs.length))));
  // geliştirici erişimi (arayüz yok): deri karşılaştırması için asker modelini oturum içinde değiştirir
  if (typeof window !== 'undefined') window.__ppDeri = async (which) => {
    const g = await gl.loadAsync(which === 'orijinal' ? 'assets/models/mark.glb' : 'assets/models/mark-deri.glb');
    g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = aniso; } });
    const w = new THREE.Group(); w.name = 'yonDuzelt'; w.rotation.y = Math.PI; for (const c of [...g.scene.children]) w.add(c); g.scene.add(w);
    A.models.mark = g.scene; A.deri = which === 'orijinal' ? 'orijinal' : 'duzeltilmis'; return A.deri;
  };
  A.ok = true;
  return A;
}

/**
 * Hareket kütüphanesi: assets/anim/library.json merkezi kaydındaki etkin kütüphane yüklenir
 * (scripts/import-anim.mjs ile üretilir). Yoksa, bozuksa ya da gerekli klipler eksikse eski
 * CMU kayıtları (mocap.json) kullanılır; program hiçbir durumda bu yüzden açılmaz hale gelmez.
 * Geliştirici karşılaştırması (arayüzsüz): localStorage 'pp.animLib' = 'cmu' (eski) | kütüphane kimliği.
 */
const NEEDED = ['Idle', 'Walk', 'Run', 'WalkBack'];
async function loadMotionLibrary() {
  const info = (A.animInfo = { active: 'cmu', source: 'CMU (eski, 6 klip)', torso: 0.8, errors: [] });
  let want = null;
  try { want = localStorage.getItem('pp.animLib'); } catch (e) { /* */ }
  if (want !== 'cmu') {
    let reg = null;
    try { reg = await (await fetch('assets/anim/library.json')).json(); } catch (e) { info.errors.push('library.json yüklenemedi: ' + (e?.message || e)); }
    // sıra: seçilen, etkin, sonra kayıttaki diğerleri. Bir kütüphanenin dosyası bu kurulumda yoksa
    // (ör. Mixamo verisi depoya girmez, yalnızca pakette bulunur) bir sonrakine geçilir.
    const ids = reg ? [...new Set([want, reg.active, ...Object.keys(reg.libraries || {})])].filter((x) => x && reg.libraries?.[x]) : [];
    for (const id of ids) {
      const L = reg.libraries[id];
      try {
        const r = await fetch(L.file);
        if (!r.ok) { info.errors.push(`${id}: dosya yok (${L.file})`); continue; }
        const M = await r.json();
        const miss = NEEDED.filter((k) => !M.clips?.[k]);
        if (!M.hierarchy || miss.length) { info.errors.push(`${id}: eksik klip ${miss.join(', ')}`); continue; }
        Object.assign(info, { active: id, source: L.source?.name || id, torso: L.torso ?? 0.8, maxWarp: L.maxWarp, clips: Object.keys(M.clips) });
        return M;
      } catch (e) { info.errors.push(`${id}: yüklenemedi (${e?.message || e})`); }
    }
  }
  try { return await (await fetch('assets/anim/mocap.json')).json(); } catch (e) { info.errors.push('mocap.json yüklenemedi'); return null; }
}

const hdrCache = {};
export async function loadSky(key) {
  if (hdrCache[key]) return hdrCache[key];
  const t = await new RGBELoader().loadAsync(`assets/sky/${key}.hdr`);
  t.mapping = THREE.EquirectangularReflectionMapping;
  hdrCache[key] = t;
  return t;
}

/** HDR görüntüdeki en parlak noktadan güneş yönünü ve ufuk rengini çıkarır. */
export function analyzeSky(t) {
  const { width: w, height: h, data } = t.image;
  const isHalf = data instanceof Uint16Array;
  const f = isHalf ? THREE.DataUtils.fromHalfFloat : (v) => v;
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const l = f(data[i]) + f(data[i + 1]) + f(data[i + 2]);
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  // ufuk rengi (ufkun biraz üstü)
  const hz = new THREE.Color(0, 0, 0);
  const yy = Math.floor(h * 0.47);
  let n = 0;
  for (let x = 0; x < w; x += 8) {
    const i = (yy * w + x) * 4;
    hz.r += f(data[i]); hz.g += f(data[i + 1]); hz.b += f(data[i + 2]);
    n++;
  }
  hz.multiplyScalar(1 / n);
  // three.js equirectUv: u = atan(z, x)/2π + 0.5 ; v = asin(y)/π + 0.5 (satır 0 = üst)
  const a = (bx / w - 0.5) * Math.PI * 2;
  const e = (0.5 - by / h) * Math.PI;
  const dir = new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
  return { dir: dir.normalize(), horizon: hz, peak: best };
}

/** Bir PBR dokusunun klonunu tekrar ayarıyla döndür */
export function rep(t, rx, ry = rx) {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

export function pbrMaterial(key, { repeat = 1, color = 0xffffff, rough = 1, normalScale = 1, metal = false, side, aoOff = false } = {}) {
  const p = A.pbr[key];
  if (!p) return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
  const m = new THREE.MeshStandardMaterial({
    map: rep(p.map, repeat),
    normalMap: rep(p.normalMap, repeat),
    roughnessMap: rep(p.arm, repeat),
    aoMap: aoOff ? null : rep(p.arm, repeat),
    color,
    roughness: rough,
    metalness: metal ? 1 : 0,
    metalnessMap: metal ? rep(p.arm, repeat) : null,
    side: side ?? THREE.FrontSide,
  });
  m.normalScale.set(normalScale, normalScale);
  return m;
}

/** Model kopyası (geometri/malzeme paylaşımlı), hedef boyuta ölçeklenir */
export function modelClone(key, { height = null, width = null, fit = null } = {}) {
  const src = A.models[key];
  if (!src) return null;
  const g = src.clone(true);
  g.traverse((o) => { if (o.isMesh) o.userData.sharedGeo = true; });
  const box = new THREE.Box3().setFromObject(g);
  const s = box.getSize(new THREE.Vector3());
  let k = 1;
  if (height) k = height / s.y;
  else if (width) k = width / Math.max(s.x, s.z);
  else if (fit) k = fit / Math.max(s.x, s.y, s.z);
  g.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  g.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}
