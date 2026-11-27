// Hareket kaydı içe aktarıcı (geliştirme aşamasında çalışır, program açılışında değil).
// Farklı kaynak iskeletlerini (CMU, 100STYLE/Xsens, Mixamo) ortak klip biçimine çevirir:
//   app/assets/anim/lib/<id>.json  (mocap.json ile aynı yapı + kaynak/lisans bilgisi)
//   app/assets/anim/library.json   (merkezi kayıt: hangi kütüphane etkin, klipler, kaynaklar)
// Çalışma zamanındaki yürüyüş motoru (soldier.js) kaynağı fark etmeden aynı klip anahtarlarını
// (Idle, Walk, Run, WalkBack ...) kullanır; kütüphane yoksa ya da bozuksa eski mocap.json devrede kalır.
//
// Kullanım:  node scripts/import-anim.mjs scripts/anim-sources/100style-neutral.json <ham-kayıt-klasörü>
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// ---- kaynak iskelet profilleri: kaynak kemik adı -> hedef (Mixamo) adı ----
const SIDES = ['Left', 'Right'];
const PROFILES = {
  cmu: (() => {
    const m = { Hips: 'Hips', LowerBack: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Neck: 'Neck', Head: 'Head' };
    for (const s of SIDES) for (const b of ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase']) m[s + b] = s + b;
    return m;
  })(),
  // 100STYLE (Xsens, 23 eklem): Chest..Chest4 omurga; Chest3 eşlenmez (dünya yönü tabanlı aktarımda sorun olmaz)
  xsens100style: (() => {
    const m = { Hips: 'Hips', Chest: 'Spine', Chest2: 'Spine1', Chest4: 'Spine2', Neck: 'Neck', Head: 'Head' };
    for (const s of SIDES) Object.assign(m, { [s + 'Collar']: s + 'Shoulder', [s + 'Shoulder']: s + 'Arm', [s + 'Elbow']: s + 'ForeArm', [s + 'Wrist']: s + 'Hand', [s + 'Hip']: s + 'UpLeg', [s + 'Knee']: s + 'Leg', [s + 'Ankle']: s + 'Foot', [s + 'Toe']: s + 'ToeBase' });
    return m;
  })(),
  // Mixamo FBX: adlar zaten mixamorig* (FBXLoader ':' karakterini atar)
  mixamo: null,
};
const LEGS = ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'Spine', 'Spine1'];

