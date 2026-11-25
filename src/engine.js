import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vig: { value: 0.28 }, sat: { value: 1.08 }, con: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vig; uniform float sat; uniform float con; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat);
      c.rgb = (c.rgb - 0.5) * con + 0.5;
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * vig * 2.2;
      c.rgb *= clamp(v, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb,0.0,1.0), c.a); }`,
};
import { updateLabelScales } from './labels.js';
import { easeInOut } from './util.js';

export const QUALITY = {
  dusuk: { ad: 'Düşük', pr: 1, shadow: 1024, samples: 0, ao: false },
  orta: { ad: 'Orta', pr: 1, shadow: 2048, samples: 4, ao: false },
  yuksek: { ad: 'Yüksek', pr: 1.25, shadow: 4096, samples: 4, ao: true },
  ultra: { ad: 'Ultra', pr: 2, shadow: 4096, samples: 4, ao: true },
};

export class Engine {
  constructor(container) {
    this.container = container;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.55;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.id = 'gl';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.position.set(20, 16, 22);

    this.lineMats = new Set();
    this.onFrame = [];
    this.afterRender = [];
    this.tween = null;
    this.cinematic = null;
    this.quality = 'yuksek';
    this.hiddenForCapture = [];
    this.clock = new THREE.Clock();
    this.fps = 60;
  }

  /** Kontroller, kullanıcı etkileşim dinleyicileri eklendikten SONRA kurulmalı. */
  initControls() {
    const c = (this.controls = new OrbitControls(this.camera, this.renderer.domElement));
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI / 2 - 0.02;
    c.minDistance = 1.2;
    c.maxDistance = 400;
    c.zoomSpeed = 1.1;
    c.screenSpacePanning = false;
    c.target.set(0, 0, -18);
    c.addEventListener('start', () => {
      this.tween = null;
      if (this.autoOrbit) this.stopAutoOrbit();
    });
    c.addEventListener('change', () => {
      if (c.target.y < 0) c.target.y = 0;
    });
  }

  initComposer() {
    const q = QUALITY[this.quality];
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.samples });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.aoPass = null;
    if (q.ao) {
      this.aoPass = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.aoPass.output = GTAOPass.OUTPUT.Default;
      this.aoPass.blendIntensity = 0.9;
      this.aoPass.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1.5, scale: 1 });
      this.composer.addPass(this.aoPass);
    }
    const op = (this.outline = new OutlinePass(new THREE.Vector2(size.x, size.y), this.scene, this.camera));
    op.edgeStrength = 5;
    op.edgeGlow = 0.4;
    op.edgeThickness = 1.6;
    op.visibleEdgeColor.set('#ffb330');
    op.hiddenEdgeColor.set('#7a531a');
    op.selectedObjects = this._selected || [];
    this.composer.addPass(op);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
    this.resize();
  }

  setSelected(objs) {
    this._selected = objs;
    if (this.outline) this.outline.selectedObjects = objs;
  }

  setQuality(key, env) {
    this.quality = QUALITY[key] ? key : 'yuksek';
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    if (env) env.setShadowSize(q.shadow);
    this.initComposer();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.composer) {
      this.composer.setPixelRatio(1);
      this.composer.setSize(s.x, s.y);
    }
    if (this.aoPass) this.aoPass.setSize(s.x, s.y);
    for (const m of this.lineMats) m.resolution.set(w, h);
    updateLabelScales(this.camera, h);
  }

  registerLineMat(m) {
    this.lineMats.add(m);
    m.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
  }

  flyTo(pos, target, dur = 1.3) {
    this.stopAutoOrbit();
    this.tween = {
      t: 0, dur,
      p0: this.camera.position.clone(), p1: pos.clone(),
      t0: this.controls.target.clone(), t1: target.clone(),
    };
  }

  startAutoOrbit(center, radius, height, speed = 0.08) {
    this.tween = null;
    this.autoOrbit = { center: center.clone(), radius, height, speed, a: Math.atan2(this.camera.position.x - center.x, this.camera.position.z - center.z), blend: 0 };
  }
  stopAutoOrbit() {
    if (this.autoOrbit && this.onAutoOrbitStop) this.onAutoOrbitStop();
    this.autoOrbit = null;
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min(this.clock.getDelta(), 0.25);
      this.fps = this.fps * 0.95 + (1 / Math.max(dt, 0.001)) * 0.05;
      this.update(dt);
      this.composer.render();
      for (const f of this.afterRender) f();
    };
    loop();
  }

  update(dt) {
    if (this.cinematic) {
      this.cinematic(dt);
    } else if (this.tween) {
      const tw = this.tween;
      tw.t += dt / tw.dur;
      const k = easeInOut(Math.min(1, tw.t));
      this.camera.position.lerpVectors(tw.p0, tw.p1, k);
      this.controls.target.lerpVectors(tw.t0, tw.t1, k);
      if (tw.t >= 1) this.tween = null;
      this.controls.update();
    } else if (this.autoOrbit) {
      const o = this.autoOrbit;
      o.a += dt * o.speed;
      o.blend = Math.min(1, o.blend + dt * 0.6);
      const want = new THREE.Vector3(o.center.x + Math.sin(o.a) * o.radius, o.height, o.center.z + Math.cos(o.a) * o.radius);
      this.camera.position.lerp(want, o.blend < 1 ? 0.05 : 1);
      this.controls.target.lerp(o.center, 0.05);
      this.camera.lookAt(this.controls.target);
    } else {
      this.controls.update();
    }
    for (const f of this.onFrame) f(dt);
  }

  /** Yüksek çözünürlüklü ekran görüntüsü (PNG data URL). */
  capture(w = 2560, h = 1440) {
    const r = this.renderer;
    const oldPR = r.getPixelRatio();
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    const hidden = this.hiddenForCapture.filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const oldSel = this.outline.selectedObjects;
    this.outline.selectedObjects = [];
    r.setPixelRatio(1);
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    if (this.aoPass) this.aoPass.setSize(w, h);
    for (const m of this.lineMats) m.resolution.set(w, h);
    updateLabelScales(this.camera, h * 0.75);
    this.composer.render();
    const url = r.domElement.toDataURL('image/png');
    hidden.forEach((o) => (o.visible = true));
    this.outline.selectedObjects = oldSel;
    r.setPixelRatio(oldPR);
    r.setSize(cw, ch);
    this.resize();
    return url;
  }
}
