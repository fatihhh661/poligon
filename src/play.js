import * as THREE from 'three';
import { Rig } from './soldier.js';
import { CATALOG, isTarget, isPoint } from './objects.js';
import { clamp, esc } from './util.js';
import { icon, hydrateIcons } from './icons.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const fmtT = (s) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
};

/**
 * Uygulama modu: askeri üçüncü şahıs kamerasıyla yönetip parkuru koşma, atış ve video kaydı.
 */
export class PlayMode {
  constructor({ engine, editor, env, settings, toast, onExit }) {
    this.engine = engine;
    this.ed = editor;
    this.env = env;
    this.S = settings;
    this.toast = toast;
    this.onExit = onExit;
    this.active = false;
    this.keys = {};
    this.ray = new THREE.Raycaster();
    this._tick = (dt) => this.tick(dt);
    this._after = () => this.afterRender();
    this.silah = 'tufek';
  }

  // ===================== giriş / çıkış =====================
  enter() {
    if (this.active) return;
    this.active = true;
    const E = this.engine, ed = this.ed;
    this.saved = { pos: E.camera.position.clone(), tgt: E.controls.target.clone(), fov: E.camera.fov, labels: ed.opts.labels };
    ed.select(null);
    ed.setMode('sec');
    ed.enabled = false;
    E.controls.enabled = false;
    E.stopAutoOrbit();
    E.tween = null;
    ed.gizmo.visible = false;
    ed.autoGroup.visible = false;
    ed.setLabelsVisible(false);
    for (const it of ed.state.items) if (['olcu', 'asker', 'yazi'].includes(it.type)) { const o = ed.objs.get(it.id); if (o) o.visible = false; }
    document.getElementById('app').classList.add('playing');
    E.resize();

    // HUD tuvali
    const vp = document.getElementById('viewport');
    this.hud = document.createElement('canvas');
    this.hud.id = 'hud';
    vp.appendChild(this.hud);
    this.hctx = this.hud.getContext('2d');
    this.resizeHud();
    this._resize = () => this.resizeHud();
    window.addEventListener('resize', this._resize);

    // ses
    this.initAudio();

    // sahne grupları
    this.fx = new THREE.Group();
    E.scene.add(this.fx);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 6, 2);
    this.fx.add(this.flashLight);
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.flashSprite.scale.setScalar(0.32);
    this.fx.add(this.flashSprite);
    this.puffs = [];

