import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

/**
 * Karakter görünüm sistemi (yalnızca asker modeli; sahnedeki başka hiçbir malzemeye dokunmaz).
 *
 *  - Orijinal 4K kaynaktan normal haritaları (gerçek dokuma/dikiş ayrıntısı), 2K renk ve ORM
 *    (R: pişirilmiş ortam gölgesi, G: pürüzlülük, B: metal maskesi), GPU sıkıştırmalı KTX2 (BC7).
 *  - Her yüzey için fiziksel değerler: albedo kalibrasyonu, pürüzlülük, kumaş parlaması (sheen),
 *    yalnızca tokalarda metal.
 *  - Karaktere özel shader eklentileri: mikro-normal (malzeme yapısı, mesafeyle sönümlenir),
 *    mikro-pürüzlülük, mikro-gölge (AO'nun doğrudan ışığa etkisi).
 *
 * Geliştirici geçişi: localStorage 'pp.karakterFX' = '0' eski görünüm (yeniden yükleyince).
 */
export const CHAR_FX = (() => { try { return localStorage.getItem('pp.karakterFX') !== '0'; } catch { return true; } })();

const HD = {};
// RTX/BC7 destekli kartta dönüştürme birkaç saniye; GPU'suz test ortamında çok uzun sürebilir
const LOAD_TIMEOUT = (() => { try { return +localStorage.getItem('pp.karakterFXSure') || 60000; } catch { return 60000; } })(); // malzeme kökü -> { map, normalMap, orm }
let maxAniso = 8;

/** Yüzey tanımları (malzeme adına göre). albedo: doğrusal çarpan, hedef değerler yorumda. */
const SURFACES = [
  // üniforma (pamuk-polyester ripstop, zeytin yeşili): hedef albedo ~0,06
  { re: /Kitel/, key: 'Kitel_1', albedo: 1.85, rough: 1.0, sheen: 0.5, sheenRough: 0.7, detail: 'fiber', dScale: 260, dStr: 0.12, nScale: 0.6 },
  { re: /Pants/, key: 'Pants_1', albedo: 1.7, rough: 1.0, sheen: 0.5, sheenRough: 0.7, detail: 'fiber', dScale: 260, dStr: 0.12, nScale: 0.6 },
  // yelek ve cepler (Cordura naylon): hedef ~0,055; naylonun hafif parlaması; tokalar metal
  { re: /Plate/, key: 'Plate_1', albedo: 1.15, rough: 0.95, sheen: 0.32, sheenRough: 0.55, detail: 'cordura', dScale: 150, dStr: 0.55 },
  { re: /Pouches/, key: 'Pouches_1', albedo: 1.15, rough: 0.95, sheen: 0.32, sheenRough: 0.55, detail: 'cordura', dScale: 150, dStr: 0.55, metal: true },
  // kask (boyalı polimer, kaplamalı): hedef ~0,05
  { re: /Helmet/, key: 'Helmet1', albedo: 1.65, rough: 1.0, sheen: 0.0, sheenRough: 0.5, detail: 'grain', dScale: 120, dStr: 0.2 },
  // eldiven (sentetik deri + kumaş): hedef ~0,045
  { re: /Gloves/, key: 'Gloves_1', albedo: 0.9, rough: 1.0, sheen: 0.3, sheenRough: 0.6, detail: 'leather', dScale: 90, dStr: 0.45 },
  // bot (süet/deri + kauçuk): hedef ~0,04 (eski kodda 1,75x ile beyaz görünüyordu)
  { re: /Boots/, key: 'Boots_2', albedo: 0.82, rough: 0.95, sheen: 0.22, sheenRough: 0.65, detail: 'leather', dScale: 70, dStr: 0.5 },
  // yüz maskesi (örme pamuk): hedef ~0,075
  { re: /Head/, key: 'HeadMasked', albedo: 0.85, rough: 0.9, sheen: 0.6, sheenRough: 0.8, detail: 'knit', dScale: 110, dStr: 0.5, noOrm: true },
  { re: /Eye/, key: 'Eye', albedo: 1.0, rough: 0.6, sheen: 0, sheenRough: 0.5, noOrm: true, noNormal: true },
];

