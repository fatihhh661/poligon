import * as THREE from 'three';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { A } from './assets.js';

// ----------------- yardımcılar -----------------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
const smooth01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

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
      root.position.y = -0.46;
      g.updateMatrixWorld(true);
      twoBoneIK(B('LeftUpLeg'), B('LeftLeg'), B('LeftFoot'), L(-0.12, 0.1, -0.42), L(-0.12, 0.6, -1.5));
      twoBoneIK(B('RightUpLeg'), B('RightLeg'), B('RightFoot'), L(0.14, 0.12, 0.42), L(0.14, -1, -0.4));
      rotWorld(B('RightFoot'), right, -0.9);
      rotWorld(spine, right, 0.12);
    } else if (this.isMark) {
      // taktik yürüyüş: hareket ederken dizler bükülür (ayaklar yerde kilitli), gövde hafif öne
      const mv = Math.min(1, s.move || 0);
      if (mv > 0.01) {
        const fl = wpos(B('LeftFoot')), fr = wpos(B('RightFoot'));
        root.position.y = -0.085 * mv;
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
    const ab = this._ab, low = ab < 0.5, mv = Math.min(1, s.move || 0);
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
      const rxLow = pitch - lr(0.62, 0.28, mv), ryLow = lr(0.45, 0.1, mv);
      o.rotation.set(lr(rxLow, pitch * (1 - renv), abW) + rec * 0.11, lr(ryLow, 0, abW), 0);
      const bLow = V(sL.x - 0.02, hL.y - 0.32, sL.z - 0.12).lerp(V(sL.x - 0.06, hL.y - 0.2, sL.z - 0.07), mv);
      const bAim = V(sL.x - 0.07, hL.y - 0.12, sL.z - 0.06);
      const butt = bLow.lerp(bAim, abW);
      if (s.stance === 'yuzustu') butt.set(sL.x - 0.08, Math.max(0.3, hL.y - 0.1), sL.z - 0.08);
      butt.z += rec * 0.055; // dipçik omza geri vurur
      const dir = V(0, 0, -1).applyEuler(o.rotation);
      o.position.copy(butt).addScaledVector(dir, W.buttOffset);
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
      poleR = L(sL.x + 0.6, sL.y - 0.5, sL.z + 0.1);
      poleL = this.silah === 'tabanca' ? L(sLl.x - 0.6, sLl.y - 0.5, sLl.z) : L(sLl.x - 0.1, sLl.y - 0.9, sLl.z - 0.2);
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
  let mag = null, bolt = null;
  m.traverse((o) => { if (o.isMesh && /Magazine/i.test(o.name + (o.parent?.name || ''))) mag = o; if (o.isMesh && /BoltCarrier/i.test(o.name + (o.parent?.name || ''))) bolt = o; });
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
  return {
    obj, buttOffset: 0, gripR: V(0, -0.05, 0.05), gripL: V(-0.035, -0.06, 0.04), muzzle: V(0, 0.03, -0.16),
    mag: magMesh, magHidden: true, magRel, magGrip: V(0, -0.11, 0.045), magGripMag: V(0, -0.04, 0), eject: V(0.012, 0.035, -0.02),
    boltRel: V(-0.015, 0.0, 0.0),
  };
}
