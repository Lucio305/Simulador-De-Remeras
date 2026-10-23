// Tizado · encuadre de cámara: calcula una vista casi cenital que hace entrar la tela completa
// en la zona libre de la pantalla (sin el panel, la barra superior ni el HUD), en cualquier tamaño.

import * as THREE from 'three';

// Márgenes de UI en px (lo mismo que calcula ui._layout para el motor).
export function screenInsets() {
  const panel = document.getElementById('panel');
  const mobile = window.matchMedia('(max-width: 820px)').matches;
  const w = window.innerWidth;
  const h = window.innerHeight;
  let right = 0;
  let bottom = 0;
  if (panel && !panel.classList.contains('hidden')) {
    if (mobile) bottom = panel.classList.contains('collapsed') ? 64 : Math.min(panel.offsetHeight || h * 0.48, h * 0.48);
    else right = (panel.offsetWidth || 380) + 24;
  }
  const top = mobile ? 50 : 58;
  return { w, h, right, bottom, top, mobile };
}

// box: { minX, maxX, minZ, maxZ, y } en mundo. tilt: ángulo de la cámara sobre la horizontal.
export function fitView(camera, box, { tilt = 1.2, reserveTop = 0, reserveBottom = 0, margin = 14 } = {}) {
  const ins = screenInsets();
  const { w, h } = ins;
  const cam = new THREE.PerspectiveCamera(camera.fov, w / h, 0.01, 100);
  const dir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const corners = [
    new THREE.Vector3(box.minX, box.y, box.minZ),
    new THREE.Vector3(box.maxX, box.y, box.minZ),
    new THREE.Vector3(box.minX, box.y, box.maxZ),
    new THREE.Vector3(box.maxX, box.y, box.maxZ),
  ];
  // zona libre (px)
  const fx0 = margin;
  const fx1 = w - ins.right - margin;
  const fy0 = ins.top + reserveTop + margin;
  const fy1 = h - ins.bottom - reserveBottom - margin;
  // centro de proyección que usa el motor (setViewOffset con la mitad de los márgenes)
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
    let lo = 0.6;
    let hi = 12;
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2;
      const m = measure(mid);
      const fits = m.x1 - m.x0 <= fx1 - fx0 && m.y1 - m.y0 <= fy1 - fy0;
      if (fits) hi = mid;
      else lo = mid;
    }
    d = hi;
    // centrar la caja proyectada en la zona libre corriendo el objetivo
    const m = measure(d);
    const ex = (m.x0 + m.x1) / 2 - (fx0 + fx1) / 2;
    const ey = (m.y0 + m.y1) / 2 - (fy0 + fy1) / 2;
    // metros por píxel aproximados a la distancia d
    const mpp = (2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / h;
    target.x += ex * mpp;
    target.z += (ey * mpp) / Math.max(0.3, Math.sin(tilt));
  }
  const position = target.clone().addScaledVector(dir, d);
  return { position: position.toArray(), target: target.toArray(), fov: camera.fov };
}
