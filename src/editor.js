import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { CATALOG, buildItem, defaultParams, isTarget, isPoint, mats } from './objects.js';
import { makeLabel, disposeObject } from './labels.js';
import { uid, fmtM, DEG, clamp } from './util.js';

export function emptyState() {
  return {
    surum: 1,
    bilgi: {
      ad: 'Yeni Parkur', no: '1', tarih: new Date().toLocaleDateString('tr-TR'), sorumlu: '', birlik: '',
      silah: 'Tabanca', baslangicPoz: '', silahDurum: '', sinyal: 'Sesli (düdük)', prosedur: '', notlar: '',
    },
    poligon: { w: 30, d: 45 },
    emniyet: { celikMin: 7 },
    items: [],
  };
}

export function normalizeState(o) {
  const e = emptyState();
  const s = { ...e, ...o, bilgi: { ...e.bilgi, ...(o.bilgi || {}) }, poligon: { ...e.poligon, ...(o.poligon || {}) }, emniyet: { ...e.emniyet, ...(o.emniyet || {}) } };
  s.items = (o.items || []).filter((it) => it && (CATALOG[it.type] || it.type === 'olcu')).map((it) => ({ ...it, id: it.id || uid() }));
  s.poligon.w = clamp(+s.poligon.w || 30, 10, 200);
  s.poligon.d = clamp(+s.poligon.d || 45, 10, 300);
  return s;
}

const COLORS = { olcu: '#ffc21a', oto: '#3fd0ff', canli: '#7dff8a' };

