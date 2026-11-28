// Yeni nesil karakter animasyon çekirdeği (v2).
//
// Eski sistem (soldier.js, "v1") dört döngü klibini esnetip üstüne çok sayıda prosedürel katman
// ekliyordu; omurga kemikleri bir karede 8 ayrı sistem tarafından değiştiriliyor, gerçek hareket
// kaydı bu katmanların altında kayboluyordu. v2'de ana hareketi tamamen gerçek kayıtlar üretir:
//
//  - 8 yönlü harmanlama alanı (ileri, çaprazlar, yanlar, geri) × tempo (yürüyüş, koşu) ve ayrı
//    çömelik yürüyüş seti. Komşu iki yön ve iki tempo ağırlıklandırılır.
//  - Adım fazı senkronu: bütün hareket klipleri ortak normalize fazla oynatılır, her klibin sol ayak
//    basış anı (ph0) hizalanır; yön/tempo değişince bacaklar birbirine karışıp "çırpınmaz".
//  - Oynatma hızı gerçek hızdan: çevrim frekansı = hız / (harmanlanmış adım boyu). Ayak, kayıttaki
//    yere basma süresi boyunca yerde kalır; kaymayı gizlemek için IK esnetmesi gerekmez.
//  - Yerinde dönüş: gövde dönerken kayıtlı 90° dönüş adımları (kök dönüşü çıkarılmış) dönüş hızıyla
//    oynatılır.
//  - Durumlar arası geçiş: hedef ağırlıklar zamanla yumuşatılır ve toplam ağırlık 1'e normalize edilir
//    (iskelet hiçbir karede bağlama pozuna kaçmaz).
//
// Prosedürel katmanlar yalnızca oyunun gerektirdiği bilgiyi ekler (nişan eğimi, gövde burulması, köşe
// açma, geri tepme, tüfeği tutan eller) ve soldier.js'de kalır.
import * as THREE from 'three';

/** Mixamo yön anahtarları ve açıları (+ sol). Oyunun locoAng değeri de +90 = sol. */
export const DIRS = [['f', 0], ['fl', 45], ['l', 90], ['bl', 135], ['b', 180], ['br', -135], ['r', -90], ['fr', -45]];
const DIR_AT = ['f', 'fl', 'l', 'bl', 'b', 'br', 'r', 'fr']; // 0,45,...,315 sırasıyla

const smooth01 = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const wrapPi = (x) => Math.atan2(Math.sin(x), Math.cos(x));

/** Geliştirici seçimi: localStorage 'pp.animSys' = 'v1' eski sisteme döner (arayüz yok). */
export function animSystemWanted() {
  try { return localStorage.getItem('pp.animSys') === 'v1' ? 'v1' : 'v2'; } catch (e) { return 'v2'; }
}

export class LocomotionV2 {
  constructor(rig) {
    this.rig = rig;
    const A_ = rig.actions;
    this.ok = !!(A_.walk_f && A_.run_f && A_.cwalk_f && A_.Idle);
    if (!this.ok) return;
    this.meta = {};
    for (const [n, a] of Object.entries(A_)) {
      const c = a.getClip(), u = c.userData || {};
      this.meta[n] = { dur: c.duration, ph0: u.ph0 || 0, stride: u.stride || 0, speed: u.speed || 0 };
    }
    this.w = {};
    for (const n in A_) this.w[n] = n === 'Idle' ? 1 : 0;
    this.phase = 0;
    this.idleT = Math.random() * this.meta.Idle.dur;
    this.turnPh = 0;
    this.turnW = 0;
    this.aimW = 0;
    this.crouchW = 0;
    this.prevYaw = null;
    this.yawRate = 0;
    this.dbg = {};
  }

