// Character Skinning Overhaul: kitel ve pantolonun uzuv bölgelerinde eksik kemik ağırlıklarını onarır.
// Orijinal model DEĞİŞMEZ; sonuç ayrı dosyaya yazılır (app/assets/models/mark-deri.glb).
//
// Tespit (mark.glb): kol/uyluk ana kemiklerinde ağırlık yok; uzuvlar yardımcı burulma kemiklerine bağlı
// (Character Creator tasarımı: UpperarmTwist01/02, ThighTwist01/02 ...). Ancak kitelin üst kol / omuz
// kısmı büyük ölçüde gövdeye (Spine2), pantolonun üst uyluğu kalçaya (Hips/Spine) boyanmış; kol kalkınca
// kılıf gövdede, bacak öne çıkınca pantolon kalçada kalıyor. Dirsek/diz hacim kemiklerinin ağırlığı sıfır.
//
// Yöntem (yalnızca hedef parçalar ve hedef bölgeler; sağlıklı köşelere dokunulmaz):
//  1) Bağlama pozunda eklem konumları (ters bağlama matrislerinden) ile uzuv segmentleri kurulur
//     (omuz→dirsek, dirsek→bilek, kalça→diz, diz→bilek).
//  2) Her köşe en yakın uzuv segmentine göre konumlanır: segment boyunca t (0 kök, 1 uç) ve eksene uzaklık.
//     Uzuv kapsülünün dışındaki köşeler (gövde, sırt, göğüs) hiç değiştirilmez.
//  3) Kapsül içinde, köşenin olması gereken uzuv payı (kökte yumuşak geçiş, uzuv boyunca 1) hesaplanır.
//     Mevcut uzuv zinciri ağırlığı bu paya zaten yakınsa köşe "sağlıklı" sayılır ve değişmez.
//  4) Eksikse: mevcut gövde ağırlıkları oranlarını koruyarak (1-pay) ile ölçeklenir, uzuv payı burulma
//     kemiklerine segment boyunca dağıtılır (kökte Twist01, ortada Twist02, uçta bir alt segmente geçiş);
//     dirsek/diz çevresine hacim kemiği payı eklenir. En büyük 4 etki tutulur, toplam 1'e normalize edilir.
//
// Kullanım: node scripts/fix-skin.mjs            → yalnızca analiz
//           node scripts/fix-skin.mjs --yaz      → mark-deri.glb üretir
import fs from 'node:fs';
import * as THREE from 'three';

const SRC = 'app/assets/models/mark.glb', OUT = 'app/assets/models/mark-deri.glb';
const WRITE = process.argv.includes('--yaz');
const TARGET_MATERIALS = ['Mark_Kitel_1', 'Mark_Pants_1'];

const buf = fs.readFileSync(SRC);
const jlen = buf.readUInt32LE(12);
const J = JSON.parse(buf.slice(20, 20 + jlen).toString());
const binOff = 20 + jlen + 8;
const out = Buffer.from(buf); // kopya; yalnızca ağırlık/eklem baytları değişir (boyutlar aynı)
const bin = out.subarray(binOff);

const accInfo = (i) => {
  const a = J.accessors[i], v = J.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  return { a, off: (v.byteOffset || 0) + (a.byteOffset || 0), comps, size, stride: v.byteStride || comps * size };
};
const rd = (I, k, c) => { const p = I.off + k * I.stride + c * I.size; const ct = I.a.componentType; return ct === 5126 ? bin.readFloatLE(p) : ct === 5123 ? bin.readUInt16LE(p) : ct === 5121 ? bin.readUInt8(p) : bin.readUInt32LE(p); };
const wr = (I, k, c, x) => { const p = I.off + k * I.stride + c * I.size; const ct = I.a.componentType; if (ct === 5126) bin.writeFloatLE(x, p); else if (ct === 5123) bin.writeUInt16LE(x, p); else if (ct === 5121) bin.writeUInt8(x, p); else bin.writeUInt32LE(x, p); };

// eklemler ve bağlama pozundaki konumları
const skin = J.skins[0];
const names = skin.joints.map((i) => J.nodes[i].name.replace('mixamorig', ''));
const jIdx = Object.fromEntries(names.map((n, i) => [n, i]));
const IBM = accInfo(skin.inverseBindMatrices);
const jPos = names.map((_, k) => { const m = new THREE.Matrix4(); const e = []; for (let c = 0; c < 16; c++) e.push(rd(IBM, k, c)); m.fromArray(e).invert(); return new THREE.Vector3().setFromMatrixPosition(m); });
const P = (n) => jPos[jIdx[n]];

