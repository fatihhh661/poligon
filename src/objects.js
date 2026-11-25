import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeLabel } from './labels.js';
import { A, pbrMaterial, modelClone } from './assets.js';
import { buildSoldier } from './soldier.js';

let M = null;

export function initMaterials(tex) {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const paint = (color) => S({ color, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const real = A.ok;
  M = {
    osb: real ? pbrMaterial('plywood', { repeat: 0.8, normalScale: 0.8 }) : S({ map: tex.osb, roughness: 0.9 }),
    wood: real ? pbrMaterial('wood', { color: 0xb59a7c }) : S({ map: tex.wood, roughness: 0.85 }),
    woodLight: real ? pbrMaterial('wood', { color: 0xe8d6bc }) : S({ map: tex.woodLight, roughness: 0.85 }),
    cardboard: S({ color: 0x9c7c55, roughness: 1 }),
    paper: S({ map: tex.target, roughness: 0.92, side: THREE.FrontSide }),
    paperDost: S({ map: tex.targetDost, roughness: 0.92 }),
    steel: S({ color: 0xe0612a, roughness: 0.5, metalness: 0.35 }),
    steelDark: S({ color: 0x33383e, roughness: 0.45, metalness: 0.75 }),
    red: real ? pbrMaterial('wood', { color: 0xd23a2a }) : S({ color: 0xc62828, roughness: 0.6 }),
    white: paint(0xf4f3ee),
    yellow: paint(0xf2c230),
    redPaint: paint(0xd32f2f),
    sandA: real ? pbrMaterial('sand', { color: 0xd8c9a0, repeat: 0.6 }) : S({ color: 0xb9a77b, roughness: 1 }),
    sandB: real ? pbrMaterial('sand', { color: 0xc4b289, repeat: 0.6 }) : S({ color: 0xa8956a, roughness: 1 }),
    barrel: S({ color: 0x1f4e8c, roughness: 0.45, metalness: 0.45 }),
    barrelDark: S({ color: 0x163a69, roughness: 0.45, metalness: 0.45 }),
    rubber: S({ color: 0x1c1c1c, roughness: 0.9 }),
    orange: S({ color: 0xff6a13, roughness: 0.55, side: THREE.DoubleSide }),
    whiteSolid: S({ color: 0xf5f5f0, roughness: 0.6 }),
    flag: S({ color: 0xd32f2f, roughness: 0.8, side: THREE.DoubleSide }),
    uniform: S({ color: 0x5d6339, roughness: 0.95 }),
    vest: S({ color: 0x454a2a, roughness: 0.9 }),
    skin: S({ color: 0xc89a78, roughness: 0.8 }),
    boot: S({ color: 0x241f1b, roughness: 0.8 }),
    rifle: S({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 }),
    helmet: S({ color: 0x4c5230, roughness: 0.8 }),
    ghost: S({ color: 0xffffff, transparent: true, opacity: 0.5 }),
  };
  return M;
}
export const mats = () => M;

// ---------- yardımcılar ----------
function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);

function woodBox(w, h, d, mat, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const L = Math.max(w, h, d);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.15, uv.getY(i) * L * 0.6);
  return mesh(g, mat, x, y, z);
}

function limb(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r * 0.4), 4, 10);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  m.castShadow = true;
  return m;
}