    this.buildRig();
    this.prepareCourse();
    this.bindInput();
    E.onFrame.push(this._tick);
    E.afterRender.push(this._after);
    this.state = 'intro';
    this.showIntro();
  }

  exit() {
    if (!this.active) return;
    if (this.rec) this.stopRec(false);
    this.active = false;
    const E = this.engine, ed = this.ed;
    document.exitPointerLock?.();
    this.unbindInput();
    E.onFrame.splice(E.onFrame.indexOf(this._tick), 1);
    E.afterRender.splice(E.afterRender.indexOf(this._after), 1);
    this.resetCourse();
    if (this.rig) E.scene.remove(this.rig.group);
    E.scene.remove(this.fx);
    this.hud.remove();
    window.removeEventListener('resize', this._resize);
    this.closeOverlay();
    document.getElementById('app').classList.remove('playing');
    E.camera.fov = this.saved.fov;
    E.camera.updateProjectionMatrix();
    E.camera.position.copy(this.saved.pos);
    E.controls.target.copy(this.saved.tgt);
    E.controls.enabled = true;
    E.controls.update();
    ed.gizmo.visible = true;
    ed.autoGroup.visible = true;
    ed.setLabelsVisible(this.saved.labels);
    for (const it of ed.state.items) if (['olcu', 'asker', 'yazi'].includes(it.type)) { const o = ed.objs.get(it.id); if (o) o.visible = true; }
    ed.enabled = true;
    E.resize();
    try { this.ac?.close(); } catch (e) { /* */ }
    this.onExit?.();
  }

  buildRig() {
    if (this.rig) this.engine.scene.remove(this.rig.group);
    this.rig = new Rig(this.silah);
    this.engine.scene.add(this.rig.group);
    this.rig.state.aim = false;
  }

  prepareCourse() {
    const ed = this.ed;
    const items = ed.state.items;
    const start = items.find((i) => i.type === 'baslangic') || items.find((i) => isPoint(i.type));
    this.pos = start ? V(start.x, 0, start.z) : V(0, 0, 2);
    this.yaw = start ? start.rot || 0 : 0;
    this.camYaw = this.yaw;
    this.camPitch = -0.05;
    this.vel = V();
    this.stance = 'ayakta';
    this.leanT = 0;
    this.aimT = 0;
    this.aiming = false;
    this.lastShot = -10;
    this.recoil = 0;
    this.shots = 0;
    this.hits = 0;
    this.misses = 0;
    this.dostHits = 0;
    this.faultViol = 0;
    this.safetyViol = 0;
    this.msgs = [];
    this.hitMark = 0;
    this.hitMarkBad = false;
    this.elapsed = 0;
    this.paused = false;
    // hedef durumları
    this.targets = new Map();
    for (const it of items) {
      const C = CATALOG[it.type];
      if (!C) continue;
      if (C.rol === 'hedef' || C.rol === 'celik' || C.rol === 'dost') {
        const need = C.rol === 'dost' ? 0 : +(it.p?.atim ?? C.params.find((p) => p.k === 'atim')?.def ?? 1);
        this.targets.set(it.id, { it, need, hits: 0, rol: C.rol, label: ed.labels.get(it.id), fall: 0, falling: false });
      }
    }
    // çarpışma kutuları
    this.colliders = [];
    this.faults = [];
    const skip = new Set(['kutu', 'baslangic', 'hata', 'ok', 'yazi', 'asker']);
    for (const it of items) {
      if (it.type === 'olcu') continue;
      const o = ed.objs.get(it.id);
      if (!o) continue;
      if (it.type === 'hata') this.faults.push({ it, inside: false });
      if (skip.has(it.type)) continue;
      if (it.type === 'kapi') {
        // kapıdan geçilebilsin: yalnızca iki kasa dikmesi engel
        const w = it.p?.w ?? 0.9;
        for (const sx of [-1, 1]) this.colliders.push({ x: it.x, z: it.z, rot: it.rot || 0, cx: sx * (w / 2 + 0.04), cz: 0, hx: 0.05, hz: 0.05 });
        // açık kapı kanadı: menteşeden kanat açısıyla uzanan ince engel
        const a = ((it.p?.aci ?? 70) * Math.PI) / 180, r = it.rot || 0;
        const lx = -w / 2 + Math.cos(a) * (w / 2), lz = -Math.sin(a) * (w / 2);
        this.colliders.push({ x: it.x + lx * Math.cos(r) + lz * Math.sin(r), z: it.z - lx * Math.sin(r) + lz * Math.cos(r), rot: r + a, cx: 0, cz: 0, hx: w / 2, hz: 0.03 });
        continue;
      }
      const body = o.getObjectByName('body');
      const r0 = o.rotation.y;
      o.rotation.y = 0;
      o.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(body);
      o.rotation.y = r0;
      o.updateMatrixWorld(true);
      if (b.isEmpty() || b.max.y < 0.25) continue;
      this.colliders.push({ x: it.x, z: it.z, rot: it.rot || 0, cx: (b.min.x + b.max.x) / 2 - it.x, cz: (b.min.z + b.max.z) / 2 - it.z, hx: (b.max.x - b.min.x) / 2, hz: (b.max.z - b.min.z) / 2 });
    }
    this.holes = new THREE.Group();
    this.fx.add(this.holes);
  }

  resetCourse() {
    for (const t of this.targets?.values() || []) {
      const o = this.ed.objs.get(t.it.id);
      const body = o?.getObjectByName('body');
      if (body) body.rotation.x = 0;
    }
    if (this.holes) { this.holes.traverse((h) => h.geometry?.dispose()); this.holes.clear(); }
  }

  restart() {
    this.resetCourse();
    this.fx.remove(this.holes);
    this.buildRig();
    this.prepareCourse();
    this.closeOverlay();
    this.state = 'intro';
    this.showIntro();
  }

  // ===================== giriş (input) =====================
  bindInput() {
    const c = this.engine.renderer.domElement;
    this.h = {
      kd: (e) => {
        if (!this.active) return;
        if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
        const k = e.key.toLowerCase();
        this.keys[k] = true;
        if (['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
        if (this.state === 'intro' && k === 'enter') { this.start(false); return; }
        if (this.state === 'finished' && k === 'enter') { this.restart(); return; }
        if (k === 'c') this.toggleStance('diz');
        if (k === 'z') this.toggleStance('yuzustu');
        if (k === 'x') this.toggleStance('alcak');
        if (k === 'r' && this.state === 'run') this.rec ? this.stopRec(true) : this.startRec();
        if (k === 'enter' && this.state === 'run') this.finish(false);
        e.stopPropagation();
      },
      ku: (e) => { this.keys[e.key.toLowerCase()] = false; },
      mm: (e) => {
        if (document.pointerLockElement !== c) return;
        const s = this.aimT > 0.5 ? 0.0011 : 0.0022;
        this.camYaw -= e.movementX * s;
        this.camPitch = clamp(this.camPitch - e.movementY * s, -0.75, 0.6);
      },
      md: (e) => {
        if (!this.active) return;
        if (this.state === 'run' && document.pointerLockElement !== c) { c.requestPointerLock?.(); return; }
        if (e.button === 0) this.fire();
        if (e.button === 2) this.aiming = true;
      },
      mu: (e) => { if (e.button === 2) this.aiming = false; },
      cm: (e) => e.preventDefault(),
      pl: () => {
        if (!this.active) return;
        if (document.pointerLockElement !== c && this.state === 'run') this.pause();
      },
    };
    window.addEventListener('keydown', this.h.kd, true);
    window.addEventListener('keyup', this.h.ku, true);
    document.addEventListener('mousemove', this.h.mm);
    c.addEventListener('mousedown', this.h.md);
    window.addEventListener('mouseup', this.h.mu);
    c.addEventListener('contextmenu', this.h.cm);
    document.addEventListener('pointerlockchange', this.h.pl);
  }

  unbindInput() {
    const c = this.engine.renderer.domElement;
    window.removeEventListener('keydown', this.h.kd, true);
    window.removeEventListener('keyup', this.h.ku, true);
    document.removeEventListener('mousemove', this.h.mm);
    c.removeEventListener('mousedown', this.h.md);
    window.removeEventListener('mouseup', this.h.mu);
    c.removeEventListener('contextmenu', this.h.cm);
    document.removeEventListener('pointerlockchange', this.h.pl);
    this.keys = {};
  }

  toggleStance(s) {
    this.stance = this.stance === s ? 'ayakta' : s;
    this.rig.state.stance = this.stance;
  }

  // ===================== akış =====================
  start(withRec) {
    this.closeOverlay();
    this.engine.renderer.domElement.requestPointerLock?.();
    this.state = 'run';
    this.elapsed = 0;
    this.whistle();
    this.say('BAŞLA!', '#7dff8a', 1.5);
    if (withRec) this.startRec();
  }

  pause() {
    if (this.state !== 'run') return;
    this.paused = true;
    this.overlay(`
      <h2>DURAKLATILDI</h2>
      <p>Süre durduruldu. Devam etmek için tıklayın.</p>
      <div class="pl-btns">
        <button class="btn primary" data-a="devam">Devam Et</button>
        <button class="btn" data-a="bitir">Parkuru Bitir</button>
        <button class="btn" data-a="tekrar">Yeniden Başla</button>
        <button class="btn danger" data-a="cik">Uygulamadan Çık</button>
      </div>`, (a) => {
      if (a === 'devam') { this.closeOverlay(); this.paused = false; this.engine.renderer.domElement.requestPointerLock?.(); }
      else if (a === 'bitir') { this.paused = false; this.finish(false); }
      else if (a === 'tekrar') this.restart();
      else if (a === 'cik') this.exit();
    });
  }

  finish(auto) {
    if (this.state !== 'run') return;
    this.state = 'finished';
    this.finishedAt = performance.now();
    document.exitPointerLock?.();
    this.keys = {};
    const pen = this.dostHits * 10 + this.faultViol * 5 + this.safetyViol * 10;
    let eksik = 0;
    for (const t of this.targets.values()) if (t.rol !== 'dost') eksik += Math.max(0, t.need - t.hits);
    const pen2 = pen + eksik * 5;
    this.result = { sure: this.elapsed, pen: pen2, toplam: this.elapsed + pen2, eksik, auto };
    this.whistle(true);
    const R = this.result;
    const rows = [
      ['Parkur süresi', fmtT(R.sure)],
      ['Atım / İsabet / Iska', `${this.shots} / ${this.hits} / ${this.misses}`],
      ['Eksik isabet (×5 sn)', eksik],
      ['Dost hedef isabeti (×10 sn)', this.dostHits],
      ['Hata çizgisi ihlali (×5 sn)', this.faultViol],
      ['Emniyet açısı ihlali (×10 sn)', this.safetyViol],
      ['Ceza süresi', '+' + R.pen.toFixed(0) + ' sn'],
    ];
    const recNote = this.rec ? '<p class="pl-rec">● Video kaydı birkaç saniye içinde tamamlanıp kaydedilecek.</p>' : '';
    this.overlay(`
      <h2>PARKUR TAMAMLANDI</h2>
      <div class="pl-big">${fmtT(R.toplam)}<small>TOPLAM SÜRE</small></div>
      <table class="pl-tab">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      ${recNote}
      <div class="pl-btns">
        <button class="btn primary" data-a="tekrar">Tekrar Dene (Enter)</button>
        <button class="btn danger" data-a="cik">Uygulamadan Çık</button>
      </div>`, (a) => { if (a === 'tekrar') this.restart(); else this.exit(); });
    if (this.rec) setTimeout(() => this.stopRec(true), 3500);
  }

  // ===================== kare güncelleme =====================
  tick(dt) {
    if (!this.active) return;
    const E = this.engine, k = this.keys, now = performance.now() / 1000;
    const running = this.state === 'run' && !this.paused;
    if (running) this.elapsed += dt;
    // hareket
    let f = 0, s = 0;
    if (running && this.stance === 'ayakta') {
      f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
      s = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
    } else if (running && this.stance === 'yuzustu') {
      // sürünme: yalnızca ileri/geri, yavaş
      f = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0);
    }
    const aimNow = this.aiming && running && !(this.stance === 'yuzustu' && f !== 0);
    const sp = this.stance === 'yuzustu' ? 0.55 : aimNow ? 1.1 : k.shift && f > 0 ? 4.8 : 1.75;
    const fwd = V(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const rgt = V(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const want = fwd.clone().multiplyScalar(f).addScaledVector(rgt, s);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(sp);
    this.vel.lerp(want, 1 - Math.exp(-dt * 10));
    const np = this.pos.clone().addScaledVector(this.vel, dt);
    this.collide(np);
    this.pos.copy(np);
    const speed = this.vel.length();
    // karakter yönü
    if (speed > 0.2 || aimNow || now - this.lastShot < 0.8 || running) this.yaw = angLerp(this.yaw, this.camYaw, 1 - Math.exp(-dt * 12));
    const fwdComp = this.vel.dot(fwd);
    this.rig.setMove(fwdComp < -0.2 && Math.abs(this.vel.dot(rgt)) < 0.5 ? -speed : speed);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const st = this.rig.state;
    st.stance = this.stance;
    const crawling = this.stance === 'yuzustu' && this.vel.length() > 0.1;
    st.crawl = THREE.MathUtils.lerp(st.crawl || 0, crawling ? 1 : 0, 1 - Math.exp(-dt * 8));
    if (crawling) st.crawlPh = (st.crawlPh || 0) + dt * 5.5 * Math.sign(this.vel.dot(fwd) || 1);
    st.aim = aimNow || now - this.lastShot < 0.7 || this.stance !== 'ayakta';
    st.pitch = st.aim ? this.camPitch : this.camPitch * 0.3;
    st.recoil = this.recoil;
    // köşe açma: Q sola, E sağa (ölçülü eğilme)
    const leanWant = running && this.stance !== 'yuzustu' && speed < 2.6 ? (k.e ? 1 : 0) - (k.q ? 1 : 0) : 0;
    this.leanT += (leanWant - this.leanT) * (1 - Math.exp(-dt * 9));
    st.lean = this.leanT;
    this.rig.group.position.copy(this.pos);
    this.rig.group.rotation.y = this.yaw;
    this.rig.update(dt);

    // kamera
    this.aimT += ((aimNow ? 1 : 0) - this.aimT) * (1 - Math.exp(-dt * 12));
    const eye = this.stance === 'ayakta' ? 1.62 : this.stance === 'diz' ? 1.12 : this.stance === 'alcak' ? 0.98 : 0.78;
    const sh = THREE.MathUtils.lerp(0.48, 0.3, this.aimT);
    const dist = this.stance === 'yuzustu' ? THREE.MathUtils.lerp(2.2, 1.0, this.aimT) : THREE.MathUtils.lerp(2.5, 0.95, this.aimT);
    const cp = Math.cos(this.camPitch), spp = Math.sin(this.camPitch);
    const dirF = V(-Math.sin(this.camYaw) * cp, spp, -Math.cos(this.camYaw) * cp);
    const pivot = this.pos.clone().add(V(0, eye - Math.abs(this.leanT) * 0.05, 0)).addScaledVector(rgt, sh + this.leanT * 0.38);
    const camPos = pivot.clone().addScaledVector(dirF, -dist);
    camPos.y = Math.max(0.25, camPos.y);
    if (this.state === 'intro') E.camera.position.copy(camPos);
    else E.camera.position.lerp(camPos, 1 - Math.exp(-dt * 20));
    E.camera.lookAt(pivot.clone().addScaledVector(dirF, 20));
    E.camera.rotateZ(-this.leanT * 0.09);
    E.controls.target.copy(pivot);
    const fov = THREE.MathUtils.lerp(52, 30, this.aimT);
    if (Math.abs(E.camera.fov - fov) > 0.05) { E.camera.fov = fov; E.camera.updateProjectionMatrix(); }

    // kurallar
    if (running) this.checkRules();
    // efektler
    const fl = Math.max(0, 1 - (now - this.lastShot) / 0.06);
    this.flashLight.intensity = fl * 12;
    this.flashSprite.material.opacity = fl;
    if (fl > 0) { const m = this.rig.muzzle(); this.flashSprite.position.copy(m); this.flashLight.position.copy(m); this.flashSprite.material.rotation = Math.random() * 6; }
    for (const t of this.targets.values()) {
      if (t.falling && t.fall < 1) {
        t.fall = Math.min(1, t.fall + dt * 4);
        const o = this.ed.objs.get(t.it.id)?.getObjectByName('body');
        if (o) o.rotation.x = -t.fall * t.fall * (t.it.type.includes('popper') ? 1.45 : 1.2);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.t += dt;
      p.s.scale.setScalar(0.15 + p.t * 1.2);
      p.s.material.opacity = Math.max(0, 0.6 - p.t * 1.2);
      p.s.position.y += dt * 0.3;
      if (p.t > 0.6) { this.fx.remove(p.s); p.s.material.dispose(); this.puffs.splice(i, 1); }
    }
    this.hitMark = Math.max(0, this.hitMark - dt * 3);
    // nişangahın gösterdiği yer askerin görüş hattında engelli mi? (her 3 karede bir)
    if (running && (this._blk = (this._blk || 0) + 1) % 3 === 0) {
      const h = this.traceShot();
      this.truePt = h && this.blocked ? h.point.clone().project(this.engine.camera) : null;
    } else if (!running) this.truePt = null;
    this.drawHud(now);
  }

  collide(p) {
    const R = 0.24;
    for (const c of this.colliders) {
      const co = Math.cos(c.rot), si = Math.sin(c.rot);
      const dx = p.x - c.x, dz = p.z - c.z;
      let lx = dx * co - dz * si - c.cx, lz = dx * si + dz * co - c.cz;
      const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
      let ex = lx - qx, ez = lz - qz;
      const d = Math.hypot(ex, ez);
      if (d >= R) continue;
      if (d > 1e-5) { lx = qx + (ex / d) * R; lz = qz + (ez / d) * R; }
      else {
        const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
        if (px < pz) lx = Math.sign(lx || 1) * (c.hx + R); else lz = Math.sign(lz || 1) * (c.hz + R);
      }
      lx += c.cx; lz += c.cz;
      p.x = c.x + lx * co + lz * si;
      p.z = c.z - lx * si + lz * co;
    }
    const { w, d } = this.ed.state.poligon;
    p.x = clamp(p.x, -w / 2 + 0.35, w / 2 - 0.35);
    p.z = clamp(p.z, -d + 1.2, 13);
  }

  checkRules() {
    for (const f of this.faults) {
      const it = f.it, co = Math.cos(it.rot || 0), si = Math.sin(it.rot || 0);
      const dx = this.pos.x - it.x, dz = this.pos.z - it.z;
      const lx = dx * co - dz * si, lz = dx * si + dz * co;
      const inside = Math.abs(lx) < (it.p?.w || 3) / 2 + 0.2 && lz < -0.08 && lz > -2.5;
      if (inside && !f.inside) { this.faultViol++; this.say('HATA ÇİZGİSİ İHLALİ  +5 sn', '#ff5252', 2.2); this.beep(); }
      f.inside = inside;
    }
  }

  // ===================== atış =====================
  fire() {
    if (this.state !== 'run' || this.paused) return;
    if (this.stance === 'yuzustu' && this.vel.length() > 0.1) return; // sürünürken ateş yok
    const now = performance.now() / 1000;
    if (now - this.lastShot < (this.silah === 'tabanca' ? 0.18 : 0.32)) return;
    this.lastShot = now;
    this.shots++;
    this.recoil = 1;
    this.camPitch = Math.min(0.6, this.camPitch + (this.silah === 'tabanca' ? 0.022 : 0.016));
    this.camYaw += (Math.random() - 0.5) * 0.006;
    this.gunshot();
    // emniyet açısı
    const E = this.engine;
    const dir = new THREE.Vector3();
    E.camera.getWorldDirection(dir);
    const ang = Math.abs(Math.atan2(dir.x, -dir.z)) * 180 / Math.PI;
    if (ang > 90) { this.safetyViol++; this.say('EMNİYET AÇISI İHLALİ  +10 sn', '#ff5252', 2.5); }
    // isabet
    const hit = this.traceShot();
    if (!hit) { this.misses++; return; }
    let o = hit.object, id = null;
    while (o) { if (o.userData?.itemId) { id = o.userData.itemId; break; } o = o.parent; }
    const t = id ? this.targets.get(id) : null;
    const nrm = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : V(0, 1, 0);
    if (t) {
      if (t.rol === 'dost') {
        this.dostHits++;
        this.hitMark = 1; this.hitMarkBad = true;
        this.say(`DOST HEDEF (${t.label}) VURULDU  +10 sn`, '#ff5252', 2.5);
        this.addHole(hit.point, nrm, 0x111111);
      } else {
        t.hits++;
        this.hits++;
        this.hitMark = 1; this.hitMarkBad = false;
        if (t.rol === 'celik') {
          this.steelPing(hit.distance);
          this.addHole(hit.point, nrm, 0x9a9a9a, 0.018);
          if (t.it.type.includes('popper') || t.it.type === 'plaka' || t.it.type === 'kare_plaka') t.falling = true;
        } else this.addHole(hit.point, nrm, 0x0d0d0d);
        if (t.hits === t.need) this.say(`${t.label} TAMAM`, '#ffd166', 1.2);
      }
      this.checkDone();
    } else {
      this.misses++;
      this.puff(hit.point);
    }
  }

  sceneObjs() {
    return (this._objs ||= [this.ed.root, this.env.floor, ...this.env.group.children.filter((o) => o.name === 'berms' || o.name === 'terrain')].filter(Boolean));
  }
  firstHit(origin, dir, far) {
    this.ray.set(origin, dir);
    this.ray.far = far;
    for (const h of this.ray.intersectObjects(this.sceneObjs(), true)) {
      if (!visibleChain(h.object) || h.object.isSprite || h.object.isLine2 || h.object.type === 'Line2') continue;
      return h;
    }
    return null;
  }
  /**
   * Gerçekçi atış: kamera nişangahın gösterdiği noktayı bulur, mermi ise askerin göz/namlu
   * hattından o noktaya gider. Arada paravan varsa mermi paravana çarpar.
   */
  traceShot() {
    const E = this.engine;
    this.ray.setFromCamera(new THREE.Vector2(0, 0), E.camera);
    const camO = this.ray.ray.origin.clone(), camD = this.ray.ray.direction.clone();
    const ch = this.firstHit(camO, camD, 400);
    const aimP = ch ? ch.point.clone() : camO.clone().addScaledVector(camD, 400);
    const eye = this.shotOrigin();
    const d = aimP.clone().sub(eye);
    const len = d.length();
    if (len < 0.05) return ch;
    d.normalize();
    const h = this.firstHit(eye, d, len + 0.05);
    this.blocked = !!(h && h.distance < len - 0.15);
    return h || ch;
  }
  shotOrigin() {
    const head = this.rig.B?.('Head');
    const p = head ? head.getWorldPosition(new THREE.Vector3()) : this.pos.clone().add(V(0, 1.6, 0));
    // nişangah hattı: başın biraz sağı (dipçik sağ omuzda)
    const rgt = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return p.addScaledVector(rgt, 0.04).add(V(0, -0.02, 0));
  }

  checkDone() {
    for (const t of this.targets.values()) if (t.rol !== 'dost' && t.hits < t.need) return;
    if (this.targets.size) setTimeout(() => this.finish(true), 900);
  }

  addHole(p, n, color, r = 0.0075) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), new THREE.MeshBasicMaterial({ color, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.copy(p).addScaledVector(n, 0.004);
    m.lookAt(p.clone().add(n));
    this.holes.add(m);
  }

  puff(p) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xb9a888, transparent: true, depthWrite: false, opacity: 0.6 }));
    s.position.copy(p).add(V(0, 0.08, 0));
    this.fx.add(s);
    this.puffs.push({ s, t: 0 });
  }

  // ===================== HUD =====================
  resizeHud() {
    const vp = document.getElementById('viewport');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.hud.width = Math.round(vp.clientWidth * dpr);
    this.hud.height = Math.round(vp.clientHeight * dpr);
    this.hdpr = dpr;
  }

  say(text, color = '#fff', dur = 1.5) {
    this.msgs.push({ text, color, until: performance.now() / 1000 + dur, dur });
    if (this.msgs.length > 3) this.msgs.shift();
  }

  drawHud(now) {
    const g = this.hctx, W = this.hud.width, H = this.hud.height, k = this.hdpr;
    g.clearRect(0, 0, W, H);
    const b = this.ed.state.bilgi;
    const font = (w, s) => `${w} ${s * k}px Rajdhani, "Segoe UI", sans-serif`;
    const panel = (x, y, w, h) => {
      g.fillStyle = 'rgba(8,10,12,0.62)';
      g.beginPath();
      g.roundRect(x, y, w, h, 10 * k);
      g.fill();
      g.strokeStyle = 'rgba(214,166,70,0.45)';
      g.lineWidth = 1 * k;
      g.stroke();
    };
    // sol üst: parkur ve süre
    panel(16 * k, 16 * k, 300 * k, 92 * k);
    g.fillStyle = '#d6a646';
    g.font = font(700, 14);
    g.textBaseline = 'top';
    g.fillText(`${b.no ? 'PARKUR ' + b.no + ' · ' : ''}${(b.ad || '').toLocaleUpperCase('tr-TR')}`.slice(0, 38), 30 * k, 28 * k);
    g.fillStyle = '#fff';
    g.font = font(700, 44);
    g.fillText(fmtT(this.elapsed), 30 * k, 46 * k);
    // sağ üst: sayaçlar
    const stats = [['ATIM', this.shots], ['İSABET', this.hits], ['ISKA', this.misses], ['CEZA', this.dostHits + this.faultViol + this.safetyViol]];
    const pw = 330 * k;
    panel(W - pw - 16 * k, 16 * k, pw, 70 * k);
    stats.forEach(([n, v], i) => {
      const x = W - pw - 16 * k + 18 * k + i * 78 * k;
      g.fillStyle = i === 3 && v ? '#ff6b6b' : '#fff';
      g.font = font(700, 30);
      g.fillText(String(v), x, 26 * k);
      g.fillStyle = '#9aa3ad';
      g.font = font(600, 12);
      g.fillText(n, x, 60 * k);
    });
    // kalan hedefler
    let kalan = 0, top = 0;
    for (const t of this.targets.values()) if (t.rol !== 'dost') { top += t.need; kalan += Math.max(0, t.need - t.hits); }
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = font(600, 15);
    g.textAlign = 'right';
    g.fillText(`Kalan isabet: ${kalan} / ${top}`, W - 22 * k, 94 * k);
    g.textAlign = 'left';
    // kayıt göstergesi
    if (this.rec) {
      const t = (performance.now() - this.recStart) / 1000;
      g.fillStyle = Math.floor(now * 2) % 2 ? '#ff3b3b' : '#a01010';
      g.beginPath();
      g.arc(W / 2 - 52 * k, 34 * k, 8 * k, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = font(700, 18);
      g.fillText('KAYIT ' + fmtT(t).slice(0, 5), W / 2 - 38 * k, 24 * k);
    }
    // nişangah
    if (this.state === 'run' && this.truePt) {
      // engel: merminin gerçekte çarpacağı nokta (paravan) kırmızı işaretle gösterilir
      const bx = (this.truePt.x * 0.5 + 0.5) * W, by = (-this.truePt.y * 0.5 + 0.5) * H;
      g.strokeStyle = 'rgba(255,70,60,0.95)';
      g.lineWidth = 2.5 * k;
      g.beginPath(); g.arc(bx, by, 9 * k, 0, Math.PI * 2); g.moveTo(bx - 6 * k, by - 6 * k); g.lineTo(bx + 6 * k, by + 6 * k); g.stroke();
      g.fillStyle = 'rgba(255,90,80,0.95)'; g.font = font(700, 14); g.textAlign = 'center';
      g.fillText('GÖRÜŞ ENGELLİ', W / 2, H / 2 + 22 * k); g.textAlign = 'left';
    }
    if (this.state === 'run') {
      const cx = W / 2, cy = H / 2;
      const gap = (this.aimT > 0.5 ? 4 : 9 + this.recoil * 10) * k, len = 9 * k;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 2 * k;
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 3 * k;
      g.beginPath();
      g.moveTo(cx - gap - len, cy); g.lineTo(cx - gap, cy);
      g.moveTo(cx + gap, cy); g.lineTo(cx + gap + len, cy);
      g.moveTo(cx, cy - gap - len); g.lineTo(cx, cy - gap);
      g.moveTo(cx, cy + gap); g.lineTo(cx, cy + gap + len);
      g.stroke();
      g.fillStyle = '#fff';
      g.fillRect(cx - 1 * k, cy - 1 * k, 2 * k, 2 * k);
      if (this.hitMark > 0) {
        g.strokeStyle = this.hitMarkBad ? `rgba(255,70,70,${this.hitMark})` : `rgba(255,255,255,${this.hitMark})`;
        g.lineWidth = 2.5 * k;
        const a = 7 * k, c2 = 14 * k;
        g.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(cx + sx * a, cy + sy * a); g.lineTo(cx + sx * c2, cy + sy * c2); }
        g.stroke();
      }
      g.shadowBlur = 0;
    }
    // mesajlar
    this.msgs = this.msgs.filter((m) => m.until > now);
    this.msgs.forEach((m, i) => {
      const a = Math.min(1, (m.until - now) / 0.4);
      g.globalAlpha = a;
      g.font = font(700, 30);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = g.measureText(m.text).width;
      g.fillRect(W / 2 - tw / 2 - 18 * k, H * 0.2 + i * 52 * k - 6 * k, tw + 36 * k, 46 * k);
      g.fillStyle = m.color;
      g.fillText(m.text, W / 2, H * 0.2 + i * 52 * k);
      g.textAlign = 'left';
      g.globalAlpha = 1;
    });
    // sonuç kartı (videoda da görünsün)
    if (this.state === 'finished' && this.result) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, W, H);
    }
    // alt bilgi
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = font(600, 13);
    if (this.state === 'run' && !this.rec) g.fillText('W A S D: hareket · Shift: koş · Fare: bak · Sağ tık: nişan · Sol tık: ateş · Q/E: köşe aç · C: diz · X: alçak çöküş · Z: yüzüstü (W/S ile sürün) · R: kayıt · Enter: bitir · Esc: duraklat', 18 * k, H - 28 * k);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(243,239,228,0.55)';
    g.font = font(700, 15);
    g.fillText(['POLİGON PRO', this.S.birlik].filter(Boolean).join('  ·  ').toLocaleUpperCase('tr-TR'), W - 18 * k, H - 28 * k);
    g.textAlign = 'left';
  }

  // ===================== kaplama (overlay) =====================
  overlay(html, onAction) {
    this.closeOverlay();
    const d = document.createElement('div');
    d.className = 'pl-ov';
    d.innerHTML = `<div class="pl-card">${html}</div>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) onAction(b.dataset.a, b);
    });
    document.getElementById('viewport').appendChild(d);
    hydrateIcons(d);
    this.ov = d;
  }
  closeOverlay() { this.ov?.remove(); this.ov = null; }

  showIntro() {
    const b = this.ed.state.bilgi;
    let nT = 0, nA = 0;
    for (const t of this.targets.values()) if (t.rol !== 'dost') { nT++; nA += t.need; }
    const recOk = !!pickMime();
    this.overlay(`
      <div class="pl-head"><i data-icon="target"></i><div><small>UYGULAMA MODU</small><h2>${esc(b.ad || 'Parkur')}</h2></div></div>
      <p>${nT} hedef · en az ${nA} atım. Asker başlangıç noktasında. Düdükle süre başlar; tüm hedefler vurulunca parkur biter.</p>
      <div class="pl-grid">
        <div><kbd>W A S D</kbd> Hareket</div><div><kbd>Shift</kbd> Koşma</div>
        <div><kbd>Fare</kbd> Bakış</div><div><kbd>Sağ tık</kbd> Nişan al</div>
        <div><kbd>Sol tık</kbd> Ateş</div><div><kbd>C</kbd> Diz çök</div>
        <div><kbd>X</kbd> Alçak çöküş</div><div><kbd>Z</kbd> Yüzüstü (W/S sürünme)</div><div><kbd>R</kbd> Video kaydı aç/kapa</div>
        <div><kbd>Q</kbd> Sola köşe aç</div><div><kbd>E</kbd> Sağa köşe aç</div>
        <div><kbd>Enter</kbd> Parkuru bitir</div><div><kbd>Esc</kbd> Duraklat</div>
      </div>
      <div class="fld"><label>Silah</label><div class="seg" id="plSilah"><button data-a="tufek" class="${this.silah === 'tufek' ? 'on' : ''}">Tüfek</button><button data-a="tabanca" class="${this.silah === 'tabanca' ? 'on' : ''}">Tabanca</button></div></div>
      <div class="pl-btns">
        <button class="btn primary" data-a="basla"><i data-icon="play"></i>Başla (Enter)</button>
        ${recOk ? '<button class="btn rec" data-a="kayit"><span class="dot"></span>Kayıtla Başla</button>' : ''}
        <button class="btn danger" data-a="cik">Çık</button>
      </div>
      ${recOk ? '<small class="pl-note">Video; ekrandaki görüntü, süre, isabet bilgileri ve atış sesleriyle birlikte MP4 olarak kaydedilir.</small>' : ''}`, (a) => {
      if (a === 'basla') this.start(false);
      else if (a === 'kayit') this.start(true);
      else if (a === 'cik') this.exit();
      else if (a === 'tufek' || a === 'tabanca') {
        this.silah = a;
        this.buildRig();
        this.ov.querySelectorAll('#plSilah button').forEach((x) => x.classList.toggle('on', x.dataset.a === a));
      }
    });
  }

  // ===================== video kaydı =====================
  startRec() {
    const mime = pickMime();
    if (!mime) { this.toast('Bu sistemde video kaydı desteklenmiyor.', 'err'); return; }
    const gl = this.engine.renderer.domElement;
    const aspect = gl.width / gl.height;
    const RW = 1920, RH = Math.round(1920 / aspect / 2) * 2;
    this.recCanvas = document.createElement('canvas');
    this.recCanvas.width = RW;
    this.recCanvas.height = RH;
    this.rctx = this.recCanvas.getContext('2d');
    const stream = this.recCanvas.captureStream(30);
    if (this.recDest) for (const t of this.recDest.stream.getAudioTracks()) stream.addTrack(t);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000, audioBitsPerSecond: 192_000 });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.recMime = mime;
    this.recStart = performance.now();
    this.rec.start(1000);
    this.say('● KAYIT BAŞLADI', '#ff5252', 1.4);
  }

  stopRec(save) {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    rec.onstop = async () => {
      if (!save) return;
      const blob = new Blob(this.chunks, { type: this.recMime });
      const ext = this.recMime.includes('mp4') ? 'mp4' : 'webm';
      const name = `${(this.ed.state.bilgi.ad || 'parkur').replace(/[\\/:*?"<>|]+/g, '_')} - uygulama.${ext}`;
      try {
        if (window.native?.saveVideo) {
          const p = await window.native.saveVideo({ defName: name, data: new Uint8Array(await blob.arrayBuffer()), ext });
          if (p) this.toast(`Video kaydedildi: ${esc(p)}`, 'ok', 5000);
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          this.toast('Video indirildi.', 'ok', 4000);
        }
      } catch (e) {
        this.toast('Video kaydedilemedi: ' + esc(e.message || e), 'err', 5000);
      }
    };
    rec.stop();
    if (this.active) this.say('■ KAYIT DURDU', '#ffd166', 1.4);
  }

  afterRender() {
    if (!this.rec || !this.rctx) return;
    const c = this.rctx, R = this.recCanvas;
    c.drawImage(this.engine.renderer.domElement, 0, 0, R.width, R.height);
    c.drawImage(this.hud, 0, 0, R.width, R.height);
  }

  // ===================== ses =====================
  initAudio() {
    try {
      const ac = (this.ac = new (window.AudioContext || window.webkitAudioContext)());
      this.master = ac.createGain();
      this.master.gain.value = 0.8;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -10;
      this.master.connect(comp);
      comp.connect(ac.destination);
      this.recDest = ac.createMediaStreamDestination();
      comp.connect(this.recDest);
      // açık alan yankısı
      const len = ac.sampleRate * 1.6;
      const ir = ac.createBuffer(2, len, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < ac.sampleRate * 0.08 ? 0.2 : 1);
      }
      this.verb = ac.createConvolver();
      this.verb.buffer = ir;
      const vg = ac.createGain();
      vg.gain.value = 0.28;
      this.verb.connect(vg).connect(this.master);
      const nl = ac.sampleRate;
      this.noise = ac.createBuffer(1, nl, ac.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    } catch (e) { this.ac = null; }
  }

  envl(node, t, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  gunshot() {
    const ac = this.ac;
    if (!ac) return;
    ac.resume?.();
    const t = ac.currentTime;
    const pistol = this.silah === 'tabanca';
    const n = ac.createBufferSource();
    n.buffer = this.noise;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(pistol ? 7000 : 9000, t);
    lp.frequency.exponentialRampToValueAtTime(pistol ? 900 : 600, t + 0.25);
    const ng = ac.createGain();
    this.envl(ng, t, 0.002, pistol ? 1.0 : 1.4, pistol ? 0.28 : 0.42);
    n.connect(lp).connect(ng);
    ng.connect(this.master);
    ng.connect(this.verb);
    n.start(t);
    n.stop(t + 0.6);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(pistol ? 160 : 120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
    const og = ac.createGain();
    this.envl(og, t, 0.002, pistol ? 0.7 : 1.1, 0.25);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  steelPing(dist = 15) {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime + dist / 340;
    for (const [f, a] of [[1850, 0.22], [2730, 0.12], [4100, 0.05]]) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      const gg = ac.createGain();
      this.envl(gg, t, 0.002, a, 0.7);
      o.connect(gg);
      gg.connect(this.master);
      gg.connect(this.verb);
      o.start(t);
      o.stop(t + 0.8);
    }
  }

  whistle(dbl = false) {
    const ac = this.ac;
    if (!ac) return;
    ac.resume?.();
    const t0 = ac.currentTime + 0.05;
    for (let k = 0; k < (dbl ? 2 : 1); k++) {
      const t = t0 + k * 0.45;
      const o = ac.createOscillator();
      o.frequency.value = 2950;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 32;
      const lg = ac.createGain();
      lg.gain.value = 140;
      lfo.connect(lg).connect(o.frequency);
      const gg = ac.createGain();
      gg.gain.setValueAtTime(0.0001, t);
      gg.gain.exponentialRampToValueAtTime(0.18, t + 0.03);
      gg.gain.setValueAtTime(0.18, t + (dbl ? 0.3 : 0.65));
      gg.gain.exponentialRampToValueAtTime(0.0001, t + (dbl ? 0.36 : 0.75));
      o.connect(gg).connect(this.master);
      o.start(t);
      lfo.start(t);
      o.stop(t + 0.8);
      lfo.stop(t + 0.8);
    }
  }

  beep() {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = 520;
    const gg = ac.createGain();
    this.envl(gg, t, 0.005, 0.08, 0.25);
    o.connect(gg).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }
}

function visibleChain(o) {
  while (o) { if (!o.visible) return false; o = o.parent; }
  return true;
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

let _flash = null;
function flashTexture() {
  if (_flash) return _flash;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.25, 'rgba(255,190,80,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, r = i % 2 ? 26 : 64;
    g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  g.fill();
  _flash = new THREE.CanvasTexture(c);
  return _flash;
}

let _puff = null;
function puffTexture() {
  if (_puff) return _puff;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _puff = new THREE.CanvasTexture(c);
  return _puff;
}
