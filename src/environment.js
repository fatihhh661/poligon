import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perlin, fbm, rng, smoothstep, clamp } from './util.js';
import { makeSignTexture } from './textures.js';
import { A, loadSky, analyzeSky, pbrMaterial, modelClone } from './assets.js';

const TIMES = {
  sabah: { exposure: 1.0, sun: 3.4, sunColor: 0xffe2c4, bg: 1.0, env: 1.0, fallback: { elev: 16, azim: 75 } },
  ogle: { exposure: 0.95, sun: 3.6, sunColor: 0xfff3e2, bg: 1.0, env: 1.0, fallback: { elev: 52, azim: 30 } },
  aksam: { exposure: 1.15, sun: 3.2, sunColor: 0xffc590, bg: 1.0, env: 1.0, fallback: { elev: 11, azim: -55 } },
};

/** Arazi için 3 dokulu karışım (splat) malzemesi + döşeme tekrarını kıran makro varyasyon */
function splatMaterial(a, b, c, sb = 1, sc = 1, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughness: 1, ...opts });
  m.normalScale.set(0.9, 0.9);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tB = { value: b.map };
    sh.uniforms.tC = { value: c.map };
    sh.uniforms.sB = { value: sb };
    sh.uniforms.sC = { value: sc };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tB;\nuniform sampler2D tC;\nuniform float sB;\nuniform float sC;\nvarying vec3 vSplat;')
      .replace('#include <map_fragment>', `
        vec3 sw = vSplat / max(1e-4, vSplat.x + vSplat.y + vSplat.z);
        vec4 ca = texture2D(map, vMapUv);
        vec4 cb = texture2D(tB, vMapUv * sB);
        vec4 cc = texture2D(tC, vMapUv * sC);
        vec4 tcol = ca * sw.x + cb * sw.y + cc * sw.z;
        float macro = texture2D(map, vMapUv * 0.037).g * 0.55 + texture2D(tB, vMapUv * 0.013).g * 0.45;
        tcol.rgb *= 0.62 + macro * 0.95;
        diffuseColor *= tcol;`);
  };
  m.customProgramCacheKey = () => 'splat3';
  return m;
}