function panelGeo(w, h, holes = [], depth = 0.018) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  for (const [x0, y0, x1, y1] of holes) {
    const p = new THREE.Path();
    p.moveTo(x0, y0);
    p.lineTo(x0, y1);
    p.lineTo(x1, y1);
    p.lineTo(x1, y0);
    p.closePath();
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

function paperTarget(g, bw, bh, bottom, mat) {
  // karton arka
  g.add(box(bw + 0.02, bh + 0.02, 0.012, M.cardboard, 0, bottom + bh / 2, -0.008));
  const face = mesh(new THREE.PlaneGeometry(bw, bh), mat, 0, bottom + bh / 2, 0.0);
  g.add(face);
  // ahşap kazıklar + taban
  const top = bottom + bh * 0.85;
  for (const x of [-bw / 2 + 0.06, bw / 2 - 0.06]) {
    g.add(woodBox(0.035, top, 0.035, M.woodLight, x, top / 2, -0.035));
  }
  g.add(woodBox(bw + 0.25, 0.06, 0.06, M.wood, 0, 0.03, -0.035));
  g.add(woodBox(0.06, 0.05, 0.55, M.wood, -bw / 2 + 0.06, 0.025, -0.035));
  g.add(woodBox(0.06, 0.05, 0.55, M.wood, bw / 2 - 0.06, 0.025, -0.035));
}

function popperShape(k = 1) {
  const s = new THREE.Shape();
  const cy = 0.72 * k, r = 0.13 * k;
  const a1 = Math.atan2(0.6 * k - cy, 0.05 * k);
  s.moveTo(-0.1 * k, 0);
  s.lineTo(0.1 * k, 0);
  s.lineTo(0.05 * k, 0.6 * k);
  s.absarc(0, cy, r, a1, Math.PI - a1, false);
  s.lineTo(-0.1 * k, 0);
  return s;
}

function popper(k) {
  const g = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(popperShape(k), { depth: 0.014, bevelEnabled: false });
  geo.translate(0, 0.06, -0.007);
  g.add(mesh(geo, M.steel));
  g.add(box(0.34 * k + 0.06, 0.03, 0.3, M.steelDark, 0, 0.015, -0.04));
  g.add(box(0.24 * k, 0.05, 0.05, M.steelDark, 0, 0.055, 0));
  return g;
}

function plateOnPost(square) {
  const g = new THREE.Group();
  g.add(box(0.32, 0.02, 0.32, M.steelDark, 0, 0.01, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.1, 10), M.steelDark, 0, 0.55, -0.03));
  const plate = square
    ? box(0.15, 0.15, 0.012, M.steel, 0, 1.18, 0)
    : mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 28).rotateX(Math.PI / 2), M.steel, 0, 1.2, 0);
  g.add(plate);
  return g;
}

function groundPaint(g, w, d, mat, lw = 0.05) {
  const y = 0.03;
  const t = 0.01;
  g.add(mesh(new THREE.BoxGeometry(w, t, lw), mat, 0, y, -d / 2 + lw / 2, false));
  g.add(mesh(new THREE.BoxGeometry(w, t, lw), mat, 0, y, d / 2 - lw / 2, false));
  g.add(mesh(new THREE.BoxGeometry(lw, t, d - lw * 2), mat, -w / 2 + lw / 2, y, 0, false));
  g.add(mesh(new THREE.BoxGeometry(lw, t, d - lw * 2), mat, w / 2 - lw / 2, y, 0, false));
}