  /** Hedef ağırlıkları üret, yumuşat, normalize et ve klip zamanlarını ayarla. */
  update(dt) {
    const r = this.rig, s = r.state, A_ = r.actions, M = this.meta;
    const crouch = s.stance === 'diz';
    const legs = s.stance === 'ayakta' || crouch;
    const sp = legs ? s.locoSpeed || 0 : 0;
    const k = (rate) => (dt > 0 ? 1 - Math.exp(-dt * rate) : 1);
    // nişan ve çömelme ağırlıkları zamanla
    this.aimW += ((s.aim ? 1 : 0) - this.aimW) * k(8);
    this.crouchW += ((crouch ? 1 : 0) - this.crouchW) * k(7);
    // gövde dönüş hızı (yerinde dönüş için); grup yönü play.js'den gelir
    const gy = r.group.rotation.y;
    if (this.prevYaw != null && dt > 0) this.yawRate += (wrapPi(gy - this.prevYaw) / dt - this.yawRate) * k(14);
    this.prevYaw = gy;

    // 1) hareket ağırlığı (bekleme ↔ hareket)
    const mv = smooth01(sp / 0.45);
    // 2) yön harmanlaması: komşu iki yön
    let a = ((s.locoAng || 0) % 360 + 360) % 360;
    const i0 = Math.floor(a / 45) % 8, i1 = (i0 + 1) % 8, t = (a - i0 * 45) / 45;
    const dirW = { [DIR_AT[i0]]: 1 - t };
    dirW[DIR_AT[i1]] = (dirW[DIR_AT[i1]] || 0) + t;
    // 3) tempo: yürüyüş ↔ koşu (Mixamo yürüyüş 1,85, koşu 4,64 m/sn). Depar kayıtları 7 m/sn olduğu için
    //    oyunun 4,2 m/sn deparında ağır çekim görünür; koşu kaydı bu hıza uyar.
    const gRun = crouch ? 0 : smooth01((sp - 1.9) / (4.2 - 1.9));
    const sets = crouch ? [['cwalk_', 1]] : [['walk_', 1 - gRun], ['run_', gRun]];
    // harmanlanmış adım boyu → çevrim frekansı (ayak kaymasın)
    let stride = 0, sw = 0;
    const tgt = {};
    for (const [pre, gw] of sets) for (const [d, dw] of Object.entries(dirW)) {
      const n = pre + d, w = gw * dw;
      if (!A_[n] || w <= 0) continue;
      stride += w * M[n].stride; sw += w;
      tgt[n] = (tgt[n] || 0) + w * mv;
    }
    stride = sw > 0 ? stride / sw : 1.8;
    const cyc = sp / Math.max(0.3, stride); // çevrim/sn (bir çevrim = iki adım)
    // durma anında çok yavaşlayan adımları önlemek için alt sınır (yalnızca harekette)
    const cycEff = mv > 0.01 ? Math.max(cyc, 0.35 * mv) : 0;
    this.phase = (this.phase + cycEff * dt) % 1;

    // 4) bekleme ve yerinde dönüş
    const still = 1 - mv;
    const turning = legs ? smooth01((Math.abs(this.yawRate) - 0.5) / 1.2) * still : 0;
    this.turnW += (turning - this.turnW) * k(10);
    const idleBase = crouch ? (this.aimW > 0.5 ? 'cidle_aim' : 'cidle') : this.aimW > 0.5 ? 'idle_aim' : 'Idle';
    const idleAlt = crouch ? (this.aimW > 0.5 ? 'cidle' : 'cidle_aim') : this.aimW > 0.5 ? 'Idle' : 'idle_aim';
    const aimBlend = Math.abs(this.aimW - 0.5) * 2; // 0 ortada, 1 uçlarda
    const idleW = still * (1 - this.turnW);
    if (A_[idleBase]) tgt[idleBase] = (tgt[idleBase] || 0) + idleW * (0.5 + 0.5 * aimBlend);
    if (A_[idleAlt]) tgt[idleAlt] = (tgt[idleAlt] || 0) + idleW * (0.5 - 0.5 * aimBlend);
    if (this.turnW > 1e-3) {
      const tn = (crouch ? 'cturn_' : 'turn_') + (this.yawRate > 0 ? 'l' : 'r');
      if (A_[tn]) {
        tgt[tn] = (tgt[tn] || 0) + still * this.turnW;
        // 90° dönüş = bir klip; faz gövdenin gerçek dönüşüyle ilerler (ayaklar kayıttaki gibi basar)
        this.turnPh = (this.turnPh + (Math.abs(this.yawRate) * dt) / (Math.PI / 2)) % 1;
      }
    }

    // 5) yumuşatma + normalize (geçiş süresi ~0,2 sn; durum değişiminde poz sıçramaz)
    let sum = 0;
    for (const n in A_) {
      const want = tgt[n] || 0;
      this.w[n] += (want - this.w[n]) * k(want > this.w[n] ? 9 : 7);
      if (this.w[n] < 1e-4) this.w[n] = 0;
      sum += this.w[n];
    }
    if (sum < 1e-4) { this.w.Idle = 1; sum = 1; }
    this.idleT += dt;
    for (const [n, act] of Object.entries(A_)) {
      const w = this.w[n] / sum;
      act.setEffectiveWeight(w);
      if (w <= 0) continue;
      const m = M[n];
      if (n.startsWith('turn_') || n.startsWith('cturn_')) act.time = this.turnPh * m.dur;
      else if (m.speed > 0.05) act.time = ((this.phase + m.ph0) % 1) * m.dur;
      else act.time = this.idleT % m.dur;
    }
    r.mixer.update(0);
    this.dbg = { hiz: +sp.toFixed(2), yon: Math.round(s.locoAng || 0), faz: +this.phase.toFixed(2), cevrim: +cycEff.toFixed(2), donus: +this.turnW.toFixed(2), nisan: +this.aimW.toFixed(2) };
  }