/** Karakter dokularını yükle (KTX2). Başarısızsa false: eski malzemeler kullanılır. */
export async function loadCharacterTextures(renderer) {
  if (!CHAR_FX) return false;
  maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const loader = new KTX2Loader().setTranscoderPath('assets/basis/').detectSupport(renderer);
  const load = (url, srgb) => loader.loadAsync(url).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  });
  try {
    // güvenlik: çözücü çalışmazsa (eski sürücü, engelli WebAssembly) program takılmasın
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('zaman aşımı')), LOAD_TIMEOUT); });
    await Promise.race([timeout, loadAll()]);
    clearTimeout(timer);
    return true;
  } catch (e) {
    console.warn('Karakter HD dokuları yüklenemedi, eski görünüm kullanılıyor:', e);
    for (const k in HD) delete HD[k];
    return false;
  } finally {
    loader.dispose();
  }
  async function loadAll() {
    await Promise.all(SURFACES.map(async (s) => {
      const base = `assets/models/mark-hd/Mark_${s.key}`;
      const [map, normalMap, orm] = await Promise.all([
        load(`${base}_baseColor.ktx2`, true),
        s.noNormal ? null : load(`${base}_normal.ktx2`, false),
        s.noOrm ? null : load(`${base}_orm.ktx2`, false),
      ]);
      HD[s.key] = { map, normalMap, orm };
    }));
  }
}

export const characterHDReady = () => CHAR_FX && Object.keys(HD).length > 0;

// ---------------- mikro-yüzey dokuları (prosedürel, kenarları birleşik) ----------------
const detailCache = {};
function hash(x, y, s) { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); }
/** Kenarları birleşik değer gürültüsü (periyot p) */
function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a) => ((a % p) + p) % p;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, p, oct, s) { let f = 0, a = 0.5, q = p; for (let i = 0; i < oct; i++) { f += a * vnoise(x * (q / p), y * (q / p), q, s + i); a *= 0.5; q *= 2; } return f; }

/** Yükseklik alanı: x,y 0..1 (dokunun bir karesi) */
const HEIGHT = {
  // naylon sepet örgüsü (Cordura): 2x2 iplik demetleri, yuvarlak kesit, lif düzensizliği
  cordura: (x, y) => {
    const N = 16, u = x * N, v = y * N, cu = Math.floor(u), cv = Math.floor(v);
    const fu = u - cu, fv = v - cv;
    const warp = ((Math.floor(cu / 2) + Math.floor(cv / 2)) & 1) === 0;
    const across = warp ? fu : fv, along = warp ? fv : fu;
    const yarn = Math.pow(Math.sin(Math.PI * ((across * 2) % 1)), 0.6);
    const arch = 0.75 + 0.25 * Math.sin(Math.PI * along);
    return yarn * arch * 0.8 + 0.2 * fbm(x * 64, y * 64, 64, 2, 3);
  },
  // örme (balaclava): sıra sıra V ilmekler
  knit: (x, y) => {
    const C = 24, R = 32, u = x * C, v = y * R, fu = u - Math.floor(u), fv = v - Math.floor(v);
    const leg = Math.abs(fu - 0.5) * 2; // ilmeğin iki bacağı
    const vshape = Math.sin(Math.PI * Math.min(1, Math.abs(leg - (1 - fv)) * 3 + 0.0));
    const loop = Math.pow(Math.max(0, Math.sin(Math.PI * fu)), 0.5) * (0.7 + 0.3 * Math.sin(Math.PI * fv));
    return 0.55 * loop + 0.25 * vshape + 0.2 * fbm(x * 48, y * 48, 48, 2, 7);
  },
  // deri/süet gren: hücresel kırışıklık + ince gözenek
  leather: (x, y) => 0.65 * Math.pow(fbm(x * 24, y * 24, 24, 4, 11), 1.4) + 0.35 * fbm(x * 96, y * 96, 96, 2, 13),
  // boya/kaplama tanesi
  grain: (x, y) => fbm(x * 64, y * 64, 64, 3, 17),
  // ince kumaş lifi (ana haritadaki dokumanın üstüne çok hafif)
  fiber: (x, y) => 0.6 * fbm(x * 128, y * 8, 128, 2, 19) + 0.4 * fbm(x * 8, y * 128, 8, 2, 23),
};

function detailTexture(kind) {
  if (detailCache[kind]) return detailCache[kind];
  const S = 256, h = new Float32Array(S * S), f = HEIGHT[kind];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) h[j * S + i] = f(i / S, j / S);
  let mn = Infinity, mx = -Infinity;
  for (const v of h) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const data = new Uint8Array(S * S * 4);
  const H = (i, j) => (h[((j + S) % S) * S + ((i + S) % S)] - mn) / (mx - mn || 1);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = (H(i + 1, j) - H(i - 1, j)) * 2.5, dy = (H(i, j + 1) - H(i, j - 1)) * 2.5;
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    const k = (j * S + i) * 4;
    data[k] = (n.x * 0.5 + 0.5) * 255; data[k + 1] = (n.y * 0.5 + 0.5) * 255; data[k + 2] = (n.z * 0.5 + 0.5) * 255;
    data[k + 3] = H(i, j) * 255; // mikro-pürüzlülük için yükseklik (çukurlar biraz daha pürüzlü)
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = maxAniso;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return (detailCache[kind] = t);
}

