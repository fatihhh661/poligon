// CMU hareket kayıtlarından (BVH) döngüsel, yerinde, askerin yönüne hizalı animasyon klipleri üretir.
// Kullanım: node scripts/prep-mocap.mjs  (dist/mocap/*.bvh -> app/assets/anim/mocap.json)
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import fs from 'node:fs';

const S = 0.0565; // CMU birimi -> metre
const MAP = { Hips: 'Hips', LowerBack: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Neck: 'Neck', Head: 'Head' };
for (const s of ['Left', 'Right']) for (const b of ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase']) MAP[s + b] = s + b;
const nm = (n) => (MAP[n] ? 'mixamorig' + MAP[n] : n);

const SPECS = [
  { key: 'Idle', file: '40_10', t0: 1.0, t1: 5.2, idle: true },
  { key: 'Walk', file: '16_15', t0: 0.6, t1: 3.8, L: [0.9, 1.3], ang: 0 },
  { key: 'Run', file: '16_35', t0: 0.0, t1: 1.3, L: [0.55, 0.85], ang: 0 },
  { key: 'WalkBack', file: '69_39', t0: 5.9, t1: 7.9, L: [0.9, 1.5], ang: 180 },
  { key: 'StrafeL', file: '69_42', t0: 1.0, t1: 3.6, L: [0.8, 1.5], ang: 90 },
  { key: 'StrafeR', file: '69_48', t0: 0.3, t1: 2.2, L: [0.8, 1.5], ang: -90 },
];
const LEG = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LowerBack', 'Spine'];

const out = { units: 'm', fps: 30, clips: {} };
for (const sp of SPECS) {
  const r = new BVHLoader().parse(fs.readFileSync(`dist/mocap/${sp.file}.bvh`, 'utf8'));
  const bones = r.skeleton.bones;
  if (!out.hierarchy) out.hierarchy = bones.map((b) => ({ n: nm(b.name), p: bones.indexOf(b.parent), o: b.position.toArray().map((v) => +(v * S).toFixed(5)) }));
  const tr = {};
  for (const t of r.clip.tracks) tr[t.name] = t;
  const n = tr['Hips.position'].times.length, fps = (n - 1) / r.clip.duration;
  const Q = (b, i) => (tr[b + '.quaternion'] ? new THREE.Quaternion().fromArray(tr[b + '.quaternion'].values, i * 4) : new THREE.Quaternion());
  const P = (i) => new THREE.Vector3().fromArray(tr['Hips.position'].values, i * 3).multiplyScalar(S);
  const i0 = Math.round(sp.t0 * fps), i1 = Math.round(sp.t1 * fps);
  let a = i0, L = i1 - i0;
  if (!sp.idle) {
    let best = 1e9;
    for (let s = i0; s < i1; s += 2) for (let l = Math.round(sp.L[0] * fps); l <= Math.round(sp.L[1] * fps) && s + l <= i1; l++) {
      let c = 0;
      for (const b of LEG) c += 1 - Math.abs(Q(b, s).dot(Q(b, s + l)));
      c += Math.abs(P(s).y - P(s + l).y) * 3 + Math.abs((P(s + 1).y - P(s).y) - (P(s + l + 1).y - P(s + l).y)) * 40;
      if (c < best) { best = c; a = s; L = l; }
    }
    console.log(sp.key, 'döngü', (a / fps).toFixed(2), '+', (L / fps).toFixed(2), 's  hata', best.toFixed(4));
  }
  // ortalama gövde yönü
  const fw = new THREE.Vector3();
  for (let i = a; i <= a + L; i++) fw.add(new THREE.Vector3(0, 0, 1).applyQuaternion(Q('Hips', i)).setY(0).normalize());
  const yaw0 = Math.atan2(fw.x, fw.z);
  const rotInv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw0);
  const D = P(a + L).sub(P(a)).setY(0);
  const speed = sp.idle ? 0 : D.length() / (L / fps);
  const N = Math.max(2, Math.round((L / fps) * out.fps));
  const clip = { dur: +(L / fps).toFixed(4), speed: +speed.toFixed(3), ang: sp.ang ?? 0, q: {}, hp: [] };
  for (const b of bones) clip.q[nm(b.name)] = [];
  const blendTail = sp.idle ? Math.round(0.6 * out.fps) : 0;
  for (let k = 0; k <= N; k++) {
    const u = k / N, f = a + u * L, fi = Math.min(a + L - 1, Math.floor(f)), fr = f - fi;
    // döngü kapanışı: son kare = ilk kare; bekleme klibinde son 0,6 sn başa harmanlanır
    const wTail = blendTail && k > N - blendTail ? (k - (N - blendTail)) / blendTail : 0;
    for (const b of bones) {
      let q = Q(b.name, fi).slerp(Q(b.name, fi + 1), fr);
      if (b.name === 'Hips') q = rotInv.clone().multiply(q);
      if (b.name === 'Hips' && sp.idle) { // beklemede gövde dönüşünü (Y ekseni) at, eğilme ve ağırlık değişimi kalsın
        const tw = new THREE.Quaternion(0, q.y, 0, q.w).normalize();
        q = q.clone().multiply(tw.invert());
      }
      if (wTail > 0) { let q0 = Q(b.name, a); if (b.name === 'Hips') { q0 = rotInv.clone().multiply(q0); if (sp.idle) q0.multiply(new THREE.Quaternion(0, q0.y, 0, q0.w).normalize().invert()); } q.slerp(q0, wTail * wTail * (3 - 2 * wTail)); }
      if (k === N) { q = Q(b.name, a); if (b.name === 'Hips') { q = rotInv.clone().multiply(q); if (sp.idle) q.multiply(new THREE.Quaternion(0, q.y, 0, q.w).normalize().invert()); } }
      clip.q[nm(b.name)].push(...q.toArray().map((v) => +v.toFixed(4)));
    }
    let p = P(fi).lerp(P(fi + 1), fr).sub(P(a));
    p.x -= D.x * u; p.z -= D.z * u;
    p.applyQuaternion(rotInv);
    if (wTail > 0 || k === N) { const p0 = new THREE.Vector3(0, 0, 0); p.lerp(p0, k === N ? 1 : wTail * wTail * (3 - 2 * wTail)); }
    clip.hp.push(+p.x.toFixed(4), +(P(a).y + p.y).toFixed(4), +p.z.toFixed(4));
  }
  clip.stride = +(speed * clip.dur).toFixed(3);
  out.clips[sp.key] = clip;
  console.log(sp.key, 'hız', speed.toFixed(2), 'm/sn', 'adım', clip.stride, 'm', 'yön', (yaw0 * 180 / Math.PI).toFixed(0));
}
// adım fazı: sol ayağın en alçak olduğu an (yere basış) -> tüm klipler bu noktadan senkronlanır
{
  const bones = out.hierarchy.map((h) => { const b = new THREE.Bone(); b.name = h.n; b.position.fromArray(h.o); return b; });
  out.hierarchy.forEach((h, i) => { if (h.p >= 0) bones[h.p].add(bones[i]); });
  const root = bones[0];
  const lf = bones.find((b) => b.name === 'mixamorigLeftFoot'), rf = bones.find((b) => b.name === 'mixamorigRightFoot');
  for (const [k, c] of Object.entries(out.clips)) {
    const N = c.hp.length / 3;
    let best = 1e9, bi = 0;
    const hs = [];
    for (let f = 0; f < N - 1; f++) {
      bones.forEach((b) => { const q = c.q[b.name]; if (q) b.quaternion.fromArray(q, f * 4); });
      root.position.fromArray(c.hp, f * 3);
      root.updateMatrixWorld(true);
      const yl = new THREE.Vector3().setFromMatrixPosition(lf.matrixWorld).y, yr = new THREE.Vector3().setFromMatrixPosition(rf.matrixWorld).y;
      hs.push([yl, yr]);
      if (yl - yr < best) { best = yl - yr; bi = f; }
    }
    c.ph0 = +(bi / (N - 1)).toFixed(4);
    c.footY = +Math.min(...hs.map((h) => Math.min(h[0], h[1]))).toFixed(4);
    console.log(k, 'faz0', c.ph0, 'en alçak ayak', c.footY);
  }
}
fs.writeFileSync('app/assets/anim/mocap.json', JSON.stringify(out));
console.log('yazıldı', (fs.statSync('app/assets/anim/mocap.json').size / 1024).toFixed(0), 'KB');