function soldier(pose = 'ayakta') {
  const g = new THREE.Group();
  const U = M.uniform, V = M.vest, Sk = M.skin, B = M.boot, R = M.rifle, H = M.helmet;
  const add = (o) => (g.add(o), o);
  if (pose === 'yuzustu') {
    add(limb([-0.12, 0.1, 0.05], [-0.22, 0.08, 0.85], 0.075, U));
    add(limb([0.12, 0.1, 0.05], [0.24, 0.08, 0.85], 0.075, U));
    add(box(0.12, 0.1, 0.26, B, -0.23, 0.07, 0.95));
    add(box(0.12, 0.1, 0.26, B, 0.25, 0.07, 0.95));
    const t = add(box(0.38, 0.2, 0.6, U, 0, 0.15, -0.27));
    t.rotation.x = 0.06;
    add(box(0.42, 0.2, 0.42, V, 0, 0.2, -0.3));
    add(mesh(new THREE.SphereGeometry(0.11, 16, 12), Sk, 0, 0.27, -0.72));
    add(mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), H, 0, 0.3, -0.72));
    add(limb([0.2, 0.2, -0.5], [0.22, 0.06, -0.78], 0.055, U));
    add(limb([0.22, 0.06, -0.78], [0.1, 0.22, -0.68], 0.05, U));
    add(limb([-0.2, 0.2, -0.5], [-0.15, 0.06, -0.95], 0.055, U));
    add(limb([-0.15, 0.06, -0.95], [0.06, 0.22, -1.0], 0.05, U));
    const rf = add(box(0.05, 0.08, 0.9, R, 0.08, 0.27, -1.05));
    rf.rotation.x = 0.04;
    return g;
  }
  const kneel = pose === 'diz';
  const dy = kneel ? -0.37 : 0;
  if (kneel) {
    add(limb([-0.11, 0.55, 0], [-0.13, 0.55, -0.45], 0.08, U));
    add(limb([-0.13, 0.55, -0.45], [-0.13, 0.1, -0.45], 0.07, U));
    add(box(0.12, 0.1, 0.27, B, -0.13, 0.05, -0.5));
    add(limb([0.11, 0.55, 0], [0.13, 0.09, -0.02], 0.08, U));
    add(limb([0.13, 0.09, -0.02], [0.13, 0.08, 0.42], 0.07, U));
    add(box(0.12, 0.12, 0.25, B, 0.13, 0.08, 0.52));
  } else {
    add(limb([-0.11, 0.9, 0], [-0.14, 0.1, 0.05], 0.08, U));
    add(limb([0.11, 0.9, 0], [0.14, 0.1, -0.05], 0.08, U));
    add(box(0.12, 0.1, 0.27, B, -0.14, 0.05, 0.02));
    add(box(0.12, 0.1, 0.27, B, 0.14, 0.05, -0.08));
  }
  add(box(0.38, 0.56, 0.22, U, 0, 1.17 + dy, 0));
  add(box(0.43, 0.42, 0.28, V, 0, 1.22 + dy, 0));
  add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), Sk, 0, 1.48 + dy, -0.01));
  add(mesh(new THREE.SphereGeometry(0.11, 16, 12), Sk, 0, 1.6 + dy, -0.02));
  add(mesh(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), H, 0, 1.63 + dy, -0.01));
  // kollar: nişan pozisyonu
  add(limb([0.21, 1.4 + dy, 0], [0.26, 1.2 + dy, -0.18], 0.055, U));
  add(limb([0.26, 1.2 + dy, -0.18], [0.12, 1.34 + dy, -0.14], 0.05, U));
  add(limb([-0.21, 1.4 + dy, 0], [-0.16, 1.23 + dy, -0.32], 0.055, U));
  add(limb([-0.16, 1.23 + dy, -0.32], [0.09, 1.35 + dy, -0.5], 0.05, U));
  add(box(0.05, 0.08, 0.9, R, 0.11, 1.4 + dy, -0.34));
  add(box(0.04, 0.12, 0.06, R, 0.11, 1.31 + dy, -0.22));
  return g;
}

// ---------- KATALOG ----------
const P = {
  w: (def, min = 0.3, max = 12) => ({ k: 'w', ad: 'Genişlik (m)', tip: 'sayi', def, min, max, step: 0.1 }),
  h: (def, min = 0.3, max = 4) => ({ k: 'h', ad: 'Yükseklik (m)', tip: 'sayi', def, min, max, step: 0.1 }),
  d: (def) => ({ k: 'd', ad: 'Derinlik (m)', tip: 'sayi', def, min: 0.3, max: 10, step: 0.1 }),
  yuk: (def) => ({ k: 'yuk', ad: 'Kağıt alt kenar yüksekliği (m)', tip: 'sayi', def, min: 0.1, max: 2, step: 0.05 }),
  atim: (def) => ({ k: 'atim', ad: 'Atım sayısı', tip: 'sayi', def, min: 0, max: 20, step: 1 }),
};

export const KATEGORILER = ['Hedefler', 'Tahtalar ve Engeller', 'Atış Alanı', 'Diğer'];

