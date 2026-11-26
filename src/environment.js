import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perlin, fbm, rng, smoothstep, clamp } from './util.js';
import { makeSignTexture } from './textures.js';
import { A, loadSky, analyzeSky, pbrMaterial, modelClone } from './assets.js';

const TIMES = {
  sabah: { exposure: 1.0, sun: 3.4, sunColor: 0xffe2c4, bg: 1.0, env: 1.0, haze: 1.35, fallback: { elev: 16, azim: 75 } },
  ogle: { exposure: 0.95, sun: 3.6, sunColor: 0xfff3e2, bg: 1.0, env: 1.0, haze: 1.0, fallback: { elev: 52, azim: 30 } },
  aksam: { exposure: 1.15, sun: 3.2, sunColor: 0xffc590, bg: 1.0, env: 1.0, haze: 1.2, fallback: { elev: 11, azim: -55 } },
};

// ---------------------------------------------------------------------------
// ATMOSFER: yüksekliğe bağlı üstel pus (hava perspektifi)
// three.js'in doğrusal sisi yerine, ışının geçtiği havanın yoğunluğu (yerde yoğun,
// yükseldikçe seyrek) integral alınarak hesaplanır. Böylece uzak dağlar pusa gömülür,
// poligon içi (0-60 m) neredeyse berrak kalır, vadiler tepelerden daha puslu görünür.
// THREE.Fog parametreleri yeniden yorumlanır: near = yer yoğunluğu x1e6, far = yükseklik
// sönümü x1e6 (bkz. setAtmosphere). Sis kullanan tüm malzemeler (sprite, çizgi dahil) bunu alır.
// ---------------------------------------------------------------------------
function installAtmosphere() {
  const C = THREE.ShaderChunk;
  if (C.__poligonFog) return;
  C.__poligonFog = true;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogWorld;\n#endif\n';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogWorld = ( inverse( viewMatrix ) * mvPosition ).xyz;\n#endif\n';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif
`;
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fA = fogNear * 1e-6;
		float fB = max( fogFar * 1e-6, 1e-7 );
		vec3 fRay = vFogWorld - cameraPosition;
		float fDist = length( fRay );
		float fK = fRay.y * fB;
		float fInt = abs( fK ) > 1e-4 ? ( 1.0 - exp( - fK ) ) / fK : 1.0;
		float fogAmt = fA * exp( - max( cameraPosition.y, 0.0 ) * fB ) * fDist * fInt;
		float fogFactor = 1.0 - exp( - fogAmt );
		// uzakta renk doygunluğu da düşer (hava perspektifi)
		float fL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( fL ), clamp( fogFactor * 0.6, 0.0, 0.3 ) );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}
installAtmosphere();

/** Döşenebilir, 4 kanallı (farklı frekans) makro gürültü dokusu: tekrar desenini kırmak için */
let noiseTex = null;
function macroNoise() {
  if (noiseTex) return noiseTex;
  const N = 256, d = new Uint8Array(N * N * 4);
  const ns = [perlin(501), perlin(502), perlin(503), perlin(504)];
  const fr = [4, 8, 16, 32];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      for (let c = 0; c < 4; c++) {
        const v = fbm(ns[c], (x / N) * fr[c], (y / N) * fr[c], 4, fr[c]) * 1.25 + 0.5;
        d[(y * N + x) * 4 + c] = clamp(v, 0, 1) * 255;
      }
    }
  }
  noiseTex = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

/**
 * Arazi için 3 dokulu karışım (splat) malzemesi.
 * - Katman başına renk tonu (ör. soluk "çim" dokusu kuru zeytin yeşili otlağa çevrilir)
 * - İki ölçekte örnekleme + makro gürültü: döşeme tekrarı uzaktan görünmez
 * - Büyük ölçekli renk lekeleri (yeşilimsi / kahverengimsi alanlar)
 */
function splatMaterial(a, b, c, sb = 1, sc = 1, opts = {}, tint = {}) {
  const { tA = [1, 1, 1], tB = [1, 1, 1], tC = [1, 1, 1], patch = 1, ...rest } = { ...opts, ...tint };
  const m = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughness: 1, ...rest });
  m.normalScale.set(0.9, 0.9);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tB = { value: b.map };
    sh.uniforms.tC = { value: c.map };
    sh.uniforms.sB = { value: sb };
    sh.uniforms.sC = { value: sc };
    sh.uniforms.tNoise = { value: macroNoise() };
    sh.uniforms.cA = { value: new THREE.Vector3(...tA) };
    sh.uniforms.cB = { value: new THREE.Vector3(...tB) };
    sh.uniforms.cC = { value: new THREE.Vector3(...tC) };
    sh.uniforms.uPatch = { value: patch };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tB; uniform sampler2D tC; uniform sampler2D tNoise;
uniform float sB; uniform float sC; uniform float uPatch;
uniform vec3 cA; uniform vec3 cB; uniform vec3 cC;
varying vec3 vSplat;
vec4 antiTile(sampler2D t, vec2 uv, float n) {
  vec4 a = texture2D(t, uv);
  vec4 b = texture2D(t, uv * 0.31 + vec2(0.43, 0.17));
  return mix(a, b, smoothstep(0.3, 0.7, n) * 0.65);
}`)
      .replace('#include <map_fragment>', `
        vec4 nz = texture2D(tNoise, vMapUv * 0.017);
        vec4 nz2 = texture2D(tNoise, vMapUv * 0.0031);
        // karışım ağırlıkları gürültüyle kırılır (keskin geçiş yerine doğal sınır)
        vec3 sw = max(vSplat + (nz.gbr - 0.5) * vec3(0.25, 0.35, 0.3) * step(0.01, vSplat), 0.0);
        sw /= max(1e-4, sw.x + sw.y + sw.z);
        vec3 ca = antiTile(map, vMapUv, nz.r).rgb * cA;
        vec3 cb = antiTile(tB, vMapUv * sB, nz.g).rgb * cB;
        vec3 cc = antiTile(tC, vMapUv * sC, nz.b).rgb * cC;
        vec3 tcol = ca * sw.x + cb * sw.y + cc * sw.z;
        // büyük ölçekli parlaklık ve ton lekeleri
        tcol *= 0.74 + nz.a * 0.5;
        tcol *= mix(vec3(1.0), mix(vec3(1.06, 0.97, 0.84), vec3(0.84, 0.95, 0.78), nz2.r), uPatch);
        diffuseColor.rgb *= tcol;`);
  };
  m.customProgramCacheKey = () => 'splat4';
  return m;
}

export class Environment {
  constructor(renderer, scene, tex) {
    this.renderer = renderer;
    this.scene = scene;
    this.tex = tex;
    this.noise = perlin(1234);
    this.noise2 = perlin(99);
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);
    this.W = 30;
    this.D = 45;
    this.quality = 'yuksek';

