import * as THREE from 'three';

export const LABELS = new Set();
let viewK = 0.001;

/**
 * Kameraya dönük, ekranda sabit boyutlu etiket (WebGL içinde çizilir; PNG ve videoda görünür).
 */
export function makeLabel(text, opt = {}) {
  const {
    px = 22,
    fg = '#ffffff',
    bg = 'rgba(14,18,24,0.86)',
    border = '#d4a445',
    sub = null,
    anchorY = 0,
  } = opt;
  const S = 3;
  const fs = 20 * S;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `700 ${fs}px Rajdhani, "Segoe UI", Arial, sans-serif`;
  g.font = font;
  const tw = g.measureText(text).width;
  const padX = 10 * S, padY = 4 * S;
  const w = Math.ceil(tw + padX * 2), h = Math.ceil(fs + padY * 2);
  c.width = w;
  c.height = h;
  g.font = font;
  const r = h / 2.6;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(S, S, w - 2 * S, h - 2 * S, r);
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 2 * S;
    g.stroke();
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  const m = new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true });
  const s = new THREE.Sprite(m);
  s.center.set(0.5, anchorY);
  s.renderOrder = 1000;
  s.userData.isLabel = true;
  s.userData.px = px * (h / S / (20 + 8));
  s.userData.aspect = w / h;
  s.userData.text = text;
  applyScale(s);
  LABELS.add(s);
  return s;
}

function applyScale(s) {
  const hpx = s.userData.px;
  s.scale.set(hpx * s.userData.aspect * viewK, hpx * viewK, 1);
}

export function updateLabelScales(camera, viewportH) {
  viewK = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / viewportH;
  for (const s of LABELS) applyScale(s);
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.userData && o.userData.isLabel) {
      LABELS.delete(o);
      o.material.map?.dispose();
      o.material.dispose();
    }
    if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
  });
}
