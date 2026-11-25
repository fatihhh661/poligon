import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CATALOG, buildItem, defaultParams } from './objects.js';
import { disposeObject } from './labels.js';

/** Kütüphane için her elemanın 3D önizleme görüntüsünü üret. */
export async function renderThumbs(onProgress) {
  const W = 240, H = 180;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(W, H);
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
  const out = {};
  const types = Object.keys(CATALOG);
  for (let i = 0; i < types.length; i++) {
    const t = types[i];
    const it = { id: 'th', type: t, x: 0, z: 0, rot: 0, p: defaultParams(t) };
    if (t === 'yazi') it.p.metin = 'Not';
    const o = buildItem(it);
    scene.add(o);
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const R = Math.max(s.x, s.y * 1.2, s.z, 0.4);
    const flat = s.y < 0.2;
    const dir = flat ? new THREE.Vector3(0.35, 1.3, 0.9) : new THREE.Vector3(0.75, 0.5, 1.1);
    const front = CATALOG[t].rol === 'nokta' || t === 'asker' || t === 'ok' ? -1 : 1;
    dir.z *= front;
    dir.normalize();
    const dist = R / (2 * Math.tan((cam.fov * Math.PI) / 360)) * 1.25;
    cam.position.copy(c).addScaledVector(dir, dist);
    cam.lookAt(c);
    r.render(scene, cam);
    out[t] = r.domElement.toDataURL('image/png');
    scene.remove(o);
    disposeObject(o);
    if (onProgress) onProgress((i + 1) / types.length);
    if (i % 4 === 3) await new Promise((res) => setTimeout(res, 0));
  }
  pm.dispose();
  r.dispose();
  r.forceContextLoss?.();
  return out;
}
