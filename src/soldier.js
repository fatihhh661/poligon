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

// ----------------- asker iskelet kontrolcüsü -----------------
const camoCache = new WeakMap();
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

/**
 * Silahlı asker. Her karede: animasyon (bekleme/yürüme/koşma) + duruş (ayakta/diz/yüzüstü)
 * + üst gövde nişan pozu (IK ile eller silahta) uygulanır.
 */
// ----------------- gerçekçi asker (Mark) -----------------
const MARK_COLORS = [
  [/Kitel|Pants/, 'camo'],
  [/Plate|Pouches/, 0x4f5435],
  [/Helmet/, 0x55593a],
  [/Gloves/, 0x2a2a26],
  [/Boots/, 0x3b3226],
  [/Head/, 0xb88a6c],
  [/Glus|Glass/, 0x0a0a0a],
  [/Eye/, 0xe8e2da],
];
const markMats = new Map();
function markMaterial(src) {
  if (markMats.has(src.name)) return markMats.get(src.name);
  let m = src;
  if (!src.map) {
    const rule = MARK_COLORS.find(([re]) => re.test(src.name));
    if (rule && rule[1] === 'camo') {
      m = new THREE.MeshStandardMaterial({ map: makeCamo(), roughness: 0.92 });
      m.map = makeCamo().clone();
      m.map.repeat.set(3, 3);
      m.map.needsUpdate = true;
    } else {
      m = new THREE.MeshStandardMaterial({ color: rule ? rule[1] : 0x777766, roughness: /Glus/.test(src.name) ? 0.15 : 0.8, metalness: /Glus/.test(src.name) ? 0.4 : 0 });
    }
    m.name = src.name;
    if (src.normalMap) m.normalMap = src.normalMap;
  }
  markMats.set(src.name, m);
  return m;
}

const LIMB_CHILD = {
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', LeftHand: 'LeftHandMiddle1',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand', RightHand: 'RightHandMiddle1',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};
for (const s of ['Left', 'Right']) for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) { LIMB_CHILD[`${s}Hand${f}1`] = `${s}Hand${f}2`; LIMB_CHILD[`${s}Hand${f}2`] = `${s}Hand${f}3`; }

function boneMap(root) {
  const m = {};
  root.traverse((o) => { if (o.isBone && o.name.startsWith('mixamorig')) m[o.name.slice(9)] = o; });
  return m;
}
function restPose(root) {
  root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); });
  root.updateMatrixWorld(true);
}

/**
 * Animasyonu farklı dinlenme pozuna sahip iskelete aktarır (dünya yönü hizalama + rotasyon farkı).
 */
