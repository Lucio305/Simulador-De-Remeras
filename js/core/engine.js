// Motor 3D: renderer, escena, cámara, controles orbitales, luces,
// transiciones de cámara y utilidades de puntero / raycasting.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { easeInOutCubic } from './utils.js';

const toV3 = (v) => (v && v.isVector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]));

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#d9cbb8');
    this.scene.fog = new THREE.Fog('#d9cbb8', 14, 30);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 60);
    this.camera.position.set(0, 2.7, 7.2);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enabled = false;
    this.controls.target.set(0, 1, -1);

    this._updaters = new Set();
    this._pointerHandlers = new Set();
    this._flight = null;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = { ndc: new THREE.Vector2(), x: 0, y: 0, down: false, buttons: 0, inside: false };

    this._setupLights();
    this._setupPointer();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    this.renderer.setAnimationLoop(() => this._tick());
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight('#fff6ea', '#7a6450', 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    sun.position.set(-3, 7, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 20;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
    sun.target.position.set(0, 0, -1);

    const fill = new THREE.DirectionalLight('#dbe8ff', 0.6);
    fill.position.set(5, 3, 6);
    this.scene.add(fill);

    this.lights = { hemi, sun, fill };
  }

  _setupPointer() {
    const c = this.canvas;
    const update = (e) => {
      const r = c.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.ndc.set((this.pointer.x / r.width) * 2 - 1, -(this.pointer.y / r.height) * 2 + 1);
    };
    const dispatch = (type, e) => {
      for (const h of [...this._pointerHandlers]) if (h.type === type) h.fn(e, this.pointer);
    };
    c.addEventListener('pointerdown', (e) => {
      update(e);
      this.pointer.down = true;
      this.pointer.buttons = e.buttons;
      dispatch('down', e);
    });
    window.addEventListener('pointermove', (e) => {
      update(e);
      this.pointer.buttons = e.buttons;
      dispatch('move', e);
    });
    window.addEventListener('pointerup', (e) => {
      update(e);
      this.pointer.down = false;
      this.pointer.buttons = 0;
      dispatch('up', e);
    });
    c.addEventListener('pointerenter', () => (this.pointer.inside = true));
    c.addEventListener('pointerleave', () => (this.pointer.inside = false));
    c.addEventListener('wheel', (e) => dispatch('wheel', e), { passive: true });
  }

  // Registra un handler de puntero: type = 'down' | 'move' | 'up' | 'wheel'.
  // Devuelve una función para desregistrarlo.
  onPointer(type, fn) {
    const h = { type, fn };
    this._pointerHandlers.add(h);
    return () => this._pointerHandlers.delete(h);
  }

  // Registra una función que se llama cada frame con (dt, t). Devuelve "off".
  onUpdate(fn) {
    this._updaters.add(fn);
    return () => this._updaters.delete(fn);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Vuela la cámara a una vista. Devuelve una promesa que se resuelve al llegar.
  flyTo({ position, target, duration = 1.3, fov = null }) {
    const p1 = toV3(position);
    const t1 = toV3(target);
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const f0 = this.camera.fov;
    const f1 = fov ?? f0;
    if (this._flight) this._flight.resolve();
    if (duration <= 0) {
      this.camera.position.copy(p1);
      this.controls.target.copy(t1);
      this.camera.fov = f1;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(t1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._flight = { p0, p1, t0, t1, f0, f1, t: 0, duration, resolve };
    });
  }

  // Configura los controles orbitales. Llamar con { enabled: false } para desactivarlos.
  setOrbit(opts = {}) {
    const c = this.controls;
    c.enabled = !!opts.enabled;
    if (opts.target) c.target.copy(toV3(opts.target));
    c.minDistance = opts.minDistance ?? 0.3;
    c.maxDistance = opts.maxDistance ?? 6;
    c.minPolarAngle = opts.minPolarAngle ?? 0.15;
    c.maxPolarAngle = opts.maxPolarAngle ?? Math.PI * 0.55;
    c.minAzimuthAngle = opts.minAzimuthAngle ?? -Infinity;
    c.maxAzimuthAngle = opts.maxAzimuthAngle ?? Infinity;
    c.enablePan = opts.enablePan ?? false;
    c.enableZoom = opts.enableZoom ?? true;
    c.autoRotate = !!opts.autoRotate;
    c.autoRotateSpeed = opts.autoRotateSpeed ?? 1.2;
    c.update();
  }

  get flying() {
    return !!this._flight;
  }

  // Raycast desde el puntero actual (o un NDC dado) contra una lista de objetos.
  raycast(objects, ndc = null, recursive = true) {
    this.raycaster.setFromCamera(ndc || this.pointer.ndc, this.camera);
    const list = Array.isArray(objects) ? objects : [objects];
    return this.raycaster.intersectObjects(list.filter(Boolean), recursive);
  }

  // Intersección del rayo del puntero con un plano (THREE.Plane). Devuelve Vector3 o null.
  pointerOnPlane(plane, ndc = null) {
    this.raycaster.setFromCamera(ndc || this.pointer.ndc, this.camera);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  // Proyecta un punto del mundo a coordenadas de pantalla (px relativos al canvas).
  worldToScreen(v) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: (p.x * 0.5 + 0.5) * r.width, y: (-p.y * 0.5 + 0.5) * r.height, behind: p.z > 1 };
  }

  screenshot(type = 'image/png') {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL(type);
  }

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    if (this._flight) {
      const f = this._flight;
      f.t += dt / f.duration;
      const k = easeInOutCubic(Math.min(f.t, 1));
      this.camera.position.lerpVectors(f.p0, f.p1, k);
      this.controls.target.lerpVectors(f.t0, f.t1, k);
      this.camera.fov = f.f0 + (f.f1 - f.f0) * k;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.controls.target);
      if (f.t >= 1) {
        this._flight = null;
        f.resolve();
      }
    } else if (this.controls.enabled) {
      this.controls.update();
    } else {
      this.camera.lookAt(this.controls.target);
    }

    for (const fn of [...this._updaters]) {
      try {
        fn(dt, t);
      } catch (err) {
        console.error(err);
        this._updaters.delete(fn);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export { THREE };
