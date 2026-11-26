import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { A } from './assets.js';

// ----------------- yardımcılar -----------------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const smooth01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Kemiği, çocuğu hedef noktaya bakacak şekilde (dünya uzayında) döndür */
/** İskeletli bir parçanın köşe ağırlığının ne kadarı baş kemiğinde (0..1). Bir kez hesaplanır. */
function headWeight(m) {
  if (!m.isSkinnedMesh || !m.skeleton) return 0;
  if (m.userData.headW !== undefined) return m.userData.headW;
  const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
  const isHead = m.skeleton.bones.map((b) => /head$/i.test(b.name));
  let h = 0;
  if (si && sw) for (let i = 0; i < si.count; i++) for (let j = 0; j < 4; j++) if (isHead[si.getComponent(i, j)]) h += sw.getComponent(i, j);
  return (m.userData.headW = si && si.count ? h / si.count : 0);
}

/** Silah duruşu katmanının yönettiği üst gövde kemikleri (üstten alta hiyerarşi sırası) */
const UPPER = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder'];
const uprightCache = new WeakMap();
function uprightReference(src) {
  if (uprightCache.has(src)) return uprightCache.get(src);
  const ref = skClone(src), tmp = new THREE.Group();
  tmp.add(ref);
  tmp.updateMatrixWorld(true);
  const bones = {};
  ref.traverse((o) => { if (o.isBone) bones[o.name.replace('mixamorig', '')] = o; });
  const rel = {};
  for (const n of UPPER) if (bones[n]) rel[n] = bones[n].getWorldQuaternion(new THREE.Quaternion());
  uprightCache.set(src, rel);
  return rel;
}

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
  if (src.map) {
    // kumaş/teçhizat: metal değil (metalik kanal kumaşı karartıyordu)
    m = src.clone();
    m.metalness = 0;
    m.metalnessMap = null;
    if (/Head/.test(src.name)) m.roughness = 0.75;
    m.aoMap = null; // ARM dokusunun kırmızı kanalı boş: dolaylı ışığı tamamen söndürüyordu
    m.envMapIntensity = 1.4;
    if (!/Head|Eye|Glus/.test(src.name)) m.color.setScalar(1.75); // dokular koyu kaydedilmiş: sahne ışığına göre aydınlat
  } else {
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
/** CMU hareket kaydı iskeleti (BVH hiyerarşisi) ve klipleri */
function mocapSource() {
  const M = A.mocap;
  const bones = M.hierarchy.map((h) => { const b = new THREE.Bone(); b.name = h.n; b.position.fromArray(h.o); return b; });
  M.hierarchy.forEach((h, i) => { if (h.p >= 0) bones[h.p].add(bones[i]); });
  bones[0].position.set(0, M.clips.Idle.hp[1], 0); // dinlenme kalça yüksekliği
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI; // kayıtlar +Z'ye bakıyor; asker -Z'ye
  holder.add(bones[0]);
  const clips = Object.entries(M.clips).map(([name, c]) => {
    const N = c.hp.length / 3;
    const times = new Float32Array(N).map((_, k) => (k / (N - 1)) * c.dur);
    const tracks = Object.entries(c.q).map(([bn, q]) => new THREE.QuaternionKeyframeTrack(bn + '.quaternion', times, q));
    tracks.push(new THREE.VectorKeyframeTrack(bones[0].name + '.position', times, c.hp));
    const clip = new THREE.AnimationClip(name, c.dur, tracks);
    clip.userData = { speed: c.speed, stride: c.stride, ph0: c.ph0, ang: c.ang };
    return clip;
  });
  return { S: holder, clips };
}

function retargetClips(tgtSrcModel, srcObj = null, srcClips = null, key = 'soldier') {
  const cache = (retargetCache[key] ||= {});
  if (cache.done) return cache.clips;
  const S = srcObj || skClone(A.models.soldier), T = skClone(tgtSrcModel);
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
  for (const clip of srcClips || A.anims.soldier) {
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
    const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
    out.userData = clip.userData || {};
    clips.push(out);
  }
  cache.done = true;
  cache.clips = clips;
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
    let clips;
    if (this.isMark && A.mocap) {
      const src = mocapSource();
      clips = retargetClips(mark, src.S, src.clips, 'mocap');
      this.mocap = true;
    } else clips = this.isMark ? (A.models.soldier ? retargetClips(mark) : []) : A.anims?.soldier || [];
    for (const clip of clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    if (this.mocap) {
      // dik duruş referansı: modelin dosyadaki dinlenme (T) pozunda gövde/baş/köprücük kemiklerinin
      // askere göre yönü. Ayrı bir kopyadan okunur: canlı iskelete skeleton.pose() uygulamak kök
      // kemiğin ölçeğini iki kez çarpıp askeri 100 kat küçültüyor.
      this.uprightRel = uprightReference(src);
      this.loco = { phase: 0, idleT: Math.random() * this.actions.Idle.getClip().duration, w: {} };
      for (const [n, a] of Object.entries(this.actions)) { a.play(); a.timeScale = 0; a.setEffectiveWeight(n === 'Idle' ? 1 : 0); this.loco.w[n] = n === 'Idle' ? 1 : 0; }
      this.cur = this.actions.Idle;
      this.mixer.update(0);
      // nişan anında üst gövdeyi sabitlemek için nötr duruş
      this.neutral = {};
      for (const n of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']) if (this.B(n)) this.neutral[n] = this.B(n).quaternion.clone();
      this.ankleH = 0.085;
      // yelek cepleri: yaylı (fizikli) kemikler
      this.jiggle = [];
      root.traverse((o) => {
        if (!o.isBone || !/Pouch/i.test(o.name) || !o.children.length) return;
        const c = o.children.find((x) => x.isBone);
        if (c) this.jiggle.push({ b: o, c, q0: o.quaternion.clone(), p: null, v: V() });
      });
    } else {
      this.cur = this.actions.Idle || null;
      if (this.cur) this.cur.play();
      this.mixer.update(0);
    }
    // parmakların temel dönüşleri
    this.fingerBase = {};
    for (const side of ['Right', 'Left']) {
      for (const f of FINGERS) for (let i = 1; i <= 3; i++) { const b = this.B(`${side}Hand${f}${i}`); if (b) this.fingerBase[b.uuid] = b.quaternion.clone(); }
      for (let i = 1; i <= 3; i++) { const b = this.B(`${side}HandThumb${i}`); if (b) this.fingerBase[b.uuid] = b.quaternion.clone(); }
    }
    if (this.isMark) this.setupCurl();
    this.weapon = silah === 'tabanca' ? pistolModel() : rifleModel();
    if (this.weapon) {
      this.group.add(this.weapon.obj);
      if (this.weapon.mag) {
        this.handMag = this.weapon.mag.clone();
        this.handMag.matrixAutoUpdate = false;
        this.handMag.visible = false;
        this.group.add(this.handMag);
      }
    }
    this.update(0);
  }

  /** Hareket animasyonunu seç: hız (m/sn), geri yürüyüş için negatif */
  setMove(speed) {
    if (!this.mixer) return;
    if (this.mocap) { this.state.locoSpeed = Math.abs(speed); this.state.locoAng = speed < -0.15 ? 180 : 0; return; }
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

  /** Hareket karıştırma: hıza ve yöne göre 6 gerçek hareket kaydı, adım fazı senkronlu */
  stepLoco(dt) {
    const s = this.state, L = this.loco, A_ = this.actions;
    const sp = s.stance === 'ayakta' || s.stance === 'diz' ? s.locoSpeed || 0 : 0;
    const a = ((s.locoAng || 0) * Math.PI) / 180;
    const locoW = smooth01(sp / 0.45);
    let wF = Math.max(0, Math.cos(a)), wB = Math.max(0, -Math.cos(a)), wL = Math.max(0, Math.sin(a)), wR = Math.max(0, -Math.sin(a));
    const sum = wF + wB + wL + wR || 1;
    wF /= sum; wB /= sum; wL /= sum; wR /= sum;
    const runK = smooth01((sp - 2.3) / 1.3);
    const tgt = { Idle: 1 - locoW, Walk: locoW * wF * (1 - runK), Run: locoW * wF * runK, WalkBack: locoW * wB, StrafeL: locoW * wL, StrafeR: locoW * wR };
    const k = dt > 0 ? 1 - Math.exp(-dt * 9) : 1;
    let strideSum = 0, wsum = 0;
    for (const n in tgt) {
      if (!A_[n]) continue;
      L.w[n] += (tgt[n] - L.w[n]) * k;
      A_[n].setEffectiveWeight(L.w[n]);
      if (n !== 'Idle') {
        const u = A_[n].getClip().userData;
        const kk = Math.min(1.6, Math.max(0.85, Math.sqrt(sp / Math.max(0.2, u.speed))));
        strideSum += L.w[n] * u.stride * kk; wsum += L.w[n];
      }
    }
    if (wsum > 0.001 && sp > 0.02) L.phase = (L.phase + (sp * dt) / (strideSum / wsum)) % 1;
    for (const n in tgt) {
      const act = A_[n];
      if (!act) continue;
      const c = act.getClip();
      if (n === 'Idle') { L.idleT = (L.idleT + dt) % c.duration; act.time = L.idleT; }
      else act.time = ((L.phase + c.userData.ph0) % 1) * c.duration;
    }
    this.mixer.update(0);
  }

  update(dt) {
    if (!this.root) return;
    const g = this.group, root = this.root, B = this.B, s = this.state;
    if (this.mocap) this.stepLoco(dt); else this.mixer.update(dt);
    // nişan alınca üst gövde sabitlenir (yürürken omuzlar sallanmaz)
    if (this.mocap && this.neutral) {
      const ab0 = this._ab ?? (s.aim ? 1 : 0);
      const k = s.stance === 'ayakta' ? 0.75 * ab0 : 0.9;
      if (k > 0) for (const n in this.neutral) B(n).quaternion.slerp(this.neutral[n], n === 'Spine' ? k * 0.5 : k);
    }
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
      // nizami yüzüstü: gövde yerde, göğüs hafif kalkık, bacaklar düz ve hafif açık, ayak uçları içe/yere
      root.rotation.x = -Math.PI / 2;
      root.position.set(0, this.isMark ? 0.2 : 0.16, 0.92);
      g.updateMatrixWorld(true);
      rotWorld(spine, right, 0.1);
      rotWorld(spine1, right, 0.14);
      rotWorld(spine2, right, 0.16);
      rotWorld(neck, right, 0.35);
      rotWorld(head, right, 0.25);
      g.updateMatrixWorld(true);
      // sürünme (askeri alçak sürünme): sağ kol + sol diz birlikte öne, sonra sol kol + sağ diz.
      // Uzanan kol yere tutunur, bacak iter; gövde öne kayar, omuzlar ve kalça yuvarlanır, baş sabit kalır.
      const cr = s.crawl || 0, ph = s.crawlPh || 0;
      const sn = Math.sin(ph);
      const kL = cr * Math.max(0, sn), kR = cr * Math.max(0, -sn);
      if (cr > 0.01) {
        const surge = Math.abs(Math.cos(ph)) * 0.05 * cr;  // itiş anında gövde öne kayar
        root.position.z -= surge;
        root.position.y += Math.abs(sn) * 0.02 * cr;      // göğüs her çekişte hafif kalkar
        root.position.x += sn * 0.03 * cr;                 // kalça yana salınır
        g.updateMatrixWorld(true);
        rotWorld(spine, back, sn * 0.09 * cr);             // kalça yuvarlanması
        rotWorld(spine2, back, -sn * 0.12 * cr);           // omuz yuvarlanması (karşı yön)
        rotWorld(spine1, up, sn * 0.06 * cr);
        rotWorld(neck, back, sn * 0.06 * cr);              // baş dik ve ileri bakar
        g.updateMatrixWorld(true);
      }
      for (const [side, sx, k] of [['Left', -1, kL], ['Right', 1, kR]]) {
        const foot = L(sx * (0.2 + k * 0.18), 0.09 + k * 0.02, 1.0 - k * 0.42);
        const pole = L(sx * (0.25 + k * 0.6), 0.02 - (1 - k) * 0.5, 0.55);
        twoBoneIK(B(side + 'UpLeg'), B(side + 'Leg'), B(side + 'Foot'), foot, pole);
        const fb = B(side + 'Foot'), toe = B(side + 'ToeBase');
        if (fb && toe) pointBone(fb, toe, wpos(fb).add(L(0, -0.2, 0.08).sub(L(0, 0, 0))));
      }
    } else if (s.stance === 'alcak') {
      // alçak çöküş: sağ diz yerde, kalça sağ topuğun üstünde, sol ayak önde basılı
      root.position.y = -0.66;
      root.position.z = 0.08;
      g.updateMatrixWorld(true);
      twoBoneIK(B('LeftUpLeg'), B('LeftLeg'), B('LeftFoot'), L(-0.17, 0.1, -0.42), L(-0.25, 1.2, -1.2));
      twoBoneIK(B('RightUpLeg'), B('RightLeg'), B('RightFoot'), L(0.16, 0.13, 0.3), L(0.25, -0.8, -1.0));
      rotWorld(B('RightFoot'), right, -1.15);
      rotWorld(spine, right, 0.32);
      rotWorld(spine1, right, 0.12);
    } else if (s.stance === 'diz') {
      // diz çökme <-> çömelerek yürüme: hareket edince kalça biraz kalkar, ayaklar yürüyüş kaydının
      // adımlarını izler (dizler bükük), durunca sağ diz yere iner
      const moving = this.mocap && (s.locoSpeed || 0) > 0.15;
      this._cw = dt > 0 ? THREE.MathUtils.lerp(this._cw || 0, moving ? 1 : 0, 1 - Math.exp(-dt * 7)) : (moving ? 1 : 0);
      const cw = this._cw;
      const fl0 = wpos(B('LeftFoot')), fr0 = wpos(B('RightFoot'));
      root.position.y = THREE.MathUtils.lerp(-0.46, -0.33, cw);
      g.updateMatrixWorld(true);
      twoBoneIK(B('LeftUpLeg'), B('LeftLeg'), B('LeftFoot'), L(-0.12, 0.1, -0.42).lerp(fl0, cw), L(-0.12, 0.6, -1.5).lerp(L(-0.18, 0.4, -1.3), cw));
      twoBoneIK(B('RightUpLeg'), B('RightLeg'), B('RightFoot'), L(0.14, 0.12, 0.42).lerp(fr0, cw), L(0.14, -1, -0.4).lerp(L(0.18, 0.4, -1.3), cw));
      if (cw < 0.99) rotWorld(B('RightFoot'), right, -0.9 * (1 - cw));
      rotWorld(spine, right, 0.12);
    } else if (this.isMark) {
      // taktik yürüyüş: hareket ederken dizler bükülür (ayaklar yerde kilitli), gövde hafif öne
      const mv = Math.min(1, s.move || 0);
      if (mv > 0.01) {
        const fl = wpos(B('LeftFoot')), fr = wpos(B('RightFoot'));
        root.position.y = -0.04 * mv; // hafif bükük diz (eskiden 8,5 cm: sürekli çömelik görünüyordu)
        g.updateMatrixWorld(true);
        twoBoneIK(B('LeftUpLeg'), B('LeftLeg'), B('LeftFoot'), fl, L(-0.12, 0.45, -1.3));
        twoBoneIK(B('RightUpLeg'), B('RightLeg'), B('RightFoot'), fr, L(0.12, 0.45, -1.3));
      }
      rotWorld(spine, right, -0.05 + 0.12 * mv);
      rotWorld(spine1, up, 0.12);
    } else {
      rotWorld(spine, right, 0.06);
      rotWorld(spine1, up, 0.12);
    }
    // ayak-zemin: ayaklar zeminin altına girmez
    if (this.mocap && s.stance === 'ayakta') {
      g.updateMatrixWorld(true);
      const gy = (s.groundY ?? 0.015) + this.ankleH;
      for (const [side, sx] of [['Left', -1], ['Right', 1]]) {
        const f = B(side + 'Foot'), fp = wpos(f);
        if (fp.y < gy) { fp.y = gy; twoBoneIK(B(side + 'UpLeg'), B(side + 'Leg'), f, fp, L(sx * 0.12, 0.5, -1.3)); }
      }
    }
    // silah duruşu katmanı (ayakta ve çömelerek yürürken)
    if (this.mocap && (s.stance === 'ayakta' || s.stance === 'diz')) { g.updateMatrixWorld(true); this.uprightTorso(dt); }
    // üst gövde burulması: bakış yönü ile bacak yönü arasındaki fark omurgaya dağıtılır (omuz önce döner)
    const tw =Math.max(-1.25, Math.min(1.25, s.twist || 0));
    if (Math.abs(tw) > 1e-4 && s.stance !== 'yuzustu') {
      rotWorld(spine, up, tw * 0.22);
      rotWorld(spine1, up, tw * 0.3);
      rotWorld(spine2, up, tw * 0.3);
      rotWorld(neck, up, tw * 0.18);
    }
    // nefes: göğüs ve omuzlar; efor arttıkça hızlanır ve derinleşir
    if (this.mocap && dt > 0) {
      const ex = Math.min(1, s.exert || 0);
      this._bt = (this._bt || 0) + dt * (1.45 + ex * 2.7);
      const br = Math.sin(this._bt), amp = 0.011 + 0.03 * ex;
      rotWorld(spine2, right, -br * amp);
      if (B('LeftShoulder')) rotWorld(B('LeftShoulder'), back, br * amp * 0.7);
      if (B('RightShoulder')) rotWorld(B('RightShoulder'), back, -br * amp * 0.7);
    }
    // geri tepme: dipçik omza vurur, üst gövde bir an geri itilir
    if (s.recoil > 0.01 && s.stance !== 'yuzustu') rotWorld(spine2, right, -s.recoil * 0.07);
    // yukarı/aşağı nişan: gövde ve baş eğilir
    // köşe açma: gövde ileri eksen etrafında yana yatar (en fazla ~18°)
    const lean = s.lean || 0;
    if (Math.abs(lean) > 0.001 && s.stance !== 'yuzustu') {
      rotWorld(spine, back, -lean * 0.1);
      rotWorld(spine1, back, -lean * 0.11);
      rotWorld(spine2, back, -lean * 0.1);
      rotWorld(neck, back, lean * 0.12); // baş dik kalsın
    }
    const pitch = s.pitch || 0;
    if (s.stance !== 'yuzustu') {
      rotWorld(spine2, right, pitch * 0.45);
      rotWorld(neck, right, pitch * 0.25);
    }
    g.updateMatrixWorld(true);
    const W = this.weapon;
    if (!W) return;
    const sL = toL(wpos(B('RightArm'))), sLl = toL(wpos(B('LeftArm'))), hL = toL(wpos(head));
    // nişan <-> hazır geçişi yumuşak
    const want = s.aim ? 1 : 0;
    this._ab = dt > 0 ? THREE.MathUtils.lerp(this._ab ?? want, want, 1 - Math.exp(-dt * 14)) : want;
    const ab = this._ab, low = ab < 0.5, mv = Math.max(Math.min(1, s.move || 0), s.ready || 0);
    const rec = s.recoil || 0;
    const o = W.obj;
    const lr = THREE.MathUtils.lerp;
    const u = s.reload ?? -1;
    const renv = u >= 0 ? smooth01(u / 0.1) * (1 - smooth01((u - 0.88) / 0.12)) : 0;
    const abW = Math.max(ab, renv); // şarjör değiştirirken tüfek göğüs hizasına kalkar
    if (this.silah === 'tabanca') {
      o.rotation.set(lr(pitch - 0.7, pitch + rec * 0.3, abW), 0, 0);
      const pLow = V((sL.x + sLl.x) / 2 + 0.03, hL.y - 0.42, hL.z - 0.38);
      const pAim = V((sL.x + sLl.x) / 2 + 0.03, hL.y - 0.06, hL.z - 0.62 + rec * 0.05);
      const p = pLow.lerp(pAim, abW);
      if (s.stance === 'yuzustu') p.set(0.03, 0.32, hL.z - 0.6);
      o.position.copy(p);
    } else {
      // hazır: duruyorken alçak hazır, yürürken sıkıştırılmış hazır (dipçik omuzda, namlu hafif aşağı)
      // dururken alçak hazır (namlu ileri-aşağı ~20°, hafif içe), yürürken sıkıştırılmış hazır,
      // koşarken göğüs önünde çapraz (namlu sol yukarı), nişanda omuzda
      const spr = (s.sprint || 0) * (1 - abW) * (1 - renv);
      const rxLow = pitch * 0.35 - lr(0.38, 0.2, mv), ryLow = lr(0.22, 0.08, mv);
      o.rotation.set(lr(lr(rxLow, 0.62, spr), pitch * (1 - renv), abW) + rec * 0.11, lr(lr(ryLow, 0.72, spr), 0, abW), 0);
      const bLow = V(sL.x - 0.04, hL.y - 0.36, sL.z - 0.1).lerp(V(sL.x - 0.06, hL.y - 0.24, sL.z - 0.07), mv);
      bLow.lerp(V(sL.x - 0.02, hL.y - 0.58, sL.z - 0.16), spr);
      const bAim = V(sL.x - 0.07, hL.y - 0.12, sL.z - 0.06);
      const butt = bLow.lerp(bAim, abW);
      if (s.stance === 'yuzustu') butt.set(sL.x - 0.08, Math.max(0.3, hL.y - 0.1), sL.z - 0.08);
      butt.z += rec * 0.055; // dipçik omza geri vurur
      if (Math.abs(tw) > 1e-4 && s.stance !== 'yuzustu') butt.sub(sL).applyAxisAngle(V(0, 1, 0), tw).add(sL);
      o.rotation.y += s.stance !== 'yuzustu' ? tw : 0;
      const dir = V(0, 0, -1).applyEuler(o.rotation);
      o.position.copy(butt).addScaledVector(dir, W.buttOffset);
    }
    if (this.silah === 'tabanca' && Math.abs(tw) > 1e-4 && s.stance !== 'yuzustu') {
      o.position.sub(hL).applyAxisAngle(V(0, 1, 0), tw).add(hL);
      o.rotation.y += tw;
    }
    if (this.mocap && dt > 0) {
      // el titremesi / salınım (nişanda çok az), efor arttıkça artar
      const t = (this._swT = (this._swT || 0) + dt), ex = Math.min(1, s.exert || 0);
      const nx = Math.sin(t * 1.31) + 0.5 * Math.sin(t * 2.73 + 1.3) + 0.25 * Math.sin(t * 5.1 + 0.4);
      const ny = Math.sin(t * 1.07 + 0.7) + 0.5 * Math.sin(t * 2.29 + 2.1) + 0.25 * Math.sin(t * 4.7 + 1.9);
      const ar = lr(0.022, 0.0035, abW) * (1 + ex * 1.8);
      o.rotation.x += ny * ar * 0.6;
      o.rotation.y += nx * ar;
      // adım sallantısı
      const sp = s.stance === 'ayakta' ? Math.min(1, (s.locoSpeed || 0) / 1.6) : 0, ph = (this.loco?.phase || 0) * Math.PI * 2;
      const bk = sp * lr(1, 0.35, abW) * (1 + (s.locoSpeed > 2.6 ? 1.2 : 0));
      o.position.y += Math.sin(ph * 2) * 0.011 * bk;
      o.position.x += Math.sin(ph) * 0.009 * bk;
      o.rotation.z += Math.sin(ph) * 0.03 * bk;
      // dönüş ataleti: hızlı dönüşte tüfek bir an geride kalır
      const want = Math.max(-0.11, Math.min(0.11, -(s.turnVel || 0) * 0.03)) * lr(1, 0.45, abW);
      const S_ = (this._lag ||= { x: 0, v: 0 });
      // kararlı yay: küçük alt adımlarla (uzun karelerde patlamaz)
      for (let left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        S_.v += ((want - S_.x) * 160 - S_.v * 22) * h;
        S_.x += S_.v * h;
      }
      if (!Number.isFinite(S_.x)) { S_.x = 0; S_.v = 0; }
      o.rotation.y += S_.x;
      o.position.x += S_.x * 0.12;
    }
    // şarjör değiştirme: dipçik koltuk altında, tüfek göğüs önünde sağa yatırılmış, namlu hafif yukarı
    if (renv > 0) {
      o.rotation.z += 0.62 * renv;
      o.rotation.x += 0.22 * renv;
      o.position.y -= 0.13 * renv;
      o.position.z += 0.1 * renv;
      o.position.x -= 0.05 * renv;
    }
    o.updateMatrix();
    g.updateMatrixWorld(true);
    this.animBolt(rec, s.boltLocked && !(u > 0.92));
    const cr = s.stance === 'yuzustu' ? s.crawl || 0 : 0;
    if (cr > 0.02) { this.updateMagVis(-1); return this.crawlArms(cr, s.crawlPh || 0, sL, sLl, L, toL, up, right); }
    const gR = o.localToWorld(W.gripR.clone());
    let gL = o.localToWorld(W.gripL.clone());
    if (u >= 0) { const hl0 = this.reloadHand(u, !!s.reloadEmpty, toL(gL), toL); this.lastHandL = hl0; gL = g.localToWorld(hl0.clone()); }
    this.updateMagVis(u, !!s.reloadEmpty);
    this.emitReload(u, !!s.reloadEmpty);
    let poleR, poleL;
    if (s.stance === 'yuzustu') { poleR = L(sL.x + 0.35, -0.8, sL.z - 0.1); poleL = L(sLl.x - 0.3, -0.8, sLl.z - 0.25); }
    else {
      // dirsekler: hazırda aşağı ve gövdeye yakın, nişanda sağ dirsek yana açılır
      poleR = L(sL.x + 0.3, sL.y - 0.8, sL.z + 0.3).lerp(L(sL.x + 0.6, sL.y - 0.5, sL.z + 0.1), ab);
      poleL = this.silah === 'tabanca' ? L(sLl.x - 0.6, sLl.y - 0.5, sLl.z) : L(sLl.x - 0.22, sLl.y - 0.9, sLl.z - 0.1);
      if (renv > 0) poleL = L(sLl.x - 0.5, sLl.y - 0.6, sLl.z + 0.1);
    }
    if (this.silah !== 'tabanca' && ab > 0.5 && renv < 0.3) {
      rotWorld(neck, back, -0.12 * ab);
      rotWorld(head, right, 0.12 * ab);
    }
    twoBoneIK(B('RightArm'), B('RightForeArm'), B('RightHand'), gR, poleR);
    twoBoneIK(B('LeftArm'), B('LeftForeArm'), B('LeftHand'), gL, poleL);
    const fw = V(0, 0, -1).applyEuler(o.rotation).transformDirection(g.matrixWorld);
    const hr = wpos(B('RightHand')), hl = wpos(B('LeftHand'));
    pointBone(B('RightHand'), B('RightHandMiddle1'), hr.clone().addScaledVector(fw, 0.06).addScaledVector(up, -0.08).addScaledVector(right, -0.03));
    if (renv > 0.3) pointBone(B('LeftHand'), B('LeftHandMiddle1'), hl.clone().addScaledVector(up, 0.06).addScaledVector(fw, 0.05));
    else pointBone(B('LeftHand'), B('LeftHandMiddle1'), hl.clone().addScaledVector(fw, this.silah === 'tabanca' ? 0.06 : 0.04).addScaledVector(up, -0.02).addScaledVector(right, this.silah === 'tabanca' ? 0.06 : 0.07));
    this.curl('Right', 0.9);
    this.curl('Left', renv > 0.3 ? 0.75 : this.silah === 'tabanca' ? 0.9 : 0.6);
    this.simJiggle(dt);
  }

  /**
   * Silah duruşu katmanı (oyunlardaki üst gövde katmanı gibi): bacaklar ve kalça gerçek hareket
   * kaydından gelir; gövde, boyun, baş ve köprücükler ise dik "tüfekli asker" duruşuna çekilir.
   * Hareket kayıtlarındaki kamburluk ve omuz silkmesi böylece görünmez, kayıttan %20 canlılık kalır.
   * Öne eğilme: durunca hafif, yürürken biraz, koşarken ve hızlanırken daha fazla; çömelerek
   * yürürken belirgin. Baş her zaman ufka bakar (nişan eğimi sonradan eklenir).
   */
  uprightTorso(dt) {
    const s = this.state, B = this.B, R = this.uprightRel;
    if (!R) return;
    const sp = Math.min(1, (s.locoSpeed || 0) / 1.6);
    const cw = this._cw || 0;
    const lean = 0.05 + 0.06 * sp + 0.16 * (s.sprint || 0) + (s.accel || 0) + 0.22 * cw;
    const gq = this.group.getWorldQuaternion(new THREE.Quaternion());
    const ax = V(1, 0, 0);
    const tilt = (a) => new THREE.Quaternion().setFromAxisAngle(ax, -a);
    // adım ritmi: omuzlar kalçaya ters yönde çok az döner, gövde iniş anında hafif çöker
    const ph = (this.loco?.phase || 0) * Math.PI * 2, mvw = Math.min(1, (s.locoSpeed || 0) / 1.2);
    const plan = {
      Spine: [lean * 0.35, 0.8], Spine1: [lean * 0.7, 0.8], Spine2: [lean, 0.8],
      Neck: [lean * 0.4, 0.85], Head: [0, 0.85], LeftShoulder: [lean, 0.7], RightShoulder: [lean, 0.7],
    };
    const pw = new THREE.Quaternion(), cur = new THREE.Quaternion(), tgt = new THREE.Quaternion();
    for (const n of UPPER) {
      const b = B(n), rel = R[n];
      if (!b || !rel) continue;
      const [a, w] = plan[n];
      b.parent.getWorldQuaternion(pw);
      cur.copy(pw).multiply(b.quaternion);
      tgt.copy(gq).multiply(tilt(a));
      if (n === 'Spine2') tgt.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -Math.sin(ph) * 0.05 * mvw));
      tgt.multiply(rel);
      cur.slerp(tgt, w);
      b.quaternion.copy(pw.invert().multiply(cur));
      b.updateMatrixWorld(true);
    }
  }

  /** Yelek cepleri ve askılar: yay-sönüm simülasyonu (adımlarla sallanır, yerçekimiyle sarkar) */
  simJiggle(dt) {
    if (!this.jiggle?.length) return;
    this.group.updateMatrixWorld(true);
    const sdt = Math.min(dt, 1 / 30);
    for (const j of this.jiggle) {
      j.b.quaternion.copy(j.q0);
      j.b.updateMatrixWorld(true);
      const tgt = wpos(j.c), base = wpos(j.b);
      if (!j.p || sdt <= 0) { j.p = tgt.clone(); j.v.set(0, 0, 0); continue; }
      const len = tgt.distanceTo(base);
      j.v.addScaledVector(tgt.clone().sub(j.p), 260 * sdt).multiplyScalar(Math.exp(-11 * sdt));
      j.v.y -= 1.2 * sdt;
      j.p.addScaledVector(j.v, sdt);
      j.p.sub(base).setLength(len).add(base);
      if (j.p.distanceTo(tgt) > len * 0.6) j.p.copy(tgt);
      pointBone(j.b, j.c, j.p);
    }
  }

  // ---------- şarjör değiştirme ----------
  /** Sol elin şarjör değiştirme yolu (grup uzayında). u: 0..1 */
  reloadHand(u, empty, guard, toL) {
    const W = this.weapon, o = W.obj;
    const seat = W.magGrip.clone().applyMatrix4(o.matrix);
    const down = V(0, -1, 0).applyQuaternion(o.quaternion);
    const out = seat.clone().addScaledVector(down, 0.2);
    const sp2 = toL(wpos(this.B('Spine2')));
    const pouch = sp2.clone().add(V(-0.13, -0.2, -0.19));
    const below = seat.clone().addScaledVector(down, 0.12);
    const bolt = (W.boltRel || W.magGrip).clone().applyMatrix4(o.matrix);
    const seg = (a, b, x0, x1) => a.clone().lerp(b, smooth01((u - x0) / (x1 - x0)));
    if (u < 0.12) return seg(guard, seat, 0, 0.12);
    if (u < 0.3) return seg(seat, out, 0.12, 0.3);
    if (u < 0.5) return seg(out, pouch, 0.3, 0.5);
    if (u < 0.72) return seg(pouch, below, 0.5, 0.72);
    if (u < 0.84) return seg(below, seat, 0.72, 0.84);
    if (empty) {
      if (u < 0.91) return seg(seat, bolt, 0.84, 0.91);
      return seg(bolt, guard, 0.93, 1.0);
    }
    return seg(seat, guard, 0.86, 1.0);
  }

  /** Tüfekteki şarjör ve eldeki şarjörün görünürlüğü/konumu */
  updateMagVis(u, empty) {
    const W = this.weapon;
    if (!W || !W.mag || !this.handMag) return;
    const inHand = u > 0.13 && u < 0.84;
    W.mag.visible = !inHand && !W.magHidden;
    const dropped = empty && u >= 0.3 && u < 0.45;
    this.handMag.visible = inHand && !dropped;
    if (!this.handMag.visible) return;
    const o = W.obj;
    const seatM = o.matrix.clone().multiply(W.magRel);
    const pos = V(), q = new THREE.Quaternion(), sc = V();
    seatM.decompose(pos, q, sc);
    const hand = this.lastHandL || V();
    const tilt = smooth01((u - 0.3) / 0.15) * (1 - smooth01((u - 0.58) / 0.14));
    const q2 = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), 0.9 * tilt));
    const off = W.magGripMag.clone().multiply(sc).applyQuaternion(q2);
    this.handMag.matrix.compose(hand.clone().sub(off), q2, sc);
    this.handMag.matrixWorldNeedsUpdate = true;
  }

  emitReload(u, empty) {
    const prev = this._ru ?? -1;
    this._ru = u;
    if (!this.onEvent || u < 0 || u < prev) return;
    const evs = [[0.17, 'magOut'], [0.3, empty ? 'magDrop' : null], [0.53, 'pouch'], [0.83, 'magIn'], [0.92, empty ? 'bolt' : null]];
    for (const [th, name] of evs) if (name && prev < th && u >= th) this.onEvent(name, this);
  }

  /** Sürgü: her atışta geri gidip gelir; son mermide açık kalır */
  animBolt(rec, locked) {
    const W = this.weapon;
    if (!W || !W.bolt) return;
    const cyc = rec > 0.5 ? (1 - rec) * 2 : rec * 2;
    W.bolt.position.copy(W.boltRest).addScaledVector(W.boltDir, locked ? 1 : cyc);
  }

  /**
   * 1. şahısta baş/kask/gözlük ve başa bağlı tüm aksesuarlar gizlenir (kamera içinden geçmesin),
   * gövde görünür kalır. İsim tek başına yetmez: kulaklık mikrofon kolu gibi parçaların adı
   * "Pouches" olabiliyor; koşuda baş sallanınca göz hizasında ekrana giriyordu. Bu yüzden
   * köşe ağırlığının çoğu baş kemiğinde olan her parça da gizlenir.
   */
  setFirstPerson(on) {
    if (this._fp === on || !this.root) return;
    this._fp = on;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (/Head|Helmet|Eye|Glus|visor/i.test((o.material?.name || '') + o.name) || headWeight(o) > 0.6) o.visible = !on;
    });
  }

  /** Nişan anında 3D nişangah gövdesi gizlenir (görüntü ekranda çizilir) */
  setOptic(v) {
    const W = this.weapon;
    if (!W || this._optic === v) return;
    this._optic = v;
    if (W.scope) W.scope.visible = v;
    if (W.dot) W.dot.visible = v;
  }

  /** Nişangah arkasındaki göz noktası ve namlu yönü (dünya) */
  sightInfo() {
    const W = this.weapon;
    if (!W || !W.sightEye) return null;
    return { p: W.obj.localToWorld(W.sightEye.clone()), f: V(0, 0, -1).transformDirection(W.obj.matrixWorld) };
  }

  /** Kovan atma noktası ve yönü (dünya) */
  ejectInfo() {
    const W = this.weapon;
    if (!W) return null;
    const p = W.obj.localToWorld((W.eject || V(0.02, 0.02, 0)).clone());
    const r = V(1, 0, 0).transformDirection(W.obj.matrixWorld);
    const f = V(0, 0, -1).transformDirection(W.obj.matrixWorld);
    return { p, r, f };
  }

  /**
   * Sürünürken kollar: uzanan kol öne yere tutunur, diğeri göğüs altına çekilir.
   * Tüfek sağ elde, namlu ileri, gövdenin sağında yere paralel taşınır.
   * cr ile nişan duruşundan sürünme duruşuna yumuşak geçiş yapılır.
   */
  crawlArms(cr, ph, sL, sLl, L, toL, up, right) {
    const B = this.B, W = this.weapon, o = W.obj, g = this.group;
    const sn = Math.sin(ph);
    const reachR = Math.max(0, sn), reachL = Math.max(0, -sn);   // sağ kol sol dizle, sol kol sağ dizle
    const lift = (r, c) => 0.07 + Math.max(0, Math.cos(ph + c)) * 0.05 * r; // ileri giderken el hafif havada
    const handR = V(sL.x + 0.1, lift(reachR, 0), sL.z - 0.12 - reachR * 0.32 + reachL * 0.08);
    const handL = V(sLl.x - 0.06, lift(reachL, Math.PI), sLl.z - 0.18 - reachL * 0.34 + reachR * 0.08);
    // tüfek: sağ elle tutulur, namlu ileri, yere paralel, hafif yatık
    const prevRot = o.rotation.clone(), prevPos = o.position.clone();
    o.rotation.set(-0.04, -0.05, 0.5);
    const grip = W.gripR.clone().applyEuler(o.rotation);
    const crawlPos = handR.clone().sub(grip);
    o.position.lerpVectors(prevPos, crawlPos, Math.min(1, cr * 1.4));
    o.rotation.set(THREE.MathUtils.lerp(prevRot.x, -0.04, cr), THREE.MathUtils.lerp(prevRot.y, -0.05, cr), THREE.MathUtils.lerp(prevRot.z, 0.5, cr));
    g.updateMatrixWorld(true);
    const gR = o.localToWorld(W.gripR.clone());
    const gLw = o.localToWorld(W.gripL.clone());
    const hLw = g.localToWorld(handL.clone());
    const tL = gLw.lerp(hLw, Math.min(1, cr * 1.4));
    const poleR = L(sL.x + 0.55, 0.45, sL.z + 0.05);
    const poleL = L(sLl.x - 0.55, 0.45, sLl.z + 0.05);
    twoBoneIK(B('RightArm'), B('RightForeArm'), B('RightHand'), gR, poleR);
    twoBoneIK(B('LeftArm'), B('LeftForeArm'), B('LeftHand'), tL, poleL);
    // sol el avuç yere dönük, parmaklar ileri
    const hl = wpos(B('LeftHand'));
    pointBone(B('LeftHand'), B('LeftHandMiddle1'), hl.clone().add(g.localToWorld(V(0.02, -0.04, -0.1)).sub(g.localToWorld(V(0, 0, 0)))));
    this.curl('Right', 0.9);
    this.curl('Left', 0.25 + reachR * 0.3);
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

function m4Model() {
  const src = A.models.m4;
  if (!src) return null;
  const m = src.clone(true);
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.sharedGeo = true; } });
  const box = new THREE.Box3().setFromObject(m);
  const c = box.getCenter(V());
  const L = 0.84, k = L / (box.max.z - box.min.z);
  const inner = new THREE.Group();
  m.position.set(-c.x, -c.y, -c.z);
  inner.add(m);
  inner.scale.setScalar(k);
  inner.rotation.y = Math.PI; // namlu -Z (ileri), dipçik +Z
  const obj = new THREE.Group();
  obj.add(inner);
  obj.updateMatrixWorld(true);
  const W = {
    obj,
    buttOffset: L / 2,
    gripR: V(0, -0.065, 0.21),
    gripL: V(-0.01, -0.005, -0.12),
    muzzle: V(0, 0.03, -L / 2),
  };
  const inv = obj.matrixWorld.clone().invert();
  const boxIn = (mesh) => { mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox.clone().applyMatrix4(inv.clone().multiply(mesh.matrixWorld)); };
  let mag = null, bolt = null, scope = null;
  m.traverse((o) => { if (o.isMesh && /Magazine/i.test(o.name + (o.parent?.name || ''))) mag = o; if (o.isMesh && /BoltCarrier/i.test(o.name + (o.parent?.name || ''))) bolt = o; if (o.isMesh && /Scope/i.test(o.name + (o.parent?.name || ''))) scope = o; });
  if (mag) {
    W.mag = mag;
    W.magRel = inv.clone().multiply(mag.matrixWorld);
    const mb = boxIn(mag), mc = mb.getCenter(V());
    W.magGrip = V(mc.x, mb.min.y + 0.05, mc.z);
    W.magGripMag = W.magGrip.clone().applyMatrix4(W.magRel.clone().invert()); // şarjörün kendi uzayında, ölçeksiz
    W.boltRel = V(mb.min.x - 0.012, mb.max.y + 0.012, mc.z - 0.01); // sürgü kilit/bırakma mandalı (sol yanda)
  } else W.magGrip = V(0, -0.12, 0.05);
  if (bolt) {
    W.bolt = bolt;
    W.boltRest = bolt.position.clone();
    const pm = bolt.parent.matrixWorld.clone().invert().multiply(obj.matrixWorld);
    W.boltDir = V(0, 0, 0.065).applyMatrix3(new THREE.Matrix3().setFromMatrix4(pm));
    const bb = boxIn(bolt), bc = bb.getCenter(V());
    W.eject = V(bb.max.x + 0.006, bc.y + 0.006, bc.z);
  } else W.eject = V(0.025, 0.02, 0.03);
  if (scope) {
    // kırmızı nokta nişangah: tüpün optik ekseni, arkasında göz mesafesi
    const sb = boxIn(scope), sc = sb.getCenter(V());
    const tubeR = (sb.max.x - sb.min.x) / 2;
    const ay = sb.max.y - tubeR;
    W.sightEye = V(sc.x, ay, sb.max.z + 0.085);
    // nişangahın içindeki kırmızı nokta (yalnızca arkadan görünür)
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0009, 16), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }));
    dot.position.set(sc.x, ay, sb.min.z + 0.02);
    dot.renderOrder = 999;
    dot.userData.noAO = true;
    obj.add(dot);
    W.dot = dot;
    W.scope = scope;
  }
  return W;
}