export class Editor {
  constructor(engine, env) {
    this.engine = engine;
    this.env = env;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.dom = engine.renderer.domElement;
    this.state = emptyState();
    this.objs = new Map();
    this.root = new THREE.Group();
    this.root.name = 'items';
    this.scene.add(this.root);
    this.gizmo = new THREE.Group();
    this.gizmo.name = 'gizmo';
    this.scene.add(this.gizmo);
    this.autoGroup = new THREE.Group();
    this.scene.add(this.autoGroup);
    this.ghost = null;
    this.engine.hiddenForCapture.push(this.gizmo);

    this.sel = null;
    this.mode = 'sec';
    this.placeType = null;
    this.measureA = null;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = {};
    this.opts = { autoDist: true, labels: true, snap: 0.1, rotSnap: 15 };
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.drag = null;
    this.enabled = false;

    this.bindPointer();
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  // ================= durum =================
  load(state, { keepView = false } = {}) {
    this.state = normalizeState(state);
    this.sel = null;
    this.measureA = null;
    for (const o of this.objs.values()) { disposeObject(o); this.root.remove(o); }
    this.objs.clear();
    const { w, d } = this.state.poligon;
    if (this.env.W !== w || this.env.D !== d || !this.env.group.children.length) this.env.build(w, d);
    for (const it of this.state.items) this.addObj(it);
    this.relabel();
    this.refreshGizmo();
    this.refreshAuto();
    this.emit('select', null);
    this.emit('change', { load: true, keepView });
  }

  snapshot() {
    this.undoStack.push(JSON.stringify(this.state));
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.state));
    this.restore(this.undoStack.pop());
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.state));
    this.restore(this.redoStack.pop());
    return true;
  }
  restore(json) {
    const sel = this.sel;
    const s = JSON.parse(json);
    const st = normalizeState(s);
    const rangeChanged = st.poligon.w !== this.state.poligon.w || st.poligon.d !== this.state.poligon.d;
    this.state = st;
    if (rangeChanged) this.env.build(st.poligon.w, st.poligon.d);
    for (const o of this.objs.values()) { disposeObject(o); this.root.remove(o); }
    this.objs.clear();
    for (const it of st.items) this.addObj(it);
    this.relabel();
    this.sel = st.items.find((i) => i.id === sel) ? sel : null;
    this.refreshGizmo();
    this.refreshAuto();
    this.emit('select', this.cur());
    this.emit('change', {});
  }

  changed(extra = {}) {
    this.refreshAuto();
    this.emit('change', extra);
  }

  item(id) { return this.state.items.find((i) => i.id === id); }
  cur() { return this.sel ? this.item(this.sel) : null; }

  // ================= nesneler =================
  addObj(it) {
    const o = it.type === 'olcu' ? this.buildMeasure(it) : buildItem(it);
    o.userData.itemId = it.id;
    this.root.add(o);
    this.objs.set(it.id, o);
    return o;
  }

  rebuildObj(it) {
    const old = this.objs.get(it.id);
    if (old) { disposeObject(old); this.root.remove(old); }
    const o = this.addObj(it);
    const lbl = this.labelFor(it);
    if (lbl) this.attachLabel(o, lbl);
    if (this.sel === it.id) this.refreshGizmo();
    return o;
  }

  buildMeasure(it) {
    const g = new THREE.Group();
    const y = 0.07;
    const A = new THREE.Vector3(it.a.x, y, it.a.z), B = new THREE.Vector3(it.b.x, y, it.b.z);
    const col = it.renk || COLORS.olcu;
    g.add(this.fatLine([A, B], col, 4));
    const dir = B.clone().sub(A);
    const len = dir.length();
    dir.normalize();
    const headGeo = new THREE.ConeGeometry(0.11, 0.34, 14);
    const hm = new THREE.MeshBasicMaterial({ color: col });
    for (const [P, s] of [[B, 1], [A, -1]]) {
      const h = new THREE.Mesh(headGeo, hm);
      h.position.copy(P).addScaledVector(dir, -0.17 * s);
      h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().multiplyScalar(s));
      g.add(h);
      const tick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), hm);
      tick.position.copy(P).setY(0.3);
      g.add(tick);
    }
    const l = makeLabel(fmtM(len), { px: 24, border: col, fg: '#fff' });
    l.position.copy(A).add(B).multiplyScalar(0.5).setY(0.45);
    g.add(l);
    g.userData.isMeasure = true;
    return g;
  }

  fatLine(pts, color, width = 3, dashed = false) {
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0.95, dashed, dashSize: 0.4, gapSize: 0.25 });
    this.engine.registerLineMat(mat);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 900;
    line.onRemoved = () => {};
    line.userData.lineMat = mat;
    return line;
  }

  // numaralandırma
  computeLabels() {
    const m = new Map();
    let h = 0, d = 0, a = 0;
    for (const it of this.state.items) {
      const C = CATALOG[it.type];
      if (!C) continue;
      let t = null;
      if (C.rol === 'hedef' || C.rol === 'celik') t = 'H' + ++h;
      else if (C.rol === 'dost') t = 'D' + ++d;
      else if (C.rol === 'nokta') t = 'A' + ++a;
      if (t) m.set(it.id, it.etiket?.trim() || t);
    }
    return m;
  }
  labelFor(it) { return this.labels?.get(it.id) || null; }

  attachLabel(o, text) {
    const old = o.getObjectByName('numLabel');
    if (old) { disposeObject(old); o.remove(old); }
    if (!text) return;
    const it = this.item(o.userData.itemId);
    const C = CATALOG[it.type];
    const color = C.rol === 'nokta' ? '#3fa9ff' : C.rol === 'dost' ? '#3ccf6e' : C.rol === 'celik' ? '#ff8a3d' : '#ff4d4d';
    const l = makeLabel(text, { px: 20, border: color });
    l.name = 'numLabel';
    l.position.y = o.userData.top + 0.15;
    l.visible = this.opts.labels;
    o.add(l);
  }

  relabel() {
    this.labels = this.computeLabels();
    for (const it of this.state.items) {
      const o = this.objs.get(it.id);
      if (!o || it.type === 'olcu') continue;
      const text = this.labels.get(it.id) || null;
      const cur = o.getObjectByName('numLabel');
      if ((cur?.userData.text || null) !== text) this.attachLabel(o, text);
    }
  }

  setLabelsVisible(v) {
    this.opts.labels = v;
    for (const o of this.objs.values()) {
      const l = o.getObjectByName('numLabel');
      if (l) l.visible = v;
    }
  }

  // ================= işlemler =================
  addItem(type, x, z, extra = {}) {
    this.snapshot();
    const it = { id: uid(), type, x: this.snapV(x), z: this.snapV(z), rot: 0, p: defaultParams(type), ...extra };
    this.state.items.push(it);
    this.addObj(it);
    this.relabel();
    this.select(it.id);
    this.changed();
    return it;
  }

  addMeasure(a, b) {
    this.snapshot();
    const it = { id: uid(), type: 'olcu', a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, renk: COLORS.olcu };
    this.state.items.push(it);
    this.addObj(it);
    this.select(it.id);
    this.changed();
  }

  deleteSelected() {
    const it = this.cur();
    if (!it) return;
    this.snapshot();
    this.state.items = this.state.items.filter((i) => i !== it);
    const o = this.objs.get(it.id);
    if (o) { disposeObject(o); this.root.remove(o); }
    this.objs.delete(it.id);
    this.sel = null;
    this.relabel();
    this.refreshGizmo();
    this.emit('select', null);
    this.changed();
  }

  duplicateSelected() {
    const it = this.cur();
    if (!it) return;
    this.snapshot();
    const c = JSON.parse(JSON.stringify(it));
    c.id = uid();
    delete c.etiket;
    if (c.type === 'olcu') {
      c.a.x += 1; c.b.x += 1;
    } else {
      const r = it.rot || 0;
      c.x = this.snapV(it.x + Math.cos(r) * 1.0);
      c.z = this.snapV(it.z - Math.sin(r) * 1.0);
    }
    this.state.items.push(c);
    this.addObj(c);
    this.relabel();
    this.select(c.id);
    this.changed();
  }

  setProp(id, k, v, { snap = true } = {}) {
    const it = this.item(id);
    if (!it) return;
    if (snap) this.snapshot();
    if (k === 'x' || k === 'z' || k === 'rot') {
      it[k] = v;
      const o = this.objs.get(id);
      o.position.set(it.x, 0, it.z);
      o.rotation.y = it.rot || 0;
      this.refreshGizmo();
    } else if (k === 'etiket') {
      it.etiket = v;
      this.relabel();
    } else if (k === 'renk' || k === 'a' || k === 'b') {
      it[k] = v;
      this.rebuildObj(it);
    }
    this.changed();
  }

  setParam(id, k, v) {
    const it = this.item(id);
    if (!it) return;
    this.snapshot();
    it.p = { ...(it.p || {}), [k]: v };
    this.rebuildObj(it);
    this.changed();
  }

  setRange(w, d) {
    this.snapshot();
    this.state.poligon.w = clamp(w, 10, 200);
    this.state.poligon.d = clamp(d, 10, 300);
    this.env.build(this.state.poligon.w, this.state.poligon.d);
    this.changed({ range: true });
  }

  setInfo(k, v) {
    this.snapshot();
    this.state.bilgi[k] = v;
    this.emit('change', { info: true });
  }

  select(id) {
    this.sel = id;
    this.refreshGizmo();
    this.refreshAuto();
    this.emit('select', this.cur());
  }

  snapV(v) {
    const s = this.opts.snap;
    return s > 0 && !this._noSnap ? Math.round(v / s) * s : Math.round(v * 1000) / 1000;
  }

  // ================= gizmo =================
  refreshGizmo() {
    for (const c of [...this.gizmo.children]) { disposeObject(c); this.gizmo.remove(c); }
    const it = this.cur();
    const o = it ? this.objs.get(it.id) : null;
    this.engine.setSelected(o && it.type !== 'olcu' ? [o.getObjectByName('body')] : []);
    if (!it || !o) return;
    const hmat = new THREE.MeshBasicMaterial({ color: 0x46d2ff, depthTest: false, transparent: true });
    const handle = (x, y, z, kind, extra = {}) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), hmat);
      m.position.set(x, y, z);
      m.renderOrder = 950;
      m.userData = { handle: kind, ...extra };
      this.gizmo.add(m);
      return m;
    };
    if (it.type === 'olcu') {
      handle(it.a.x, 0.1, it.a.z, 'mA');
      handle(it.b.x, 0.1, it.b.z, 'mB');
      return;
    }
    const box = new THREE.Box3().setFromObject(o.getObjectByName('body'));
    const size = box.getSize(new THREE.Vector3());
    const R = Math.max(0.55, Math.hypot(size.x, size.z) / 2 + 0.3);
    const ringG = new THREE.Group();
    ringG.position.set(it.x, 0.06, it.z);
    ringG.rotation.y = it.rot || 0;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.035, 8, 96).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb330, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    ring.renderOrder = 940;
    ring.userData.handle = 'rot';
    ringG.add(ring);
    // geniş tıklama alanı
    const hit = new THREE.Mesh(new THREE.TorusGeometry(R, 0.18, 6, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.handle = 'rot';
    ringG.add(hit);
    // yön göstergesi (ileri)
    const fwd = isPoint(it.type) || it.type === 'asker' ? -1 : 1;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 12), ring.material);
    arrow.rotation.x = fwd * Math.PI / 2;
    arrow.position.set(0, 0, fwd * (R + 0.2));
    arrow.renderOrder = 940;
    arrow.userData.handle = 'rot';
    ringG.add(arrow);
    this.gizmo.add(ringG);
    const C = CATALOG[it.type];
    if (C.uzun && it.p?.w != null) {
      const w = it.p.w;
      const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
      for (const side of [-1, 1]) {
        const lx = (side * w) / 2;
        handle(it.x + lx * c, 0.25, it.z - lx * s, 'len', { side });
      }
    }
  }

  // ================= otomatik mesafeler =================
  refreshAuto(liveId = null) {
    for (const c of [...this.autoGroup.children]) { disposeObject(c); c.traverse((o) => o.userData.lineMat && this.engine.lineMats.delete(o.userData.lineMat)); this.autoGroup.remove(c); }
    const items = this.state.items;
    const points = items.filter((i) => isPoint(i.type));
    const targets = items.filter((i) => isTarget(i.type) || CATALOG[i.type]?.rol === 'dost');
    const cur = this.cur();
    const pairs = [];
    if (this.opts.autoDist) {
      let srcs;
      if (cur && isPoint(cur.type)) srcs = [cur];
      else if (cur && (isTarget(cur.type) || CATALOG[cur.type]?.rol === 'dost')) {
        for (const p of points) pairs.push([p, cur]);
        srcs = [];
      } else srcs = points.slice(0, 1);
      for (const p of srcs) for (const t of targets) pairs.push([p, t]);
    } else if (liveId) {
      const t = this.item(liveId);
      if (t && (isTarget(t.type) || CATALOG[t.type]?.rol === 'dost') && points.length) {
        let best = null;
        for (const p of points) {
          const d = Math.hypot(p.x - t.x, p.z - t.z);
          if (!best || d < best[0]) best = [d, p];
        }
        pairs.push([best[1], t]);
      } else if (t && isPoint(t.type)) for (const tt of targets) pairs.push([t, tt]);
    }
    for (const [p, t] of pairs) {
      const A = new THREE.Vector3(p.x, 0.09, p.z), B = new THREE.Vector3(t.x, 0.09, t.z);
      const g = new THREE.Group();
      const dost = CATALOG[t.type].rol === 'dost';
      const col = dost ? '#5be08a' : COLORS.oto;
      g.add(this.fatLine([A, B], col, 2.2, true));
      const d = A.distanceTo(B);
      const lt = `${this.labels.get(t.id) || ''} · ${fmtM(d)}`;
      const l = makeLabel(lt, { px: 17, border: col, bg: 'rgba(8,22,30,0.85)' });
      l.position.copy(A).lerp(B, 0.55).setY(0.35);
      g.add(l);
      this.autoGroup.add(g);
    }
  }

  // ================= işaretçi etkileşimi =================
  setNdc(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  groundPoint(e) {
    this.setNdc(e);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }
  pickHandle() {
    const hits = this.ray.intersectObjects(this.gizmo.children, true);
    for (const h of hits) if (h.object.userData.handle) return h.object;
    return null;
  }
  pickItem() {
    const hits = this.ray.intersectObjects(this.root.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.itemId) o = o.parent;
      if (o) return o.userData.itemId;
    }
    return null;
  }

  setMode(m, type = null) {
    this.mode = m;
    this.placeType = type;
    this.measureA = null;
    this.clearGhost();
    this.clearTempMeasure();
    if (m === 'yerlestir' && type) this.makeGhost(type);
    this.dom.style.cursor = m === 'olc' ? 'crosshair' : m === 'yerlestir' ? 'copy' : '';
    this.emit('mode', m, type);
  }

  makeGhost(type) {
    this.clearGhost();
    const it = { id: '_ghost', type, x: 0, z: 0, rot: 0, p: defaultParams(type) };
    const g = buildItem(it);
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = mats().ghost;
        o.castShadow = false;
      }
    });
    g.visible = false;
    g.userData.itemId = null;
    this.ghost = g;
    this.scene.add(g);
  }
  clearGhost() {
    if (this.ghost) { disposeObject(this.ghost); this.scene.remove(this.ghost); this.ghost = null; }
  }
  moveGhost(e) {
    if (!this.ghost) return;
    const p = this.groundPoint(e);
    if (!p) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghost.position.set(this.snapV(p.x), 0, this.snapV(p.z));
  }

  clearTempMeasure() {
    if (this.tempMeasure) { disposeObject(this.tempMeasure); this.scene.remove(this.tempMeasure); this.tempMeasure = null; }
  }
  updateTempMeasure(b) {
    this.clearTempMeasure();
    if (!this.measureA || !b) return;
    const it = { a: this.measureA, b: { x: b.x, z: b.z }, renk: '#ffe27a' };
    this.tempMeasure = this.buildMeasure(it);
    this.scene.add(this.tempMeasure);
  }

  bindPointer() {
    const el = this.dom;
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this._noSnap = e.altKey;
      this.down = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button !== 0) return;
      if (this.mode !== 'sec') return; // yerleştirme/ölçüm tıklama ile
      this.setNdc(e);
      const h = this.pickHandle();
      const it = this.cur();
      if (h && it) {
        this.engine.controls.enabled = false;
        const gp = this.groundPoint(e);
        this.drag = { kind: h.userData.handle, side: h.userData.side, moved: false, startRot: it.rot || 0, startAng: gp ? Math.atan2(gp.x - it.x, gp.z - it.z) : 0 };
        el.setPointerCapture(e.pointerId);
        return;
      }
      const id = this.pickItem();
      if (id) {
        if (this.sel !== id) this.select(id);
        const t = this.item(id);
        const gp = this.groundPoint(e);
        if (gp) {
          this.engine.controls.enabled = false;
          const ox = t.type === 'olcu' ? (t.a.x + t.b.x) / 2 : t.x;
          const oz = t.type === 'olcu' ? (t.a.z + t.b.z) / 2 : t.z;
          this.drag = { kind: 'move', ox: gp.x - ox, oz: gp.z - oz, moved: false, a0: t.a && { ...t.a }, b0: t.b && { ...t.b }, c0: { x: ox, z: oz } };
          el.setPointerCapture(e.pointerId);
        }
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      this._noSnap = e.altKey;
      const gp = this.groundPoint(e);
      this.emit('cursor', gp);
      if (this.mode === 'yerlestir') this.moveGhost(e);
      if (this.mode === 'olc' && this.measureA && gp) this.updateTempMeasure({ x: this.snapV(gp.x), z: this.snapV(gp.z) });
      if (!this.drag) {
        if (this.mode === 'sec' && !e.buttons) {
          const h = this.pickHandle();
          el.style.cursor = h ? (h.userData.handle === 'rot' ? 'grab' : 'ew-resize') : this.pickItem() ? 'move' : '';
        }
        return;
      }
      const it = this.cur();
      if (!it || !gp) return;
      if (!this.drag.moved) {
        const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
        if (dx * dx + dy * dy < 9) return;
        this.snapshot();
        this.drag.moved = true;
      }
      const o = this.objs.get(it.id);
      const k = this.drag.kind;
      if (k === 'move') {
        const nx = this.snapV(gp.x - this.drag.ox), nz = this.snapV(gp.z - this.drag.oz);
        if (it.type === 'olcu') {
          const dx = nx - this.drag.c0.x, dz = nz - this.drag.c0.z;
          it.a = { x: this.drag.a0.x + dx, z: this.drag.a0.z + dz };
          it.b = { x: this.drag.b0.x + dx, z: this.drag.b0.z + dz };
          this.rebuildObj(it);
        } else {
          it.x = nx;
          it.z = nz;
          o.position.set(it.x, 0, it.z);
        }
      } else if (k === 'rot') {
        const ang = Math.atan2(gp.x - it.x, gp.z - it.z);
        let r = this.drag.startRot + (ang - this.drag.startAng);
        const step = (e.shiftKey ? 1 : this.opts.rotSnap) * DEG;
        r = Math.round(r / step) * step;
        r = Math.atan2(Math.sin(r), Math.cos(r));
        it.rot = r;
        o.rotation.y = r;
      } else if (k === 'len') {
        const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
        const w0 = it.p.w;
        const fx = it.x - (this.drag.side * w0 / 2) * c, fz = it.z + (this.drag.side * w0 / 2) * s;
        const lx = (gp.x - fx) * c - (gp.z - fz) * s;
        const C = CATALOG[it.type].params.find((p) => p.k === 'w');
        let w = clamp(Math.abs(lx), C.min, C.max);
        w = Math.max(C.min, this.snapV(w));
        const sign = Math.sign(lx) || this.drag.side;
        const mid = (sign * w) / 2;
        it.p = { ...it.p, w };
        it.x = fx + mid * c;
        it.z = fz - mid * s;
        if (sign !== this.drag.side) this.drag.side = sign;
        this.rebuildObj(it);
        return this.liveUpdate(it);
      } else if (k === 'mA' || k === 'mB') {
        const key = k === 'mA' ? 'a' : 'b';
        it[key] = { x: this.snapV(gp.x), z: this.snapV(gp.z) };
        this.rebuildObj(it);
      }
      this.liveUpdate(it);
    });

    const up = (e) => {
      if (!this.enabled) return;
      const d = this.down;
      this.down = null;
      if (this.drag) {
        const moved = this.drag.moved;
        this.drag = null;
        this.engine.controls.enabled = true;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        if (moved) {
          this.refreshGizmo();
          this.changed();
        }
        return;
      }
      if (!d || d.button !== 0) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (dx * dx + dy * dy > 25) return; // sürükleme (kamera) idi
      // tıklama
      const gp = this.groundPoint(e);
      if (this.mode === 'yerlestir' && gp) {
        this.addItem(this.placeType, gp.x, gp.z);
        if (!e.shiftKey) this.setMode('sec');
        else this.makeGhost(this.placeType);
        return;
      }
      if (this.mode === 'olc' && gp) {
        const q = { x: this.snapV(gp.x), z: this.snapV(gp.z) };
        if (!this.measureA) this.measureA = q;
        else {
          if (Math.hypot(q.x - this.measureA.x, q.z - this.measureA.z) > 0.05) this.addMeasure(this.measureA, q);
          this.measureA = null;
          this.clearTempMeasure();
          this.engine.controls.enabled = true;
        }
        this.emit('mode', this.mode);
        return;
      }
      if (this.mode === 'sec') {
        this.setNdc(e);
        if (!this.pickHandle() && !this.pickItem() && this.sel) this.select(null);
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { if (this.ghost && !this.externalDrag) this.ghost.visible = false; });
  }

  liveUpdate(it) {
    if (it.type !== 'olcu') {
      // gizmo konumunu güncelle
      const ringG = this.gizmo.children.find((c) => c.isGroup);
      if (ringG && this.drag?.kind !== 'len') { ringG.position.set(it.x, 0.06, it.z); ringG.rotation.y = it.rot || 0; }
      if (this.drag?.kind === 'len') this.refreshGizmo();
      else {
        const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
        for (const h of this.gizmo.children) if (h.userData.handle === 'len') {
          const lx = (h.userData.side * it.p.w) / 2;
          h.position.set(it.x + lx * c, 0.25, it.z - lx * s);
        }
      }
    } else this.refreshGizmo();
    this.refreshAuto(it.id);
    this.emit('live', it);
  }

  // dışarıdan (kütüphaneden sürükle-bırak)
  externalDragMove(e) {
    this.externalDrag = true;
    this.moveGhost(e);
  }
  externalDrop(e) {
    this.externalDrag = false;
    const p = this.groundPoint(e);
    if (p && this.placeType) this.addItem(this.placeType, p.x, p.z);
    this.setMode('sec');
  }

  nudge(dx, dz) {
    const it = this.cur();
    if (!it) return;
    this.snapshot();
    if (it.type === 'olcu') {
      it.a.x += dx; it.a.z += dz; it.b.x += dx; it.b.z += dz;
      this.rebuildObj(it);
    } else {
      it.x = Math.round((it.x + dx) * 1000) / 1000;
      it.z = Math.round((it.z + dz) * 1000) / 1000;
      this.objs.get(it.id).position.set(it.x, 0, it.z);
    }
    this.refreshGizmo();
    this.changed();
    this.emit('live', it);
  }
  rotateSel(deg) {
    const it = this.cur();
    if (!it || it.type === 'olcu') return;
    let r = (it.rot || 0) + deg * DEG;
    r = Math.atan2(Math.sin(r), Math.cos(r));
    this.setProp(it.id, 'rot', Math.round(r / DEG) * DEG);
    this.emit('live', it);
  }

  // ================= analiz =================
  analyze() {
    const items = this.state.items;
    const L = this.labels || new Map();
    const { w, d } = this.state.poligon;
    const points = items.filter((i) => isPoint(i.type));
    const targets = items.filter((i) => isTarget(i.type));
    const dost = items.filter((i) => CATALOG[i.type]?.rol === 'dost');
    const steel = targets.filter((i) => CATALOG[i.type].rol === 'celik');
    const atim = targets.reduce((s, t) => s + (+(t.p?.atim ?? CATALOG[t.type].params.find((p) => p.k === 'atim')?.def ?? 0)), 0);
    const W = [];
    if (items.length && !points.length) W.push({ lvl: 'bilgi', text: 'Parkurda atış noktası yok. Atış Kaidesi, Atış Kutusu veya Başlangıç Noktası ekleyin.' });
    for (const t of [...targets, ...dost]) {
      if (Math.abs(t.x) > w / 2 || t.z < -d || t.z > 0)
        W.push({ lvl: 'hata', id: t.id, text: `${L.get(t.id)}: poligon sınırları veya atış hattı dışında.` });
    }
    for (const t of targets) for (const p of points) {
      const dx = t.x - p.x, dz = t.z - p.z;
      const dist = Math.hypot(dx, dz);
      const ang = Math.abs(Math.atan2(dx, -dz) / DEG);
      if (ang > 90) W.push({ lvl: 'hata', id: t.id, text: `${L.get(t.id)}: ${L.get(p.id)} noktasından 180° emniyet açısını aşıyor (${ang.toFixed(0)}°).` });
      else if (ang > 80) W.push({ lvl: 'uyari', id: t.id, text: `${L.get(t.id)}: ${L.get(p.id)} noktasından emniyet açısı sınırına yakın (${ang.toFixed(0)}°).` });
      if (CATALOG[t.type].rol === 'celik' && dist < this.state.emniyet.celikMin)
        W.push({ lvl: 'hata', id: t.id, text: `${L.get(t.id)}: ${L.get(p.id)} noktasına ${fmtM(dist)}. Çelik hedefler için en az ${this.state.emniyet.celikMin} m olmalı.` });
    }
    // tahmini süre: her atış 0.6 sn + noktalar arası hareket (2 m/sn) + ilk tepki 1.5 sn
    let yol = 0;
    for (let i = 1; i < points.length; i++) yol += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
    const sure = targets.length ? 1.5 + atim * 0.55 + yol / 2.2 + Math.max(0, points.length - 1) * 0.8 : 0;
    return { points, targets, dost, steel, atim, W, sure, yol };
  }

  /** Kamera kısayolları için faydalı geometri */
  centroid(list) {
    if (!list.length) return null;
    const c = new THREE.Vector3();
    for (const i of list) c.add(new THREE.Vector3(i.x, 0, i.z));
    return c.multiplyScalar(1 / list.length);
  }
}