const retargetCache = {};
function retargetClips(tgtSrcModel) {
  if (retargetCache.done) return retargetCache.clips;
  const S = skClone(A.models.soldier), T = skClone(tgtSrcModel);
  const holder = new THREE.Group();
  holder.add(S, T);
  restPose(S); restPose(T);
  const sb = boneMap(S), tb = boneMap(T);
  const names = Object.keys(tb).filter((n) => sb[n]);
  // hedefi kaynağın dinlenme pozuna (T-poz) getir: kemik yönlerini hizala
  const order = [];
  T.traverse((o) => { if (o.isBone && o.name.startsWith('mixamorig')) order.push(o.name.slice(9)); });
  for (const n of order) {
    const c = LIMB_CHILD[n];
    if (!c || !sb[n] || !sb[c] || !tb[c]) continue;
    const td = wpos(tb[c]).sub(wpos(tb[n])).normalize();
    const sd = wpos(sb[c]).sub(wpos(sb[n])).normalize();
    rotWorld(tb[n], new THREE.Vector3().crossVectors(td, sd).normalize(), td.angleTo(sd));
  }
  T.updateMatrixWorld(true);
  const sRest = {}, tRest = {};
  for (const n of names) { sRest[n] = sb[n].getWorldQuaternion(new THREE.Quaternion()); tRest[n] = tb[n].getWorldQuaternion(new THREE.Quaternion()); }
  const sHip0 = wpos(sb.Hips), tHip0 = wpos(tb.Hips);
  const scale = tHip0.y / Math.max(0.01, sHip0.y);
  const tHipLocal0 = tb.Hips.position.clone();
  const tOrder = order.filter((n) => names.includes(n));
  const clips = [];
  for (const clip of A.anims.soldier) {
    const mixer = new THREE.AnimationMixer(S);
    const act = mixer.clipAction(clip);
    act.play();
    const fps = 30, N = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(N);
    const qv = {}; for (const n of tOrder) qv[n] = new Float32Array(N * 4);
    const pv = new Float32Array(N * 3);
    const q = new THREE.Quaternion(), pw = new THREE.Quaternion(), inv = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      const t = Math.min(clip.duration, i / fps);
      times[i] = t;
      mixer.setTime(t);
      S.updateMatrixWorld(true);
      for (const n of tOrder) {
        const sw = sb[n].getWorldQuaternion(new THREE.Quaternion());
        q.copy(sw).multiply(inv.copy(sRest[n]).invert()).multiply(tRest[n]);
        // yerel = ebeveyn dünya^-1 * dünya (ebeveyn bu karede zaten ayarlandı)
        tb[n].parent.getWorldQuaternion(pw);
        const local = pw.invert().multiply(q);
        tb[n].quaternion.copy(local);
        tb[n].updateMatrixWorld(true);
        local.toArray(qv[n], i * 4);
      }
      const d = wpos(sb.Hips).sub(sHip0).multiplyScalar(scale);
      const parentInv = tb.Hips.parent.matrixWorld.clone().invert();
      const p0w = tHip0.clone().add(d);
      const pl = p0w.applyMatrix4(parentInv);
      (pl || tHipLocal0).toArray(pv, i * 3);
    }
    const tracks = tOrder.map((n) => new THREE.QuaternionKeyframeTrack(`${tb[n].name}.quaternion`, times, qv[n]));
    tracks.push(new THREE.VectorKeyframeTrack(`${tb.Hips.name}.position`, times, pv));
    clips.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  retargetCache.done = true;
  retargetCache.clips = clips;
  return clips;
}

