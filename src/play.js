import * as THREE from 'three';
import { Rig } from './soldier.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { CATALOG, isTarget, isPoint } from './objects.js';
import { clamp, esc } from './util.js';
import { icon, hydrateIcons } from './icons.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const STANCES = ['ayakta', 'diz', 'alcak', 'yuzustu'];
const CAM_ADI = { fps: '1. ŞAHIS', sinematik: 'SİNEMATİK', takip: 'OMUZ KAMERASI', drone: 'DRONE', hedef: 'HEDEF ARKASI', yan: 'YAN AÇI', yakin: 'YAKIN PLAN', arka: 'ARKADAN GENİŞ' };
const EYE_H = { ayakta: 1.6, diz: 1.1, alcak: 0.95, yuzustu: 0.5 };
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
    this.ray.camera = engine.camera; // etiket sprite'larına çarpan ışınlar için gerekli
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
    this.casings = [];
    this.mags = [];
    this.smokes = [];

    this.view = this.view || 'tps';
    this._objs = null;
    this.buildRig();
    this.prepareCourse();
    this.buildBVH();
    this.engine.camera.near = this.view === 'fps' ? 0.05 : 0.1;
    this.engine.camera.updateProjectionMatrix();
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
    this.rpBar?.remove();
    this.rpBar = null;
    this.clearDebris();
    window.removeEventListener('resize', this._resize);
    this.closeOverlay();
    document.getElementById('app').classList.remove('playing');
    E.camera.near = 0.1;
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
    this.rig.onEvent = (n, r) => this.rigEvent(n, r);
    this.rig.setFirstPerson(this.view === 'fps');
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
    this.magCap = this.silah === 'tabanca' ? 15 : 30;
    this.mag = this.magCap;
    this.reserve = this.magCap * (this.silah === 'tabanca' ? 3 : 5);
    this.reloadU = -1;
    this.reloadEmpty = false;
    this.boltLocked = false;
    this.shake = 0;
    this.recData = { snaps: [], events: [], silah: this.silah };
    this.clearDebris?.();
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
    this.rpBar?.remove();
    this.rpBar = null;
    this._shots = null;
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
        if (k === 'v') this.toggleView();
        if (k === 'c') this.toggleStance('diz');
        if (k === 'z') this.toggleStance('yuzustu');
        if (k === 'x') this.toggleStance('alcak');
        if (k === 'r' && this.state === 'run') this.startReload();
        if (k === 'k' && this.state === 'run') this.rec ? this.stopRec(true) : this.startRec();
        if (this.state === 'replay') {
          if (k === ' ') { e.preventDefault(); this.rpToggle(); }
          if (k === 'arrowleft') this.seekReplay(Math.max(0, this.rp.t - 2));
          if (k === 'arrowright') this.seekReplay(Math.min(this.rp.end, this.rp.t + 2));
        }
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
    this._showResult = () => this.overlay(`
      <h2>PARKUR TAMAMLANDI</h2>
      <div class="pl-big">${fmtT(R.toplam)}<small>TOPLAM SÜRE</small></div>
      <table class="pl-tab">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      ${recNote}
      <div class="pl-btns">
        <button class="btn primary" data-a="izle"><i data-icon="play"></i>Tekrar İzle (Sinematik)</button>
        <button class="btn" data-a="tekrar">Yeniden Koş (Enter)</button>
        <button class="btn danger" data-a="cik">Çık</button>
      </div>`, (a) => { if (a === 'izle') this.startReplay(); else if (a === 'tekrar') this.restart(); else this.exit(); });
    this._showResult();
    if (this.rec) setTimeout(() => this.stopRec(true), 3500);
  }

  // ===================== kare güncelleme =====================
  tick(dt) {
    if (!this.active) return;
    if (this.state === 'replay') return this.replayTick(dt);
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
    const aimNow = this.aiming && running && !(this.stance === 'yuzustu' && f !== 0) && this.reloadU < 0;
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
    if (this.view === 'fps') this.yaw = this.camYaw; // 1. şahısta gövde ve silah bakışla tam hizalı
    const fwdComp = this.vel.dot(fwd);
    const mvs = fwdComp < -0.2 && Math.abs(this.vel.dot(rgt)) < 0.5 ? -speed : speed;
    this.rig.setMove(mvs);
    // şarjör değiştirme ilerlemesi
    if (this.reloadU >= 0 && running) {
      this.reloadU += dt / this.reloadDur;
      if (this.reloadU >= 1) {
        const take = Math.min(this.magCap - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloadU = -1;
        this.boltLocked = false;
      }
    }
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const st = this.rig.state;
    st.stance = this.stance;
    const crawling = this.stance === 'yuzustu' && this.vel.length() > 0.1;
    st.crawl = THREE.MathUtils.lerp(st.crawl || 0, crawling ? 1 : 0, 1 - Math.exp(-dt * 8));
    if (crawling) st.crawlPh = (st.crawlPh || 0) + dt * 5.5 * Math.sign(this.vel.dot(fwd) || 1);
    st.aim = (aimNow || now - this.lastShot < 0.7 || this.stance !== 'ayakta' || (this.view === 'fps' && speed < 2.6)) && this.reloadU < 0;
    st.move = this.stance === 'ayakta' ? Math.min(1, speed / 1.6) : 0;
    st.ready = this.view === 'fps' ? 1 : 0; // 1. şahısta tüfek görüş alanında (sıkıştırılmış hazır)
    st.reload = this.reloadU;
    st.reloadEmpty = this.reloadEmpty;
    st.boltLocked = this.boltLocked;
    st.pitch = st.aim ? this.camPitch : this.camPitch * 0.3;
    st.recoil = this.recoil;
    // köşe açma: Q sola, E sağa (ölçülü eğilme)
    const leanWant = running && this.stance !== 'yuzustu' && speed < 2.6 ? (k.e ? 1 : 0) - (k.q ? 1 : 0) : 0;
    this.leanT += (leanWant - this.leanT) * (1 - Math.exp(-dt * 9));
    st.lean = this.leanT;
    this.rig.group.position.copy(this.pos);
    this.rig.group.rotation.y = this.yaw;
    this.rig.update(dt);
    if (running && this.elapsed - (this._lastSnap ?? -1) >= 1 / 60) {
      this._lastSnap = this.elapsed;
      this.recData.snaps.push([this.elapsed, this.pos.x, this.pos.z, this.yaw, this.camYaw, this.camPitch, STANCES.indexOf(this.stance), this.aimT, st.aim ? 1 : 0, st.pitch, this.leanT, st.crawl || 0, st.crawlPh || 0, mvs, this.recoil, this.reloadU, this.reloadEmpty ? 1 : 0, this.boltLocked ? 1 : 0, st.move]);
    }

    // kamera
    this.aimT += ((aimNow ? 1 : 0) - this.aimT) * (1 - Math.exp(-dt * 12));
    const cam = this.view === 'fps' ? this.fpCam(dt) : this.collideCam(this.camFor(this.pos, this.camYaw, this.camPitch, this.aimT, this.stance, this.leanT));
    this.shake = Math.max(0, this.shake - dt * 7);
    if (this.shake > 0) { cam.p.x += (Math.random() - 0.5) * 0.022 * this.shake; cam.p.y += (Math.random() - 0.5) * 0.022 * this.shake; }
    if (this.state === 'intro' || this.view === 'fps') E.camera.position.copy(cam.p);
    else E.camera.position.lerp(cam.p, 1 - Math.exp(-dt * 20));
    E.camera.lookAt(cam.look);
    E.camera.rotateZ(cam.roll + (Math.random() - 0.5) * 0.014 * this.shake);
    E.controls.target.copy(cam.pivot);
    this.rig.setOptic(!(this.view === 'fps' && this.aimT > 0.55 && this.silah !== 'tabanca'));
    if (Math.abs(E.camera.fov - cam.fov) > 0.05) { E.camera.fov = cam.fov; E.camera.updateProjectionMatrix(); }

    // kurallar
    if (running) this.checkRules();
    this.visualFx(dt, now);
    this.updateDebris(dt);
    this.hitMark = Math.max(0, this.hitMark - dt * 3);
    // nişangahın gösterdiği yer askerin görüş hattında engelli mi? (her 3 karede bir)
    if (running) {
      this.traceShot();
      const sp = this.aimWorld.clone().project(this.engine.camera);
      const tx = sp.z < 1 ? sp.x : 0, ty = sp.z < 1 ? sp.y : 0;
      const kx = 1 - Math.exp(-dt * 30);
      this.xh = this.xh || { x: 0, y: 0 };
      this.xh.x += (tx - this.xh.x) * kx;
      this.xh.y += (ty - this.xh.y) * kx;
    }
    this.drawHud(now);
  }

  visualFx(dt, now) {
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

  // ===================== kamera =====================
  /** Omuz arkası kamera (canlı oyun ve tekrarın "omuz" açısı aynı hesabı kullanır) */
  camFor(pos, cy, cp, aimT, stance, lean) {
    const rgt = V(Math.cos(cy), 0, -Math.sin(cy));
    const eye = stance === 'ayakta' ? 1.62 : stance === 'diz' ? 1.12 : stance === 'alcak' ? 0.98 : 0.78;
    const sh = THREE.MathUtils.lerp(0.48, 0.3, aimT);
    const dist = stance === 'yuzustu' ? THREE.MathUtils.lerp(2.2, 1.0, aimT) : THREE.MathUtils.lerp(2.5, 0.95, aimT);
    const c = Math.cos(cp), sp = Math.sin(cp);
    const dirF = V(-Math.sin(cy) * c, sp, -Math.cos(cy) * c);
    const pivot = pos.clone().add(V(0, eye - Math.abs(lean) * 0.05, 0)).addScaledVector(rgt, sh + lean * 0.38);
    const p = pivot.clone().addScaledVector(dirF, -dist);
    p.y = Math.max(0.25, p.y);
    return { p, look: pivot.clone().addScaledVector(dirF, 20), pivot, fov: THREE.MathUtils.lerp(52, 30, aimT), roll: -lean * 0.09 };
  }

  /** 1. şahıs kamera: gözden bakış; nişan alınca tüfeğin nişangahının arkasına geçer */
  fpCam(dt) {
    return this.fpCamFrom(this.camYaw, this.camPitch, this.aimT, this.leanT, dt, this.yaw);
  }
  fpCamFrom(cy, cp, aimT, lean, dt, yaw) {
    const r = this.rig, head = r.B?.('Head');
    const f = V(-Math.sin(cy) * Math.cos(cp), Math.sin(cp), -Math.cos(cy) * Math.cos(cp));
    const fh = V(-Math.sin(yaw), 0, -Math.cos(yaw));
    const hp = head ? head.getWorldPosition(V()) : r.group.position.clone().add(V(0, 1.6, 0));
    const eye = hp.add(V(0, 0.095, 0)).addScaledVector(fh, 0.17); // yaka ve askıların önünde
    this._fpEye = this._fpEye && dt > 0 ? this._fpEye.lerp(eye, 1 - Math.exp(-dt * 18)) : eye.clone();
    const p = this._fpEye.clone(), dir = f.clone();
    const si = r.sightInfo?.();
    if (si && aimT > 0.001) { p.lerp(si.p, aimT); dir.lerp(si.f, aimT).normalize(); }
    return { p, look: p.clone().addScaledVector(dir, 20), pivot: p.clone(), fov: THREE.MathUtils.lerp(74, this.silah === 'tabanca' ? 56 : 44, aimT), roll: -lean * 0.12 };
  }

  /** 3. şahıs kamera duvar/paravan içine girmesin */
  collideCam(c) {
    const d = c.p.clone().sub(c.pivot), len = d.length();
    if (len < 0.01) return c;
    d.normalize();
    this.ray.set(c.pivot, d);
    this.ray.far = len + 0.2;
    for (const h of this.ray.intersectObject(this.ed.root, true)) {
      if (!visibleChain(h.object) || h.object.isSprite || h.object.isLine2 || h.object.type === 'Line2') continue;
      if (h.distance < len + 0.15) c.p = c.pivot.clone().addScaledVector(d, Math.max(0.2, h.distance - 0.2));
      break;
    }
    return c;
  }

  toggleView() {
    if (this.state === 'replay') return;
    this.view = this.view === 'fps' ? 'tps' : 'fps';
    this.rig.setFirstPerson(this.view === 'fps');
    this.engine.camera.near = this.view === 'fps' ? 0.05 : 0.1;
    this.engine.camera.updateProjectionMatrix();
    this._fpEye = null;
    this.say(this.view === 'fps' ? '1. ŞAHIS GÖRÜŞ' : '3. ŞAHIS GÖRÜŞ', '#ffffff', 0.9);
  }

  // ===================== şarjör =====================
  startReload() {
    if (this.state !== 'run' || this.paused || this.reloadU >= 0) return;
    if (this.stance === 'yuzustu' && this.vel.length() > 0.1) return;
    if (this.mag >= this.magCap) return;
    if (this.reserve <= 0) { this.say('YEDEK ŞARJÖR KALMADI', '#ffb020', 1.4); return; }
    this.reloadEmpty = this.mag === 0;
    this.reloadU = 0;
    this.reloadDur = this.silah === 'tabanca' ? (this.reloadEmpty ? 1.9 : 1.6) : (this.reloadEmpty ? 2.8 : 2.3);
    this.recData.events.push({ t: this.elapsed, k: 'reload' });
  }

  rigEvent(name, rig) {
    if (this.silent) return;
    if (name === 'magDrop') { this.spawnMagDrop(rig); return; }
    this.snd(name);
  }

  // ===================== kovan, şarjör, duman =====================
  ejectCasing(inherit = this.vel) {
    const info = this.rig.ejectInfo();
    if (!info) return;
    const pistol = this.silah === 'tabanca';
    if (!this._casingGeo) {
      this._casingGeo = new THREE.CylinderGeometry(0.0048, 0.0048, 0.045, 10);
      this._casingGeoP = new THREE.CylinderGeometry(0.0048, 0.0048, 0.019, 10);
      this._casingMat = new THREE.MeshStandardMaterial({ color: 0xc8a046, metalness: 0.92, roughness: 0.32 });
    }
    const m = new THREE.Mesh(pistol ? this._casingGeoP : this._casingGeo, this._casingMat);
    m.userData.noAO = true;
    m.castShadow = true;
    m.position.copy(info.p);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), info.r);
    const v = info.r.clone().multiplyScalar(1.7 + Math.random() * 0.9).add(V(0, 1.2 + Math.random() * 0.7, 0)).addScaledVector(info.f, -0.35 - Math.random() * 0.3);
    if (inherit) v.add(inherit);
    const w = V((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    this.fx.add(m);
    this.casings.push({ m, v, w, rest: false, bounced: false, h: pistol ? 0.0048 : 0.0048 });
    if (this.casings.length > 140) { const c = this.casings.shift(); this.fx.remove(c.m); }
  }

  spawnMagDrop(rig) {
    if (!rig.handMag) return;
    const m = new THREE.Mesh(rig.handMag.geometry, rig.handMag.material);
    rig.handMag.updateMatrixWorld(true);
    rig.handMag.matrixWorld.decompose(m.position, m.quaternion, m.scale);
    m.castShadow = true;
    m.userData.noAO = true;
    this.fx.add(m);
    const box = new THREE.Box3().setFromObject(m);
    this.mags.push({ m, v: V((Math.random() - 0.5) * 0.3, -0.4, (Math.random() - 0.5) * 0.3), w: V(Math.random() * 3, 0, Math.random() * 3), rest: false, half: Math.max(0.012, (box.max.y - box.min.y) * 0.12) });
    if (this.mags.length > 12) { const c = this.mags.shift(); this.fx.remove(c.m); }
  }

  muzzleSmoke() {
    const p = this.rig.muzzle();
    const f = V(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xd9d6cf, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData.noAO = true;
      s.position.copy(p).addScaledVector(f, 0.05 + i * 0.06);
      const v = f.clone().multiplyScalar(0.35 + Math.random() * 0.5).add(V((Math.random() - 0.5) * 0.25, 0.18 + Math.random() * 0.2, (Math.random() - 0.5) * 0.25));
      this.fx.add(s);
      this.smokes.push({ s, v, t: -i * 0.03, life: 1.6 + Math.random() * 0.8, a: 0.22 + Math.random() * 0.1 });
    }
    if (this.smokes.length > 90) { const o = this.smokes.shift(); this.fx.remove(o.s); o.s.material.dispose(); }
  }

  updateDebris(dt) {
    const G = 9.81, ground = 0.02;
    for (const c of this.casings) {
      if (c.rest) continue;
      c.v.y -= G * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
      if (c.m.position.y < ground + c.h) {
        c.m.position.y = ground + c.h;
        if (c.v.y < -0.45) {
          c.v.y = -c.v.y * 0.3; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5);
          if (!c.bounced) { c.bounced = true; this.snd('tink'); }
        } else {
          c.rest = true;
          const yaw = Math.random() * Math.PI * 2;
          c.m.rotation.set(Math.PI / 2, 0, yaw);
        }
      }
    }
    for (const g of this.mags) {
      if (g.rest) continue;
      g.v.y -= G * dt;
      g.m.position.addScaledVector(g.v, dt);
      g.m.rotateX(g.w.x * dt); g.m.rotateZ(g.w.z * dt);
      if (g.m.position.y < ground + g.half) {
        g.m.position.y = ground + g.half;
        g.rest = true;
        const e = new THREE.Euler().setFromQuaternion(g.m.quaternion, 'YXZ');
        g.m.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, e.y, 0, 'YXZ'));
        this.snd('magHit');
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const o = this.smokes[i];
      o.t += dt;
      if (o.t < 0) continue;
      const k = o.t / o.life;
      o.v.multiplyScalar(1 - dt * 1.4);
      o.v.y += dt * 0.08;
      o.s.position.addScaledVector(o.v, dt);
      o.s.scale.setScalar(0.06 + k * 0.75);
      o.s.material.opacity = o.a * Math.min(1, o.t / 0.05) * (1 - k);
      o.s.material.rotation += dt * 0.3;
      if (k >= 1) { this.fx.remove(o.s); o.s.material.dispose(); this.smokes.splice(i, 1); }
    }
  }

  clearDebris() {
    for (const c of this.casings || []) this.fx?.remove(c.m);
    for (const g of this.mags || []) this.fx?.remove(g.m);
    for (const o of this.smokes || []) { this.fx?.remove(o.s); o.s.material.dispose(); }
    this.casings = []; this.mags = []; this.smokes = [];
  }

  // ===================== mekanik sesler =====================
  burst(t, f, q, dur, amp) {
    const ac = this.ac;
    const n = ac.createBufferSource(); n.buffer = this.noise;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const g = ac.createGain(); this.envl(g, t, 0.002, amp, dur);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.05);
  }
  ring(t, freqs, dur, amp) {
    const ac = this.ac;
    for (const f of freqs) {
      const o = ac.createOscillator(); o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ac.createGain(); this.envl(g, t, 0.001, amp, dur);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  snd(name) {
    const ac = this.ac;
    if (!ac) return;
    const t = ac.currentTime + 0.005;
    switch (name) {
      case 'dry': this.burst(t, 3200, 6, 0.02, 0.35); this.ring(t, [2400], 0.03, 0.05); break;
      case 'magOut': this.burst(t, 2600, 5, 0.025, 0.4); this.burst(t + 0.05, 1400, 1.5, 0.09, 0.18); break;
      case 'pouch': this.burst(t, 700, 0.8, 0.16, 0.12); this.burst(t + 0.09, 1100, 1, 0.08, 0.08); break;
      case 'magIn': this.burst(t, 1600, 3, 0.04, 0.6); this.ring(t, [180], 0.05, 0.25); this.burst(t + 0.06, 3200, 7, 0.02, 0.35); break;
      case 'bolt': this.burst(t, 2800, 2.5, 0.05, 0.7); this.ring(t, [1750, 2630, 3900], 0.16, 0.05); break;
      case 'tink': this.ring(t, [5200, 7300, 9100], 0.07 + Math.random() * 0.05, 0.018); break;
      case 'magHit': this.burst(t, 900, 2, 0.05, 0.25); this.burst(t + 0.07, 1300, 2, 0.04, 0.12); break;
    }
  }

  /** Kırmızı nokta nişangah görüntüsü (Aimpoint tipi, 1x): gövde halkası, mercek, parlayan nokta */
  drawRedDot(g, W, H, k, a) {
    const cx = W / 2, cy = H / 2, R = H * 0.34;
    g.save();
    g.globalAlpha = a;
    // nişangah gövdesi: kalın koyu halka, iç kenarda metal parlaması
    g.lineWidth = R * 0.32;
    const ring = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.32);
    ring.addColorStop(0, 'rgba(18,20,22,1)');
    ring.addColorStop(0.15, 'rgba(48,52,56,1)');
    ring.addColorStop(0.3, 'rgba(14,15,17,1)');
    ring.addColorStop(1, 'rgba(8,9,10,1)');
    g.strokeStyle = ring;
    g.beginPath(); g.arc(cx, cy, R * 1.16, 0, Math.PI * 2); g.stroke();
    // alt montaj ve ayar düğmeleri
    g.fillStyle = 'rgba(12,13,15,1)';
    g.fillRect(cx - R * 0.42, cy + R * 1.18, R * 0.84, H);
    g.beginPath(); g.roundRect(cx + R * 1.12, cy - R * 0.22, R * 0.28, R * 0.44, R * 0.06); g.fill();
    g.beginPath(); g.roundRect(cx - R * 0.2, cy - R * 1.42, R * 0.4, R * 0.24, R * 0.06); g.fill();
    // mercek: hafif yeşil-mor yansıma ve kenar kararması
    const lens = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R);
    lens.addColorStop(0, 'rgba(160,200,255,0.06)');
    lens.addColorStop(0.7, 'rgba(90,120,110,0.03)');
    lens.addColorStop(1, 'rgba(0,0,0,0.28)');
    g.fillStyle = lens;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    // parlayan kırmızı nokta
    const r = Math.max(2.2, 2.6 * k) * (1 + this.recoil * 0.4);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, r * 5);
    glow.addColorStop(0, 'rgba(255,60,40,0.55)');
    glow.addColorStop(1, 'rgba(255,40,20,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, r * 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff3a26';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,220,210,0.9)';
    g.beginPath(); g.arc(cx, cy, r * 0.4, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ===================== mühimmat göstergesi =====================
  drawAmmo(g, W, H, k, font) {
    const pw = 250 * k, ph = 86 * k, x = W - pw - 16 * k, y = H - ph - 54 * k;
    g.fillStyle = 'rgba(8,10,12,0.62)';
    g.beginPath(); g.roundRect(x, y, pw, ph, 10 * k); g.fill();
    g.strokeStyle = 'rgba(214,166,70,0.45)'; g.lineWidth = 1 * k; g.stroke();
    const low = this.mag <= Math.ceil(this.magCap * 0.17);
    g.textBaseline = 'top';
    g.fillStyle = this.mag === 0 ? '#ff5a52' : low ? '#ffb020' : '#ffffff';
    g.font = font(700, 46);
    g.textAlign = 'right';
    g.fillText(String(this.mag), x + 92 * k, y + 10 * k);
    g.textAlign = 'left';
    g.fillStyle = '#9aa3ad';
    g.font = font(700, 20);
    g.fillText('/ ' + this.reserve, x + 98 * k, y + 30 * k);
    g.font = font(600, 12);
    g.fillText(this.silah === 'tabanca' ? 'TABANCA · 9×19' : 'M4 · 5.56×45', x + 162 * k, y + 14 * k);
    // fişek çubukları
    const n = this.magCap, bw = Math.max(2, (pw - 32 * k) / n - 2 * k);
    for (let i = 0; i < n; i++) {
      g.fillStyle = i < this.mag ? (low ? '#ffb020' : '#d6a646') : 'rgba(255,255,255,0.12)';
      g.fillRect(x + 16 * k + i * (bw + 2 * k), y + 64 * k, bw, 10 * k);
    }
    if (this.reloadU >= 0) {
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, y - 30 * k, pw, 24 * k);
      g.fillStyle = '#d6a646'; g.fillRect(x, y - 8 * k, pw * this.reloadU, 2 * k);
      g.fillStyle = '#fff'; g.font = font(700, 14); g.textAlign = 'center';
      g.fillText(this.reloadEmpty ? 'ŞARJÖR DEĞİŞTİRİLİYOR · SÜRGÜ' : 'ŞARJÖR DEĞİŞTİRİLİYOR', x + pw / 2, y - 26 * k);
      g.textAlign = 'left';
    } else if (this.mag === 0) {
      g.fillStyle = '#ff5a52'; g.font = font(700, 14); g.textAlign = 'center';
      g.fillText(this.reserve > 0 ? 'ŞARJÖR BOŞ — R' : 'MÜHİMMAT BİTTİ', x + pw / 2, y - 22 * k); g.textAlign = 'left';
    }
  }

  // ===================== TEKRAR İZLEME =====================
  startReplay() {
    const R = this.recData;
    if (!R.snaps.length) { this.toast('Kayıtlı koşu yok.', 'err'); return; }
    if (this.rec) this.stopRec(true);
    this._shots = null;
    this.closeOverlay();
    this.state = 'replay';
    document.exitPointerLock?.();
    this.rp = { t: 0, speed: 1, playing: true, cam: 'sinematik', end: R.snaps[R.snaps.length - 1][0], evIdx: 0, curCam: null, slow: 1, recording: false };
    this.seekReplay(0);
    this.buildReplayBar();
  }

  closeReplay() {
    if (this.rec) this.stopRec(true);
    this.rpBar?.remove();
    this.rpBar = null;
    this.state = 'finished';
    this.rig.setFirstPerson(this.view === 'fps');
    this.engine.camera.near = this.view === 'fps' ? 0.05 : 0.1;
    this.engine.camera.updateProjectionMatrix();
    // parkuru koşunun bittiği hale getir
    this.seekReplay(this.rp.end + 1);
    this._showResult();
  }

  rpToggle() {
    const rp = this.rp;
    if (rp.t >= rp.end - 1e-3) this.seekReplay(0);
    rp.playing = !rp.playing;
    this.syncBar();
  }

  /** Belirli zamana atla: hedefler/delikler/kovanlar o ana kadarki haliyle yeniden kurulur */
  seekReplay(t) {
    const rp = this.rp, evs = this.recData.events;
    this.silent = true;
    for (const tg of this.targets.values()) {
      tg.falling = false; tg.fall = 0;
      const b = this.ed.objs.get(tg.it.id)?.getObjectByName('body');
      if (b) b.rotation.x = 0;
    }
    this.holes.traverse((h) => h.geometry?.dispose());
    this.holes.clear();
    this.clearDebris();
    let i = 0;
    for (; i < evs.length && evs[i].t <= t; i++) this.applyEvent(evs[i], false);
    rp.evIdx = i;
    rp.t = Math.max(0, Math.min(t, rp.end));
    this.rig._ru = -1;
    this.silent = false;
    rp.curCam = null;
    this.syncBar(true);
  }

  applyEvent(e, live) {
    this._curEv = null;
    if (e.k !== 'shot') return;
    if (live) {
      this.lastShot = performance.now() / 1000;
      this.gunshot();
      this.ejectCasing(null);
      this.muzzleSmoke();
      if (this.rp.cam === 'takip') this.shake = 1;
    }
    for (const f of e.fx) {
      if (f[0] === 'hole') this.addHole(V().fromArray(f[1]), V().fromArray(f[2]), f[3], f[4]);
      else if (f[0] === 'puff' && live) this.puff(V().fromArray(f[1]));
      else if (f[0] === 'ping' && live) this.steelPing(f[1]);
      else if (f[0] === 'fall') {
        const tg = this.targets.get(f[1]);
        if (!tg) continue;
        tg.falling = true;
        if (!live) {
          tg.fall = 1;
          const b = this.ed.objs.get(tg.it.id)?.getObjectByName('body');
          if (b) b.rotation.x = -(tg.it.type.includes('popper') ? 1.45 : 1.2);
        }
      }
    }
    this._curEv = null;
  }

  snapAt(t) {
    const S = this.recData.snaps;
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid][0] <= t) lo = mid; else hi = mid - 1; }
    const a = S[lo], b = S[Math.min(S.length - 1, lo + 1)];
    const f = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
    const L = (i) => a[i] + (b[i] - a[i]) * f;
    return {
      x: L(1), z: L(2), yaw: angLerp(a[3], b[3], f), cy: angLerp(a[4], b[4], f), cp: L(5), st: STANCES[a[6]] || 'ayakta',
      aimT: L(7), aim: a[8] > 0.5, pitch: L(9), lean: L(10), cr: L(11), ph: L(12), mvs: L(13), rec: L(14),
      rl: a[15] >= 0 && b[15] >= 0 ? L(15) : a[15], re: a[16] > 0.5, bl: a[17] > 0.5, mv: L(18),
    };
  }

  replayTick(dt) {
    const rp = this.rp, evs = this.recData.events, now = performance.now() / 1000;
    let sp = rp.playing ? rp.speed : 0;
    // sinematik: atış anlarında otomatik yavaş çekim
    let slow = 1;
    if (rp.cam === 'sinematik') {
      let d = 9;
      for (const e of this.shotsIdx()) { const x = Math.abs(e.t - rp.t); if (x < d) d = x; }
      slow = d < 0.3 ? 0.3 : d < 0.65 ? 0.3 + (d - 0.3) / 0.35 * 0.7 : 1;
    }
    rp.slow = slow;
    sp *= slow;
    rp.t = Math.min(rp.end, rp.t + dt * sp);
    while (rp.evIdx < evs.length && evs[rp.evIdx].t <= rp.t) { this.applyEvent(evs[rp.evIdx], true); rp.evIdx++; }
    const s = this.snapAt(rp.t);
    const r = this.rig, st = r.state;
    Object.assign(st, { stance: s.st, aim: s.aim, pitch: s.pitch, lean: s.lean, crawl: s.cr, crawlPh: s.ph, recoil: s.rec, reload: s.rl, reloadEmpty: s.re, boltLocked: s.bl, move: s.mv });
    r.group.position.set(s.x, 0, s.z);
    r.group.rotation.y = s.yaw;
    r.setMove(s.mvs);
    r.update(Math.max(0.0001, dt * sp));
    this.replayCamera(s, dt);
    this.visualFx(dt * Math.max(sp, 0.0001), now);
    this.updateDebris(dt * sp);
    this.shake = Math.max(0, this.shake - dt * 7);
    if (rp.playing && rp.t >= rp.end) {
      rp.playing = false;
      if (rp.recording) { rp.recording = false; setTimeout(() => this.stopRec(true), 700); }
      this.syncBar();
    }
    if ((this._rpUi = (this._rpUi || 0) + 1) % 4 === 0) this.syncBar(true);
    this.drawHud(now);
  }

  shotsIdx() {
    return (this._shots ||= this.recData.events.filter((e) => e.k === 'shot'));
  }

  /** Sinematik yönetmen: açıları otomatik keser, atış anlarında yakın plan / hedef açısı */
  directorCam(t) {
    const shots = this.shotsIdx();
    let best = -1, bd = 0.6;
    shots.forEach((e, i) => { const d = Math.abs(e.t - t); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) return ['yakin', 'hedef', 'yan'][best % 3];
    if (t < 2.4) return 'drone';
    return ['takip', 'arka', 'yan', 'takip', 'drone'][Math.floor((t - 2.4) / 3.2) % 5];
  }

  directorTarget(t, sx, sz, yaw) {
    let best = null, bd = 1e9;
    for (const e of this.shotsIdx()) {
      if (!e.tid) continue;
      const d = Math.abs(e.t - t);
      if (d < bd) { bd = d; best = e.tid; }
    }
    let tg = best && bd < 1.5 ? this.targets.get(best) : null;
    if (!tg) {
      const f = V(-Math.sin(yaw), 0, -Math.cos(yaw));
      let md = 1e9;
      for (const x of this.targets.values()) {
        const dx = x.it.x - sx, dz = x.it.z - sz;
        if (dx * f.x + dz * f.z < 1) continue;
        const d = Math.hypot(dx, dz);
        if (d < md) { md = d; tg = x; }
      }
    }
    return tg;
  }

  replayCamera(s, dt) {
    const E = this.engine, rp = this.rp;
    const mode = rp.cam === 'sinematik' ? this.directorCam(rp.t) : rp.cam;
    const pos = V(s.x, 0, s.z);
    const fwd = V(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)), rgt = V(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const eh = EYE_H[s.st] || 1.6;
    let c;
    if (mode === 'fps') c = this.fpCamFrom(s.cy, s.cp, s.aimT, s.lean, 0, s.yaw);
    else if (mode === 'takip') c = this.camFor(pos, s.cy, s.cp, s.aimT, s.st, s.lean);
    else if (mode === 'arka') c = { p: pos.clone().addScaledVector(fwd, -3.6).addScaledVector(rgt, 0.7).add(V(0, eh + 0.6, 0)), look: pos.clone().addScaledVector(fwd, 8).add(V(0, eh * 0.6, 0)), fov: 50, roll: 0 };
    else if (mode === 'yan') c = { p: pos.clone().addScaledVector(rgt, 3.3).addScaledVector(fwd, 0.9).add(V(0, eh * 0.85, 0)), look: pos.clone().addScaledVector(fwd, 1.1).add(V(0, eh * 0.78, 0)), fov: 42, roll: 0 };
    else if (mode === 'yakin') {
      const head = this.rig.B?.('Head')?.getWorldPosition(V()) || pos.clone().add(V(0, eh, 0));
      c = { p: pos.clone().addScaledVector(fwd, 1.35).addScaledVector(rgt, 0.8).add(V(0, eh - 0.08, 0)), look: head.clone().addScaledVector(rgt, 0.06).add(V(0, -0.08, 0)), fov: 36, roll: 0.02 };
    } else if (mode === 'drone') {
      const a = s.yaw + rp.t * 0.22 + 0.8;
      c = { p: pos.clone().add(V(Math.sin(a) * 6.5, 3.6, Math.cos(a) * 6.5)), look: pos.clone().add(V(0, eh * 0.55, 0)), fov: 45, roll: 0 };
    } else {
      const tg = this.directorTarget(rp.t, s.x, s.z, s.yaw);
      if (tg) {
        const tp = V(tg.it.x, 0, tg.it.z);
        const d = tp.clone().sub(pos); const dist = d.length(); d.normalize();
        const side = V(-d.z, 0, d.x);
        const p = tp.clone().addScaledVector(d, 1.9).addScaledVector(side, 1.0).add(V(0, 1.75, 0));
        const look = pos.clone().add(V(0, eh * 0.85, 0));
        const fov = Math.max(9, Math.min(45, (2 * Math.atan(2.4 / Math.max(1, dist + 1.5)) * 180) / Math.PI));
        c = { p, look, fov, roll: 0 };
      } else c = this.camFor(pos, s.cy, s.cp, s.aimT, s.st, s.lean);
    }
    const cut = rp.curCam !== mode;
    rp.curCam = mode;
    if (cut) {
      this.rig.setFirstPerson(mode === 'fps');
      E.camera.near = mode === 'fps' ? 0.05 : 0.1;
      E.camera.updateProjectionMatrix();
    }
    if (this.shake > 0) c.p.x += (Math.random() - 0.5) * 0.02 * this.shake;
    if (cut || mode === 'takip' || mode === 'fps') { E.camera.position.copy(c.p); rp.look = c.look.clone(); }
    else { const k = 1 - Math.exp(-dt * 5); E.camera.position.lerp(c.p, k); rp.look.lerp(c.look, k); }
    E.camera.lookAt(rp.look);
    E.camera.rotateZ(c.roll || 0);
    if (Math.abs(E.camera.fov - c.fov) > 0.05) { E.camera.fov = cut ? c.fov : THREE.MathUtils.lerp(E.camera.fov, c.fov, 1 - Math.exp(-dt * 5)); E.camera.updateProjectionMatrix(); }
    rp.mode = mode;
    rp.ads = mode === 'fps' && s.aimT > 0.55 && this.silah !== 'tabanca' ? Math.min(1, (s.aimT - 0.55) / 0.3) : 0;
    this.rig.setOptic(!rp.ads);
  }

  buildReplayBar() {
    this.rpBar?.remove();
    const d = document.createElement('div');
    d.className = 'rp-bar';
    const cams = [['sinematik', 'Sinematik'], ['fps', '1. Şahıs'], ['takip', 'Omuz'], ['drone', 'Drone'], ['hedef', 'Hedef Arkası'], ['yan', 'Yan'], ['yakin', 'Yakın'], ['arka', 'Arkadan']];
    d.innerHTML = `
      <div class="rp-row">
        <button class="rp-play" data-rp="play" title="Oynat / duraklat (Boşluk)"></button>
        <span class="rp-time">00:00.00</span>
        <input type="range" class="rp-seek" min="0" max="1000" value="0">
        <span class="rp-end"></span>
      </div>
      <div class="rp-row">
        <div class="seg rp-cams">${cams.map(([k, n]) => `<button data-cam="${k}">${n}</button>`).join('')}</div>
        <div class="seg rp-sp">${[0.25, 0.5, 1, 2].map((v) => `<button data-sp="${v}">${String(v).replace('.', ',')}×</button>`).join('')}</div>
        <button class="btn rec" data-rp="video"><span class="dot"></span>Videoya Kaydet</button>
        <button class="btn" data-rp="close">Kapat</button>
      </div>`;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cam) { this.rp.cam = b.dataset.cam; this.rp.curCam = null; }
      if (b.dataset.sp) this.rp.speed = +b.dataset.sp;
      if (b.dataset.rp === 'play') this.rpToggle();
      if (b.dataset.rp === 'close') this.closeReplay();
      if (b.dataset.rp === 'video') {
        if (this.rec) return;
        this.seekReplay(0);
        this.rp.playing = true;
        this.rp.recording = true;
        this.recSuffix = 'tekrar';
        this.startRec();
      }
      this.syncBar();
    });
    const seek = d.querySelector('.rp-seek');
    seek.addEventListener('input', () => { this.seekReplay((seek.value / 1000) * this.rp.end); });
    document.getElementById('viewport').appendChild(d);
    this.rpBar = d;
    this.syncBar();
  }

  syncBar(timeOnly = false) {
    const d = this.rpBar, rp = this.rp;
    if (!d) return;
    d.querySelector('.rp-time').textContent = fmtT(rp.t);
    const sk = d.querySelector('.rp-seek');
    if (document.activeElement !== sk) sk.value = Math.round((rp.t / Math.max(0.001, rp.end)) * 1000);
    if (timeOnly) return;
    d.querySelector('.rp-end').textContent = fmtT(rp.end);
    d.querySelector('.rp-play').innerHTML = rp.playing ? '❚❚' : '▶';
    d.querySelectorAll('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === rp.cam));
    d.querySelectorAll('[data-sp]').forEach((b) => b.classList.toggle('on', +b.dataset.sp === rp.speed));
    d.querySelector('[data-rp="video"]').classList.toggle('on', !!this.rec);
  }

  drawReplayHud(g, W, H, k, font) {
    const rp = this.rp, now = performance.now() / 1000;
    if (rp.cam === 'sinematik') {
      const bh = H * 0.075;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, bh);
      g.fillRect(0, H - bh, W, bh);
    }
    if (rp.ads > 0) this.drawRedDot(g, W, H, k, rp.ads);
    const top = rp.cam === 'sinematik' ? H * 0.075 + 12 * k : 16 * k;
    const b = this.ed.state.bilgi;
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(8,10,12,0.6)';
    g.beginPath(); g.roundRect(16 * k, top, 330 * k, 86 * k, 10 * k); g.fill();
    g.fillStyle = '#d6a646'; g.font = font(700, 13);
    g.fillText('TEKRAR İZLEME · ' + (CAM_ADI[rp.mode] || ''), 30 * k, top + 12 * k);
    g.fillStyle = '#fff'; g.font = font(700, 40);
    g.fillText(fmtT(rp.t), 30 * k, top + 30 * k);
    if (rp.slow < 0.9 && rp.playing) {
      g.fillStyle = Math.floor(now * 3) % 2 ? '#ffd166' : '#ffb020'; g.font = font(700, 16);
      g.fillText('YAVAŞ ÇEKİM', 210 * k, top + 44 * k);
    }
    let shots = 0, hits = 0;
    for (const e of this.shotsIdx()) { if (e.t > rp.t) break; shots++; if (e.hit) hits++; }
    g.textAlign = 'right';
    g.fillStyle = 'rgba(8,10,12,0.6)';
    g.beginPath(); g.roundRect(W - 236 * k, top, 220 * k, 56 * k, 10 * k); g.fill();
    g.fillStyle = '#fff'; g.font = font(700, 26);
    g.fillText(`${shots} ATIM · ${hits} İSABET`, W - 30 * k, top + 15 * k);
    g.font = font(700, 15);
    g.fillStyle = 'rgba(243,239,228,0.75)';
    g.fillText(`${b.no ? 'PARKUR ' + b.no + ' · ' : ''}${(b.ad || '').toLocaleUpperCase('tr-TR')}`.slice(0, 44), W - 24 * k, H - (rp.cam === 'sinematik' ? H * 0.075 + 30 * k : 52 * k));
    g.fillStyle = 'rgba(243,239,228,0.5)';
    g.fillText(['POLİGON PRO', this.S.birlik].filter(Boolean).join('  ·  ').toLocaleUpperCase('tr-TR'), W - 24 * k, H - (rp.cam === 'sinematik' ? H * 0.075 + 12 * k : 30 * k));
    g.textAlign = 'left';
  }

  // ===================== atış =====================
  fire() {
    if (this.state !== 'run' || this.paused) return;
    if (this.stance === 'yuzustu' && this.vel.length() > 0.1) return; // sürünürken ateş yok
    if (this.reloadU >= 0) return;
    const now = performance.now() / 1000;
    if (this.mag <= 0) {
      if (now - (this._dry || 0) > 0.25) { this._dry = now; this.snd('dry'); this.say('ŞARJÖR BOŞ — R', '#ffb020', 1.3); }
      return;
    }
    if (now - this.lastShot < (this.silah === 'tabanca' ? 0.18 : 0.32)) return;
    this.lastShot = now;
    this.shots++;
    this.mag--;
    if (this.mag === 0 && this.silah !== 'tabanca') this.boltLocked = true;
    this.shake = 1;
    this.recoil = 1;
    this.camPitch = Math.min(0.6, this.camPitch + (this.silah === 'tabanca' ? 0.022 : 0.016));
    this.camYaw += (Math.random() - 0.5) * 0.006;
    this.gunshot();
    this.ejectCasing();
    this.muzzleSmoke();
    // emniyet açısı
    const E = this.engine;
    const dir = new THREE.Vector3();
    E.camera.getWorldDirection(dir);
    const ang = Math.abs(Math.atan2(dir.x, -dir.z)) * 180 / Math.PI;
    if (ang > 90) { this.safetyViol++; this.say('EMNİYET AÇISI İHLALİ  +10 sn', '#ff5252', 2.5); }
    // isabet
    this._curEv = { t: this.elapsed, k: 'shot', fx: [] };
    this.recData.events.push(this._curEv);
    const hit = this.traceShot();
    if (!hit) { this.misses++; return; }
    let o = hit.object, id = null;
    while (o) { if (o.userData?.itemId) { id = o.userData.itemId; break; } o = o.parent; }
    const t = id ? this.targets.get(id) : null;
    if (t) { this._curEv.tid = id; this._curEv.hit = t.rol !== 'dost'; }
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
          if (t.it.type.includes('popper') || t.it.type === 'plaka' || t.it.type === 'kare_plaka') { t.falling = true; this._curEv?.fx.push(['fall', id]); }
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
    return (this._objs ||= [this.ed.root, this.env.floor, ...this.env.group.children.filter((o) => o.name === 'berms')].filter(Boolean));
  }
  buildBVH() {
    const t0 = performance.now();
    for (const o of [this.env.floor, ...this.env.group.children.filter((c) => c.name === 'berms' || c.name === 'terrain')]) {
      if (o?.geometry && !o.geometry.boundsTree) o.geometry.computeBoundsTree();
    }
    this.ed.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.geometry && !o.geometry.boundsTree && o.geometry.attributes.position?.count > 300) o.geometry.computeBoundsTree(); });
    console.info('BVH', Math.round(performance.now() - t0), 'ms');
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
    this.aimWorld = h ? h.point.clone() : aimP;
    return h || ch;
  }
  shotOrigin() {
    if (this.view === 'fps' && this.state !== 'replay') return this.engine.camera.position.clone();
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
    this._curEv?.fx.push(['hole', p.toArray(), n.toArray(), color, r]);
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 10), new THREE.MeshBasicMaterial({ color, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    m.position.copy(p).addScaledVector(n, 0.004);
    m.lookAt(p.clone().add(n));
    this.holes.add(m);
  }

  puff(p) {
    this._curEv?.fx.push(['puff', p.toArray()]);
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
    if (this.state === 'replay') {
      this.drawReplayHud(g, W, H, k, font);
      if (this.rec) {
        const t = (performance.now() - this.recStart) / 1000;
        g.fillStyle = Math.floor(now * 2) % 2 ? '#ff3b3b' : '#a01010';
        g.beginPath(); g.arc(W / 2 - 52 * k, H * 0.075 + 30 * k, 8 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.font = font(700, 18); g.textBaseline = 'top';
        g.fillText('KAYIT ' + fmtT(t).slice(0, 5), W / 2 - 38 * k, H * 0.075 + 20 * k);
      }
      return;
    }
    if (this.state === 'run' || this.state === 'finished') this.drawAmmo(g, W, H, k, font);
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
    const adsFps = this.view === 'fps' && this.aimT > 0.55 && this.silah !== 'tabanca';
    if (adsFps && this.state === 'run') this.drawRedDot(g, W, H, k, Math.min(1, (this.aimT - 0.55) / 0.3));
    if (this.state === 'run' && !adsFps) {
      const xh = this.xh || { x: 0, y: 0 };
      const cx = (xh.x * 0.5 + 0.5) * W, cy = (-xh.y * 0.5 + 0.5) * H;
      const off = Math.hypot(cx - W / 2, cy - H / 2) > 6 * k;
      // ekran merkezi ile gerçek isabet noktası ayrıysa merkezde soluk bir halka (nişan yönü)
      if (off) { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5 * k; g.beginPath(); g.arc(W / 2, H / 2, 4 * k, 0, Math.PI * 2); g.stroke(); }
      const gap = (this.aimT > 0.5 ? 4 : 9 + this.recoil * 10) * k, len = 9 * k;
      g.strokeStyle = this.blocked ? 'rgba(255,190,90,0.95)' : 'rgba(255,255,255,0.9)';
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
    if (this.state === 'run' && !this.rec) g.fillText('W A S D: hareket · Shift: koş · Fare: bak · Sağ tık: nişan · Sol tık: ateş · V: 1./3. şahıs · Q/E: köşe aç · C: diz · X: alçak çöküş · Z: yüzüstü (W/S ile sürün) · R: şarjör · K: kayıt · Enter: bitir · Esc: duraklat', 18 * k, H - 28 * k);
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
        <div><kbd>X</kbd> Alçak çöküş</div><div><kbd>Z</kbd> Yüzüstü (W/S sürünme)</div><div><kbd>R</kbd> Şarjör değiştir</div><div><kbd>K</kbd> Video kaydı aç/kapa</div>
        <div><kbd>V</kbd> 1. / 3. şahıs görüş</div><div><kbd>Q</kbd> Sola köşe aç</div><div><kbd>E</kbd> Sağa köşe aç</div>
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
      const name = `${(this.ed.state.bilgi.ad || 'parkur').replace(/[\\/:*?"<>|]+/g, '_')} - ${this.recSuffix || 'uygulama'}.${ext}`;
      this.recSuffix = null;
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
    this._curEv?.fx.push(['ping', dist]);
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
