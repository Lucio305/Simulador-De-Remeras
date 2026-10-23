// Corte · encuadre de cámara: vista casi cenital que hace entrar una caja de la mesa en la zona
// libre de la pantalla (sin panel, barra superior ni HUD). Igual que tizado/view.js, pero con
// giro (azimut): en un teléfono vertical conviene mirar la pieza "de costado" para que su lado
// largo quede a lo alto de la pantalla.

import * as THREE from 'three';
import { screenInsets } from '../tizado/view.js';

export { screenInsets };

// box: { minX, maxX, minZ, maxZ, y } (mundo). tilt: ángulo sobre la horizontal. azimuth: giro alrededor de Y.
export function fitBox(camera, box, { tilt = 1.3, azimuth = 0, reserveTop = 0, reserveBottom = 0, reserveLeft = 0, margin = 14 } = {}) {
  const ins = screenInsets();
  const { w, h } = ins;
  const cam = new THREE.PerspectiveCamera(camera.fov, w / h, 0.01, 100);
  const ca = Math.cos(azimuth);
  const sa = Math.sin(azimuth);
  const dir = new THREE.Vector3(sa * Math.cos(tilt), Math.sin(tilt), ca * Math.cos(tilt));
  const right = new THREE.Vector3(ca, 0, -sa);
  const toward = new THREE.Vector3(sa, 0, ca); // "abajo" de la pantalla, sobre la mesa
  const corners = [
    new THREE.Vector3(box.minX, box.y, box.minZ),
    new THREE.Vector3(box.maxX, box.y, box.minZ),
    new THREE.Vector3(box.minX, box.y, box.maxZ),
    new THREE.Vector3(box.maxX, box.y, box.maxZ),
  ];
  const fx0 = margin + reserveLeft;
  const fx1 = w - ins.right - margin;
  const fy0 = ins.top + reserveTop + margin;
  const fy1 = h - ins.bottom - reserveBottom - margin;
  const cx = (w - ins.right) / 2;
  const cy = (h - ins.bottom) / 2;
  const target = new THREE.Vector3((box.minX + box.maxX) / 2, box.y, (box.minZ + box.maxZ) / 2);
  const v = new THREE.Vector3();
  const measure = (d) => {
    cam.position.copy(target).addScaledVector(dir, d);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of corners) {
      v.copy(c).project(cam);
      const px = cx + (v.x * w) / 2;
      const py = cy - (v.y * h) / 2;
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y0 = Math.min(y0, py);
      y1 = Math.max(y1, py);
    }
    return { x0, x1, y0, y1 };
  };
  let d = 2.5;
  for (let iter = 0; iter < 4; iter++) {
    let lo = 0.25;
    let hi = 12;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      const m = measure(mid);
      if (m.x1 - m.x0 <= fx1 - fx0 && m.y1 - m.y0 <= fy1 - fy0) hi = mid;
      else lo = mid;
    }
    d = hi;
    const m = measure(d);
    const ex = (m.x0 + m.x1) / 2 - (fx0 + fx1) / 2;
    const ey = (m.y0 + m.y1) / 2 - (fy0 + fy1) / 2;
    const mpp = (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / h;
    target.addScaledVector(right, ex * mpp);
    target.addScaledVector(toward, (ey * mpp) / Math.max(0.3, Math.sin(tilt)));
  }
  const position = target.clone().addScaledVector(dir, d);
  // escala resultante (px por metro de mesa) para elegir el mejor azimut
  const m = measure(d);
  const spanX = Math.abs(box.maxX - box.minX);
  const spanZ = Math.abs(box.maxZ - box.minZ);
  const pxPerM = Math.max((m.x1 - m.x0) / Math.max(1e-6, Math.abs(ca) > 0.5 ? spanX : spanZ), 1);
  return { position: position.toArray(), target: target.toArray(), fov: camera.fov, distance: d, pxPerM, azimuth };
}

// Elige entre mirar derecho o girado 90° (lo que deje la caja más grande en pantalla).
export function bestFit(camera, box, opts = {}, { allowTurn = false } = {}) {
  const a = fitBox(camera, box, { ...opts, azimuth: 0 });
  if (!allowTurn) return a;
  const b = fitBox(camera, box, { ...opts, azimuth: Math.PI / 2 });
  return b.distance < a.distance * 0.86 ? b : a;
}