  /** En ağır 6 klip (teşhis için) */
  top() {
    return Object.entries(this.w).filter(([, w]) => w > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, w]) => `${n}:${w.toFixed(2)}`);
  }
}

/**
 * Character Creator (Reallusion) yardımcı kemik sürücüsü.
 * Model ağırlıkları ana kemiklerin yanında burulma (UpperarmTwist, ForearmTwist, ThighTwist, CalfTwist,
 * NeckTwist) ve hacim koruma (ElbowShare, KneeShare, ToeBaseShare) kemiklerine dağıtılmış. Bu kemikler
 * Character Creator/Unreal'da kısıtlarla sürülür; bizde hiç sürülmüyordu: bileğin burulması bilekte
 * toplanıyor (büzülme), üst kol burulması omuzda kesiliyor, diz ve dirsek bükülünce hacim çöküyordu.
 * Her karede animasyondan sonra:
 *  - üst kol / uyluk: kendi burulmasının bir kısmı omuz/kalça tarafında geri alınır
 *  - ön kol / baldır: el / ayak burulmasının bir kısmı ön kolun / baldırın boyunca dağıtılır
 *  - dirsek / diz / ayak parmağı hacim kemikleri: eklem bükülmesinin yarısında durur
 */
export class CorrectiveBones {
  constructor(B) {
    this.B = B;
    this.items = [];
    const bind = (b) => b.quaternion.clone();
    const axisTo = (b, c) => c.position.clone().normalize(); // kemiğin yerel uzayında çocuğa yön
    const cc = (name) => B(name); // CC_Base_* adları kemik haritasında aynen durur
    for (const S of ['L', 'R']) {
      const side = S === 'L' ? 'Left' : 'Right';
      const arm = B(side + 'Arm'), fore = B(side + 'ForeArm'), hand = B(side + 'Hand'), mid = B(side + 'HandMiddle1');
      const up = B(side + 'UpLeg'), leg = B(side + 'Leg'), foot = B(side + 'Foot'), toe = B(side + 'ToeBase');
      const u1 = cc(`CC_Base_${S}_UpperarmTwist01`), u2 = cc(`CC_Base_${S}_UpperarmTwist02`);
      const f1 = cc(`CC_Base_${S}_ForearmTwist01`), f2 = cc(`CC_Base_${S}_ForearmTwist02`);
      const t1 = cc(`CC_Base_${S}_ThighTwist01`), t2 = cc(`CC_Base_${S}_ThighTwist02`);
      const c1 = cc(`CC_Base_${S}_CalfTwist01`), c2 = cc(`CC_Base_${S}_CalfTwist02`);
      const eS = cc(`CC_Base_${S}_ElbowShareBone`), kS = cc(`CC_Base_${S}_KneeShareBone`), tS = cc(`CC_Base_${S}_ToeBaseShareBone`);
      // kendi burulmasını omuz tarafında geri alan zincir: toplam -0,5 (kök) ve -0,2 (orta)
      if (arm && fore && u1 && u2) this.items.push({ type: 'selfTwist', src: arm, axis: axisTo(arm, fore), srcBind: bind(arm), b1: u1, b1Bind: bind(u1), b2: u2, b2Bind: bind(u2), b12: bind(u1).multiply(bind(u2)), k1: -0.5, k2: 0.3 });
      if (up && leg && t1 && t2) this.items.push({ type: 'selfTwist', src: up, axis: axisTo(up, leg), srcBind: bind(up), b1: t1, b1Bind: bind(t1), b2: t2, b2Bind: bind(t2), b12: bind(t1).multiply(bind(t2)), k1: -0.45, k2: 0.25 });
      // uç burulmasını boyunca dağıtan zincir: kök %25, orta %60
      if (fore && hand && mid && f1 && f2) this.items.push({ type: 'childTwist', src: hand, axis: axisTo(hand, mid), srcBind: bind(hand), parentAxis: axisTo(fore, hand), b1: f1, b1Bind: bind(f1), b2: f2, b2Bind: bind(f2), b12: bind(f1).multiply(bind(f2)), k1: 0.25, k2: 0.35 });
      if (leg && foot && toe && c1 && c2) this.items.push({ type: 'childTwist', src: foot, axis: axisTo(foot, toe), srcBind: bind(foot), parentAxis: axisTo(leg, foot), b1: c1, b1Bind: bind(c1), b2: c2, b2Bind: bind(c2), b12: bind(c1).multiply(bind(c2)), k1: 0.15, k2: 0.2 });
      // hacim kemikleri: eklem bükülmesinin yarısı
      if (fore && eS) this.items.push({ type: 'share', src: fore, srcBind: bind(fore), b: eS, bBind: bind(eS), k: 0.5 });
      if (leg && kS) this.items.push({ type: 'share', src: leg, srcBind: bind(leg), b: kS, bBind: bind(kS), k: 0.5 });
      if (toe && tS) this.items.push({ type: 'shareSibling', src: toe, srcBind: bind(toe), b: tS, bBind: bind(tS), k: 0.5 });
    }
    const neck = B('Neck'), head = B('Head'), n2 = cc('CC_Base_NeckTwist02');
    if (neck && head && n2) this.items.push({ type: 'childTwist1', src: head, axis: V3(0, 1, 0), srcBind: bind(head), b1: n2, b1Bind: bind(n2), k1: 0.5 });
    this.count = this.items.length;
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion(); this._v = new THREE.Vector3();
  }