export const CATALOG = {
  hedef: {
    ad: 'Silüet Hedef', kat: 'Hedefler', rol: 'hedef', ikon: 'hedef',
    params: [P.yuk(0.85), P.atim(2)],
    build: (p) => { const g = new THREE.Group(); paperTarget(g, 0.6, 0.9, p.yuk, M.paper); return g; },
    top: (p) => p.yuk + 0.9,
  },
  mini: {
    ad: 'Mini Silüet', kat: 'Hedefler', rol: 'hedef',
    params: [P.yuk(1.0), P.atim(2)],
    build: (p) => { const g = new THREE.Group(); paperTarget(g, 0.34, 0.5, p.yuk, M.paper); return g; },
    top: (p) => p.yuk + 0.5,
  },
  dost: {
    ad: 'Dost / Sivil Hedef', kat: 'Hedefler', rol: 'dost',
    params: [P.yuk(0.85)],
    build: (p) => { const g = new THREE.Group(); paperTarget(g, 0.6, 0.9, p.yuk, M.paperDost); return g; },
    top: (p) => p.yuk + 0.9,
  },
  popper: {
    ad: 'Çelik Popper', kat: 'Hedefler', rol: 'celik',
    params: [P.atim(1)],
    build: () => popper(1), top: () => 0.95,
  },
  mini_popper: {
    ad: 'Mini Popper', kat: 'Hedefler', rol: 'celik',
    params: [P.atim(1)],
    build: () => popper(0.62), top: () => 0.62,
  },
  plaka: {
    ad: 'Yuvarlak Çelik Plaka', kat: 'Hedefler', rol: 'celik',
    params: [P.atim(1)],
    build: () => plateOnPost(false), top: () => 1.3,
  },
  kare_plaka: {
    ad: 'Kare Çelik Plaka', kat: 'Hedefler', rol: 'celik',
    params: [P.atim(1)],
    build: () => plateOnPost(true), top: () => 1.28,
  },
  plaka_rafi: {
    ad: 'Plaka Rafı (6\'lı)', kat: 'Hedefler', rol: 'celik',
    params: [P.atim(6)],
    build: () => {
      const g = new THREE.Group();
      g.add(box(2.1, 0.06, 0.06, M.steelDark, 0, 1.05, -0.05));
      for (const x of [-1.0, 1.0]) {
        const l1 = box(0.05, 1.12, 0.05, M.steelDark, x, 0.53, 0.12);
        l1.rotation.x = 0.22;
        const l2 = box(0.05, 1.12, 0.05, M.steelDark, x, 0.53, -0.22);
        l2.rotation.x = -0.22;
        g.add(l1, l2);
      }
      for (let i = 0; i < 6; i++) {
        const x = -0.8 + i * 0.32;
        g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 28).rotateX(Math.PI / 2), M.steel, x, 0.88, 0.0));
        g.add(box(0.02, 0.12, 0.02, M.steelDark, x, 1.0, -0.02));
      }
      return g;
    },
    top: () => 1.15,
  },

  duvar: {
    ad: 'Tahta Paravan', kat: 'Tahtalar ve Engeller', uzun: true,
    params: [P.w(2.4), P.h(1.8)],
    build: (p) => wall(p.w, p.h, []), top: (p) => p.h + 0.1,
  },
  pencere: {
    ad: 'Pencereli Paravan', kat: 'Tahtalar ve Engeller', uzun: true,
    params: [P.w(2.4), P.h(1.9),
      { k: 'pw', ad: 'Pencere genişliği (m)', tip: 'sayi', def: 0.6, min: 0.2, max: 3, step: 0.05 },
      { k: 'ph', ad: 'Pencere yüksekliği (m)', tip: 'sayi', def: 0.5, min: 0.2, max: 2, step: 0.05 },
      { k: 'py', ad: 'Pencere alt kenarı (m)', tip: 'sayi', def: 1.0, min: 0.1, max: 2.5, step: 0.05 }],
    build: (p) => {
      const pw = Math.min(p.pw, p.w - 0.2), ph = Math.min(p.ph, p.h - 0.2);
      const py = Math.min(p.py, p.h - ph - 0.05);
      return wall(p.w, p.h, [[-pw / 2, py, pw / 2, py + ph]]);
    },
    top: (p) => p.h + 0.1,
  },
  kapi: {
    ad: 'Kapı', kat: 'Tahtalar ve Engeller', uzun: true,
    params: [P.w(0.9, 0.6, 2), P.h(2.0, 1.5, 3), { k: 'aci', ad: 'Açıklık açısı (°)', tip: 'sayi', def: 70, min: 0, max: 120, step: 5 }],
    build: (p) => {
      const g = new THREE.Group();
      for (const x of [-p.w / 2 - 0.04, p.w / 2 + 0.04]) {
        g.add(woodBox(0.07, p.h + 0.05, 0.07, M.wood, x, (p.h + 0.05) / 2, 0));
        g.add(woodBox(0.07, 0.05, 0.7, M.wood, x, 0.025, 0));
      }
      g.add(woodBox(p.w + 0.15, 0.07, 0.07, M.wood, 0, p.h + 0.05, 0));
      const hinge = new THREE.Group();
      hinge.position.set(-p.w / 2, 0, 0);
      const leaf = mesh(panelGeo(p.w - 0.03, p.h - 0.06, [], 0.025), M.osb, (p.w - 0.03) / 2, 0.04, 0);
      hinge.add(leaf);
      hinge.rotation.y = (p.aci * Math.PI) / 180;
      g.add(hinge);
      return g;
    },
    top: (p) => p.h + 0.15,
  },
  barikat: {
    ad: 'Alçak Barikat', kat: 'Tahtalar ve Engeller', uzun: true,
    params: [P.w(1.2), P.h(1.0, 0.3, 2)],
    build: (p) => wall(p.w, p.h, []), top: (p) => p.h + 0.1,
  },
  kum: {
    ad: 'Kum Torbası Siperi', kat: 'Tahtalar ve Engeller', uzun: true,
    params: [P.w(1.5, 0.5, 8), { k: 'kat', ad: 'Sıra sayısı', tip: 'sayi', def: 4, min: 1, max: 8, step: 1 }],
    build: (p) => {
      const g = new THREE.Group();
      const geo = new RoundedBoxGeometry(0.52, 0.16, 0.32, 2, 0.06);
      const n = Math.max(1, Math.round(p.w / 0.5));
      for (let row = 0; row < p.kat; row++) {
        const off = row % 2 ? 0.25 : 0;
        const cnt = row % 2 ? n - 1 : n;
        for (let i = 0; i < cnt; i++) {
          const m = mesh(geo, (i + row) % 2 ? M.sandA : M.sandB, -((n - 1) * 0.5) / 2 + off + i * 0.5, 0.08 + row * 0.15, 0);
          m.rotation.y = ((i * 7 + row * 3) % 5 - 2) * 0.02;
          m.userData.sharedGeo = true;
          g.add(m);
        }
      }
      return g;
    },
    top: (p) => p.kat * 0.15 + 0.15,
  },
  varil: {
    ad: 'Varil', kat: 'Tahtalar ve Engeller',
    params: [],
    build: () => {
      const mdl = modelClone('barrel', { height: 0.88 });
      if (mdl) { const g = new THREE.Group(); g.add(mdl); return g; }
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 28), M.barrel, 0, 0.44, 0));
      for (const y of [0.29, 0.59]) g.add(mesh(new THREE.TorusGeometry(0.292, 0.012, 6, 32).rotateX(Math.PI / 2), M.barrelDark, 0, y, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.01, 28), M.barrelDark, 0, 0.885, 0));
      return g;
    },
    top: () => 1.0,
  },
  palet: {
    ad: 'Ahşap Palet', kat: 'Tahtalar ve Engeller',
    params: [{ k: 'adet', ad: 'İstif adedi', tip: 'sayi', def: 1, min: 1, max: 8, step: 1 }],
    build: (p) => {
      const g = new THREE.Group();
      for (let s = 0; s < p.adet; s++) {
        const y0 = s * 0.145;
        for (const z of [-0.35, 0, 0.35]) g.add(woodBox(1.2, 0.1, 0.1, M.woodLight, 0, y0 + 0.05, z));
        for (let i = 0; i < 7; i++) g.add(woodBox(0.1, 0.022, 0.8, M.woodLight, -0.55 + i * (1.1 / 6), y0 + 0.111, 0));
      }
      return g;
    },
    top: (p) => p.adet * 0.145 + 0.1,
  },
  lastik: {
    ad: 'Lastik', kat: 'Tahtalar ve Engeller',
    params: [{ k: 'adet', ad: 'İstif adedi', tip: 'sayi', def: 2, min: 1, max: 6, step: 1 }],
    build: (p) => {
      if (A.models.tyre) {
        const g = new THREE.Group();
        for (let i = 0; i < p.adet; i++) {
          const t = tyreFlat();
          t.position.set((i % 2) * 0.03, i * (t.userData.h - 0.01), 0);
          t.rotation.y = i * 0.7;
          g.add(t);
        }
        return g;
      }
      const g = new THREE.Group();
      const geo = new THREE.TorusGeometry(0.27, 0.11, 12, 28).rotateX(Math.PI / 2);
      for (let i = 0; i < p.adet; i++) {
        const m = mesh(geo, M.rubber, (i % 2) * 0.03, 0.11 + i * 0.21, 0);
        m.userData.sharedGeo = true;
        g.add(m);
      }
      return g;
    },
    top: (p) => p.adet * 0.21 + 0.1,
  },
  masa: {
    ad: 'Masa', kat: 'Tahtalar ve Engeller',
    params: [P.w(1.2, 0.6, 3)],
    build: (p) => {
      const mdl = modelClone('table');
      if (mdl) {
        const b = new THREE.Box3().setFromObject(mdl), s = b.getSize(new THREE.Vector3());
        const k = p.w / Math.max(s.x, s.z);
        mdl.scale.set(k, 0.75 / s.y, k);
        if (s.z > s.x) mdl.rotation.y = Math.PI / 2;
        const g = new THREE.Group(); g.add(mdl); return g;
      }
      const g = new THREE.Group();
      g.add(woodBox(p.w, 0.05, 0.6, M.woodLight, 0, 0.75, 0));
      for (const x of [-p.w / 2 + 0.06, p.w / 2 - 0.06]) for (const z of [-0.24, 0.24]) g.add(woodBox(0.05, 0.73, 0.05, M.wood, x, 0.365, z));
      return g;
    },
    top: () => 0.9,
  },

  sandik: {
    ad: 'Askeri Sandık', kat: 'Tahtalar ve Engeller',
    params: [{ k: 'adet', ad: 'İstif adedi', tip: 'sayi', def: 1, min: 1, max: 4, step: 1 }],
    build: (p) => {
      const g = new THREE.Group();
      let y = 0;
      for (let i = 0; i < p.adet; i++) {
        const m = modelClone('crate') || (() => { const x = new THREE.Group(); x.add(box(0.9, 0.45, 0.5, M.wood, 0, 0.225, 0)); return x; })();
        const h = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()).y;
        m.position.y = y;
        m.rotation.y = (i % 2) * 0.12;
        y += h;
        g.add(m);
      }
      g.userData.h = y;
      return g;
    },
    top: (p) => 0.45 * p.adet + 0.15,
  },
  muhimmat: {
    ad: 'Mühimmat Kutusu', kat: 'Tahtalar ve Engeller',
    params: [],
    build: () => {
      const m = modelClone('ammo');
      const g = new THREE.Group();
      g.add(m || box(0.3, 0.18, 0.15, M.uniform, 0, 0.09, 0));
      return g;
    },
    top: () => 0.4,
  },
  kaide: {
    ad: 'Atış Kaidesi', kat: 'Atış Alanı', rol: 'nokta',
    params: [],
    build: () => {
      const g = new THREE.Group();
      groundPaint(g, 1.2, 1.2, M.white, 0.06);
      g.add(woodBox(0.12, 1.0, 0.12, M.wood, 0, 0.5, 0.35));
      const tray = woodBox(0.55, 0.04, 0.32, M.woodLight, 0, 1.02, 0.3);
      tray.rotation.x = -0.25;
      g.add(tray);
      g.add(woodBox(0.5, 0.06, 0.08, M.wood, 0, 0.03, 0.35));
      g.add(woodBox(0.08, 0.06, 0.45, M.wood, 0, 0.03, 0.35));
      return g;
    },
    top: () => 1.35,
  },
  kutu: {
    ad: 'Atış Kutusu', kat: 'Atış Alanı', rol: 'nokta',
    params: [P.w(1.0, 0.3, 10), P.d(1.0)],
    build: (p) => { const g = new THREE.Group(); groundPaint(g, p.w, p.d, M.white, 0.06); return g; },
    top: () => 0.5,
  },
  baslangic: {
    ad: 'Başlangıç Noktası', kat: 'Atış Alanı', rol: 'nokta',
    params: [],
    build: () => {
      const g = new THREE.Group();
      const ring = mesh(new THREE.RingGeometry(0.34, 0.42, 40).rotateX(-Math.PI / 2), M.yellow, 0, 0.032, 0, false);
      g.add(ring);
      const tri = new THREE.Shape();
      tri.moveTo(0, -0.26);
      tri.lineTo(0.18, 0.1);
      tri.lineTo(-0.18, 0.1);
      tri.closePath();
      g.add(mesh(new THREE.ShapeGeometry(tri).rotateX(Math.PI / 2), M.yellow, 0, 0.034, 0, false));
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 8), M.whiteSolid, 0.48, 0.6, 0.0));
      const fl = mesh(new THREE.PlaneGeometry(0.28, 0.18), M.orange, 0.62, 1.1, 0.0);
      fl.material = M.orange;
      g.add(fl);
      return g;
    },
    top: () => 1.4,
  },
  hata: {
    ad: 'Hata Çizgisi', kat: 'Atış Alanı', uzun: true,
    params: [P.w(3, 0.5, 30)],
    build: (p) => { const g = new THREE.Group(); g.add(box(p.w, 0.06, 0.08, M.red, 0, 0.03, 0)); return g; },
    top: () => 0.4,
  },
  ok: {
    ad: 'Yön Oku', kat: 'Atış Alanı',
    params: [{ k: 'boy', ad: 'Ok boyu (m)', tip: 'sayi', def: 1.5, min: 0.5, max: 6, step: 0.1 }],
    build: (p) => {
      const L = p.boy, s = new THREE.Shape();
      const hw = 0.09 * Math.max(1, L / 1.5), hh = 0.25 * Math.max(1, L / 1.5);
      s.moveTo(-hw, L / 2);
      s.lineTo(hw, L / 2);
      s.lineTo(hw, -L / 2 + hh);
      s.lineTo(hw * 2.6, -L / 2 + hh);
      s.lineTo(0, -L / 2);
      s.lineTo(-hw * 2.6, -L / 2 + hh);
      s.lineTo(-hw, -L / 2 + hh);
      s.closePath();
      const g = new THREE.Group();
      g.add(mesh(new THREE.ShapeGeometry(s).rotateX(Math.PI / 2), M.yellow, 0, 0.033, 0, false));
      return g;
    },
    top: () => 0.4,
  },
  koni: {
    ad: 'Trafik Konisi', kat: 'Atış Alanı',
    params: [],
    build: () => {
      const g = new THREE.Group();
      g.add(box(0.34, 0.025, 0.34, M.rubber, 0, 0.0125, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.14, 0.52, 24), M.orange, 0, 0.285, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.072, 0.092, 0.09, 24), M.whiteSolid, 0, 0.33, 0));
      return g;
    },
    top: () => 0.7,
  },
  direk: {
    ad: 'İşaret Direği', kat: 'Atış Alanı',
    params: [P.h(2.5, 1, 6)],
    build: (p) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, p.h, 10), M.whiteSolid, 0, p.h / 2, 0));
      const f = mesh(new THREE.PlaneGeometry(0.6, 0.4), M.flag, 0.31, p.h - 0.22, 0);
      g.add(f);
      return g;
    },
    top: (p) => p.h + 0.2,
  },

  yazi: {
    ad: 'Yazı / Not Etiketi', kat: 'Diğer',
    params: [
      { k: 'metin', ad: 'Metin', tip: 'metin', def: 'Not' },
      { k: 'yuk', ad: 'Yükseklik (m)', tip: 'sayi', def: 1.5, min: 0, max: 6, step: 0.1 },
    ],
    build: (p) => {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, p.yuk, 6), M.whiteSolid, 0, p.yuk / 2, 0, false));
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 16), M.yellow, 0, 0.03, 0, false));
      const l = makeLabel(p.metin || ' ', { px: 20, border: '#f2c230' });
      l.position.y = p.yuk;
      g.add(l);
      return g;
    },
    top: (p) => p.yuk,
    noLabel: true,
  },
  asker: {
    ad: 'Atıcı (Asker)', kat: 'Diğer',
    params: [
      { k: 'poz', ad: 'Pozisyon', tip: 'secim', def: 'ayakta', ops: [['ayakta', 'Ayakta'], ['diz', 'Diz çökmüş'], ['yuzustu', 'Yüzüstü']] },
      { k: 'silah', ad: 'Silah', tip: 'secim', def: 'tufek', ops: [['tufek', 'Tüfek'], ['tabanca', 'Tabanca']] },
    ],
    build: (p) => buildSoldier(p.poz, p.silah) || soldier(p.poz),
    top: (p) => (p.poz === 'ayakta' ? 1.85 : p.poz === 'diz' ? 1.45 : 0.5),
  },
};

