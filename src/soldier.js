import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { A } from './assets.js';

// ----------------- yardımcılar -----------------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());

/** Kemiği, çocuğu hedef noktaya bakacak şekilde (dünya uzayında) döndür */
function pointBone(bone, child, target) {
  bone.updateWorldMatrix(true, true);
  const bp = wpos(bone);
  const d0 = wpos(child).sub(bp).normalize();
  const d1 = target.clone().sub(bp).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(d0, d1);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  bone.updateWorldMatrix(false, true);
}

/** Kemiği dünya uzayındaki bir eksen etrafında döndür */
function rotWorld(bone, axis, ang) {
  bone.updateWorldMatrix(true, false);
  const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), ang);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  bone.updateWorldMatrix(false, true);
}

/** İki kemikli analitik IK (kol/bacak). pole: dirsek/diz yönü (dünya noktası) */
function twoBoneIK(upper, lower, end, target, pole) {
  upper.updateWorldMatrix(true, true);
  const a = wpos(upper), b = wpos(lower), c = wpos(end);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const d = Math.min(Math.max(a.distanceTo(target), 0.02), l1 + l2 - 0.002);
  const dir = target.clone().sub(a).normalize();
  const pd = pole.clone().sub(a);
  const bend = pd.sub(dir.clone().multiplyScalar(pd.dot(dir))).normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const elbow = a.clone().addScaledVector(dir, Math.cos(ang) * l1).addScaledVector(bend, Math.sin(ang) * l1);
  pointBone(upper, lower, elbow);
  pointBone(lower, end, a.clone().addScaledVector(dir, d));
}

function curlFingers(root, side, amount) {
  const axis = 'z';
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    for (let i = 1; i <= 3; i++) {
      const b = root.getObjectByName(`mixamorig${side}Hand${f}${i}`);
      if (b) b.rotation[axis] += (side === 'Right' ? -1 : 1) * amount * (i === 1 ? 0.8 : 1.1);
    }
  }
  for (let i = 1; i <= 3; i++) {
    const b = root.getObjectByName(`mixamorig${side}HandThumb${i}`);
    if (b) b.rotation.x += amount * 0.25;
  }
}

// ----------------- kamuflaj -----------------
let camoTex = null;
function makeCamo() {
  if (camoTex) return camoTex;
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  // TSK tarzı dijital orman deseni
  g.fillStyle = '#7d7a55';
  g.fillRect(0, 0, N, N);
  const cols = ['#5c6339', '#3f472a', '#8f8660', '#2d2f22', '#6f6a45'];
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const px = 8;
  for (const [ci, count, size] of [[0, 160, 9], [1, 120, 7], [2, 90, 6], [3, 70, 4], [4, 80, 5]]) {
    g.fillStyle = cols[ci];
    for (let i = 0; i < count; i++) {
      let x = Math.floor(rnd() * N / px) * px, y = Math.floor(rnd() * N / px) * px;
      const n = Math.floor(size + rnd() * size * 2);
      for (let k = 0; k < n; k++) {
        for (const dx of [0, N]) for (const dy of [0, N]) g.fillRect(x - dx, y - dy, px, px);
        const r = rnd();
        if (r < 0.25) x += px; else if (r < 0.5) x -= px; else if (r < 0.75) y += px; else y -= px;
        x = (x + N) % N; y = (y + N) % N;
      }
    }
  }
  camoTex = new THREE.CanvasTexture(c);
  camoTex.colorSpace = THREE.SRGBColorSpace;
  camoTex.wrapS = camoTex.wrapT = THREE.RepeatWrapping;
  camoTex.magFilter = THREE.NearestFilter;
  return camoTex;
}

