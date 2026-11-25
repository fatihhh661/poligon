import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/** Fotoğraf tabanlı (Poly Haven, CC0) dokular, gökyüzleri ve modeller. */
export const A = { pbr: {}, tex: {}, models: {}, anims: {}, ok: false };

const PBR = ['gravel', 'berm', 'grass', 'forest', 'rock', 'plywood', 'wood', 'roof', 'concrete', 'sand'];
const MODELS = ['barrel', 'tyre', 'table', 'crate', 'ammo', 'rock1', 'rock2', 'shrub', 'soldier', 'rifle', 'pistol'];

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
  jobs.push(async () => { A.tex.branch = await tex('assets/tex/branch.png'); });
  jobs.push(async () => { A.tex.twigNor = await tex('assets/tex/twig_nor.jpg', false); });
  jobs.push(async () => { A.tex.bark = await tex('assets/tex/bark_diff.jpg'); });
  jobs.push(async () => { A.tex.barkNor = await tex('assets/tex/bark_nor.jpg', false); });
  const gl = new GLTFLoader();
  for (const k of MODELS) {
    jobs.push(async () => {
      const g = await gl.loadAsync(`assets/models/${k}.glb`);
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = true;
          if (o.material.map) o.material.map.anisotropy = aniso;
        }
      });
      A.models[k] = g.scene;
      A.anims[k] = g.animations;
    });
  }
  let done = 0;
  await Promise.all(jobs.map((j) => j().then(() => onProgress(++done / jobs.length))));
  A.ok = true;
  return A;
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