    // yedek gökyüzü (HDR yüklenemezse)
    this.sky = new Sky();
    this.sky.scale.setScalar(3500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.2;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.sky.visible = false;
    scene.add(this.sky);

    // gölgede kalan yüzeyler için yumuşak dolgu (gökyüzü / zemin yansıması)
    this.fill = new THREE.HemisphereLight(0xcfe0ff, 0x9a8466, 1.6);
    scene.add(this.fill);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // yüksek çözünürlüklü fotoğraf gökyüzü kubbesi (kameraya kilitli, sis ve ton eşlemeden etkilenmez)
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(4200, 96, 48),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false, fog: false, depthWrite: false, color: 0xf2f2f2 }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.dome.visible = false;
    this.dome.onBeforeRender = (r, s, cam) => { this.dome.position.copy(cam.position); this.dome.updateMatrixWorld(); };
    scene.add(this.dome);
    this.bgCache = {};

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.sunDir = new THREE.Vector3(0.4, 0.8, 0.4).normalize();
  }

  async setTime(key = 'ogle') {
    const t = TIMES[key] || TIMES.ogle;
    this.time = key;
    let hdr = null;
    try { hdr = await loadSky(key); } catch (e) { console.warn('HDR yüklenemedi', e); }
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    if (hdr) {
      const info = analyzeSky(hdr);
      this.sunDir.copy(info.dir);
      if (this.sunDir.y < 0.08) this.sunDir.y = 0.08;
      this.sunDir.normalize();
      this.scene.background = hdr;
      this.scene.backgroundIntensity = t.bg;
      try {
        let bg = this.bgCache[key];
        if (!bg) {
          bg = await new THREE.TextureLoader().loadAsync(`assets/sky/${key}_bg.jpg`);
          bg.colorSpace = THREE.SRGBColorSpace;
          bg.wrapS = THREE.RepeatWrapping;
          bg.repeat.x = -1;
          bg.offset.x = 1;
          bg.anisotropy = 8;
          this.bgCache[key] = bg;
        }
        this.dome.material.map = bg;
        this.dome.material.needsUpdate = true;
        this.dome.visible = true;
        this.scene.background = null;
      } catch (e) {
        this.dome.visible = false;
      }
      this.envRT = this.pmrem.fromEquirectangular(hdr);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = t.env;
      this.sky.visible = false;
      // sis rengi: gökyüzü ufuk rengi (pozlamaya göre ölçeklenmiş)
      const hz = info.horizon.clone();
      const mx = Math.max(hz.r, hz.g, hz.b) || 1;
      hz.multiplyScalar(0.82 / mx);
      this.setAtmosphere(hz, t.haze || 1);
    } else {
      const f = t.fallback;
      this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - f.elev), THREE.MathUtils.degToRad(f.azim));
      this.sky.visible = true;
      this.dome.visible = false;
      this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
      this.scene.background = null;
      const envScene = new THREE.Scene();
      const s2 = new Sky();
      s2.scale.setScalar(1000);
      s2.material.uniforms.sunPosition.value.copy(this.sunDir);
      envScene.add(s2);
      this.envRT = this.pmrem.fromScene(envScene, 0, 0.1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.75;
      this.setAtmosphere(new THREE.Color(0xbfd0e2), t.haze || 1);
    }
    this.sun.color.set(t.sunColor);
    this.sun.intensity = t.sun;
    this.renderer.toneMappingExposure = t.exposure;
    this.updateSunPosition();
  }

  /**
   * Yüksekliğe bağlı pus (bkz. installAtmosphere). density: yer seviyesinde 1/m,
   * falloff: yükseklik sönümü 1/m. Örn. 0,0006 yoğunlukta 60 m'de %3,5, 1 km'de ~%45 pus.
   */
  setAtmosphere(color, k = 1, density = 0.00042, falloff = 0.0035) {
    this.scene.fog = new THREE.Fog(color, density * k * 1e6, falloff * 1e6);
  }

  updateSunPosition() {
    const cz = -this.D / 2;
    const r = Math.max(this.W, this.D) / 2 + 26;
    this.sun.position.set(this.sunDir.x * 160, this.sunDir.y * 160, cz + this.sunDir.z * 160);
    this.sun.target.position.set(0, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 420;
    cam.updateProjectionMatrix();
  }

  setShadowSize(n) {
    if (this.sun.shadow.mapSize.x === n) return;
    this.sun.shadow.mapSize.set(n, n);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  // ---------- yükseklik fonksiyonları ----------
  keepout() {
    const { W, D } = this;
    return { x0: -W / 2 - 14, x1: W / 2 + 14, z0: -D - 16, z1: 24 };
  }

  /**
   * Toprak set yüksekliği. Dozerle yığılmış, yağmurla yıpranmış bir set:
   * etek çizgisi dalgalı, sırt yüksekliği boyunca değişken, iç yamaçta aşağı inen
   * erozyon olukları, üstte dozer palet izleri, her yerde topak ve çukurlar.
   */
  bermHeight(x, z) {
    const { W, D } = this;
    const n = this.noise, n2 = this.noise2;
    const right = x > 0;
    // etek çizgisi ve sırt yüksekliği set boyunca değişir
    // (etek hiçbir zaman zemin kenarının içine taşmaz: 0,2–1,0 m dışarıda başlar)
    const ax = Math.abs(x) - W / 2 - (0.2 + clamp(fbm(n, z / 9 + (right ? 3 : 7), 1.7, 2) * 0.8 + 0.4, 0, 0.8));
    const Hs = (right ? 4.2 : 2.6) * (1 + fbm(n2, z / 22, right ? 5 : 9, 3) * 0.28);
    let s = 0, sSlope = 0;
    if (ax > 0) {
      if (ax < 6) { s = Hs * smoothstep(0, 6, ax); sSlope = 1 - Math.abs(ax / 6 - 0.5) * 2; }
      else if (ax < 8.5) s = Hs;
      else if (ax < 13.5) { s = Hs * (1 - smoothstep(8.5, 13.5, ax)); sSlope = 0.6 * (1 - Math.abs((ax - 8.5) / 5 - 0.5) * 2); }
    }
    // set uçları ağın kenarında dik duvar gibi kesilmesin: arazi seviyesine doğal olarak iner
    const zf = smoothstep(8, -2, z) * smoothstep(-D - 16, -D - 9, z);
    s *= zf;
    sSlope *= zf;
    const bz = -D - z - (0.2 + clamp(fbm(n, x / 9 + 11, 4.3, 2) * 0.8 + 0.4, 0, 0.8));
    const Hb = 6.5 * (1 + fbm(n2, x / 20 + 13, 2.2, 3) * 0.22);
    let b = 0, bSlope = 0;
    if (bz > 0) {
      if (bz < 6) { b = Hb * smoothstep(0, 6, bz); bSlope = 1 - Math.abs(bz / 6 - 0.5) * 2; }
      else if (bz < 10) b = Hb;
      else if (bz < 15.5) { b = Hb * (1 - smoothstep(10, 15.5, bz)); bSlope = 0.6 * (1 - Math.abs((bz - 10) / 5.5 - 0.5) * 2); }
    }
    const bxf = smoothstep(W / 2 + 14, W / 2 + 7.5, Math.abs(x));
    b *= bxf;
    bSlope *= bxf;
    const side = s >= b;
    const h = Math.max(s, b);
    if (h <= 0.05) return 0;
    const slope = Math.max(0, side ? sSlope : bSlope);
    // erozyon olukları: yamaç boyunca (aşağı doğru) uzamış, keskin dipli kanallar
    const along = side ? z : x, across = side ? ax : bz;
    const rv = n2(along * 0.85 + (side ? 0 : 40), across * 0.11);
    // oluk yoğunluğu set boyunca değişir (perde gibi düzenli çizgiler olmasın)
    const rillMask = smoothstep(-0.25, 0.25, fbm(n, along / 14 + 31, 2.7, 2));
    const rill = (Math.pow(1 - Math.min(1, Math.abs(rv) * 2.4), 3) * 0.34 * rillMask + Math.pow(1 - Math.min(1, Math.abs(n(along * 2.1, across * 0.3)) * 3), 2) * 0.06);
    // sırtta dozer palet izleri (set boyunca paralel sırtlar)
    const top = smoothstep(0.75, 0.97, h / (side ? Hs : Hb));
    const track = Math.sin(across * 5.2 + fbm(n, along * 0.2, 3.1, 2) * 2) * 0.035 * top;
    // topaklar ve çukurlar
    const lumps = fbm(n2, x * 0.25, z * 0.25, 3) * 0.6 + fbm(n, x * 0.9, z * 0.9, 3) * 0.16;
    return Math.max(0, h - rill * slope * Math.min(1, h) + track + lumps * Math.min(1, h));
  }

  terrainHeight(x, z) {
    const k = this.keepout();
    const dx = Math.max(k.x0 - x, 0, x - k.x1);
    const dz = Math.max(k.z0 - z, 0, z - k.z1);
    const dist = Math.hypot(dx, dz);
    if (dist <= 0) return -0.06;
    const m = smoothstep(0, 60, dist);
    const n = this.noise;
    let h = 0;
    const lat = x > 0 ? 0.34 : 0.1;
    h += (dx * lat * smoothstep(0, 40, dx) + dz * 0.05) * m;
    h += (fbm(n, x / 140, z / 140, 5) * 0.5 + 0.5) * 22 * m;
    const back = smoothstep(-this.D - 160, -this.D - 750, z);
    h += back * (70 + fbm(n, x / 240 + 7, z / 240, 5) * 130);
    const R = Math.hypot(x, z + this.D / 2);
    const mtn = smoothstep(450, 1000, R);
    h += mtn * (90 + fbm(n, x / 300 + 3, z / 300 + 3, 4) * 150);
    // sırt ve vadi yapısı (ridged gürültü): dağlar kum tepesi gibi pürüzsüz değil
    const big = back + mtn;
    // (arazi ızgarası ~6,5 m: daha ince sırtlar sivri üçgen dikenlere dönüşür, bu yüzden geniş ölçek)
    if (big > 0.01) {
      const r1 = 1 - Math.abs(fbm(this.noise2, x / 170 + 5, z / 170, 3) * 2);
      h += big * r1 * r1 * 38;
    }
    // orta tepelerde yağmur yarıntıları ve hafif kayalık basamaklar
    const g1 = 1 - Math.abs(fbm(n, x / 60 + 17, z / 60, 2) * 2);
    h += g1 * g1 * 4 * m * smoothstep(5, 40, h);
    h += fbm(n, x / 18, z / 18, 3) * 2.5 * m;
    return Math.max(h * smoothstep(0, 6, dist), -0.06);
  }

  forestDensity(x, z) {
    return fbm(this.noise, x / 90, z / 90, 4);
  }

  // ---------- inşa ----------
  build(W, D) {
    this.W = W;
    this.D = D;
    this.clear();
    this.updateSunPosition();
    this.buildTerrain();
    this.buildBerms();
    this.buildRangeFloor();
    this.buildShelter();
    this.buildRoad();
    this.buildVegetation();
  }

  clear() {
    for (const c of [...this.group.children]) {
      c.traverse((o) => {
        if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
      });
      this.group.remove(c);
    }
  }

  /**
   * Izgara ağında eğrilikten köşe rengi: çukur/oluk dipleri koyu ve nemli, sırtlar
   * açık (güneşte ağarmış). Ortam kapatmanın (AO) büyük ölçekli karşılığı gibi çalışır.
   */
  curvatureColors(geo, cols, rows, cell, { dark = 0.35, light = 0.12, scale = 1, extra = null } = {}) {
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const H = (c, r) => pos.getY(clamp(r, 0, rows) * (cols + 1) + clamp(c, 0, cols));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const i = r * (cols + 1) + c;
        const h = pos.getY(i);
        const lap = ((H(c - 1, r) + H(c + 1, r) + H(c, r - 1) + H(c, r + 1)) / 4 - h) / cell * scale;
        const lap2 = ((H(c - 3, r) + H(c + 3, r) + H(c, r - 3) + H(c, r + 3)) / 4 - h) / (cell * 3) * scale;
        const cv = lap * 0.6 + lap2 * 0.4;
        let k = 1 - clamp(cv, 0, 1) * dark + clamp(-cv, 0, 1) * light;
        if (extra) k *= extra(pos.getX(i), h, pos.getZ(i));
        col[i * 3] = k; col[i * 3 + 1] = k * 0.985; col[i * 3 + 2] = k * 0.97;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  buildTerrain() {
    const S = 2200, seg = this.quality === 'dusuk' ? 220 : 340;
    const geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -this.D / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.terrainHeight(x, z));
      uv.setXY(i, x / 5, z / 5);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const splat = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nor.getY(i);
      const fo = smoothstep(-0.12, 0.25, this.forestDensity(x, z)) * smoothstep(1, 10, h);
      const rk = smoothstep(0.22, 0.5, slope + fbm(this.noise2, x / 30, z / 30, 2) * 0.15);
      splat[i * 3] = Math.max(0.02, 1 - fo - rk);
      splat[i * 3 + 1] = fo * (1 - rk);
      splat[i * 3 + 2] = rk;
    }
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
    this.curvatureColors(geo, seg, seg, S / seg, { dark: 0.4, light: 0.15, scale: 6 });
    const P = A.pbr;
    // "grass" dokusu soluk kum rengi; kuru zeytin yeşili otlağa çevrilir (kum tepesi görüntüsü biter)
    const mat = P.grass
      ? splatMaterial(P.grass, P.forest, P.rock, 1.2, 0.6, { vertexColors: true }, { tA: [0.46, 0.48, 0.32], tB: [0.74, 0.72, 0.66], tC: [0.8, 0.78, 0.74], patch: 1 })
      : new THREE.MeshStandardMaterial({ color: 0x9a8a6a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
  }

  buildBerms() {
    const k = this.keepout();
    const w = k.x1 - k.x0, d = k.z1 - k.z0;
    const cell = this.quality === 'dusuk' ? 0.45 : 0.3;
    const sx = Math.ceil(w / cell), sz = Math.ceil(d / cell);
    const geo = new THREE.PlaneGeometry(w, d, sx, sz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((k.x0 + k.x1) / 2, 0, (k.z0 + k.z1) / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.bermHeight(x, z));
      uv.setXY(i, x / 3.2, z / 3.2);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    const splat = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nor.getY(i);
      const n = fbm(this.noise, x / 6, z / 6, 3);
      const rk = x > 0 ? smoothstep(0.6, 2.2, h) * (0.55 + n * 0.8) : smoothstep(1.5, 2.5, h) * 0.25;
      const gr = smoothstep(0.2, 0.0, slope) * smoothstep(0.5, 1.5, h) * 0.6 + (h < 0.05 ? 0.35 : 0) + Math.max(0, n) * 0.3;
      splat[i * 3] = 1;
      splat[i * 3 + 1] = clamp(rk, 0, 1.6);
      splat[i * 3 + 2] = clamp(gr, 0, 1);
    }
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
    // oluk dipleri koyu; set eteği nemli/koyu; sırt güneşte ağarmış
    const D = this.D, W = this.W, nb = this.noise2;
    this.curvatureColors(geo, sx, sz, w / sx, {
      dark: 0.45, light: 0.1, scale: 2.2,
      extra: (x, h, z) => {
        if (h <= 0.02) return 1;
        let k = 0.82 + 0.18 * smoothstep(0.0, 1.4, h) + 0.04 * smoothstep(2.5, 5, h);
        // arka sette hedef yüksekliğinde mermi darbe bandı: eşelenmiş, koyu, nemli toprak
        if (z < -D && Math.abs(x) < W / 2 + 1) {
          const band = smoothstep(0.25, 0.8, h) * (1 - smoothstep(2.2, 3.2, h)) * smoothstep(W / 2 + 1, W / 2 - 2, Math.abs(x));
          const pock = Math.max(0, nb(x * 2.3, z * 2.3 + h * 2)) * 1.6 + Math.max(0, nb(x * 0.6 + 7, h * 1.5)) * 0.5;
          k *= 1 - band * (0.28 + Math.min(0.4, pock * 0.38));
        }
        return k;
      },
    });
    const P = A.pbr;
    const mat = P.berm
      ? splatMaterial(P.berm, P.rock, P.grass, 0.7, 0.8, { vertexColors: true }, { tA: [0.84, 0.78, 0.7], tB: [0.8, 0.78, 0.75], tC: [0.55, 0.55, 0.38], patch: 0.6 })
      : new THREE.MeshStandardMaterial({ color: 0xb8a07a });
    mat.normalScale.set(1.25, 1.25);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'berms';
    this.group.add(mesh);
  }

  buildRangeFloor() {
    const { W, D } = this;
    const L = D + 14;
    const geo = new THREE.PlaneGeometry(W, L, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.015, -D + L / 2);
    const uv = geo.attributes.uv;
    geo.setAttribute('maskUv', uv.clone());
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * W) / 2.4, (uv.getY(i) * L) / 2.4);
    let mat;
    if (A.pbr.gravel) {
      mat = pbrMaterial('gravel', { normalScale: 1.4 });
      this.floorShader(mat, this.floorMask(W, D, L), W, L);
    } else mat = new THREE.MeshStandardMaterial({ map: this.tex.gravel, roughness: 0.95 });
    const floor = new THREE.Mesh(geo, mat);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    this.floor = floor;

    const wm = pbrMaterial('wood', { color: 0xc8b49a });
    const mk = (w, h, d, x, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uvs = g.attributes.uv;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * Math.max(w, d) / 2, uvs.getY(i) * 0.15);
      const m = new THREE.Mesh(g, wm);
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    };
    mk(0.2, 0.18, L, -W / 2 - 0.1, -D + L / 2);
    mk(0.2, 0.18, L, W / 2 + 0.1, -D + L / 2);
    mk(W + 0.4, 0.18, 0.2, 0, -D - 0.1);
  }

  /**
   * Zemin ayrıntı maskesi (R: açıkta toprak, G: sıkışma/nem — koyulaşma, B: yükseklik, 0,5 = düz).
   * Tuval pikseli → dünya: x = -W/2 + px/CW*W, z = -D + py/CH*L (tuvalin üstü = hedef seti).
   */
  floorMask(W, D, L) {
    const CW = 1024, CH = 2048;
    const mk = () => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; };
    const cR = mk(), cG = mk(), cB = mk();
    const gR = cR.getContext('2d'), gG = cG.getContext('2d'), gB = cB.getContext('2d');
    gR.fillStyle = '#000'; gR.fillRect(0, 0, CW, CH);
    gG.fillStyle = '#000'; gG.fillRect(0, 0, CW, CH);
    gB.fillStyle = 'rgb(128,128,128)'; gB.fillRect(0, 0, CW, CH);
    const sx = CW / W, sz = CH / L;
    const X = (x) => (x + W / 2) * sx, Z = (z) => (z + D) * sz;
    const r = rng(9001);
    const blob = (g, x, z, rad, color, a, sq = 1) => {
      const gr = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), rad * sx);
      gr.addColorStop(0, color.replace('A', a));
      gr.addColorStop(1, color.replace('A', 0));
      g.save();
      g.translate(X(x), Z(z)); g.scale(1, sq); g.translate(-X(x), -Z(z));
      g.fillStyle = gr;
      g.beginPath(); g.arc(X(x), Z(z), rad * sx, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    // --- toprak: kenarlara dökülen set toprağı + rastgele lekeler
    const edgeR = (x0, x1, z0, z1, dir) => {
      const gr = dir === 'x' ? gR.createLinearGradient(X(x0), 0, X(x1), 0) : gR.createLinearGradient(0, Z(z0), 0, Z(z1));
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      gR.fillStyle = gr;
      gR.fillRect(X(Math.min(x0, x1)), Z(Math.min(z0, z1)), Math.abs(X(x1) - X(x0)), Math.abs(Z(z1) - Z(z0)));
    };
    edgeR(-W / 2, -W / 2 + 2.2, -D, 14, 'x');
    edgeR(W / 2, W / 2 - 2.6, -D, 14, 'x');
    edgeR(-W / 2, W / 2, -D, -D + 4.5, 'z');
    for (let i = 0; i < 70; i++) {
      blob(gR, (r() - 0.5) * W, -D + r() * L, 0.6 + r() * 2.8, 'rgba(255,255,255,A)', 0.25 + r() * 0.5, 0.5 + r());
    }
    // set dibinde dökülme dilleri (yağmurla akmış toprak)
    for (let i = 0; i < 60; i++) {
      const side = r() < 0.33 ? 'b' : r() < 0.5 ? 'l' : 'rr';
      const x = side === 'b' ? (r() - 0.5) * W : side === 'l' ? -W / 2 + r() * 0.6 : W / 2 - r() * 0.6;
      const z = side === 'b' ? -D + r() * 0.8 : -D + r() * L;
      blob(gR, x, z, 0.8 + r() * 1.6, 'rgba(255,255,255,A)', 0.5 + r() * 0.4, 0.6);
    }
    // --- sıkışma/aşınma: atış hattı, yürüme yolları, nem lekeleri
    blob(gG, 0, 0, W * 0.42, 'rgba(255,255,255,A)', 0.42, 0.22);
    for (let p = 0; p < 5; p++) {
      let x = (r() - 0.5) * W * 0.6, z = 3;
      gG.lineCap = 'round';
      for (let s = 0; s < 40; s++) {
        const nx = x + (r() - 0.5) * 1.4, nz = z - (D + 2) / 40;
        gG.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.1})`;
        gG.lineWidth = (0.9 + r() * 0.6) * sx;
        gG.beginPath(); gG.moveTo(X(x), Z(z)); gG.lineTo(X(nx), Z(nz)); gG.stroke();
        x = clamp(nx, -W / 2 + 1, W / 2 - 1); z = nz;
      }
    }
    for (let i = 0; i < 14; i++) blob(gG, (r() - 0.5) * W, -D + r() * L, 0.8 + r() * 2.2, 'rgba(255,255,255,A)', 0.25 + r() * 0.25, 0.4 + r() * 0.8);
    // --- araç izi (hedef bakım aracı): sol kenardan girip hedef hattında dönen çift tekerlek izi
    const track = [];
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const z = 14 - t * (L - 6);
      const x = -W / 2 + 3.2 + Math.sin(t * 5.1) * 0.5 + smoothstep(0.75, 1, t) * W * 0.35;
      track.push([x, z]);
    }
    const strokeTrack = (g, off, width, style) => {
      g.strokeStyle = style; g.lineWidth = width * sx; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      track.forEach(([x, z], i) => {
        const [x2, z2] = track[Math.min(track.length - 1, i + 1)], [x0, z0] = track[Math.max(0, i - 1)];
        const dx = x2 - x0, dz = z2 - z0, l = Math.hypot(dx, dz) || 1;
        const px = x + (-dz / l) * off, pz = z + (dx / l) * off;
        if (i) g.lineTo(X(px), Z(pz)); else g.moveTo(X(px), Z(pz));
      });
      g.stroke();
    };
    for (const off of [-0.8, 0.8]) {
      strokeTrack(gB, off, 0.5, 'rgba(165,165,165,0.8)'); // kenarlara itilmiş çakıl sırtı
      strokeTrack(gB, off, 0.26, 'rgba(78,78,78,0.9)'); // tekerlek oluğu
      strokeTrack(gG, off, 0.3, 'rgba(255,255,255,0.5)');
      strokeTrack(gR, off, 0.22, 'rgba(255,255,255,0.35)');
    }
    // lastik diş izi (oluk içinde enine çizgiler)
    gB.strokeStyle = 'rgba(60,60,60,0.35)'; gB.lineWidth = 0.03 * sx;
    for (let i = 1; i < track.length - 1; i += 1) {
      for (let k = 0; k < 3; k++) {
        const t = k / 3;
        const [xa, za] = track[i], [xb, zb] = track[i + 1];
        const x = xa + (xb - xa) * t, z = za + (zb - za) * t;
        const dx = xb - xa, dz = zb - za, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        for (const off of [-0.8, 0.8]) {
          gB.beginPath();
          gB.moveTo(X(x + nx * (off - 0.11)), Z(z + nz * (off - 0.11)));
          gB.lineTo(X(x + nx * (off + 0.11)), Z(z + nz * (off + 0.11)));
          gB.stroke();
        }
      }
    }
    // --- ayak izleri (atış hattı ve yürüme yollarında yoğun)
    const boot = (x, z, a, left) => {
      const L0 = 0.29, W0 = 0.105;
      for (const [g, col] of [[gB, 'rgba(100,100,100,0.55)'], [gG, 'rgba(255,255,255,0.25)']]) {
        g.save();
        g.translate(X(x), Z(z)); g.rotate(a); g.scale(sx, sz);
        g.fillStyle = col;
        g.beginPath(); g.ellipse(0, -L0 * 0.18, W0 * 0.5, L0 * 0.32, left ? 0.06 : -0.06, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(0, L0 * 0.3, W0 * 0.42, L0 * 0.16, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    };
    for (let w = 0; w < 46; w++) {
      // yürüyüş dizileri: adım adım, hafif kıvrılarak
      let x = (r() - 0.5) * W * 0.85, z = r() < 0.5 ? (r() - 0.5) * 6 : -D + r() * L;
      let a = (r() < 0.75 ? Math.PI : 0) + (r() - 0.5) * 0.9;
      const steps = 6 + Math.floor(r() * 16);
      for (let s = 0; s < steps; s++) {
        const left = s % 2 === 0;
        const side = left ? -0.11 : 0.11;
        // yerel -y (burun) yönü dünyada (sin a, -cos a); yan ofset ona dik
        boot(x + Math.cos(a) * side, z + Math.sin(a) * side, a, left);
        x += Math.sin(a) * 0.72; z += -Math.cos(a) * 0.72;
        a += (r() - 0.5) * 0.18;
        if (Math.abs(x) > W / 2 - 0.5 || z < -D + 0.5 || z > 13) break;
      }
    }
    // --- mermi çukurları: hedef hattının arkası ve set dibi
    for (let i = 0; i < 420; i++) {
      const x = (r() - 0.5) * W * 0.9, z = -D + Math.pow(r(), 1.8) * 9;
      const rad = 0.03 + Math.pow(r(), 2) * 0.12;
      blob(gB, x, z, rad * 1.8, 'rgba(160,160,160,A)', 0.7);
      blob(gB, x, z, rad, 'rgba(70,70,70,A)', 0.9);
      blob(gR, x, z, rad * 2.5, 'rgba(255,255,255,A)', 0.5);
    }
    // --- hafif çukur ve tümsekler, çakıl kümeleri
    for (let i = 0; i < 260; i++) {
      const up = r() < 0.5;
      blob(gB, (r() - 0.5) * W, -D + r() * L, 0.2 + r() * 1.1, up ? 'rgba(150,150,150,A)' : 'rgba(105,105,105,A)', 0.35 + r() * 0.4, 0.5 + r());
    }
    // birleştir (yükseklik hafifçe yumuşatılır)
    const out = mk(), go = out.getContext('2d');
    const getData = (c, blur) => {
      if (!blur) return c.getContext('2d').getImageData(0, 0, CW, CH).data;
      const t = mk(), tg = t.getContext('2d');
      tg.filter = `blur(${blur}px)`;
      tg.drawImage(c, 0, 0);
      return tg.getImageData(0, 0, CW, CH).data;
    };
    const dR = getData(cR, 2), dG = getData(cG, 1.5), dB = getData(cB, 1);
    const img = go.createImageData(CW, CH), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = dR[i]; d[i + 1] = dG[i]; d[i + 2] = dB[i]; d[i + 3] = 255; }
    go.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(out);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    t.flipY = false; // tuval satırı 0 = v 0 = uzak uç (aşağıda maskUv buna göre çevrilir)
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return { tex: t, texel: new THREE.Vector2(1 / CW, 1 / CH) };
  }

  /** Çakıl malzemesine ayrıntı maskesi: toprak karışımı, koyulaşma, oluk/çukur normal sapması */
  floorShader(mat, mask, W, L) {
    const dirt = A.pbr.berm;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tMask = { value: mask.tex };
      sh.uniforms.tDirt = { value: dirt ? dirt.map : mat.map };
      sh.uniforms.tDirtN = { value: dirt ? dirt.normalMap : mat.normalMap };
      sh.uniforms.tNoise = { value: macroNoise() };
      sh.uniforms.uTexel = { value: mask.texel };
      sh.uniforms.uSize = { value: new THREE.Vector2(W, L) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 maskUv;\nvarying vec2 vMaskUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMaskUv = vec2(maskUv.x, 1.0 - maskUv.y);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tMask; uniform sampler2D tDirt; uniform sampler2D tDirtN; uniform sampler2D tNoise;
uniform vec2 uTexel; uniform vec2 uSize;
varying vec2 vMaskUv;
float floorDirt; float floorComp;`)
        .replace('#include <map_fragment>', `
        vec4 nz = texture2D(tNoise, vMapUv * 0.031);
        vec4 nzb = texture2D(tNoise, vMapUv * 0.11);
        vec4 g1 = texture2D(map, vMapUv);
        vec4 g2 = texture2D(map, vMapUv * 0.37 + vec2(0.31, 0.77));
        vec4 gcol = mix(g1, g2, smoothstep(0.3, 0.7, nz.r) * 0.6);
        vec4 mk = texture2D(tMask, vMaskUv);
        float dA = mk.r + (nz.g - 0.5) * 1.0 + (nzb.b - 0.5) * 0.5 + 0.02;
        floorDirt = smoothstep(0.2, 0.75, dA);
        floorComp = mk.g;
        // toprak: set toprağının daha boz, az doygun hali (pas lekesi gibi turuncu durmasın)
        vec3 dcol = texture2D(tDirt, vMapUv * 0.8).rgb;
        dcol = mix(dcol, vec3(dot(dcol, vec3(0.2126, 0.7152, 0.0722))), 0.6) * vec3(0.9, 0.84, 0.76);
        // çakıl: mavi-gri yerine hafif sıcak, kırılmış taş tonu
        gcol.rgb *= vec3(0.98, 0.93, 0.86);
        vec3 col = mix(gcol.rgb, dcol, floorDirt);
        // çakıl kümeleri: toprak lekelerinin içinde de yer yer çakıl kalır
        col = mix(col, gcol.rgb, smoothstep(0.62, 0.8, nzb.a) * floorDirt * 0.7);
        col *= 1.0 - floorComp * 0.34;
        col *= 0.72 + nz.a * 0.42;
        col *= 0.86 + nzb.r * 0.24;
        col *= mix(vec3(1.03, 1.0, 0.96), vec3(0.95, 0.98, 1.03), nz.b);
        // oluk ve çukur dipleri biraz koyu (ince malzeme birikimi)
        col *= 1.0 - clamp(0.5 - mk.b, 0.0, 0.5) * 0.7;
        diffuseColor.rgb *= col;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.98, floorDirt * 0.6) * (1.0 - floorComp * 0.12);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // toprak katmanının kendi normal ayrıntısı
          vec3 dn = texture2D(tDirtN, vMapUv * 0.8).xyz * 2.0 - 1.0;
          // maske yüksekliğinden eğim → dünya normali (zemin yataydır)
          float hL = texture2D(tMask, vMaskUv - vec2(uTexel.x, 0.0)).b;
          float hR = texture2D(tMask, vMaskUv + vec2(uTexel.x, 0.0)).b;
          float hD = texture2D(tMask, vMaskUv - vec2(0.0, uTexel.y)).b;
          float hU = texture2D(tMask, vMaskUv + vec2(0.0, uTexel.y)).b;
          float hs = 0.14; // 1 birim maske = 14 cm
          float dhdx = (hR - hL) * hs / (2.0 * uTexel.x * uSize.x);
          float dhdz = (hU - hD) * hs / (2.0 * uTexel.y * uSize.y);
          vec3 nW = normalize(vec3(-dhdx - dn.x * 0.35 * floorDirt, 1.0, -dhdz + dn.y * 0.35 * floorDirt));
          vec3 nV = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          vec3 gV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          normal = normalize(normal + nV - gV);
        }`);
    };
    mat.customProgramCacheKey = () => 'floorDetail2';
  }

  buildShelter() {
    const { W } = this;
    const g = new THREE.Group();
    g.position.set(-W / 2 - 6.2, 0, 5);
    const wood = pbrMaterial('wood');
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.5, metalness: 0.7 });
    const roofMat = pbrMaterial('roof', { color: 0x9aa0a8, metal: true, side: THREE.DoubleSide });
    roofMat.map.repeat.set(3, 1.5);
    roofMat.normalMap.repeat.set(3, 1.5);
    roofMat.roughnessMap.repeat.set(3, 1.5);
    const conc = pbrMaterial('concrete', { repeat: 2 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(5.6, 0.14, 7.4), conc, 0, 0.07, 0);
    const postGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
    for (const [x, z, h] of [[-2.5, -3.4, 2.9], [2.5, -3.4, 2.5], [-2.5, 3.4, 2.9], [2.5, 3.4, 2.5], [-2.5, 0, 2.9], [2.5, 0, 2.5]]) {
      const p = add(postGeo, steel, x, h / 2, z);
      p.scale.y = h;
    }
    add(new THREE.BoxGeometry(6.2, 0.04, 7.9), roofMat, 0, 2.78, 0, 0, 0, -Math.atan(0.4 / 5));
    for (const z of [-2, 1.2]) {
      add(new THREE.BoxGeometry(1.0, 0.06, 2.4), wood, 0.2, 0.76, z);
      for (const [lx, lz] of [[-0.35, -1.0], [0.75, -1.0], [-0.35, 1.0], [0.75, 1.0]]) add(new THREE.BoxGeometry(0.07, 0.74, 0.07), wood, lx, 0.39, z + lz);
      for (const bx of [-0.75, 1.15]) {
        add(new THREE.BoxGeometry(0.32, 0.05, 2.4), wood, bx, 0.45, z);
        add(new THREE.BoxGeometry(0.06, 0.43, 0.06), wood, bx, 0.22, z - 1.0);
        add(new THREE.BoxGeometry(0.06, 0.43, 0.06), wood, bx, 0.22, z + 1.0);
      }
    }
    // gölgelik yanında sandık ve varil (doğal görünüm)
    const cr = modelClone('crate');
    if (cr) { cr.position.set(1.8, 0.14, 3.0); cr.rotation.y = 0.3; g.add(cr); }
    const br = modelClone('barrel');
    if (br) { br.position.set(2.2, 0.14, -3.0); g.add(br); }
    this.group.add(g);

    const s = new THREE.Group();
    s.position.set(-W / 2 - 2.2, 0, -1.5);
    s.rotation.y = Math.PI / 2 - 0.25;
    const signMat = new THREE.MeshStandardMaterial({ map: makeSignTexture(['POLİGON KURALLARI', 'Namlu daima hedef yönünde', 'Atış emniyetçisinin komutlarına uyun', 'Gözlük ve kulaklık zorunludur', 'Ateş hattı geçilmez']), roughness: 0.7 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.04), [wood, wood, wood, wood, signMat, wood]);
    board.position.y = 1.55;
    board.castShadow = true;
    s.add(board);
    for (const x of [-0.55, 0.55]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 0.08), steel);
      p.position.set(x, 1.0, -0.05);
      p.castShadow = true;
      s.add(p);
    }
    this.group.add(s);
  }

  buildRoad() {
    const { W, D } = this;
    const pts = [
      new THREE.Vector3(-W / 2 - 11, 0, 40),
      new THREE.Vector3(-W / 2 - 11, 0, 14),
      new THREE.Vector3(-W / 2 - 11.5, 0, -D * 0.4),
      new THREE.Vector3(-W / 2 - 12, 0, -D - 4),
      new THREE.Vector3(-W / 2 - 26, 0, -D - 18),
      new THREE.Vector3(-W / 2 - 60, 0, -D - 30),
      new THREE.Vector3(-W / 2 - 110, 0, -D - 22),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 220, hw = 1.9;
    const posA = [], uvA = [], idx = [];
    const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      curve.getPointAt(t, tmp);
      curve.getTangentAt(t, tan);
      side.set(-tan.z, 0, tan.x).normalize();
      for (const s of [-1, 1]) {
        const x = tmp.x + side.x * hw * s, z = tmp.z + side.z * hw * s;
        const h = Math.max(this.terrainHeight(x, z), this.bermHeight(x, z), 0) + 0.07;
        posA.push(x, h, z);
        uvA.push(s * 0.5 + 0.5, (t * curve.getLength()) / 3.5);
      }
      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = pbrMaterial('sand', { color: 0xd8ccb8 });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  // ---------- çam ağacı ----------
  /**
   * Çam ağacı geometrisi (birim yükseklik). Her kademede gövdeden çıkan dallar; her dal
   * boyunca bükülen (önce sarkan, ucu hafif kalkan) alt bölümlü çapraz kartlar.
   * Köşe renkleri: gövdeye yakın iç kısım ve alt kademeler karanlık (taç içi gölge),
   * dal uçları aydınlık. Normaller taç merkezinden dışa doğru (hacimli, yumuşak ışık).
   * lod: 0 = yakın (ayrıntılı), 1 = orta mesafe.
   */
  pineGeometry(seed, lod) {
    const r = rng(seed);
    const cards = [];
    const tiers = lod ? 14 : 24;
    const crownBase = 0.2 + r() * 0.12;
    const lean = new THREE.Vector2((r() - 0.5) * 0.03, (r() - 0.5) * 0.03); // hafif eğik gövde
    const v = new THREE.Vector3(), cN = new THREE.Vector3();
    const addCard = (L, w, droop, lift, roll, az, y, tone, inner) => {
      const seg = lod ? 2 : 3;
      const g = new THREE.PlaneGeometry(L, w, seg, 1);
      g.translate(L / 2, 0, 0);
      const p = g.attributes.position;
      // dal eğrisi: kökte yatay-aşağı, uca doğru daha çok sarkar, en uçta hafif kalkar
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), t = x / L;
        p.setY(k, p.getY(k) - Math.tan(droop) * x * (0.45 + 0.55 * t) + lift * L * t * t * t);
      }
      g.rotateX(roll);
      g.rotateY(az);
      g.translate(lean.x * y, y, lean.y * y);
      const nn = g.attributes.normal;
      const col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const px = p.getX(k), py = p.getY(k), pz = p.getZ(k);
        const rad = Math.hypot(px, pz);
        // dışa + yukarı yönlü normal, kart normaliyle biraz karışık (yaprak dokusu canlı kalsın)
        cN.set(nn.getX(k), nn.getY(k), nn.getZ(k));
        if (cN.y < 0) cN.negate();
        // yukarı eğilim dal boyuyla orantılı: tepedeki kısa dallar da yana bakar (parlak "şapka" olmaz)
        v.set(px, L * 0.38 + (py - y) * 0.4, pz).normalize().multiplyScalar(0.8).addScaledVector(cN, 0.2).normalize();
        nn.setXYZ(k, v.x, v.y, v.z);
        const t = clamp(rad / Math.max(0.001, L), 0, 1);
        const k2 = (inner ? 0.32 : 0.36 + 0.64 * Math.pow(t, 0.75)) * tone;
        col[k * 3] = k2; col[k * 3 + 1] = k2; col[k * 3 + 2] = k2;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      cards.push(g);
    };
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1);
      // kademeler tepeye doğru sıklaşır (tepede gövde açıkta kalıp "lolipop" görünmesin)
      const y = crownBase + Math.pow(f, 0.78) * (0.975 - crownBase);
      // konik taç zarfı; alt kademeler biraz kısalır (eski dallar kurur)
      const env = Math.pow(1 - f, 0.92) * (0.82 + 0.18 * smoothstep(0, 0.15, f));
      const R = 0.03 + 0.25 * env * (0.85 + r() * 0.3);
      const nb = lod ? Math.max(3, Math.round(5 - f * 2)) : Math.max(4, Math.round(7 - f * 3 + r()));
      const off = r() * Math.PI * 2;
      const shade = (0.6 + 0.4 * Math.pow(f, 0.6)) * (1 - 0.18 * smoothstep(0.8, 1, f)); // alt kademeler gölgede, en tepe aşırı parlamasın
      for (let i = 0; i < nb; i++) {
        const az = off + (i / nb) * Math.PI * 2 + (r() - 0.5) * 0.7;
        const L = R * (0.75 + r() * 0.45);
        const droop = 0.18 + (1 - f) * 0.42 + (r() - 0.5) * 0.18;
        const lift = 0.12 + r() * 0.12;
        const tone = shade * (0.88 + r() * 0.24);
        const yy = y + (r() - 0.5) * 0.012;
        // hiçbir kart yatay değil (yandan bakınca ince çizgi/"tabak" görünmesin): ~40°, ~90°, ~140°
        if (lod) {
          addCard(L, L * 0.5, droop, lift, 0.7 + (r() - 0.5) * 0.3, az, yy, tone, false);
          addCard(L * 0.9, L * 0.45, droop, lift, 2.3 + (r() - 0.5) * 0.3, az, yy, tone, false);
        } else {
          addCard(L, L * 0.46, droop, lift, 0.7 + (r() - 0.5) * 0.3, az, yy, tone, false);
          addCard(L * 0.94, L * 0.42, droop, lift, Math.PI / 2 + (r() - 0.5) * 0.3, az + (r() - 0.5) * 0.12, yy, tone, false);
          addCard(L * 0.9, L * 0.42, droop, lift, 2.45 + (r() - 0.5) * 0.3, az + (r() - 0.5) * 0.12, yy, tone, false);
        }
      }
      // taç içini dolduran kısa, karanlık dal parçaları (arkası görünmesin)
      if (!lod && f < 0.9) {
        for (let i = 0; i < 2; i++) addCard(R * 0.45, R * 0.3, 0.5, 0, r() * Math.PI, r() * Math.PI * 2, y + 0.012, shade, true);
      }
    }
    // tepe filizi (dikey, yana bakan normaller, gövde ucunu örter)
    for (const ry of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(0.05, 0.1);
      g.rotateZ(Math.PI / 2);
      g.rotateY(ry);
      g.translate(lean.x, 0.985, lean.y);
      const nn = g.attributes.normal;
      for (let k = 0; k < nn.count; k++) { const s = k % 2 ? 1 : -1; nn.setXYZ(k, Math.cos(ry) * s * 0.8, 0.6, Math.sin(ry) * s * 0.8); }
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nn.count * 3).fill(0.7), 3));
      cards.push(g);
    }
    const foliage = mergeGeometries(cards);
    // gövde: konik, hafif eğik, tepeye doğru incelir (tacın içinde kalır); tacın altında kurumuş dal kütükleri
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.0015, 0.021, 0.95, lod ? 5 : 9, lod ? 1 : 6, true);
    trunk.translate(0, 0.475, 0);
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + lean.x * y); tp.setZ(i, tp.getZ(i) + lean.y * y); }
    const tuv = trunk.attributes.uv;
    for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * 9);
    trunk.computeVertexNormals();
    parts.push(trunk);
    if (!lod) {
      for (let i = 0; i < 9; i++) {
        const y = 0.06 + r() * (crownBase - 0.04);
        const L = 0.02 + r() * 0.05;
        const st = new THREE.CylinderGeometry(0.0006, 0.0022, L, 4, 1, true);
        st.translate(0, L / 2, 0);
        st.rotateZ(-Math.PI / 2 + 0.25 + r() * 0.5);
        st.rotateY(r() * Math.PI * 2);
        st.translate(lean.x * y, y, lean.y * y);
        parts.push(st);
      }
    }
    return { foliage, trunk: parts.length > 1 ? mergeGeometries(parts) : trunk };
  }

  /**
   * Uzak ağaçlar için "impostor": yakın ağaç geometrisi ortografik kamerayla bir kez
   * dokuya çizilir (renk + normal). Uzaktaki ağaçlar bu dokuyu taşıyan çapraz kartlardır;
   * normal haritası sayesinde güneşe göre doğru aydınlanırlar, sise ve gölgeye uyarlar.
   */
  bakeImpostor(variant, foliageColor, barkColor) {
    const R = this.renderer;
    const W = 256, H = 384;
    const box = { l: -0.4, r: 0.4, b: -0.05, t: 1.15 };
    const mkRT = () => {
      const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      return rt;
    };
    const vs = `varying vec2 vUv; varying vec3 vN; varying vec3 vC;
      void main(){ vUv = uv; vN = normal;
        #ifdef USE_COLOR
          vC = color;
        #else
          vC = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    const fs = `uniform sampler2D map; uniform int mode; uniform vec3 tint; uniform float cut;
      varying vec2 vUv; varying vec3 vN; varying vec3 vC;
      void main(){ vec4 t = texture2D(map, vUv); if (t.a < cut) discard;
        if (mode == 0) gl_FragColor = vec4(t.rgb * tint * vC, 1.0);
        else gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }`;
    const mk = (map, tint, colors, cut) => new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, mode: { value: 0 }, tint: { value: tint }, cut: { value: cut } },
      vertexShader: vs, fragmentShader: fs, vertexColors: colors, side: THREE.DoubleSide,
    });
    const fm = mk(A.tex.branch, new THREE.Vector3(foliageColor.r, foliageColor.g, foliageColor.b), true, 0.4);
    const tm = mk(A.tex.bark, new THREE.Vector3(barkColor.r, barkColor.g, barkColor.b), false, -1);
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(variant.trunk, tm), new THREE.Mesh(variant.foliage, fm));
    const cam = new THREE.OrthographicCamera(box.l, box.r, box.t, box.b, 0.1, 10);
    cam.position.set(0, 0, 5);
    const prevRT = R.getRenderTarget(), prevCol = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha();
    const prevSh = R.shadowMap.autoUpdate;
    R.shadowMap.autoUpdate = false;
    const albedo = mkRT(), normal = mkRT();
    for (const [rt, mode, clear] of [[albedo, 0, 0x0b1208], [normal, 1, 0x8080ff]]) {
      fm.uniforms.mode.value = tm.uniforms.mode.value = mode;
      R.setRenderTarget(rt);
      R.setClearColor(clear, 0);
      R.clear();
      R.render(sc, cam);
    }
    R.setRenderTarget(prevRT);
    R.setClearColor(prevCol, prevA);
    R.shadowMap.autoUpdate = prevSh;
    fm.dispose(); tm.dispose();
    // çapraz iki kart; tabanı y=0, gövde ekseni x=z=0 (yakın ağaçla aynı ölçek)
    const planes = [0, Math.PI / 2].map((a) => {
      const g = new THREE.PlaneGeometry(box.r - box.l, box.t - box.b);
      g.translate((box.l + box.r) / 2, (box.b + box.t) / 2, 0);
      g.rotateY(a);
      return g;
    });
    return { geo: mergeGeometries(planes), albedo, normal };
  }

  buildVegetation() {
    const r = rng(77);
    const k = this.keepout();
    const q = this.quality;
    const nearCount = q === 'dusuk' ? 900 : q === 'orta' ? 1600 : 2600;
    // uzak ağaçlar impostor (2 kart) olduğu için ucuz: dağlar çıplak kum tepesi gibi kalmasın
    const farCount = q === 'dusuk' ? 3000 : q === 'orta' ? 7000 : 13000;
    // koyu, hafif mavimsi çam yeşili (dal dokusunun sarı-turuncu tonları bastırılır)
    const foliageColor = new THREE.Color().setRGB(0.38, 0.49, 0.33);
    const barkColor = new THREE.Color().setRGB(1.3, 1.18, 1.05);
    const branchMat = new THREE.MeshStandardMaterial({
      // alpha-to-coverage yalnızca MSAA varken (Düşük'te MSAA yok: kenar pikselleri sızar)
      map: A.tex.branch || null, alphaTest: 0.4, alphaToCoverage: q !== 'dusuk', side: THREE.DoubleSide, roughness: 0.84, vertexColors: true,
    });
    if (A.tex.branch) branchMat.color.copy(foliageColor); else branchMat.color.set(0x2f4a2a);
    branchMat.envMapIntensity = 0.7;
    branchMat.emissive.setRGB(0.008, 0.012, 0.006); // taç içi tam siyaha düşmesin
    branchMat.onBeforeCompile = (sh) => {
      // çift yüzlü kartlarda arka yüz normali ters çevrilmesin: dışa bakan "hacim" normalleri korunur
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
      // dokunun saydam kenarındaki beyaz arka plan rengi (mip seviyelerinde) yaprağa sızmasın
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.35, 0.95, diffuseColor.a));');
      // güneşe karşı bakınca yaprak kenarlarından süzülen ışık (basit geçirgenlik)
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float bl = pow(clamp(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.0, 1.0), 4.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * bl * 0.18;
        #endif`);
    };
    branchMat.customProgramCacheKey = () => 'pineFoliage2';
    const barkMat = new THREE.MeshStandardMaterial({ map: A.tex.bark || null, normalMap: A.tex.barkNor || null, roughness: 0.95 });
    if (A.tex.bark) barkMat.color.copy(barkColor); else barkMat.color.set(0x4a3626);

    const near = [], far = [];
    let tries = 0;
    while ((near.length < nearCount || far.length < farCount) && tries < (nearCount + farCount) * 14) {
      tries++;
      const R = Math.pow(r(), 0.8) * 1300;
      const a = r() * Math.PI * 2;
      const x = Math.cos(a) * R, z = -this.D / 2 + Math.sin(a) * R;
      if (Math.abs(x) > 1060 || Math.abs(z + this.D / 2) > 1060) continue; // arazi ağının dışı
      if (x > k.x0 - 5 && x < k.x1 + 3 && z > k.z0 - 5 && z < k.z1 + 10) continue;
      if (x < k.x0 - 5 && x > k.x0 - 20 && z > k.z0 && z < k.z1 + 30) { if (r() < 0.8) continue; } // yol tarafı açık
      const dens = this.forestDensity(x, z);
      if (dens < -0.02 - smoothstep(300, 700, R) * 0.12 + r() * 0.22) continue;
      const h = this.terrainHeight(x, z);
      const dist = Math.hypot(x, z + this.D / 2);
      const s = (8 + r() * 9) * (1 + smoothstep(250, 900, dist) * 0.8);
      const it = { x, y: h - 0.3, z, s, rot: r() * Math.PI * 2, c: 0.8 + r() * 0.35, v: Math.floor(r() * 3), h: r() };
      if (dist < 190) { if (near.length < nearCount) near.push(it); }
      else if (far.length < farCount) far.push(it);
    }
    // fotoğraftaki gibi berm arkasında birkaç belirgin ağaç
    for (let i = 0; i < 30; i++) {
      const right = r() < 0.6;
      const x = right ? k.x1 + 1 + r() * 22 : k.x0 - 6 - r() * 18;
      const z = k.z0 - 4 + r() * (k.z1 - k.z0) * 0.75;
      near.push({ x, y: this.terrainHeight(x, z) - 0.3, z, s: 9 + r() * 7, rot: r() * 6, c: 0.85 + r() * 0.3, v: i % 3, h: r() });
    }
    // düşük kalitede yakın ağaçlar da sade geometriyi kullanır
    const variants = [0, 1, 2].map((i) => this.pineGeometry(100 + i * 17, q === 'dusuk'));
    const variantsLod = [0, 1, 2].map((i) => this.pineGeometry(300 + i * 17, true));
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const place = (t, i, meshes) => {
      qq.setFromAxisAngle(up, t.rot);
      sc.set(t.s * (0.9 + (t.c - 0.8)), t.s, t.s * (0.9 + (t.c - 0.8)));
      p.set(t.x, t.y, t.z);
      m4.compose(p, qq, sc);
      for (const m of meshes) m.setMatrixAt(i, m4);
      // ağaçtan ağaca ton farkı: bazıları daha sarımsı/kahverengimsi, bazıları daha koyu-mavimsi
      col.setRGB(t.c * (0.92 + t.h * 0.16), t.c, t.c * (1.02 - t.h * 0.14));
      meshes[0].setColorAt(i, col);
    };
    const mkInst = (list, vars, cast) => {
      for (let v = 0; v < 3; v++) {
        const L = list.filter((t) => t.v === v);
        if (!L.length) continue;
        const fm = new THREE.InstancedMesh(vars[v].foliage, branchMat, L.length);
        const tm = new THREE.InstancedMesh(vars[v].trunk, barkMat, L.length);
        L.forEach((t, i) => place(t, i, [fm, tm]));
        // GTAO derinlik geçişi alfa testini bilmez; kartlar dikdörtgen gölge lekesi bırakmasın
        fm.userData.noAO = true;
        fm.castShadow = tm.castShadow = cast;
        fm.receiveShadow = tm.receiveShadow = true;
        this.group.add(fm, tm);
      }
    };
    // Ayrıntılı + gölge düşüren ağaçlar yalnızca güneş gölge haritasının kapsadığı alanda
    // (InstancedMesh örnek başına kırpılmaz: dışarıdakiler gölge geçişinde boşuna çizilirdi).
    const dist = (t) => Math.hypot(t.x, t.z + this.D / 2);
    const nearR = Math.max(this.W, this.D) / 2 + 30;
    mkInst(near.filter((t) => dist(t) < nearR), variants, true);
    mkInst(near.filter((t) => dist(t) >= nearR), variantsLod, false);
    // uzak orman: impostor kartları (yakın ağaçtan çekilmiş renk + normal dokusu)
    let imp = null;
    if (A.tex.branch && A.tex.bark) {
      try { imp = this.impostors ||= variantsLod.map((vv) => this.bakeImpostor(vv, foliageColor, barkColor)); } catch (e) { console.warn('impostor', e); }
    }
    if (imp) {
      for (let v = 0; v < 3; v++) {
        const L = far.filter((t) => t.v === v);
        if (!L.length) continue;
        const mat = new THREE.MeshStandardMaterial({
          map: imp[v].albedo.texture, normalMap: imp[v].normal.texture, alphaTest: 0.45, alphaToCoverage: q !== 'dusuk',
          side: THREE.DoubleSide, roughness: 0.88,
        });
        mat.envMapIntensity = 0.7;
        const im = new THREE.InstancedMesh(imp[v].geo, mat, L.length);
        L.forEach((t, i) => place(t, i, [im]));
        im.receiveShadow = false;
        im.castShadow = false;
        im.userData.sharedGeo = true;
        im.userData.noAO = true;
        this.group.add(im);
      }
    } else mkInst(far, variantsLod, false);

    // ---- kayalar: taranmış modeller + küçük taşlar ----
    const rocks = [];
    // kayalar sette eşit serpiştirilmez: yuvarlanıp eteğe birikir, sırtta dozerin bıraktığı kümeler olur
    const clusters = Array.from({ length: 22 }, () => -this.D - 1 + r() * (this.D + 3));
    for (let i = 0; i < 260; i++) {
      const right = r() < 0.75;
      let x, z, y;
      if (r() < 0.65) {
        const zone = r();
        const off = zone < 0.5 ? 0.4 + Math.pow(r(), 1.6) * 2.2 : zone < 0.75 ? 6.2 + r() * 2.2 : 2.5 + r() * 3.5;
        x = (right ? 1 : -1) * (this.W / 2 + 0.6 + off);
        z = r() < 0.65 ? clusters[Math.floor(r() * clusters.length)] + (r() - 0.5) * 3 : -this.D - 2 + r() * (this.D + 4);
        y = this.bermHeight(x, z);
        if (y < 0.15) continue;
      } else {
        x = right ? k.x1 + r() * 70 : k.x0 - r() * 40;
        z = k.z0 - 30 + r() * (k.z1 - k.z0 + 30);
        y = this.terrainHeight(x, z);
        if (!right && r() < 0.6) continue;
      }
      rocks.push({ x, y: y - 0.1, z, s: 0.35 + Math.pow(r(), 2.4) * 1.6, rot: r() * 6, tilt: (r() - 0.5) * 0.4, m: r() < 0.5 ? 'rock1' : 'rock2' });
    }
    for (const key of ['rock1', 'rock2']) this.instModel(key, rocks.filter((t) => t.m === key), 1, true);

    // küçük taşlar (poligon kenarı ve berm eteği)
    const pebGeo = new THREE.DodecahedronGeometry(1, 1);
    const pp = pebGeo.attributes.position, rn = perlin(5);
    for (let i = 0; i < pp.count; i++) {
      const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i));
      v.multiplyScalar(1 + rn(v.x * 1.7, v.y * 1.7 + v.z) * 0.4);
      pp.setXYZ(i, v.x, v.y * 0.6, v.z);
    }
    pebGeo.computeVertexNormals();
    const pebMat = pbrMaterial('rock', { repeat: 0.5, color: 0xa89c8c });
    const pebs = [];
    for (let i = 0; i < 1100; i++) {
      const right = r() < 0.7;
      // çoğu set eteğinde birikir, yamaçta seyrek
      let x = (right ? 1 : -1) * (this.W / 2 + 0.5 + Math.pow(r(), 2.6) * 12);
      let z = r() < 0.5 ? clusters[Math.floor(r() * clusters.length)] + (r() - 0.5) * 5 : -this.D - 3 + r() * (this.D + 6);
      if (i % 3 === 0) { x = (r() - 0.5) * (this.W + 10); z = -this.D - 0.5 - Math.pow(r(), 2.2) * 14; }
      const y = this.bermHeight(x, z);
      pebs.push({ x, y, z, s: 0.05 + Math.pow(r(), 3.2) * 0.3, rot: r() * 6 });
    }
    // poligon zemininde küçük taşlar: kenarlarda ve kümeler halinde (çakıldan iri, seyrek)
    for (let i = 0; i < 1400; i++) {
      let x, z;
      if (r() < 0.55) {
        const side = r() < 0.5 ? -1 : 1;
        x = side * (this.W / 2 - Math.pow(r(), 2) * 2.5);
        z = -this.D + r() * (this.D + 13);
      } else {
        const cx = (r() - 0.5) * this.W * 0.9, cz = -this.D + r() * (this.D + 12);
        x = cx; z = cz;
        if (r() < 0.6) { x += (r() - 0.5) * 0.8; z += (r() - 0.5) * 0.8; }
      }
      const s = 0.012 + Math.pow(r(), 3) * 0.05;
      pebs.push({ x, y: 0.015 - s * 0.25, z, s, rot: r() * 6 });
    }
    const pm = new THREE.InstancedMesh(pebGeo, pebMat, pebs.length);
    const e = new THREE.Euler();
    pebs.forEach((t, i) => {
      e.set(t.rot, t.rot * 1.3, t.rot * 0.7);
      qq.setFromEuler(e);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), qq, new THREE.Vector3(t.s, t.s, t.s));
      pm.setMatrixAt(i, m4);
    });
    pm.castShadow = pm.receiveShadow = true;
    this.group.add(pm);

    // ---- çalılar ----
    const shrubs = [];
    for (let i = 0; i < (q === 'dusuk' ? 70 : 150); i++) {
      const right = r() < 0.55;
      let x = (right ? 1 : -1) * (this.W / 2 + 2 + r() * 12);
      let z = -this.D - 4 + r() * (this.D + 8);
      let y = this.bermHeight(x, z);
      if (r() < 0.5) {
        x = right ? k.x1 + r() * 35 : k.x0 - r() * 35;
        z = k.z0 + r() * (k.z1 - k.z0);
        y = this.terrainHeight(x, z);
      }
      shrubs.push({ x, y: y - 0.05, z, s: 0.7 + r() * 1.1, rot: r() * 6, tilt: 0 });
    }
    // zemin kenarında, tahta bordürün dibinde ve set eteğinde cılız ot öbekleri
    for (let i = 0; i < (q === 'dusuk' ? 40 : 110); i++) {
      const side = r();
      let x, z;
      if (side < 0.7) { x = (r() < 0.5 ? -1 : 1) * (this.W / 2 + (r() - 0.6) * 1.4); z = -this.D + r() * (this.D + 12); }
      else { x = (r() - 0.5) * this.W; z = -this.D - 0.3 - r() * 1.2; }
      const y = Math.max(this.bermHeight(x, z), Math.abs(x) < this.W / 2 && z > -this.D ? 0.015 : 0);
      shrubs.push({ x, y: y - 0.02, z, s: 0.18 + r() * 0.3, rot: r() * 6, tilt: (r() - 0.5) * 0.3 });
    }
    this.instModel('shrub', shrubs, 1, true);
  }

  /** Bir glTF modelini çok sayıda örnekle (instancing) yerleştir. */
  instModel(key, list, fit = 1, cast = true) {
    if (!list.length) return;
    const proto = modelClone(key, { fit });
    if (!proto) return;
    proto.updateMatrixWorld(true);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
    proto.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const im = new THREE.InstancedMesh(geo, o.material, list.length);
      list.forEach((t, i) => {
        e.set(t.tilt || 0, t.rot, (t.tilt || 0) * 0.7);
        qq.setFromEuler(e);
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), qq, new THREE.Vector3(t.s, t.s, t.s));
        im.setMatrixAt(i, m4);
      });
      im.castShadow = cast;
      im.receiveShadow = true;
      this.group.add(im);
    });
  }
}