/** Kaynak dosyayı ortak "hareket" yapısına çevir: kemikler (dinlenme ofsetleri) + kare kare yerel dönüşler */
async function loadMotion(file, cfg) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.bvh') throw new Error(`Şimdilik yalnızca BVH destekleniyor (${file}). FBX için önce GLB/BVH'ye çevirin.`);
  const r = new BVHLoader().parse(fs.readFileSync(file, 'utf8'));
  const map = PROFILES[cfg.profile];
  if (map === undefined) throw new Error('Bilinmeyen iskelet profili: ' + cfg.profile);
  const nm = (n) => (map && map[n] ? 'mixamorig' + map[n] : n);
  const bones = r.skeleton.bones;
  const tr = {};
  for (const t of r.clip.tracks) tr[t.name] = t;
  const hipName = bones[0].name;
  const n = tr[hipName + '.position'].times.length, fps = (n - 1) / r.clip.duration;
  // birim: dinlenme pozunda kalça yüksekliği (kalçadan en alçak ayak ucuna) gerçek boya ölçeklenir
  const rest = bones.map((b) => b.position.clone());
  const restWorld = []; bones.forEach((b, i) => { const p = bones.indexOf(b.parent); restWorld[i] = p >= 0 ? restWorld[p].clone().add(rest[i]) : new THREE.Vector3(); });
  const minY = Math.min(...restWorld.map((v) => v.y));
  const hipRaw = -minY;
  const S = cfg.scale ?? (cfg.hipHeight ?? 0.93) / hipRaw;
  // kaynağın "ileri" ekseni: dinlenme pozunda ayak ucu yönü. Ortak biçim (CMU gibi) +Z ileri kabul eder;
  // farklıysa iskelet tümüyle yeniden eksenlenir: ofsetler R ile döner, her yerel dönüş R·q·R⁻¹ olur
  const toe = bones.findIndex((b) => /Toe/i.test(b.name) && !/End/i.test(b.name));
  const ank = bones.findIndex((b) => /Ankle|Foot/i.test(b.name) && !/Toe/i.test(b.name));
  const fwd0 = restWorld[toe].clone().sub(restWorld[ank]).setY(0).normalize();
  const restYaw = Math.atan2(fwd0.x, fwd0.z);
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -restYaw), Ri = R.clone().invert();
  const Q = (b, i) => {
    const q = tr[b + '.quaternion'] ? new THREE.Quaternion().fromArray(tr[b + '.quaternion'].values, Math.min(i, n - 1) * 4) : new THREE.Quaternion();
    return R.clone().multiply(q).multiply(Ri);
  };
  const P = (i) => new THREE.Vector3().fromArray(tr[hipName + '.position'].values, Math.min(i, n - 1) * 3).multiplyScalar(S).applyQuaternion(R);
  const fwd = new THREE.Vector3(0, 0, 1);
  return {
    names: bones.map((b) => b.name), hipName, fps, n, S, Q, P, fwd, nm, restYaw,
    hierarchy: bones.map((b, i) => ({ n: nm(b.name), p: bones.indexOf(b.parent), o: rest[i].clone().applyQuaternion(R).toArray().map((v) => +(v * S).toFixed(5)) })),
  };
}

/** Bir klip üret: döngü penceresi seç (bacak/kalça uyumu), yönü hizala, yerinde hale getir */
function buildClip(M, sp, outFps) {
  const { fps, Q, P, names, hipName } = M;
  const i0 = Math.round(sp.t0 * fps), i1 = Math.round(sp.t1 * fps);
  let a = i0, L = i1 - i0, best = 0;
  if (!sp.idle) {
    best = 1e9;
    const legNames = names.filter((x) => LEGS.includes(M.nm(x).replace('mixamorig', '')));
    const yawAt = (i) => { const f = M.fwd.clone().applyQuaternion(Q(hipName, i)); return Math.atan2(f.x, f.z); };
    const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    for (let s = i0; s < i1; s += 2) for (let l = Math.round(sp.L[0] * fps); l <= Math.round(sp.L[1] * fps) && s + l <= i1; l++) {
      let c = 0;
      for (const b of legNames) c += 1 - Math.abs(Q(b, s).dot(Q(b, s + l)));
      c += Math.abs(P(s).y - P(s + l).y) * 3 + Math.abs((P(s + 1).y - P(s).y) - (P(s + l + 1).y - P(s + l).y)) * 40;
      // düzlük: kayıt alanı küçükse oyuncu sık döner; dönüş anları döngü olarak seçilmesin
      const p0 = P(s), p1 = P(s + l), pm = P(s + (l >> 1)), d = p1.clone().sub(p0).setY(0), dl = d.length();
      if (dl < 0.2) continue; // yerinde sayma / durma
      const off = pm.clone().sub(p0).setY(0).cross(d).length() / dl; // yolun düz çizgiden sapması (m)
      c += Math.abs(wrap(yawAt(s + l) - yawAt(s))) * 2 + off * 6;
      // hedef hız aralığı (verildiyse)
      if (sp.v) { const v = dl / (l / fps); if (v < sp.v[0] || v > sp.v[1]) continue; }
      if (c < best) { best = c; a = s; L = l; }
    }
    if (best >= 1e9) throw new Error(`${sp.key}: uygun döngü bulunamadı (pencere/hız aralığını kontrol edin)`);
  }
  // ortalama gövde yönü (kaynağın ileri ekseniyle)
  const fw = new THREE.Vector3();
  for (let i = a; i <= a + L; i++) fw.add(M.fwd.clone().applyQuaternion(Q(hipName, i)).setY(0).normalize());
  // hareket yönüne hizalama: ileri yürüyüşte kalça yönü, diğerlerinde de kalça yönü (klip açısı ayrıca kayıtlı)
  const yaw0 = Math.atan2(fw.x, fw.z);
  const rotInv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw0);
  const D = P(a + L).sub(P(a)).setY(0);
  const speed = sp.idle ? 0 : D.length() / (L / fps);
  const N = Math.max(2, Math.round((L / fps) * outFps));
  const clip = { dur: +(L / fps).toFixed(4), speed: +speed.toFixed(3), ang: sp.ang ?? 0, q: {}, hp: [] };
  for (const b of names) clip.q[M.nm(b)] = [];
  const blendTail = sp.idle ? Math.round((sp.blend ?? 0.8) * outFps) : 0;
  const hipQ = (i) => { let q = rotInv.clone().multiply(Q(hipName, i)); if (sp.idle) q = q.multiply(new THREE.Quaternion(0, q.y, 0, q.w).normalize().invert()); return q; };
  for (let k = 0; k <= N; k++) {
    const u = k / N, f = a + u * L, fi = Math.min(a + L - 1, Math.floor(f)), fr = f - fi;
    const wTail = blendTail && k > N - blendTail ? (k - (N - blendTail)) / blendTail : 0;
    const sm = wTail * wTail * (3 - 2 * wTail);
    for (const b of names) {
      let q = b === hipName ? hipQ(fi).slerp(hipQ(fi + 1), fr) : Q(b, fi).slerp(Q(b, fi + 1), fr);
      const q0 = b === hipName ? hipQ(a) : Q(b, a);
      if (wTail > 0) q.slerp(q0, sm);
      if (k === N) q = q0;
      clip.q[M.nm(b)].push(...q.toArray().map((v) => +v.toFixed(5)));
    }
    let p = P(fi).lerp(P(fi + 1), fr).sub(P(a));
    p.x -= D.x * u; p.z -= D.z * u;
    p.applyQuaternion(rotInv);
    if (wTail > 0 || k === N) p.lerp(new THREE.Vector3(), k === N ? 1 : sm);
    clip.hp.push(+p.x.toFixed(4), +(P(a).y + p.y).toFixed(4), +p.z.toFixed(4));
  }
  clip.stride = +(speed * clip.dur).toFixed(3);
  clip.src = { file: path.basename(sp.file), t0: +(a / fps).toFixed(3), t1: +((a + L) / fps).toFixed(3), loopErr: +best.toFixed(4) };
  return clip;
}

/** Adım fazı: sol ayağın en alçakta olduğu an (yere basış) ve en alçak ayak yüksekliği */
function footPhases(out) {
  const bones = out.hierarchy.map((h) => { const b = new THREE.Bone(); b.name = h.n; b.position.fromArray(h.o); return b; });
  out.hierarchy.forEach((h, i) => { if (h.p >= 0) bones[h.p].add(bones[i]); });
  const lf = bones.find((b) => b.name === 'mixamorigLeftFoot'), rf = bones.find((b) => b.name === 'mixamorigRightFoot');
  for (const [k, c] of Object.entries(out.clips)) {
    const N = c.hp.length / 3;
    let best = 1e9, bi = 0;
    const hs = [];
    for (let f = 0; f < N - 1; f++) {
      bones.forEach((b) => { const q = c.q[b.name]; if (q) b.quaternion.fromArray(q, f * 4); });
      bones[0].position.fromArray(c.hp, f * 3);
      bones[0].updateMatrixWorld(true);
      const yl = new THREE.Vector3().setFromMatrixPosition(lf.matrixWorld).y, yr = new THREE.Vector3().setFromMatrixPosition(rf.matrixWorld).y;
      hs.push(Math.min(yl, yr));
      if (yl - yr < best) { best = yl - yr; bi = f; }
    }
    c.ph0 = +(bi / (N - 1)).toFixed(4);
    c.footY = +Math.min(...hs).toFixed(4);
  }
}

// ---- çalıştır ----
const cfgFile = process.argv[2];
if (!cfgFile) { console.error('Kullanım: node scripts/import-anim.mjs <kaynak-tanımı.json>'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const outFps = cfg.fps || 60;
const out = { units: 'm', fps: outFps, id: cfg.id, source: cfg.source, clips: {}, hierarchy: null };
const cache = {};
for (const sp of cfg.clips) {
  // ham kayıtlar depoya girmez: kaynak klasörü 2. argümanla verilebilir
  const file = path.resolve(process.argv[3] || path.resolve(path.dirname(cfgFile), cfg.dir || '.'), sp.file);
  if (!fs.existsSync(file)) { console.error('EKSİK DOSYA:', file); process.exit(2); }
  const M = (cache[file] ||= await loadMotion(file, cfg));
  if (!out.hierarchy) out.hierarchy = M.hierarchy;
  const c = buildClip(M, { ...sp, file }, outFps);
  out.clips[sp.key] = c;
  console.log(`${sp.key.padEnd(10)} ${c.src.file} ${c.src.t0}-${c.src.t1} sn  süre ${c.dur}  hız ${c.speed} m/sn  adım ${c.stride} m  döngü hatası ${c.src.loopErr}`);
}
footPhases(out);
const libDir = path.join(root, 'app/assets/anim/lib');
fs.mkdirSync(libDir, { recursive: true });
const outFile = path.join(libDir, cfg.id + '.json');
fs.writeFileSync(outFile, JSON.stringify(out));
// merkezi kayıt
const regFile = path.join(root, 'app/assets/anim/library.json');
const reg = fs.existsSync(regFile) ? JSON.parse(fs.readFileSync(regFile, 'utf8')) : { active: null, libraries: {} };
reg.libraries[cfg.id] = {
  file: `assets/anim/lib/${cfg.id}.json`, source: cfg.source, fps: outFps, torso: cfg.torso ?? 0.8,
  clips: Object.fromEntries(Object.entries(out.clips).map(([k, c]) => [k, { dur: c.dur, speed: c.speed, stride: c.stride, frames: c.hp.length / 3, ...c.src }])),
  imported: new Date().toISOString().slice(0, 10),
};
if (cfg.activate) reg.active = cfg.id;
fs.writeFileSync(regFile, JSON.stringify(reg, null, 2));
console.log('yazıldı', path.relative(root, outFile), (fs.statSync(outFile).size / 1024).toFixed(0), 'KB; etkin kütüphane:', reg.active);