// uzuv tanımları: kök/uç eklem, burulma kemikleri, uzuv zinciri (sağlık ölçümü için), kökteki gövde tarafı
const LIMBS = [];
for (const [S, side] of [['L', 'Left'], ['R', 'Right']]) {
  LIMBS.push({ id: S + '_ustkol', mat: 'Mark_Kitel_1', a: P(side + 'Arm'), b: P(side + 'ForeArm'), radius: 0.62, t0: -0.12, tFull: 0.32,
    bones: [`CC_Base_${S}_UpperarmTwist01`, `CC_Base_${S}_UpperarmTwist02`], next: `CC_Base_${S}_ForearmTwist01`, share: `CC_Base_${S}_ElbowShareBone`,
    chain: [`CC_Base_${S}_UpperarmTwist01`, `CC_Base_${S}_UpperarmTwist02`, `CC_Base_${S}_ForearmTwist01`, `CC_Base_${S}_ForearmTwist02`, `CC_Base_${S}_ElbowShareBone`, side + 'Arm', side + 'ForeArm', side + 'Hand'],
    nextChain: [`CC_Base_${S}_ForearmTwist01`, `CC_Base_${S}_ForearmTwist02`, side + 'ForeArm', side + 'Hand'] });
  LIMBS.push({ id: S + '_onkol', mat: 'Mark_Kitel_1', a: P(side + 'ForeArm'), b: P(side + 'Hand'), radius: 0.5, t0: -0.3, tFull: -0.3, onlyFill: true,
    bones: [`CC_Base_${S}_ForearmTwist01`, `CC_Base_${S}_ForearmTwist02`], next: side + 'Hand', share: null,
    chain: [`CC_Base_${S}_UpperarmTwist01`, `CC_Base_${S}_UpperarmTwist02`, `CC_Base_${S}_ForearmTwist01`, `CC_Base_${S}_ForearmTwist02`, `CC_Base_${S}_ElbowShareBone`, side + 'Hand', side + 'ForeArm'] });
  LIMBS.push({ id: S + '_uyluk', mat: 'Mark_Pants_1', a: P(side + 'UpLeg'), b: P(side + 'Leg'), radius: 0.42, t0: -0.06, tFull: 0.3,
    bones: [`CC_Base_${S}_ThighTwist01`, `CC_Base_${S}_ThighTwist02`], next: `CC_Base_${S}_CalfTwist01`, share: `CC_Base_${S}_KneeShareBone`,
    chain: [`CC_Base_${S}_ThighTwist01`, `CC_Base_${S}_ThighTwist02`, `CC_Base_${S}_CalfTwist01`, `CC_Base_${S}_CalfTwist02`, `CC_Base_${S}_KneeShareBone`, side + 'UpLeg', side + 'Leg', side + 'Foot'],
    nextChain: [`CC_Base_${S}_CalfTwist01`, `CC_Base_${S}_CalfTwist02`, side + 'Leg', side + 'Foot'] });
}
for (const L of LIMBS) { L.len = L.a.distanceTo(L.b); L.dir = L.b.clone().sub(L.a).normalize(); }
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const report = {};
const tmp = new THREE.Vector3();
for (const [mi, mesh] of J.meshes.entries()) for (const prim of mesh.primitives) {
  const matName = J.materials[prim.material]?.name;
  if (!TARGET_MATERIALS.includes(matName) || prim.attributes.JOINTS_0 == null) continue;
  const PI = accInfo(prim.attributes.POSITION), JI = accInfo(prim.attributes.JOINTS_0), WI = accInfo(prim.attributes.WEIGHTS_0);
  const n = PI.a.count;
  for (let k = 0; k < n; k++) {
    tmp.set(rd(PI, k, 0), rd(PI, k, 1), rd(PI, k, 2));
    // en uygun uzuv: kapsül içinde ve eksene en yakın
    let best = null, bd = 1e9, bt = 0;
    for (const L of LIMBS) {
      if (L.mat !== matName) continue;
      const rel = tmp.clone().sub(L.a), t = rel.dot(L.dir) / L.len;
      if (t < L.t0 - 0.05 || t > 1.08) continue;
      const d = rel.clone().addScaledVector(L.dir, -t * L.len).length() / L.len; // eksene uzaklık / uzuv boyu
      if (d > L.radius) continue;
      if (d < bd) { bd = d; best = L; bt = t; }
    }
    if (!best) continue;
    const L = best, t = bt;
    // köşenin mevcut ağırlıkları
    const cur = {};
    for (let c = 0; c < 4; c++) { const w = rd(WI, k, c); if (w > 1e-4) { const nm = names[rd(JI, k, c)]; cur[nm] = (cur[nm] || 0) + w; } }
    const limbCur = L.chain.reduce((s, b) => s + (cur[b] || 0), 0);
    // olması gereken uzuv payı (kökte gövdeyle yumuşak geçiş)
    const want = L.onlyFill ? 1 : smooth(L.t0, L.tFull, t) * (1 - smooth(0.85, 1.0, bd / L.radius) * 0.5);
    const R = (report[L.id] ||= { koseler: 0, saglikli: 0, duzeltilen: 0, eksikOrt: 0 });
    R.koseler++;
    // ikinci kusur: uç segmente (ön kol / baldır) erken geçiş — dirsek/diz bükülünce üstteki kılıf katlanıp içeri girer
    const nextCur = L.nextChain ? L.nextChain.reduce((s2, b) => s2 + (cur[b] || 0), 0) : 0;
    const nextWant = want * smooth(0.88, 1.06, t);
    const earlyNext = L.nextChain && t < 0.95 && nextCur > nextWant + 0.2;
    if (limbCur >= want - 0.08 && !earlyNext) { R.saglikli++; continue; }
    R.duzeltilen++; R.eksikOrt += Math.max(0, want - limbCur); if (earlyNext) R.erkenGecis = (R.erkenGecis || 0) + 1;
    if (!WRITE) continue;
    // yeni dağılım: gövde (uzuv dışı) ağırlıkları oranını koruyarak (1-want) ile ölçeklenir
    const nw = {};
    const restSum = Object.entries(cur).filter(([b]) => !L.chain.includes(b)).reduce((s, [, w]) => s + w, 0);
    for (const [b, w] of Object.entries(cur)) if (!L.chain.includes(b) && restSum > 1e-6) nw[b] = (w / restSum) * (1 - want);
    // uzuv payı burulma kemiklerine: t<0.5 Twist01 ağırlıklı, t>0.5 Twist02; uçta alt segmente geçiş; dirsek/dizde hacim kemiği
    const toNext = smooth(0.88, 1.06, t);
    const tw2 = smooth(0.15, 0.75, t);
    const shareW = L.share ? 0.35 * Math.max(0, 1 - Math.abs(t - 1) / 0.14) : 0;
    const limb = want;
    const add = (b, w) => { if (w > 1e-4 && jIdx[b] != null) nw[b] = (nw[b] || 0) + w; };
    add(L.bones[0], limb * (1 - tw2) * (1 - toNext) * (1 - shareW));
    add(L.bones[1], limb * tw2 * (1 - toNext) * (1 - shareW));
    add(L.next, limb * toNext * (1 - shareW));
    if (L.share) add(L.share, limb * shareW);
    if (L.onlyFill) { // ön kolda yalnızca eksik doldurma: mevcut uzuv ağırlıkları da korunur
      for (const b of L.chain) if (cur[b]) nw[b] = (nw[b] || 0) + cur[b] * 0; // ön kol zincirinin yerine yeni dağılım geçer
    }
    // en büyük 4 etki, normalize
    const top = Object.entries(nw).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const s = top.reduce((a, [, w]) => a + w, 0) || 1;
    for (let c = 0; c < 4; c++) {
      const e = top[c];
      wr(JI, k, c, e ? jIdx[e[0]] : 0);
      wr(WI, k, c, e ? e[1] / s : 0);
    }
  }
}
for (const R of Object.values(report)) R.eksikOrt = +(R.eksikOrt / Math.max(1, R.duzeltilen)).toFixed(2);
console.log(JSON.stringify(report, null, 1));
if (WRITE) { fs.writeFileSync(OUT, out); console.log('yazıldı', OUT, (out.length / 1e6).toFixed(1), 'MB (orijinal değişmedi)'); }
