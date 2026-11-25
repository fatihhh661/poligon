import * as THREE from 'three';
import { CATALOG } from './objects.js';

export class Minimap {
  constructor(canvas, editor, engine) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.editor = editor;
    this.engine = engine;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = 200 * this.dpr;
    canvas.height = 250 * this.dpr;
    this.t = 0;
    let dragging = false;
    const go = (e) => {
      const p = this.toWorld(e);
      const c = engine.controls;
      const off = engine.camera.position.clone().sub(c.target);
      const tgt = new THREE.Vector3(p.x, 0, p.z);
      if (dragging === 'drag') {
        c.target.copy(tgt);
        engine.camera.position.copy(tgt).add(off);
      } else engine.flyTo(tgt.clone().add(off), tgt, 0.6);
    };
    canvas.addEventListener('pointerdown', (e) => { dragging = 'click'; canvas.setPointerCapture(e.pointerId); go(e); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) { dragging = 'drag'; engine.tween = null; go(e); } });
    canvas.addEventListener('pointerup', () => (dragging = false));
  }

  layout() {
    const { w, d } = this.editor.state.poligon;
    const W = 200, H = 250, pad = 14;
    const ext = { x0: -w / 2 - 3, x1: w / 2 + 3, z0: -d - 4, z1: 6 };
    const s = Math.min((W - pad * 2) / (ext.x1 - ext.x0), (H - pad * 2) / (ext.z1 - ext.z0));
    const ox = W / 2 - ((ext.x0 + ext.x1) / 2) * s;
    const oz = H / 2 - ((ext.z0 + ext.z1) / 2) * s;
    return { s, ox, oz, ext };
  }

  toWorld(e) {
    const r = this.c.getBoundingClientRect();
    const L = this.layout();
    return { x: (e.clientX - r.left - L.ox) / L.s, z: (e.clientY - r.top - L.oz) / L.s };
  }

  draw() {
    const g = this.g, dpr = this.dpr;
    const L = this.layout();
    const { s, ox, oz } = L;
    const X = (x) => ox + x * s, Z = (z) => oz + z * s;
    const { w, d } = this.editor.state.poligon;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 200, 250);
    // set
    g.fillStyle = '#5a4a36';
    g.fillRect(X(-w / 2 - 3), Z(-d - 4), (w + 6) * s, 4 * s);
    g.fillRect(X(-w / 2 - 3), Z(-d), 3 * s, (d + 4) * s);
    g.fillRect(X(w / 2), Z(-d), 3 * s, (d + 4) * s);
    // zemin
    g.fillStyle = '#4a4d50';
    g.fillRect(X(-w / 2), Z(-d), w * s, (d + 6) * s);
    // ızgara 5 m
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = -Math.floor(w / 2 / 5) * 5; x <= w / 2; x += 5) { g.moveTo(X(x), Z(-d)); g.lineTo(X(x), Z(6)); }
    for (let z = 0; z >= -d; z -= 5) { g.moveTo(X(-w / 2), Z(z)); g.lineTo(X(w / 2), Z(z)); }
    g.stroke();
    // atış hattı
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(X(-w / 2), Z(0));
    g.lineTo(X(w / 2), Z(0));
    g.stroke();
    g.setLineDash([]);

    const sel = this.editor.sel;
    for (const it of this.editor.state.items) {
      const isSel = it.id === sel;
      if (it.type === 'olcu') {
        g.strokeStyle = '#ffc21a';
        g.lineWidth = isSel ? 2.5 : 1.5;
        g.beginPath();
        g.moveTo(X(it.a.x), Z(it.a.z));
        g.lineTo(X(it.b.x), Z(it.b.z));
        g.stroke();
        continue;
      }
      const C = CATALOG[it.type];
      const x = X(it.x), z = Z(it.z);
      if (C.uzun && it.p?.w) {
        const hw = (it.p.w / 2) * s;
        const c = Math.cos(it.rot || 0), sn = Math.sin(it.rot || 0);
        g.strokeStyle = it.type === 'hata' ? '#e53935' : '#c9a46a';
        g.lineWidth = isSel ? 4 : 2.5;
        g.beginPath();
        g.moveTo(x - hw * c, z + hw * sn);
        g.lineTo(x + hw * c, z - hw * sn);
        g.stroke();
      } else {
        const col = C.rol === 'hedef' ? '#ff5252' : C.rol === 'celik' ? '#ff8a3d' : C.rol === 'dost' ? '#3ccf6e' : C.rol === 'nokta' ? '#3fa9ff' : '#b0b6bd';
        g.fillStyle = col;
        const r = C.rol ? 3.2 : 2.4;
        g.beginPath();
        if (C.rol === 'nokta') g.rect(x - r, z - r, r * 2, r * 2);
        else g.arc(x, z, r, 0, Math.PI * 2);
        g.fill();
      }
      if (isSel) {
        g.strokeStyle = '#ffb330';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, z, 7, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // kamera
    const cam = this.engine.camera.position, tgt = this.engine.controls.target;
    const ang = Math.atan2(tgt.x - cam.x, tgt.z - cam.z);
    const cx = X(Math.max(L.ext.x0, Math.min(L.ext.x1, cam.x))), cz = Z(Math.max(L.ext.z0, Math.min(L.ext.z1 + 2, cam.z)));
    g.save();
    g.translate(cx, cz);
    g.rotate(-ang + Math.PI);
    const grd = g.createLinearGradient(0, 0, 0, -40);
    grd.addColorStop(0, 'rgba(214,166,70,0.55)');
    grd.addColorStop(1, 'rgba(214,166,70,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-18, -40);
    g.lineTo(18, -40);
    g.closePath();
    g.fill();
    g.fillStyle = '#f0c368';
    g.beginPath();
    g.arc(0, 0, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}