export class Rig {
  constructor(silah = 'tufek') {
    const mark = A.models.mark;
    const src = mark || A.models.soldier;
    this.isMark = !!mark;
    this.ok = !!src;
    this.group = new THREE.Group();
    this.silah = silah;
    this.state = { stance: 'ayakta', aim: true, pitch: 0, recoil: 0, lowReady: false };
    if (!src) return;
    const root = (this.root = skClone(src));
    this.group.add(root);
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        o.userData.sharedGeo = true;
        if (this.isMark) o.material = markMaterial(o.material);
        else if (o.name.includes('Mesh')) {
          if (!camoCache.has(o.material)) camoCache.set(o.material, camoMaterial(o.material));
          o.material = camoCache.get(o.material);
        }
      }
    });
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[o.name.replace('mixamorig', '')] = o; });
    this.B = (n) => bones[n];
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    const clips = this.isMark ? (A.models.soldier ? retargetClips(mark) : []) : A.anims?.soldier || [];
    for (const clip of clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.cur = this.actions.Idle || null;
    if (this.cur) this.cur.play();
    this.mixer.update(0);
    // parmakların temel dönüşleri
    this.fingerBase = {};
    for (const side of ['Right', 'Left']) {
      for (const f of FINGERS) for (let i = 1; i <= 3; i++) { const b = this.B(`${side}Hand${f}${i}`); if (b) this.fingerBase[b.uuid] = b.quaternion.clone(); }
      for (let i = 1; i <= 3; i++) { const b = this.B(`${side}HandThumb${i}`); if (b) this.fingerBase[b.uuid] = b.quaternion.clone(); }
    }
    if (this.isMark) this.setupCurl();
    this.weapon = silah === 'tabanca' ? pistolModel() : rifleModel();
    if (this.weapon) this.group.add(this.weapon.obj);
    this.update(0);
  }

  /** Hareket animasyonunu seç: hız (m/sn), geri yürüyüş için negatif */
  setMove(speed) {
    if (!this.mixer) return;
    const a = Math.abs(speed);
    const st = this.state.stance;
    let want = 'Idle', ts = 1;
    if (st === 'ayakta' && a > 0.15) {
      if (a > 2.6 && this.actions.Run) { want = 'Run'; ts = a / 5.0; }
      else { want = 'Walk'; ts = Math.max(0.5, a / 1.45); }
    }
    if (speed < -0.15) ts = -ts;
    const next = this.actions[want] || this.cur;
    if (next && next !== this.cur) {
      next.reset().play();
      if (this.cur) this.cur.crossFadeTo(next, 0.25, false);
      this.cur = next;
    }
    if (this.cur) this.cur.timeScale = ts;
  }

  update(dt) {
    if (!this.root) return;
    const g = this.group, root = this.root, B = this.B, s = this.state;
    this.mixer.update(dt);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const L = (x, y, z) => g.localToWorld(V(x, y, z));
    const toL = (v) => g.worldToLocal(v.clone());
    const right = V(1, 0, 0).transformDirection(g.matrixWorld);
    const back = V(0, 0, 1).transformDirection(g.matrixWorld);
    const up = V(0, 1, 0);
    const spine = B('Spine'), spine1 = B('Spine1'), spine2 = B('Spine2'), neck = B('Neck'), head = B('Head');

    if (s.stance === 'yuzustu') {
      root.rotation.x = -Math.PI / 2;
      root.position.set(0, 0.16, 0.85);
      g.updateMatrixWorld(true);
      rotWorld(B('LeftUpLeg'), up, -0.18);
      rotWorld(B('RightUpLeg'), up, 0.22);
      rotWorld(spine2, right, 0.25);
      rotWorld(neck, right, 0.55);
      rotWorld(head, right, 0.35);
    } else if (s.stance === 'diz') {
      root.position.y = -0.46;
      g.updateMatrixWorld(true);
      twoBoneIK(B('LeftUpLeg'), B('LeftLeg'), B('LeftFoot'), L(-0.12, 0.1, -0.42), L(-0.12, 0.6, -1.5));
      twoBoneIK(B('RightUpLeg'), B('RightLeg'), B('RightFoot'), L(0.14, 0.12, 0.42), L(0.14, -1, -0.4));
      rotWorld(B('RightFoot'), right, -0.9);
      rotWorld(spine, right, 0.12);
    } else if (this.isMark) {
      rotWorld(spine, right, -0.05);
      rotWorld(spine1, up, 0.12);
    } else {
      rotWorld(spine, right, 0.06);
      rotWorld(spine1, up, 0.12);
    }
    // yukarı/aşağı nişan: gövde ve baş eğilir
    const pitch = s.pitch || 0;
    if (s.stance !== 'yuzustu') {
      rotWorld(spine2, right, pitch * 0.45);
      rotWorld(neck, right, pitch * 0.25);
    }
    g.updateMatrixWorld(true);
    const W = this.weapon;
    if (!W) return;
    const sL = toL(wpos(B('RightArm'))), sLl = toL(wpos(B('LeftArm'))), hL = toL(wpos(head));
    const low = !s.aim;
    const rec = s.recoil || 0;
    const o = W.obj;
    if (this.silah === 'tabanca') {
      o.rotation.set(low ? pitch - 0.7 : pitch + rec * 0.25, 0, 0);
      const p = V((sL.x + sLl.x) / 2 + 0.03, hL.y - (low ? 0.42 : 0.06), hL.z - (low ? 0.38 : 0.62) + rec * 0.04);
      if (s.stance === 'yuzustu') p.set(0.03, 0.32, hL.z - 0.6);
      o.position.copy(p);
    } else {
      o.rotation.set(low ? pitch - 0.62 : pitch + rec * 0.08, low ? 0.45 : 0, 0);
      const butt = low ? V(sL.x - 0.02, hL.y - 0.32, sL.z - 0.12) : V(sL.x - 0.07, hL.y - 0.12, sL.z - 0.06 + rec * 0.05);
      if (s.stance === 'yuzustu') butt.set(sL.x - 0.08, sL.y + 0.02, sL.z - 0.05);
      const dir = V(0, 0, -1).applyEuler(o.rotation);
      o.position.copy(butt).addScaledVector(dir, W.buttOffset);
    }
    g.updateMatrixWorld(true);
    const gR = o.localToWorld(W.gripR.clone());
    const gL = o.localToWorld(W.gripL.clone());
    let poleR, poleL;
    if (s.stance === 'yuzustu') { poleR = L(sL.x + 0.3, -0.5, sL.z - 0.2); poleL = L(sLl.x - 0.2, -0.5, sLl.z - 0.3); }
    else {
      poleR = L(sL.x + 0.6, sL.y - 0.5, sL.z + 0.1);
      poleL = this.silah === 'tabanca' ? L(sLl.x - 0.6, sLl.y - 0.5, sLl.z) : L(sLl.x - 0.1, sLl.y - 0.9, sLl.z - 0.2);
    }
    if (this.silah !== 'tabanca' && !low) {
      rotWorld(neck, back, -0.12);
      rotWorld(head, right, 0.12);
    }
    twoBoneIK(B('RightArm'), B('RightForeArm'), B('RightHand'), gR, poleR);
    twoBoneIK(B('LeftArm'), B('LeftForeArm'), B('LeftHand'), gL, poleL);
    const fw = V(0, 0, -1).applyEuler(o.rotation).transformDirection(g.matrixWorld);
    const hr = wpos(B('RightHand')), hl = wpos(B('LeftHand'));
    pointBone(B('RightHand'), B('RightHandMiddle1'), hr.clone().addScaledVector(fw, 0.06).addScaledVector(up, -0.08).addScaledVector(right, -0.03));
    pointBone(B('LeftHand'), B('LeftHandMiddle1'), hl.clone().addScaledVector(fw, this.silah === 'tabanca' ? 0.06 : 0.04).addScaledVector(up, -0.02).addScaledVector(right, this.silah === 'tabanca' ? 0.06 : 0.07));
    this.curl('Right', 0.9);
    this.curl('Left', this.silah === 'tabanca' ? 0.9 : 0.6);
  }

  /** Mark iskeletinde parmak bükme yönünü ölçerek belirle */
  setupCurl() {
    this.curlSign = {};
    for (const side of ['Right', 'Left']) {
      const m1 = this.B(`${side}HandMiddle1`), m3 = this.B(`${side}HandMiddle3`), th = this.B(`${side}HandThumb1`);
      if (!m1 || !m3 || !th) continue;
      const q0 = m1.quaternion.clone();
      const axis = this.palmAxis(side);
      const d0 = wpos(m3).distanceTo(wpos(th));
      rotWorld(m1, axis, 0.6);
      const d1 = wpos(m3).distanceTo(wpos(th));
      m1.quaternion.copy(q0);
      this.root.updateMatrixWorld(true);
      this.curlSign[side] = d1 < d0 ? 1 : -1;
    }
  }
  palmAxis(side) {
    const a = wpos(this.B(`${side}HandIndex1`)), b = wpos(this.B(`${side}HandPinky1`));
    return a.sub(b).normalize();
  }

  curl(side, amount) {
    const B = this.B;
    if (this.isMark) {
      const sg = this.curlSign?.[side];
      if (!sg) return;
      for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
        const b = B(`${side}Hand${f}${i}`);
        if (b) b.quaternion.copy(this.fingerBase[b.uuid]);
      }
      this.root.updateMatrixWorld(true);
      for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
        const b = B(`${side}Hand${f}${i}`);
        if (b) rotWorld(b, this.palmAxis(side), sg * amount * (i === 1 ? 0.9 : 1.15));
      }
      return;
    }
    for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
      const b = B(`${side}Hand${f}${i}`);
      if (!b) continue;
      b.quaternion.copy(this.fingerBase[b.uuid]);
      b.rotation.z += (side === 'Right' ? -1 : 1) * amount * (i === 1 ? 0.8 : 1.1);
    }
    for (let i = 1; i <= 3; i++) {
      const b = B(`${side}HandThumb${i}`);
      if (!b) continue;
      b.quaternion.copy(this.fingerBase[b.uuid]);
      b.rotation.x += amount * 0.25;
    }
  }

  /** Namlu ucunun dünya konumu */
  muzzle() {
    if (!this.weapon) return wpos(this.group).add(V(0, 1.4, 0));
    return this.weapon.obj.localToWorld(this.weapon.muzzle.clone());
  }
}

/** Editördeki sabit atıcı figürü */
export function buildSoldier(pose = 'ayakta', silah = 'tufek') {
  if (!A.models.soldier) return null;
  const r = new Rig(silah);
  r.state.stance = pose;
  r.update(0);
  r.group.userData.rig = r;
  return r.group;
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
    muzzle: V(0, 0.02, -0.62),
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
  return { obj, buttOffset: 0, gripR: V(0, -0.05, 0.05), gripL: V(-0.035, -0.06, 0.04), muzzle: V(0, 0.03, -0.16) };
}
