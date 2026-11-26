import * as THREE from 'three';
import { perlin, fbm, rng, clamp } from './util.js';

function cnv(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, { srgb = true, aniso = 8, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Döşenebilir fbm ile renk tabanı doldur. */
function noiseFill(ctx, N, seed, scale, colA, colB, oct = 5, contrast = 1) {
  const n = perlin(seed);
  const img = ctx.createImageData(N, N);
  const d = img.data;
  const per = scale;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = fbm(n, (x / N) * scale, (y / N) * scale, oct, per) * contrast + 0.5;
      v = clamp(v, 0, 1);
      const i = (y * N + x) * 4;
      d[i] = colA[0] + (colB[0] - colA[0]) * v;
      d[i + 1] = colA[1] + (colB[1] - colA[1]) * v;
      d[i + 2] = colA[2] + (colB[2] - colA[2]) * v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Kenarlardan sarmalanarak çizim (döşenebilirlik için). */
function wrapDraw(N, x, y, r, fn) {
  fn(x, y);
  const xs = [x];
  const ys = [y];
  if (x < r) xs.push(x + N);
  if (x > N - r) xs.push(x - N);
  if (y < r) ys.push(y + N);
  if (y > N - r) ys.push(y - N);
  for (const a of xs) for (const b of ys) if (a !== x || b !== y) fn(a, b);
}

export function makeGravel(aniso) {
  const N = 1024;
  const c = cnv(N), g = c.getContext('2d');
  const h = cnv(N), hg = h.getContext('2d');
  noiseFill(g, N, 11, 8, [96, 98, 100], [150, 150, 148], 4, 1.2);
  hg.fillStyle = '#202020';
  hg.fillRect(0, 0, N, N);
  const r = rng(7);
  for (let i = 0; i < 26000; i++) {
    const x = r() * N, y = r() * N;
    const rad = 1.6 + Math.pow(r(), 2.2) * 7;
    const rx = rad * (0.7 + r() * 0.6), ry = rad * (0.55 + r() * 0.45), rot = r() * Math.PI;
    const base = 88 + r() * 105;
    const tint = (r() - 0.5) * 14;
    const col = `rgb(${base + tint | 0},${base | 0},${base - tint * 0.6 | 0})`;
    const hi = `rgba(255,255,255,${0.12 + r() * 0.18})`;
    const hv = 120 + r() * 135 | 0;
    wrapDraw(N, x, y, rad * 2, (px, py) => {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(px + rad * 0.35, py + rad * 0.45, rx, ry, rot, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hi;
      g.beginPath();
      g.ellipse(px - rx * 0.25, py - ry * 0.3, rx * 0.45, ry * 0.4, rot, 0, Math.PI * 2);
      g.fill();
      hg.fillStyle = `rgb(${hv},${hv},${hv})`;
      hg.beginPath();
      hg.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
      hg.fill();
    });
  }
  return { map: tex(c, { aniso }), bump: tex(h, { aniso, srgb: false }) };
}

export function makeDirt(aniso, seed = 3, dark = false) {
  const N = 1024;
  const c = cnv(N), g = c.getContext('2d');
  const A = dark ? [118, 98, 74] : [150, 128, 98];
  const B = dark ? [176, 152, 118] : [205, 184, 150];
  noiseFill(g, N, seed, 6, A, B, 6, 1.4);
  const r = rng(seed * 13);
  for (let i = 0; i < 9000; i++) {
    const x = r() * N, y = r() * N, rad = 0.8 + Math.pow(r(), 3) * 5;
    const v = 70 + r() * 120;
    g.fillStyle = `rgba(${v + 20 | 0},${v + 8 | 0},${v - 10 | 0},${0.35 + r() * 0.5})`;
    wrapDraw(N, x, y, rad, (px, py) => {
      g.beginPath();
      g.arc(px, py, rad, 0, Math.PI * 2);
      g.fill();
    });
  }
  return tex(c, { aniso });
}

export function makeOSB(aniso) {
  const N = 512;
  const c = cnv(N), g = c.getContext('2d');
  g.fillStyle = '#c9a46a';
  g.fillRect(0, 0, N, N);
  const r = rng(21);
  for (let i = 0; i < 2600; i++) {
    const x = r() * N, y = r() * N;
    const w = 8 + r() * 26, hh = 3 + r() * 7, rot = (r() - 0.5) * 1.2 + (r() < 0.5 ? 0 : Math.PI / 2);
    const l = 150 + r() * 70;
    g.fillStyle = `rgba(${l + 25 | 0},${l - 5 | 0},${l - 60 | 0},${0.55 + r() * 0.4})`;
    wrapDraw(N, x, y, w, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(rot);
      g.fillRect(-w / 2, -hh / 2, w, hh);
      g.restore();
    });
  }
  return tex(c, { aniso });
}

export function makeWood(aniso, light = false) {
  const N = 512;
  const c = cnv(N), g = c.getContext('2d');
  const n = perlin(31);
  const img = g.createImageData(N, N);
  const d = img.data;
  const base = light ? [176, 136, 88] : [120, 84, 52];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const w = fbm(n, (x / N) * 2, (y / N) * 24, 4, 2);
      const ring = Math.sin((y / N) * 90 + w * 9) * 0.5 + 0.5;
      const v = 0.75 + ring * 0.25 + fbm(n, (x / N) * 16, (y / N) * 16, 3, 16) * 0.2;
      const i = (y * N + x) * 4;
      d[i] = base[0] * v;
      d[i + 1] = base[1] * v;
      d[i + 2] = base[2] * v;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { aniso });
}

export function makeRoof(aniso) {
  const N = 256;
  const c = cnv(N), g = c.getContext('2d');
  for (let x = 0; x < N; x++) {
    const v = 0.55 + Math.sin((x / N) * Math.PI * 2 * 8) * 0.25;
    g.fillStyle = `rgb(${40 * v + 18 | 0},${52 * v + 22 | 0},${70 * v + 28 | 0})`;
    g.fillRect(x, 0, 1, N);
  }
  return tex(c, { aniso });
}

/** Bust silüeti yolu (0..1 normalize koordinatlar, kağıt hedef için) */
function silhouettePath(g, W, H, ox = 0, oy = 0) {
  const P = (x, y) => [ox + x * W, oy + y * H];
  g.beginPath();
  g.moveTo(...P(0.5, 0.06));
  g.bezierCurveTo(...P(0.64, 0.06), ...P(0.67, 0.18), ...P(0.64, 0.27));
  g.bezierCurveTo(...P(0.63, 0.31), ...P(0.6, 0.34), ...P(0.58, 0.36));
  g.lineTo(...P(0.6, 0.4));
  g.bezierCurveTo(...P(0.78, 0.43), ...P(0.9, 0.48), ...P(0.93, 0.6));
  g.lineTo(...P(0.97, 0.98));
  g.lineTo(...P(0.03, 0.98));
  g.lineTo(...P(0.07, 0.6));
  g.bezierCurveTo(...P(0.1, 0.48), ...P(0.22, 0.43), ...P(0.4, 0.4));
  g.lineTo(...P(0.42, 0.36));
  g.bezierCurveTo(...P(0.4, 0.34), ...P(0.37, 0.31), ...P(0.36, 0.27));
  g.bezierCurveTo(...P(0.33, 0.18), ...P(0.36, 0.06), ...P(0.5, 0.06));
  g.closePath();
}

export function makeTargetTexture(kind = 'normal') {
  const W = 512, H = 768;
  const c = cnv(W, H), g = c.getContext('2d');
  // kağıt
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#fbfaf6');
  grd.addColorStop(1, '#ecebe4');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  const r = rng(kind.length * 17);
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.035})`;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
  }
  const m = 40;
  if (kind === 'dost') {
    silhouettePath(g, W - m * 2, H - m * 2 - 30, m, m + 30);
    g.fillStyle = '#e8f1ea';
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#1f8a4c';
    g.stroke();
    g.lineWidth = 18;
    g.strokeStyle = '#1f8a4c';
    g.strokeRect(9, 9, W - 18, H - 18);
    g.fillStyle = '#1f8a4c';
    g.font = 'bold 72px Rajdhani, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('DOST', W / 2, H * 0.72);
  } else {
    silhouettePath(g, W - m * 2, H - m * 2 - 30, m, m + 30);
    g.fillStyle = '#1b2230';
    g.fill();
    // puan bölgeleri
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 3;
    const cx = W / 2, cy = H * 0.62;
    for (const [rx, ry] of [[70, 90], [130, 165], [190, 240]]) {
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(W / 2, H * 0.24, 36, 44, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = 'bold 34px Rajdhani, Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('10', cx, cy + 12);
    g.fillText('8', cx, cy - 115);
    g.fillText('6', cx, cy - 195);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function makeSignTexture(lines) {
  const W = 512, H = 384;
  const c = cnv(W, H), g = c.getContext('2d');
  g.fillStyle = '#2e4a2e';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e8e2c8';
  g.lineWidth = 8;
  g.strokeRect(14, 14, W - 28, H - 28);
  g.fillStyle = '#f2ecd2';
  g.textAlign = 'center';
  g.font = 'bold 58px Rajdhani, Arial, sans-serif';
  g.fillText(lines[0], W / 2, 90);
  g.font = '600 30px Rajdhani, Arial, sans-serif';
  lines.slice(1).forEach((l, i) => g.fillText(l, W / 2, 150 + i * 42));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Yükseklik alanından teğet uzayı normal haritası (döşenebilir, Sobel) */
function heightToNormal(H, N, strength) {
  const c = cnv(N), g = c.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  const at = (x, y) => H[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * N + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Jüt çuval bezi (kum torbası): açık örgülü, düzensiz kalınlıkta lifler, ipliklerin
 * altından görünen koyu boşluklar, toz ve toprak lekeleri. Renk + normal + pürüzlülük.
 */
export function makeBurlap(aniso = 8) {
  const N = 512, T = 40; // T: döşemedeki iplik sayısı (her yön)
  const cell = N / T;
  const n1 = perlin(301), n2 = perlin(302), n3 = perlin(303);
  const r = rng(304);
  // iplik başına kalınlık / ton / kayma değişimi (doğal jüt düzensizliği)
  const warp = Array.from({ length: T }, () => ({ w: 0.74 + r() * 0.16, t: 0.82 + r() * 0.3, o: (r() - 0.5) * 0.18 }));
  const weft = Array.from({ length: T }, () => ({ w: 0.72 + r() * 0.18, t: 0.82 + r() * 0.3, o: (r() - 0.5) * 0.18 }));
  const H = new Float32Array(N * N);
  const c = cnv(N), g = c.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  const rc = cnv(N), rg = rc.getContext('2d');
  const rimg = rg.createImageData(N, N), rd = rimg.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // ipliklerin hafif dalgalı gidişi
      const wx = x + fbm(n1, (x / N) * 6, (y / N) * 6, 2, 6) * cell * 0.5;
      const wy = y + fbm(n2, (x / N) * 6, (y / N) * 6, 2, 6) * cell * 0.5;
      const ci = Math.floor(wx / cell), cj = Math.floor(wy / cell);
      const fi = wx / cell - ci, fj = wy / cell - cj;
      const a = warp[((ci % T) + T) % T], b = weft[((cj % T) + T) % T];
      // iplik kesit profili (yuvarlak), kalınlık değişken
      const pa = Math.max(0, 1 - Math.pow(Math.abs(fi - 0.5 - a.o) / (a.w * 0.5), 2));
      const pb = Math.max(0, 1 - Math.pow(Math.abs(fj - 0.5 - b.o) / (b.w * 0.5), 2));
      // üst-alt örgü: hücreye göre hangi iplik üstte; üstteki iplik ortada kabarık
      const over = ((ci + cj) & 1) === 0;
      const bulgeA = 0.55 + 0.45 * Math.sin(Math.PI * fj);
      const bulgeB = 0.55 + 0.45 * Math.sin(Math.PI * fi);
      const ha = Math.sqrt(pa) * (over ? bulgeA : 0.55);
      const hb = Math.sqrt(pb) * (over ? 0.55 : bulgeB);
      // lif dokusu: iplik yönünde uzamış ince gürültü (bükülmüş lif)
      const fibA = n3((x / N) * 6, (y / N) * 160, 160) * 0.5 + n3((x / N) * 3, (y / N) * 90 + 7, 90) * 0.3;
      const fibB = n3((x / N) * 160, (y / N) * 6 + 13, 160) * 0.5 + n3((x / N) * 90 + 3, (y / N) * 3, 90) * 0.3;
      let h, tone, fib;
      if (ha >= hb) { h = ha; tone = a.t; fib = fibA; } else { h = hb; tone = b.t; fib = fibB; }
      const gap = Math.max(ha, hb) < 0.05; // örgü boşluğu
      h = gap ? 0 : h * (0.9 + fib * 0.25);
      H[y * N + x] = h;
      // renk: jüt (sıcak bej-kahve), boşluklar koyu, leke ve toz
      const stain = fbm(n1, (x / N) * 3 + 11, (y / N) * 3 + 5, 4, 3);
      const dust = fbm(n2, (x / N) * 9 + 2, (y / N) * 9, 3, 9);
      // iplik başına ton farkı çok küçük tutulur; büyük olursa uzaktan "kareli kumaş" gibi görünür
      let k = gap ? 0.66 : (0.8 + 0.2 * h) * (0.97 + (tone - 0.97) * 0.12) * (1 + fib * 0.2);
      k *= 1 - Math.max(0, stain) * 0.5;
      const R = 146 * k + dust * 16, G = 129 * k + dust * 14, B = 97 * k + dust * 10;
      const i = (y * N + x) * 4;
      d[i] = clamp(R, 0, 255); d[i + 1] = clamp(G, 0, 255); d[i + 2] = clamp(B, 0, 255); d[i + 3] = 255;
      const ro = clamp((gap ? 1 : 0.86 + (1 - h) * 0.1 - fib * 0.05) * 255, 0, 255);
      rd[i] = ro; rd[i + 1] = ro; rd[i + 2] = ro; rd[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  // dışarı fırlamış tüyler (jütün tüylü görünümü)
  g.lineWidth = 0.7;
  for (let i = 0; i < 1400; i++) {
    const x = r() * N, y = r() * N, L = 3 + r() * 9, a = r() * Math.PI * 2;
    const v = 150 + r() * 60;
    g.strokeStyle = `rgba(${v | 0},${(v * 0.85) | 0},${(v * 0.6) | 0},${0.25 + r() * 0.35})`;
    wrapDraw(N, x, y, L, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.quadraticCurveTo(px + Math.cos(a + 0.6) * L * 0.5, py + Math.sin(a + 0.6) * L * 0.5, px + Math.cos(a) * L, py + Math.sin(a) * L);
      g.stroke();
    });
  }
  const nc = heightToNormal(H, N, 2.6);
  return {
    map: tex(c, { aniso }),
    normalMap: tex(nc, { aniso, srgb: false }),
    roughnessMap: tex(rc, { aniso, srgb: false }),
  };
}

let cache = null;
export function getTextures(renderer) {
  if (cache) return cache;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const gravel = makeGravel(aniso);
  cache = {
    gravel: gravel.map,
    gravelBump: gravel.bump,
    dirt: makeDirt(aniso, 3, false),
    dirtDark: makeDirt(aniso, 5, true),
    osb: makeOSB(aniso),
    wood: makeWood(aniso, false),
    woodLight: makeWood(aniso, true),
    roof: makeRoof(aniso),
    target: makeTargetTexture('normal'),
    targetDost: makeTargetTexture('dost'),
    burlap: makeBurlap(aniso),
  };
  return cache;
}