/** Kum rengi zırh/kumaş bölgelerine kamuflaj deseni uygula (diğer renkler korunur) */
function camoMaterial(src) {
  const m = src.clone();
  m.roughness = 0.9;
  m.metalness = 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tCamo = { value: makeCamo() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n#define DEBUGCAMO 0.0\nuniform sampler2D tCamo;\nvarying vec3 vObjPos;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 bc = diffuseColor.rgb;
        float mx = max(bc.r, max(bc.g, bc.b)), mn = min(bc.r, min(bc.g, bc.b));
        float sat = (mx - mn) / max(mx, 1e-3);
        // kum/ten tonları: kırmızı > yeşil > mavi ve orta doygunluk
        float tan = smoothstep(0.05, 0.14, mx) * step(bc.b, bc.g * 1.05) * step(bc.g, bc.r * 1.08) * smoothstep(0.08, 0.2, sat) * (1.0 - smoothstep(0.7, 0.85, sat));
        float red = smoothstep(0.45, 0.65, sat) * step(bc.g * 1.8, bc.r);
        vec2 cuv = vMapUv * 4.5;
        vec3 camo = texture2D(tCamo, cuv).rgb;
        float lum = dot(bc, vec3(0.299, 0.587, 0.114));
        vec3 shaded = camo * (0.45 + lum * 1.25);
        diffuseColor.rgb = mix(bc, shaded, tan);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.055, 0.035), red);
        diffuseColor.rgb = vec3(1.0, 0.0, 0.0) * DEBUGCAMO + diffuseColor.rgb * (1.0 - DEBUGCAMO);`);
  };
  m.customProgramCacheKey = () => 'camo1';
  return m;
}

// ----------------- asker -----------------
let camoCache = new WeakMap();

export function buildSoldier(pose = 'ayakta', silah = 'tufek') {
  const src = A.models.soldier;
  if (!src) return null;
  const root = skClone(src);
  const group = new THREE.Group();
  group.add(root);
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      o.userData.sharedGeo = true;
      if (o.name.includes('Mesh')) {
        if (!camoCache.has(o.material)) camoCache.set(o.material, camoMaterial(o.material));
        o.material = camoCache.get(o.material);
      }
    }
  });
  // temel duruş: "Idle" animasyonunun ilk karesi
  const idle = A.anims?.soldier?.find((a) => a.name === 'Idle');
  if (idle) {
    const mx = new THREE.AnimationMixer(root);
    mx.clipAction(idle).play();
    mx.update(0.0);
    mx.stopAllAction();
  }
  group.updateMatrixWorld(true);
  const B = (n) => root.getObjectByName('mixamorig' + n);
  const hips = B('Hips'), spine = B('Spine'), spine1 = B('Spine1'), spine2 = B('Spine2'), neck = B('Neck'), head = B('Head');

  if (pose === 'yuzustu') {
    root.rotation.x = -Math.PI / 2;
    root.position.set(0, 0.16, 0.85);
    group.updateMatrixWorld(true);
    // bacaklar hafif açık
    rotWorld(B('LeftUpLeg'), V(0, 1, 0), -0.18);
    rotWorld(B('RightUpLeg'), V(0, 1, 0), 0.22);
    // baş ve göğüs kalkık
    rotWorld(spine2, V(1, 0, 0), 0.25);
    rotWorld(neck, V(1, 0, 0), 0.55);
    rotWorld(head, V(1, 0, 0), 0.35);
  } else if (pose === 'diz') {
    hips.position.y -= 0; // aşağıda IK ile yerleştirilecek
    const drop = 0.46;
    root.position.y = -drop;
    group.updateMatrixWorld(true);
    // sol ayak önde basılı, sağ diz yerde
    twoBoneIK(B('LeftUpLeg'), B('LeftLeg'), B('LeftFoot'), V(-0.12, 0.1, -0.42), V(-0.12, 0.6, -1.5));
    twoBoneIK(B('RightUpLeg'), B('RightLeg'), B('RightFoot'), V(0.14, 0.12, 0.42), V(0.14, -1, -0.4));
    rotWorld(B('RightFoot'), V(1, 0, 0), -0.9);
    rotWorld(spine, V(1, 0, 0), 0.12);
  } else {
    // ayakta: hafif öne eğilmiş, ayaklar açık
    rotWorld(spine, V(1, 0, 0), 0.08);
    rotWorld(spine1, V(0, 1, 0), 0.12);
  }
  group.updateMatrixWorld(true);

  // ----- silah -----
  const weapon = silah === 'tabanca' ? pistolModel() : rifleModel();
  if (weapon) {
    group.add(weapon.obj);
    const sh = wpos(B('RightArm'));
    const hd = wpos(head);
    let fwd = V(0, 0, -1);
    if (silah === 'tabanca') {
      // iki elle nişan: kollar ileri uzanmış, tabanca göz hizasında
      const p = V((sh.x + wpos(B('LeftArm')).x) / 2 + 0.03, hd.y - 0.06, hd.z - 0.62);
      if (pose === 'yuzustu') p.set(0.03, 0.32, hd.z - 0.6);
      weapon.obj.position.copy(p);
      weapon.obj.updateMatrixWorld(true);
    } else {
      // dipçik sağ omuzda, nişangah göz hizasında
      const butt = V(sh.x - 0.07, hd.y - 0.12, sh.z - 0.06);
      if (pose === 'yuzustu') butt.set(sh.x - 0.08, sh.y + 0.02, sh.z - 0.05);
      weapon.obj.position.copy(butt).addScaledVector(fwd, weapon.buttOffset);
      weapon.obj.updateMatrixWorld(true);
    }
    const gR = weapon.obj.localToWorld(weapon.gripR.clone());
    const gL = weapon.obj.localToWorld(weapon.gripL.clone());
    const shR = wpos(B('RightArm')), shL = wpos(B('LeftArm'));
    const poleR = pose === 'yuzustu' ? V(shR.x + 0.3, -0.5, shR.z - 0.2) : V(shR.x + 0.6, shR.y - 0.5, shR.z + 0.1);
    const poleL = pose === 'yuzustu' ? V(shL.x - 0.2, -0.5, shL.z - 0.3) : silah === 'tabanca' ? V(shL.x - 0.6, shL.y - 0.5, shL.z) : V(shL.x - 0.1, shL.y - 0.9, shL.z - 0.2);
    // baş: yanağı dipçiğe yasla
    if (silah !== 'tabanca') {
      rotWorld(neck, V(0, 0, 1), -0.12);
      rotWorld(head, V(1, 0, 0), 0.12);
    }
    twoBoneIK(B('RightArm'), B('RightForeArm'), B('RightHand'), gR, poleR);
    twoBoneIK(B('LeftArm'), B('LeftForeArm'), B('LeftHand'), gL, poleL);
    // eller silah yönünde
    const hr = wpos(B('RightHand')), hl = wpos(B('LeftHand'));
    pointBone(B('RightHand'), B('RightHandMiddle1'), hr.clone().add(V(-0.03, -0.08, -0.06)));
    pointBone(B('LeftHand'), B('LeftHandMiddle1'), hl.clone().add(silah === 'tabanca' ? V(0.06, -0.02, -0.06) : V(0.07, -0.02, -0.04)));
    curlFingers(root, 'Right', 0.9);
    curlFingers(root, 'Left', silah === 'tabanca' ? 0.9 : 0.6);
  }
  return group;
}

function rifleModel() {
  const src = A.models.rifle;
  if (!src) return null;
  const m = src.clone(true);
  m.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.userData.sharedGeo = true;
      if (!o.material.userData.darkened) {
        const mm = o.material.clone();
        // ahşap dipçiği koyu sentetik görünüme çevir
        mm.color = new THREE.Color(0.2, 0.2, 0.19);
        mm.userData.darkened = true;
        o.material = mm;
      }
    }
  });
  const obj = new THREE.Group();
  m.rotation.y = Math.PI / 2; // namlu (+X) -> ileri (-Z)
  obj.add(m);
  // model ekseninde: dipçik x=-0.635, kabza ~x=-0.3, el kundağı ~x=+0.05
  return {
    obj,
    buttOffset: 0.63, // dipçikten ileri doğru model merkezine
    gripR: V(0, -0.06, 0.3),
    gripL: V(-0.01, -0.03, -0.12),
  };
}

function pistolModel() {
  const src = A.models.pistol;
  if (!src) return null;
  const m = src.clone(true);
  // set iki tabanca + şarjör içeriyor: yalnızca en üstteki tabancayı göster
  // set: üstte mavi kabzalı, altta ahşap kabzalı tabanca + şarjörler. Alttaki tabancayı tut.
  m.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(m);
  const midY = (all.min.y + all.max.y) / 2;
  const keep = new THREE.Box3();
  const box = new THREE.Box3();
  m.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    const c = box.getCenter(V());
    o.visible = c.y < midY && c.x > all.min.x + 0.07;
    o.castShadow = true;
    o.userData.sharedGeo = true;
    if (o.visible) keep.union(box);
  });
  const obj = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(m);
  if (!keep.isEmpty()) {
    const c = keep.getCenter(V());
    m.position.set(-c.x, -c.y, -c.z);
  }
  inner.rotation.y = Math.PI / 2; // namlu ileri
  obj.add(inner);
  return { obj, buttOffset: 0, gripR: V(0, -0.05, 0.05), gripL: V(-0.035, -0.06, 0.04) };
}