function rifleModel() {
  const m4 = m4Model();
  if (m4) return m4;
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
  // tabanca şarjörü (kabza içinde): elde taşınacak basit şarjör modeli
  const magMesh = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.11, 0.034), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.55, metalness: 0.4 }));
  magMesh.visible = false;
  obj.add(magMesh);
  const magRel = new THREE.Matrix4().makeTranslation(0, -0.07, 0.045);
  // gez-arpacık hattı: görünen tabancanın üst arka kenarı
  obj.updateMatrixWorld(true);
  const invO = obj.matrixWorld.clone().invert(), pb = new THREE.Box3();
  m.traverse((o) => { if (o.isMesh && o.visible) { o.geometry.computeBoundingBox(); pb.union(o.geometry.boundingBox.clone().applyMatrix4(invO.clone().multiply(o.matrixWorld))); } });
  const sightEye = pb.isEmpty() ? V(0, 0.06, 0.2) : V((pb.min.x + pb.max.x) / 2, pb.max.y + 0.006, pb.max.z + 0.17);
  return {
    obj, buttOffset: 0, gripR: V(0, -0.05, 0.05), gripL: V(-0.035, -0.06, 0.04), muzzle: V(0, 0.03, -0.16),
    mag: magMesh, magHidden: true, magRel, magGrip: V(0, -0.11, 0.045), magGripMag: V(0, -0.04, 0), eject: V(0.012, 0.035, -0.02),
    boltRel: V(-0.015, 0.0, 0.0), sightEye,
  };
}
