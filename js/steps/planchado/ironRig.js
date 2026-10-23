// Control de la plancha 3D del taller durante el paso: la lleva del apoya-plancha a la remera,
// la hace seguir al puntero (flotando o apoyada), la orienta según la dirección de las pasadas
// y la devuelve a su lugar. Guarda la pose original y la restaura al salir.

import * as THREE from 'three';
import { clamp } from '../../core/utils.js';

const TAU = Math.PI * 2;
const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

export function createIronRig(iron, board) {
  const g = iron.group;
  const saved = {
    parent: g.parent,
    position: g.position.clone(),
    rotation: g.rotation.clone(),
    scale: g.scale.clone(),
    visible: g.visible,
  };
  const rest = board.restPoint.clone();
  const pos = g.position.clone();
  const target = pos.clone();
  let yaw = 0;
  let yawGoal = 0;
  let pitch = 0;
  let mode = 'rest'; // 'rest' | 'follow'
  let contactY = rest.y;
  let pressing = false;
  let lastSpeed = 0;
  let snapNext = false;
  const prev = pos.clone();
  const tmp = new THREE.Vector3();

  const rig = {
    get position() {
      return pos;
    },
    get yaw() {
      return yaw;
    },
    get speed() {
      return lastSpeed;
    },
    get mode() {
      return mode;
    },
    // ¿Está la suela apoyada (bajó del todo) sobre la superficie pedida?
    get inContact() {
      return mode === 'follow' && pressing && Math.abs(pos.y - contactY) < 0.004;
    },
    // Dirección de la punta en el mundo (XZ).
    tipDir(out = new THREE.Vector3()) {
      return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
    },
    // Sigue un punto (x, z) del mundo; y = altura de apoyo de la suela.
    follow(x, z, y, press, snap = false) {
      if (mode === 'rest' && pos.distanceTo(rest) < 0.02) {
        // al despegar del apoya-plancha arranca con la punta hacia la punta de la tabla
        yawGoal = 0;
      }
      mode = 'follow';
      target.set(x, y, z);
      contactY = y;
      pressing = !!press;
      snapNext = !!snap;
    },
    goRest() {
      mode = 'rest';
      pressing = false;
      target.copy(rest);
      contactY = rest.y;
    },
    // Salta directo al punto (sin animación), p. ej. al tocar con el dedo lejos de la plancha.
    snapXZ(x, z) {
      pos.x = x;
      pos.z = z;
      prev.copy(pos);
    },
    update(dt) {
      if (dt <= 0) return;
      prev.copy(pos);
      const hd = Math.hypot(target.x - pos.x, target.z - pos.z);
      const kxz = snapNext ? 1 : 1 - Math.exp(-dt * (mode === 'rest' ? 7 : 24));
      pos.x += (target.x - pos.x) * kxz;
      pos.z += (target.z - pos.z) * kxz;
      // altura: apoyada, flotando, o en arco si viaja lejos (apretada, solo si "salta" lejos)
      let ty = target.y;
      if (mode === 'follow' && !pressing) ty += 0.035;
      // (el umbral de "salto" crece con dt: con pocos cuadros por segundo cada cuadro avanza más)
      ty += pressing ? clamp((hd - 0.15 - 2.5 * dt) * 0.8, 0, 0.14) : clamp((hd - 0.06 - 1.5 * dt) * 0.6, 0, 0.14);
      const ky = 1 - Math.exp(-dt * (pressing ? 30 : 14));
      pos.y += (ty - pos.y) * ky;
      if (pressing && pos.y < target.y + 0.0015) pos.y = target.y;
      // velocidad horizontal y orientación según el eje de la pasada (ida y vuelta sin girar 180°)
      const dx = pos.x - prev.x;
      const dz = pos.z - prev.z;
      const sp = Math.hypot(dx, dz) / dt;
      lastSpeed += (sp - lastSpeed) * (1 - Math.exp(-dt * 12));
      if (mode === 'follow' && sp > 0.06) {
        let a = Math.atan2(-dz, dx);
        if (Math.abs(wrapAngle(a - yaw)) > Math.PI / 2) a = wrapAngle(a + Math.PI);
        yawGoal = a;
      } else if (mode === 'rest') yawGoal = 0;
      const ka = 1 - Math.exp(-dt * (mode === 'rest' ? 6 : clamp(sp * 14, 0.5, 9)));
      yaw = wrapAngle(yaw + wrapAngle(yawGoal - yaw) * ka);
      // levantada: la punta sube un poquito
      const lift = clamp((pos.y - target.y) / 0.05, 0, 1);
      const pGoal = mode === 'follow' ? 0.07 * lift : 0.05 * clamp(hd / 0.1, 0, 1);
      pitch += (pGoal - pitch) * (1 - Math.exp(-dt * 10));
      g.position.copy(pos);
      g.rotation.set(0, yaw, pitch, 'YXZ');
    },
    atRest() {
      return mode === 'rest' && pos.distanceTo(rest) < 0.004;
    },
    restore() {
      if (saved.parent && g.parent !== saved.parent) saved.parent.add(g);
      g.position.copy(saved.position);
      g.rotation.copy(saved.rotation);
      g.scale.copy(saved.scale);
      g.visible = saved.visible;
      iron.setSteam(false);
      iron.setHot(0);
      iron.setLevel(0);
    },
    // punto del mundo a lo largo del eje de la suela (offset en metros desde el centro)
    along(offset, out = tmp) {
      return out.set(pos.x + Math.cos(yaw) * offset, pos.y, pos.z - Math.sin(yaw) * offset);
    },
  };
  return rig;
}