/** Tekdüze dokularda tekrar desenini kırmak için düşük frekanslı parlaklık değişimi */
function addMacro(m, k = 0.06, amt = 0.5) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float mcr = texture2D(map, vMapUv * ${k.toFixed(4)}).g * 0.6 + texture2D(map, vMapUv * ${(k * 0.31).toFixed(4)}).r * 0.4;
      diffuseColor.rgb *= ${(1 - amt).toFixed(3)} + mcr * ${(amt * 2).toFixed(3)};`);
  };
  m.customProgramCacheKey = () => 'macro' + k + amt;
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
      this.scene.fog = new THREE.Fog(hz, 220, 1900);
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
      this.scene.fog = new THREE.Fog(0xbfd0e2, 180, 1500);
    }
    this.sun.color.set(t.sunColor);
    this.sun.intensity = t.sun;
    this.renderer.toneMappingExposure = t.exposure;
    this.updateSunPosition();
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

  bermHeight(x, z) {
    const { W, D } = this;
    const right = x > 0;
    const Hs = right ? 4.2 : 2.6;
    const ax = Math.abs(x) - W / 2;
    let s = 0;
    if (ax > 0) {
      if (ax < 6) s = Hs * smoothstep(0, 6, ax);
      else if (ax < 8.5) s = Hs;
      else if (ax < 13.5) s = Hs * (1 - smoothstep(8.5, 13.5, ax));
    }
    s *= smoothstep(8, -2, z);
    const Hb = 6.5;
    const bz = -D - z;
    let b = 0;
    if (bz > 0) {
      if (bz < 6) b = Hb * smoothstep(0, 6, bz);
      else if (bz < 10) b = Hb;
      else if (bz < 15.5) b = Hb * (1 - smoothstep(10, 15.5, bz));
    }
    const h = Math.max(s, b);
    if (h > 0.05) return h + fbm(this.noise2, x * 0.25, z * 0.25, 3) * 0.6 * Math.min(1, h);
    return 0;
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
    h += smoothstep(450, 1000, R) * (90 + fbm(n, x / 300 + 3, z / 300 + 3, 4) * 150);
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
    const P = A.pbr;
    const mat = P.grass ? splatMaterial(P.grass, P.forest, P.rock, 1.2, 0.6, { color: 0xb3a690 }) : new THREE.MeshStandardMaterial({ color: 0x9a8a6a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
  }

  buildBerms() {
    const k = this.keepout();
    const w = k.x1 - k.x0, d = k.z1 - k.z0;
    const sx = Math.ceil(w / 0.45), sz = Math.ceil(d / 0.45);
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
    const P = A.pbr;
    const mat = P.berm ? splatMaterial(P.berm, P.rock, P.grass, 0.7, 0.8) : new THREE.MeshStandardMaterial({ color: 0xb8a07a });
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
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * W) / 2.4, (uv.getY(i) * L) / 2.4);
    const mat = A.pbr.gravel ? addMacro(pbrMaterial('gravel', { normalScale: 1.4 }), 0.045, 0.32) : new THREE.MeshStandardMaterial({ map: this.tex.gravel, roughness: 0.95 });
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
  pineGeometry(seed, lod) {
    const r = rng(seed);
    const cards = [];
    const tiers = lod ? 8 : 15;
    const perTier = lod ? 4 : 6;
    const base = 0.16 + r() * 0.06;
    for (let t = 0; t < tiers; t++) {
      const f = t / (tiers - 1);
      const y = base + f * (0.97 - base);
      const L = 0.04 + 0.27 * Math.pow(1 - f, 0.85) * (0.85 + r() * 0.3);
      const n = Math.max(3, Math.round(perTier * (1 - f * 0.4)));
      const off = r() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const az = off + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
        const droop = -0.15 - (1 - f) * 0.35 + (r() - 0.5) * 0.2;
        for (const roll of lod ? [r() * 0.6] : [r() * 0.5, Math.PI / 2 + (r() - 0.5) * 0.4]) {
          const g = new THREE.PlaneGeometry(L, L * 0.5);
          g.translate(L / 2, 0, 0);
          g.rotateX(roll);
          g.rotateZ(droop);
          g.rotateY(az);
          g.translate(0, y, 0);
          // dışa doğru normaller (hacimli ışık)
          const p = g.attributes.position, nn = g.attributes.normal;
          for (let k = 0; k < p.count; k++) {
            const v = new THREE.Vector3(p.getX(k), (p.getY(k) - y) * 0.6 + 0.35 * L, p.getZ(k)).normalize();
            nn.setXYZ(k, v.x, v.y, v.z);
          }
          cards.push(g);
        }
      }
    }
    // tepe
    for (const ry of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(0.09, 0.16);
      g.rotateZ(Math.PI / 2);
      g.rotateY(ry);
      g.translate(0, 1.0, 0);
      cards.push(g);
    }
    const foliage = mergeGeometries(cards);
    const trunk = new THREE.CylinderGeometry(0.007, 0.022, 1.0, lod ? 5 : 8, 1, true);
    trunk.translate(0, 0.5, 0);
    const tuv = trunk.attributes.uv;
    for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 2, tuv.getY(i) * 8);
    return { foliage, trunk };
  }

  buildVegetation() {
    const r = rng(77);
    const k = this.keepout();
    const q = this.quality;
    const nearCount = q === 'dusuk' ? 900 : q === 'orta' ? 1600 : 2600;
    const farCount = q === 'dusuk' ? 2500 : q === 'orta' ? 4500 : 7000;
    const branchMat = new THREE.MeshStandardMaterial({
      map: A.tex.branch || null, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.88, color: A.tex.branch ? 0xffffff : 0x2f4a2a,
    });
    const barkMat = new THREE.MeshStandardMaterial({ map: A.tex.bark || null, normalMap: A.tex.barkNor || null, roughness: 0.95, color: A.tex.bark ? 0xffffff : 0x4a3626 });

    const near = [], far = [];
    let tries = 0;
    while ((near.length < nearCount || far.length < farCount) && tries < (nearCount + farCount) * 14) {
      tries++;
      const R = Math.pow(r(), 0.8) * 950;
      const a = r() * Math.PI * 2;
      const x = Math.cos(a) * R, z = -this.D / 2 + Math.sin(a) * R;
      if (x > k.x0 - 5 && x < k.x1 + 3 && z > k.z0 - 5 && z < k.z1 + 10) continue;
      if (x < k.x0 - 5 && x > k.x0 - 20 && z > k.z0 && z < k.z1 + 30) { if (r() < 0.8) continue; } // yol tarafı açık
      const dens = this.forestDensity(x, z);
      if (dens < -0.02 + r() * 0.22) continue;
      const h = this.terrainHeight(x, z);
      const dist = Math.hypot(x, z + this.D / 2);
      const s = (8 + r() * 9) * (1 + smoothstep(250, 900, dist) * 0.8);
      const it = { x, y: h - 0.3, z, s, rot: r() * Math.PI * 2, c: 0.8 + r() * 0.35, v: Math.floor(r() * 3) };
      if (dist < 190) { if (near.length < nearCount) near.push(it); }
      else if (far.length < farCount) far.push(it);
    }
    // fotoğraftaki gibi berm arkasında birkaç belirgin ağaç
    for (let i = 0; i < 30; i++) {
      const right = r() < 0.6;
      const x = right ? k.x1 + 1 + r() * 22 : k.x0 - 6 - r() * 18;
      const z = k.z0 - 4 + r() * (k.z1 - k.z0) * 0.75;
      near.push({ x, y: this.terrainHeight(x, z) - 0.3, z, s: 9 + r() * 7, rot: r() * 6, c: 0.85 + r() * 0.3, v: i % 3 });
    }
    const variants = [0, 1, 2].map((i) => this.pineGeometry(100 + i * 17, false));
    const variantsLod = [0, 1, 2].map((i) => this.pineGeometry(300 + i * 17, true));
    const mkInst = (list, vars, cast) => {
      for (let v = 0; v < 3; v++) {
        const L = list.filter((t) => t.v === v);
        if (!L.length) continue;
        const fm = new THREE.InstancedMesh(vars[v].foliage, branchMat, L.length);
        const tm = new THREE.InstancedMesh(vars[v].trunk, barkMat, L.length);
        const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
        L.forEach((t, i) => {
          qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
          sc.set(t.s * (0.9 + (t.c - 0.8)), t.s, t.s * (0.9 + (t.c - 0.8)));
          p.set(t.x, t.y, t.z);
          m4.compose(p, qq, sc);
          fm.setMatrixAt(i, m4);
          tm.setMatrixAt(i, m4);
          col.setRGB(0.95 * t.c, 1.0 * t.c, 0.9 * t.c);
          fm.setColorAt(i, col);
        });
        fm.castShadow = tm.castShadow = cast;
        fm.receiveShadow = tm.receiveShadow = true;
        this.group.add(fm, tm);
      }
    };
    mkInst(near.filter((t) => Math.hypot(t.x, t.z + this.D / 2) < 85), variants, true);
    mkInst(near.filter((t) => Math.hypot(t.x, t.z + this.D / 2) >= 85), variants, false);
    mkInst(far, variantsLod, false);

    // ---- kayalar: taranmış modeller + küçük taşlar ----
    const rocks = [];
    for (let i = 0; i < 260; i++) {
      const right = r() < 0.75;
      let x, z, y;
      if (r() < 0.65) {
        x = (right ? 1 : -1) * (this.W / 2 + 1 + r() * 12);
        z = -this.D - 2 + r() * (this.D + 4);
        y = this.bermHeight(x, z);
        if (y < 0.4) continue;
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
    const pebMat = pbrMaterial('rock', { repeat: 0.5 });
    const pebs = [];
    for (let i = 0; i < 1100; i++) {
      const right = r() < 0.7;
      let x = (right ? 1 : -1) * (this.W / 2 + 0.3 + Math.pow(r(), 1.5) * 12);
      let z = -this.D - 3 + r() * (this.D + 6);
      if (i % 3 === 0) { x = (r() - 0.5) * (this.W + 10); z = -this.D - 0.3 - Math.pow(r(), 1.3) * 14; }
      const y = this.bermHeight(x, z);
      pebs.push({ x, y, z, s: 0.06 + Math.pow(r(), 3) * 0.3, rot: r() * 6 });
    }
    const pm = new THREE.InstancedMesh(pebGeo, pebMat, pebs.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler();
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