// ---------------- karakter malzemesi ----------------
const matCache = new Map();
/** Kaynak (glTF) malzemeden karakter malzemesi üret. Tanınmayan malzemede null döner. */
export function characterMaterial(src) {
  if (!characterHDReady()) return null;
  if (matCache.has(src.name)) return matCache.get(src.name);
  const S = SURFACES.find((s) => s.re.test(src.name));
  const T = S && HD[S.key];
  if (!S || !T) return null;
  const m = new THREE.MeshPhysicalMaterial({
    name: src.name,
    map: T.map,
    normalMap: T.normalMap || null,
    roughness: S.rough,
    roughnessMap: T.orm || null,
    metalness: S.metal ? 1 : 0,
    metalnessMap: S.metal ? T.orm : null,
    aoMap: T.orm || null,
    aoMapIntensity: 0.85,
    sheen: S.sheen,
    sheenRoughness: S.sheenRough,
    envMapIntensity: 1.0,
  });
  m.color.setScalar(S.albedo);
  // kumaş parlaması rengi: kumaşın kendi tonu (beyaz parlama plastik gösterir)
  m.sheenColor.setRGB(0.55, 0.56, 0.45);
  // KTX2 normal haritası glTF kuralında (+Y); türev tabanlı tanjant çerçevesiyle y ters
  // ripstop ızgarası gerçekte ince; kaynak haritada abartılı olan yüzeylerde ölçeklenir
  m.normalScale.set(S.nScale ?? 1, -(S.nScale ?? 1));
  const detail = S.detail ? detailTexture(S.detail) : null;
  const U = {
    uDetail: { value: detail },
    uDetailScale: { value: S.dScale || 1 },
    uDetailStr: { value: S.dStr || 0 },
    uMicroShadow: { value: 0.45 },
    uHemi: { value: 0.5 },
  };
  m.userData.charU = U;
  m.customProgramCacheKey = () => 'charLook-' + (detail ? S.detail : 'none');
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uDetail; uniform float uDetailScale; uniform float uDetailStr; uniform float uMicroShadow; uniform float uHemi;`)
      // sahnedeki yarım küre dolgu ışığı, HDR gökyüzünün verdiği ışığı ikinci kez ekliyor; karakterde yarıya
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );',
        'irradiance += uHemi * getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );'))
      // mikro-pürüzlülük: ince yapının çukurları biraz daha mat
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#if defined( USE_NORMALMAP_TANGENTSPACE ) && ${detail ? 1 : 0}
  float dH = texture2D( uDetail, vNormalMapUv * uDetailScale ).a;
  roughnessFactor = clamp( roughnessFactor + ( 0.5 - dH ) * 0.08 * uDetailStr, 0.04, 1.0 );
#endif`)
      // mikro-normal: ana normalin üstüne UDN karışımı; mipmap ile uzakta düzleşir (moiré yok)
      .replace('#include <normal_fragment_maps>', `
#if defined( USE_NORMALMAP_TANGENTSPACE )
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  #if ${detail ? 1 : 0}
    vec3 dN = texture2D( uDetail, vNormalMapUv * uDetailScale ).xyz * 2.0 - 1.0;
    mapN = normalize( vec3( mapN.xy + dN.xy * uDetailStr * vec2( normalScale.x, normalScale.y ), mapN.z ) );
  #endif
  normal = normalize( tbn * mapN );
#else
  #include <normal_fragment_maps>
#endif`)
      // mikro-gölge: pişirilmiş AO doğrudan güneş ışığını da kısmen keser (kıvrım, cep altı, kayış)
      // pişirilmiş AO: tam siyaha inmez (gölgeye de ışık sızar); dolaylı ışık + speküler örtme + mikro-gölge
      .replace('#include <aomap_fragment>', `
#ifdef USE_AOMAP
  float ambientOcclusion = ( max( texture2D( aoMap, vAoMapUv ).r, 0.22 ) - 1.0 ) * aoMapIntensity + 1.0;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
#endif
#ifdef USE_AOMAP
  float microSh = mix( 1.0, clamp( ambientOcclusion * 1.35, 0.0, 1.0 ), uMicroShadow );
  reflectedLight.directDiffuse *= microSh;
  reflectedLight.directSpecular *= microSh;
#endif`);
  };
  matCache.set(src.name, m);
  return m;
}