  /** q'nun ax (birim) ekseni etrafındaki burulma açısı (işaretli, radyan) */
  static twistAngle(q, ax) {
    const d = q.x * ax.x + q.y * ax.y + q.z * ax.z;
    return wrapPi(2 * Math.atan2(d, q.w));
  }

  apply() {
    const q = this._q, inv = this._q2;
    const rel = (b, bindQ) => inv.copy(bindQ).invert().multiply(b.quaternion); // bağlama pozuna göre fark
    const rotIn = (bBind, axisParent, ang) => {
      // ebeveyn uzayındaki ekseni kemiğin bağlama uzayına çevirip o eksen etrafında döndür
      const ax = this._v.copy(axisParent).applyQuaternion(q.copy(bBind).invert()).normalize();
      return new THREE.Quaternion().setFromAxisAngle(ax, ang);
    };
    for (const it of this.items) {
      if (it.type === 'selfTwist') {
        const th = CorrectiveBones.twistAngle(rel(it.src, it.srcBind), it.axis);
        it.b1.quaternion.copy(it.b1Bind).multiply(rotIn(it.b1Bind, it.axis, it.k1 * th));
        it.b2.quaternion.copy(it.b2Bind).multiply(rotIn(it.b12, it.axis, it.k2 * th)); // eksen ebeveyn zinciri üzerinden
      } else if (it.type === 'childTwist') {
        const th = CorrectiveBones.twistAngle(rel(it.src, it.srcBind), it.axis);
        it.b1.quaternion.copy(it.b1Bind).multiply(rotIn(it.b1Bind, it.parentAxis, it.k1 * th));
        it.b2.quaternion.copy(it.b2Bind).multiply(rotIn(it.b12, it.parentAxis, it.k2 * th));
      } else if (it.type === 'childTwist1') {
        const th = CorrectiveBones.twistAngle(rel(it.src, it.srcBind), it.axis);
        it.b1.quaternion.copy(it.b1Bind).multiply(rotIn(it.b1Bind, it.axis, it.k1 * th));
      } else if (it.type === 'share') {
        // hacim kemiği eklem kemiğinin çocuğu: bükülmenin yarısını geri al → eklem açısının ortasında durur
        const r = rel(it.src, it.srcBind).clone();
        const half = new THREE.Quaternion().slerp(r.invert(), it.k);
        it.b.quaternion.copy(half).multiply(it.bBind);
      } else if (it.type === 'shareSibling') {
        // kardeş kemik (ayak parmağı): parmak tabanının dönüşünün yarısı kadar döner
        const d = q.copy(it.src.quaternion).multiply(inv.copy(it.srcBind).invert());
        const half = new THREE.Quaternion().slerp(d, it.k);
        it.b.quaternion.copy(half).multiply(it.bBind);
      }
    }
  }
}

function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
