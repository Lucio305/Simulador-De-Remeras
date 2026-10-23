// "Mesa giratoria": usa los OrbitControls del motor (arrastre, inercia, rueda, pellizco) pero
// convierte el giro horizontal de la cámara en giro de la remera. Así la luz de los spots sigue
// pegando de frente y se puede dar la vuelta completa sin mirar hacia la pared abierta del taller.
// El giro vertical y el zoom (hacia el cursor) quedan en la cámara, con límites.

import * as THREE from 'three';
import { clamp, easeInOutCubic } from '../../core/utils.js';

const TAU = Math.PI * 2;

export function createTurntable(ctx, { object, center, minDistance = 0.45, maxDistance = 2.4 }) {
  const { engine } = ctx;
  const c = engine.controls;
  const cam = engine.camera;
  const saved = {
    zoomToCursor: c.zoomToCursor,
    rotateSpeed: c.rotateSpeed,
    zoomSpeed: c.zoomSpeed,
    dampingFactor: c.dampingFactor,
    maxTargetRadius: c.maxTargetRadius,
    minTargetRadius: c.minTargetRadius,
    cursor: c.cursor.clone(),
  };
  ctx.track(() => {
    c.zoomToCursor = saved.zoomToCursor;
    c.rotateSpeed = saved.rotateSpeed;
    c.zoomSpeed = saved.zoomSpeed;
    c.dampingFactor = saved.dampingFactor;
    c.maxTargetRadius = saved.maxTargetRadius;
    c.minTargetRadius = saved.minTargetRadius;
    c.cursor.copy(saved.cursor);
  });
  const ctr = center.clone();
  const sph = new THREE.Spherical();
  const off = new THREE.Vector3();
  let on = false;
  let yaw = object.rotation.y;
  let tween = null;
  let keyVel = 0;
  let keyTarget = 0;
  let dragging = false;
  let spin = 0; // velocidad angular de la remera (para el "sonido" y la UI)

  ctx.listen(c, 'start', () => {
    dragging = true;
    tween = null;
  });
  ctx.listen(c, 'end', () => (dragging = false));

  const api = {
    get yaw() {
      return yaw;
    },
    get dragging() {
      return dragging;
    },
    get enabled() {
      return on;
    },
    get spin() {
      return spin;
    },
    get turning() {
      return !!tween;
    },
    enable(opts = {}) {
      on = true;
      c.zoomToCursor = true;
      c.rotateSpeed = 0.85;
      c.zoomSpeed = 1.1;
      c.dampingFactor = 0.09;
      c.cursor.copy(ctr);
      c.maxTargetRadius = opts.maxTargetRadius ?? 0.34;
      c.minTargetRadius = 0;
      engine.setOrbit({
        enabled: true,
        target: opts.target || engine.controls.target.clone(),
        minDistance: opts.minDistance ?? minDistance,
        maxDistance: opts.maxDistance ?? maxDistance,
        minPolarAngle: opts.minPolarAngle ?? Math.PI * 0.3,
        maxPolarAngle: opts.maxPolarAngle ?? Math.PI * 0.6,
        enablePan: false,
        enableZoom: true,
      });
    },
    disable() {
      on = false;
      dragging = false;
      engine.setOrbit({ enabled: false });
      c.zoomToCursor = saved.zoomToCursor;
    },
    // gira la remera a un ángulo (radianes), por el camino más corto salvo que se pida otra cosa
    turnTo(to, dur = 0.9, { shortest = true } = {}) {
      // corta la inercia que haya dejado un arrastre: si no, el resto del "envión" de los
      // OrbitControls seguía girando y cancelaba el giro pedido a mitad de camino
      if (c._sphericalDelta) c._sphericalDelta.theta = 0;
      let target = to;
      if (shortest) {
        const d = ((((to - yaw) % TAU) + TAU * 1.5) % TAU) - Math.PI;
        target = yaw + d;
      }
      return new Promise((resolve) => {
        if (Math.abs(target - yaw) < 1e-4 || dur <= 0) {
          yaw = target;
          object.rotation.y = yaw;
          tween = null;
          return resolve();
        }
        tween = { from: yaw, to: target, t: 0, dur, resolve };
      });
    },
    turnBy(delta, dur = 0.8) {
      return api.turnTo(yaw + delta, dur, { shortest: false });
    },
    // cara que se ve: 'frente' o 'espalda'
    facing() {
      const a = ((yaw % TAU) + TAU) % TAU;
      return a > Math.PI / 2 && a < (Math.PI * 3) / 2 ? 'espalda' : 'frente';
    },
    flip(dur = 0.95) {
      const to = api.facing() === 'frente' ? Math.PI : 0;
      return api.turnTo(to, dur);
    },
    setKeySpin(dir) {
      keyTarget = dir;
    },
    snap() {
      tween = null;
      object.rotation.y = yaw;
    },
    setYaw(v) {
      yaw = v;
      object.rotation.y = v;
    },
    update(dt) {
      const prev = yaw;
      if (tween) {
        tween.t = Math.min(1, tween.t + dt / tween.dur);
        yaw = tween.from + (tween.to - tween.from) * easeInOutCubic(tween.t);
        if (tween.t >= 1) {
          const r = tween.resolve;
          tween = null;
          r();
        }
      }
      keyVel += (keyTarget * 2.2 - keyVel) * clamp(dt * 9, 0, 1);
      if (Math.abs(keyVel) > 1e-3) {
        tween = null;
        yaw += keyVel * dt;
      }
      if (on && !engine.flying && c.enabled) {
        off.copy(cam.position).sub(c.target);
        sph.setFromVector3(off);
        if (api._theta0 === undefined) api._theta0 = sph.theta;
        const d = sph.theta - api._theta0;
        if (Math.abs(d) > 1e-7) {
          // el giro horizontal de la cámara pasa a la remera; durante un giro animado solo lo
          // interrumpe un arrastre real (la inercia residual se descarta)
          if (!tween || dragging) {
            yaw -= d;
            tween = null;
          }
          sph.theta = api._theta0;
          off.setFromSpherical(sph);
          cam.position.copy(c.target).add(off);
          cam.lookAt(c.target);
        }
      }
      object.rotation.y = yaw;
      spin = dt > 0 ? (yaw - prev) / dt : 0;
    },
    // azimut de referencia de la cámara (frente de la remera) — se fija al llegar a una vista
    resetAzimuth() {
      off.copy(cam.position).sub(c.target);
      sph.setFromVector3(off);
      api._theta0 = sph.theta;
    },
  };
  return api;
}