function tyreFlat() {
  const m = modelClone('tyre');
  const b = new THREE.Box3().setFromObject(m), s = b.getSize(new THREE.Vector3());
  // lastik dik duruyorsa yatır
  if (s.y > Math.min(s.x, s.z) * 1.2) {
    const inner = m.children[0];
    if (s.x < s.z) inner.parent.rotation.z = Math.PI / 2; else inner.parent.rotation.x = Math.PI / 2;
    const w = new THREE.Group();
    w.add(m);
    const b2 = new THREE.Box3().setFromObject(w), c = b2.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -b2.min.y, -c.z);
    w.userData.h = b2.getSize(new THREE.Vector3()).y;
    return w;
  }
  m.userData.h = s.y;
  return m;
}

function wall(w, h, holes) {
  const g = new THREE.Group();
  const panel = mesh(panelGeo(w, h, holes), M.osb, 0, 0.06, 0);
  g.add(panel);
  for (const x of [-w / 2 - 0.035, w / 2 + 0.035]) {
    g.add(woodBox(0.07, h + 0.08, 0.07, M.wood, x, (h + 0.08) / 2, 0));
    g.add(woodBox(0.07, 0.06, 0.8, M.wood, x, 0.03, 0));
  }
  g.add(woodBox(w, 0.05, 0.05, M.wood, 0, 0.06 + h * 0.5, -0.035));
  for (const [x0, y0, x1, y1] of holes) {
    const yb = 0.06 + y0, yt = 0.06 + y1;
    g.add(woodBox(x1 - x0 + 0.08, 0.04, 0.05, M.woodLight, (x0 + x1) / 2, yb - 0.02, 0.02));
    g.add(woodBox(x1 - x0 + 0.08, 0.04, 0.05, M.woodLight, (x0 + x1) / 2, yt + 0.02, 0.02));
  }
  return g;
}

export function defaultParams(type) {
  const p = {};
  for (const d of CATALOG[type].params) p[d.k] = d.def;
  return p;
}

/** Bir öğeyi 3D nesneye dönüştür. */
export function buildItem(it) {
  const C = CATALOG[it.type];
  const p = { ...defaultParams(it.type), ...(it.p || {}) };
  const root = new THREE.Group();
  const body = C.build(p);
  body.name = 'body';
  root.add(body);
  root.position.set(it.x, 0, it.z);
  root.rotation.y = it.rot || 0;
  root.userData.itemId = it.id;
  root.userData.top = C.top ? C.top(p) : 1;
  return root;
}

export const isTarget = (t) => ['hedef', 'celik'].includes(CATALOG[t]?.rol);
export const isPoint = (t) => CATALOG[t]?.rol === 'nokta';
