import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perlin, fbm, rng, smoothstep, clamp } from './util.js';
import { makeSignTexture } from './textures.js';

const TIMES = {
  sabah: { elev: 16, azim: 75, exposure: 0.85, sun: 3.0, sunColor: 0xffe0bc, fog: 0xc9d3dc },
  ogle: { elev: 52, azim: 30, exposure: 0.8, sun: 3.6, sunColor: 0xfff4e4, fog: 0xbfd0e2 },
  aksam: { elev: 11, azim: -55, exposure: 0.95, sun: 3.0, sunColor: 0xffc48a, fog: 0xdcc8b4 },
};

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

    // gökyüzü
    this.sky = new Sky();
    this.sky.scale.setScalar(3500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.2;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x8a7458, 0.35);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.sunDir = new THREE.Vector3();
  }

  setTime(key = 'ogle') {
    const t = TIMES[key] || TIMES.ogle;
    this.time = key;
    const phi = THREE.MathUtils.degToRad(90 - t.elev);
    const theta = THREE.MathUtils.degToRad(t.azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sun.color.set(t.sunColor);
    this.sun.intensity = t.sun;
    this.renderer.toneMappingExposure = t.exposure;
    this.scene.fog = new THREE.Fog(t.fog, 180, 1500);
    this.updateSunPosition();
    // ortam ışığı (IBL) gökyüzünden
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'])
      sky2.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    envScene.add(sky2);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0, 0.1, 2000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.75;
    sky2.geometry.dispose();
    sky2.material.dispose();
  }

  updateSunPosition() {
    const cz = -this.D / 2;
    const r = Math.max(this.W, this.D) / 2 + 30;
    this.sun.position.set(this.sunDir.x * 150, this.sunDir.y * 150, cz + this.sunDir.z * 150);
    this.sun.target.position.set(0, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 400;
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
    // yamaçlar: sağ taraf dik ve kayalık, sol yumuşak, arkada vadi ve uzakta dağlar
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
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const mm of ms) mm.dispose();
        }
      });
      this.group.remove(c);
    }
  }

  repeatTex(t, rx, ry) {
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  }

  buildTerrain() {
    const S = 2000, seg = 300;
    const geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -this.D / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const n = this.noise2;
    const dry = new THREE.Color(0.62, 0.54, 0.4);
    const forest = new THREE.Color(0.2, 0.25, 0.16);
    const rock = new THREE.Color(0.46, 0.45, 0.43);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.terrainHeight(x, z);
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nor.getY(i);
      const f = smoothstep(-0.1, 0.3, fbm(n, x / 90, z / 90, 4)) * smoothstep(1, 15, h);
      c.copy(dry).lerp(forest, f * 0.8);
      c.lerp(rock, smoothstep(0.25, 0.55, slope) * 0.6);
      const v = 0.9 + fbm(n, x / 12, z / 12, 2) * 0.25;
      col[i * 3] = c.r * v;
      col[i * 3 + 1] = c.g * v;
      col[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({
      map: this.repeatTex(this.tex.dirtDark, S / 5, S / 5),
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
  }

  buildBerms() {
    const k = this.keepout();
    const w = k.x1 - k.x0, d = k.z1 - k.z0;
    const sx = Math.ceil(w / 0.5), sz = Math.ceil(d / 0.5);
    const geo = new THREE.PlaneGeometry(w, d, sx, sz);
    geo.rotateX(-Math.PI / 2);
    geo.translate((k.x0 + k.x1) / 2, 0, (k.z0 + k.z1) / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.bermHeight(x, z));
      uv.setXY(i, x / 5, z / 5);
    }
    geo.computeVertexNormals();
    const col = new Float32Array(pos.count * 3);
    const n = this.noise;
    const nor = geo.attributes.normal;
    const soil = new THREE.Color(0.74, 0.65, 0.52);
    const rocky = new THREE.Color(0.52, 0.5, 0.47);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const slope = 1 - nor.getY(i);
      const r = x > 0 ? smoothstep(0.5, 2, h) * 0.8 : smoothstep(1, 2.5, h) * 0.35;
      c.copy(soil).lerp(rocky, clamp(r + fbm(n, x / 4, z / 4, 3) * 0.6, 0, 1));
      const v = 0.85 + fbm(n, x / 2, z / 2, 2) * 0.3 - slope * 0.1;
      col[i * 3] = c.r * v;
      col[i * 3 + 1] = c.g * v;
      col[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.dirt, vertexColors: true, roughness: 1 });
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
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * W) / 3.2, (uv.getY(i) * L) / 3.2);
    const mat = new THREE.MeshStandardMaterial({
      map: this.tex.gravel,
      bumpMap: this.tex.gravelBump,
      bumpScale: 3,
      roughness: 0.96,
      metalness: 0,
    });
    const floor = new THREE.Mesh(geo, mat);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    this.floor = floor;

    // ahşap kenar bordürleri
    const wm = new THREE.MeshStandardMaterial({ map: this.tex.wood, roughness: 0.85 });
    const mk = (w, h, d, x, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uvs = g.attributes.uv;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * Math.max(w, d) / 2, uvs.getY(i) * 0.2);
      const m = new THREE.Mesh(g, wm);
      m.position.set(x, h / 2, z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    };
    mk(0.16, 0.14, L, -W / 2 - 0.08, -D + L / 2);
    mk(0.16, 0.14, L, W / 2 + 0.08, -D + L / 2);
    mk(W + 0.32, 0.14, 0.16, 0, -D - 0.08);
  }

  buildShelter() {
    const { W } = this;
    const g = new THREE.Group();
    g.position.set(-W / 2 - 6.2, 0, 5);
    const wood = new THREE.MeshStandardMaterial({ map: this.tex.wood, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.6, metalness: 0.6 });
    const roofTex = this.repeatTex(this.tex.roof, 2, 1);
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.45, metalness: 0.65, side: THREE.DoubleSide });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // beton zemin
    add(new THREE.BoxGeometry(5.6, 0.12, 7.4), new THREE.MeshStandardMaterial({ color: 0x9a9893, roughness: 0.95 }), 0, 0.06, 0);
    const postGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
    for (const [x, z, h] of [[-2.5, -3.4, 2.9], [2.5, -3.4, 2.5], [-2.5, 3.4, 2.9], [2.5, 3.4, 2.5], [-2.5, 0, 2.9], [2.5, 0, 2.5]]) {
      const p = add(postGeo, steel, x, h / 2, z);
      p.scale.y = h;
    }
    const roof = add(new THREE.BoxGeometry(6.2, 0.05, 7.9), roofMat, 0, 2.78, 0, 0, 0, -Math.atan(0.4 / 5));
    roof.castShadow = true;
    // masalar ve banklar
    for (const z of [-2, 1.2]) {
      add(new THREE.BoxGeometry(1.0, 0.06, 2.4), wood, 0.2, 0.76, z);
      for (const [lx, lz] of [[-0.35, -1.0], [0.75, -1.0], [-0.35, 1.0], [0.75, 1.0]]) add(new THREE.BoxGeometry(0.07, 0.74, 0.07), wood, lx, 0.39, z + lz);
      for (const bx of [-0.75, 1.15]) {
        add(new THREE.BoxGeometry(0.32, 0.05, 2.4), wood, bx, 0.45, z);
        add(new THREE.BoxGeometry(0.06, 0.43, 0.06), wood, bx, 0.22, z - 1.0);
        add(new THREE.BoxGeometry(0.06, 0.43, 0.06), wood, bx, 0.22, z + 1.0);
      }
    }
    this.group.add(g);

    // kural tabelası
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
        uvA.push(s * 0.5 + 0.5, t * curve.getLength() / 4);
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
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.dirt, color: 0xe6dccb, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    this.group.add(m);
  }

  buildVegetation() {
    const r = rng(77);
    const k = this.keepout();
    const treeCount = this.quality === 'dusuk' ? 2500 : this.quality === 'orta' ? 4500 : 7000;
    // çam ağacı geometrisi
    const trunk = new THREE.CylinderGeometry(0.09, 0.16, 1.4, 6);
    trunk.translate(0, 0.7, 0);
    const cones = [];
    const tiers = [[1.5, 2.4, 1.6], [1.2, 2.1, 2.7], [0.9, 1.8, 3.7], [0.55, 1.4, 4.6]];
    for (const [rad, h, y] of tiers) {
      const c = new THREE.ConeGeometry(rad, h, 9, 1);
      c.translate(0, y, 0);
      cones.push(c);
    }
    const foliage = mergeGeometries(cones);
    {
      // dalları doğal göstermek için düzensizlik
      const fp = foliage.attributes.position, jn = perlin(17);
      for (let i = 0; i < fp.count; i++) {
        const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
        if (Math.hypot(x, z) < 0.05) continue;
        const f = 1 + jn(x * 2.3 + y * 1.7, z * 2.3 - y) * 0.45;
        fp.setXYZ(i, x * f, y + jn(x * 3.1, z * 3.1 + y) * 0.18, z * f);
      }
      foliage.computeVertexNormals();
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
    const folMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });

    const near = [], far = [];
    const n = this.noise;
    let tries = 0;
    while (near.length + far.length < treeCount && tries < treeCount * 12) {
      tries++;
      const R = Math.pow(r(), 0.75) * 900;
      const a = r() * Math.PI * 2;
      const x = Math.cos(a) * R, z = -this.D / 2 + Math.sin(a) * R;
      if (x > k.x0 - 6 && x < k.x1 + 4 && z > k.z0 - 6 && z < k.z1 + 10) continue;
      const dens = fbm(n, x / 90, z / 90, 4);
      if (dens < -0.12 + r() * 0.14) continue;
      const h = this.terrainHeight(x, z);
      const dist = Math.hypot(x, z + this.D / 2);
      const s = (0.75 + r() * 0.9) * (1 + smoothstep(150, 800, dist) * 1.4);
      const item = { x, y: h - 0.2, z, s, rot: r() * Math.PI * 2, c: 0.75 + r() * 0.4 };
      (dist < 140 ? near : far).push(item);
    }
    // kenarlarda birkaç yakın ağaç (fotoğraftaki gibi)
    for (let i = 0; i < 26; i++) {
      const right = r() < 0.65;
      const x = right ? k.x1 + 2 + r() * 20 : k.x0 - 4 - r() * 18;
      const z = k.z0 + r() * (k.z1 - k.z0) * 0.8;
      near.push({ x, y: this.terrainHeight(x, z) - 0.2, z, s: 0.9 + r() * 0.8, rot: r() * 6, c: 0.8 + r() * 0.3 });
    }
    const mkInst = (list, cast) => {
      if (!list.length) return;
      const tm = new THREE.InstancedMesh(trunk, trunkMat, list.length);
      const fm = new THREE.InstancedMesh(foliage, folMat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      const col = new THREE.Color();
      list.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        sc.set(t.s, t.s * (0.9 + (t.c - 0.75) * 0.6), t.s);
        p.set(t.x, t.y, t.z);
        m4.compose(p, q, sc);
        tm.setMatrixAt(i, m4);
        fm.setMatrixAt(i, m4);
        col.setRGB(0.045 * t.c, 0.075 * t.c, 0.038 * t.c);
        fm.setColorAt(i, col);
      });
      tm.castShadow = fm.castShadow = cast;
      tm.receiveShadow = fm.receiveShadow = true;
      this.group.add(tm, fm);
    };
    mkInst(near, true);
    mkInst(far, false);

    // kayalar (berm ve yamaçlarda)
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rp = rockGeo.attributes.position;
    const rn = perlin(5);
    for (let i = 0; i < rp.count; i++) {
      const v = new THREE.Vector3(rp.getX(i), rp.getY(i), rp.getZ(i));
      const f = 1 + rn(v.x * 1.7, v.y * 1.7 + v.z) * 0.45;
      v.multiplyScalar(f);
      rp.setXYZ(i, v.x, v.y * 0.7, v.z);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
    const rocks = [];
    for (let i = 0; i < 900; i++) {
      const right = r() < 0.72;
      let x, z, y;
      if (r() < 0.7) {
        // berm üzerinde
        x = (right ? 1 : -1) * (this.W / 2 + 0.8 + r() * 12);
        z = -this.D - 2 + r() * (this.D + 6);
        y = this.bermHeight(x, z);
        if (y < 0.2) continue;
      } else {
        x = right ? k.x1 + r() * 60 : k.x0 - r() * 40;
        z = k.z0 - 20 + r() * (k.z1 - k.z0 + 20);
        y = this.terrainHeight(x, z);
      }
      if (!right && r() < 0.5) continue;
      rocks.push({ x, y, z, s: 0.1 + Math.pow(r(), 2.8) * 0.6, c: 0.055 + r() * 0.06, rot: r() * 6 });
    }
    // arka set hedef bölgesinde birkaç taş
    const rm = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const col = new THREE.Color();
    rocks.forEach((t, i) => {
      e.set(t.rot, t.rot * 1.3, t.rot * 0.7);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      rm.setMatrixAt(i, m4);
      col.setRGB(t.c * 1.05, t.c, t.c * 0.92);
      rm.setColorAt(i, col);
    });
    rm.castShadow = true;
    rm.receiveShadow = true;
    this.group.add(rm);

    // çalılar
    const bushGeo = new THREE.IcosahedronGeometry(0.6, 1);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
    const bushes = [];
    for (let i = 0; i < 260; i++) {
      const right = r() < 0.6;
      let x = (right ? 1 : -1) * (this.W / 2 + 1 + r() * 13);
      let z = -this.D - 4 + r() * (this.D + 8);
      let y = this.bermHeight(x, z);
      if (r() < 0.45) {
        x = right ? k.x1 + r() * 30 : k.x0 - r() * 30;
        z = k.z0 + r() * (k.z1 - k.z0);
        y = this.terrainHeight(x, z);
      }
      bushes.push({ x, y, z, s: 0.4 + r() * 0.9, c: 0.7 + r() * 0.4 });
    }
    const bm = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
    bushes.forEach((t, i) => {
      m4.compose(new THREE.Vector3(t.x, t.y + t.s * 0.25, t.z), q.identity(), new THREE.Vector3(t.s, t.s * 0.7, t.s));
      bm.setMatrixAt(i, m4);
      col.setRGB(0.05 * t.c, 0.065 * t.c, 0.028 * t.c);
      bm.setColorAt(i, col);
    });
    bm.castShadow = true;
    bm.receiveShadow = true;
    this.group.add(bm);
  }
}
