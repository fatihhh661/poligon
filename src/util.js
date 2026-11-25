export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const DEG = Math.PI / 180;

export const fmtM = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',') + ' m';
export const fmtN = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace('.', ',');

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D Perlin gürültüsü. per verilirse o periyotta döşenebilir (tileable). */
export function perlin(seed = 1) {
  const r = rng(seed);
  const a = [];
  for (let i = 0; i < 256; i++) a[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, per = 256) => {
    let X = Math.floor(x), Y = Math.floor(y);
    x -= X; y -= Y;
    const X0 = ((X % per) + per) % per, Y0 = ((Y % per) + per) % per;
    const X1 = (X0 + 1) % per, Y1 = (Y0 + 1) % per;
    const u = fade(x), v = fade(y);
    const aa = p[p[X0] + Y0], ab = p[p[X0] + Y1], ba = p[p[X1] + Y0], bb = p[p[X1] + Y1];
    return lerp(lerp(grad(aa, x, y), grad(ba, x - 1, y), u), lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u), v) * 0.75;
  };
}

export function fbm(noise, x, y, oct = 4, per = 256) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += noise(x * f, y * f, per * f) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return s;
}

let _id = Date.now() % 1e8;
export const uid = () => 'o' + (_id++).toString(36);
