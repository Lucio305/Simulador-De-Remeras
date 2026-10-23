// Prensa térmica tipo almeja (38 × 38 cm): base negra, plancha inferior con espuma
// de silicona, plancha superior calefactora que abre con el brazo y la manija
// (setOpen 0 = cerrada … 1 = abierta ~60°), control digital con temperatura/tiempo y LED.

import { THREE, Batch, std, mesh, V3, chrome, rubber, blackPaint, darkPlastic, place, damp, DEG, tube, RoundedBoxGeometry } from './common.js';
import { clamp } from '../../core/utils.js';

const PLATEN = 0.38;
const LOWER_TOP = 0.1; // alto del tope de la plancha inferior sobre la mesa

function drawDisplay(ctx, w, h, temp, secs, heating, blink) {
  ctx.fillStyle = '#140a08';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, w, h * 0.45);
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,70,40,0.9)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ff4a2e';
  ctx.font = '700 58px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(temp)}`, w * 0.47, h * 0.42);
  ctx.fillText(`${Math.max(0, Math.round(secs))}`, w * 0.9, h * 0.42);
  ctx.shadowBlur = 0;
  ctx.font = '700 22px sans-serif';
  ctx.fillStyle = '#ff8a6e';
  ctx.textAlign = 'left';
  ctx.fillText('°C', w * 0.48, h * 0.3);
  ctx.fillText('s', w * 0.91, h * 0.3);
  ctx.font = '600 18px sans-serif';
  ctx.fillStyle = '#b9a8a2';
  ctx.textAlign = 'center';
  ctx.fillText('TEMP', w * 0.28, h * 0.82);
  ctx.fillText('TIEMPO', w * 0.72, h * 0.82);
  if (heating && blink) {
    ctx.fillStyle = '#ffb02e';
    ctx.shadowColor = 'rgba(255,170,40,0.9)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(w * 0.06, h * 0.82, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createHeatPress({ position, topY, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'prensa-termica';
  group.position.set(position[0], topY, position[1]);
  group.rotation.y = ry;
  const b = new Batch();
  const black = blackPaint();
  const alu = std('aluminio-plancha', { color: '#c9cdd1', roughness: 0.35, metalness: 0.95 });
  const pad = std('silicona-gris', { color: '#7d8186', roughness: 0.85 });
  // base y soporte
  b.box(0.44, 0.045, 0.56, black, { p: [0, 0.0225, -0.04], radius: 0.01, seg: 2, cast: true });
  b.box(0.3, 0.03, 0.3, black, { p: [0, 0.06, 0], radius: 0.006, seg: 1 });
  b.box(PLATEN + 0.004, 0.012, PLATEN + 0.004, alu, { p: [0, LOWER_TOP - 0.018, 0], radius: 0.003, seg: 1, cast: true });
  b.box(PLATEN, 0.012, PLATEN, pad, { p: [0, LOWER_TOP - 0.006, 0], radius: 0.004, seg: 2 });
  // columna trasera (bisagra con resortes)
  b.box(0.12, 0.17, 0.1, black, { p: [0, 0.045 + 0.085, -0.26], radius: 0.012, seg: 2, cast: true });
  for (const sx of [-1, 1]) {
    const spring = new THREE.TorusGeometry(0.012, 0.0025, 6, 14);
    for (let i = 0; i < 6; i++) b.add(spring, chrome(), { p: [sx * 0.035, 0.1 + i * 0.012, -0.205], r: [Math.PI / 2, 0, 0] });
    spring.dispose();
  }
  // perilla de presión arriba de la columna
  b.cyl(0.006, 0.006, 0.06, chrome(), { p: [0, 0.24, -0.26], seg: 10 });
  b.cyl(0.028, 0.032, 0.025, darkPlastic(), { p: [0, 0.28, -0.26], seg: 20, cast: true });
  // panel de control al frente de la base (inclinado)
  b.box(0.2, 0.05, 0.05, black, { p: [0, 0.05, 0.255], r: [-0.5, 0, 0], radius: 0.008, seg: 2 });
  for (let i = 0; i < 3; i++) b.cyl(0.007, 0.007, 0.006, std('boton-prensa', { color: '#dfe2e5', roughness: 0.35 }), { p: [0.035 + i * 0.024, 0.066, 0.272], r: [Math.PI / 2 - 0.5, 0, 0], seg: 12 });
  b.flush(group, 'prensa');

  // display
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const dispMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, roughness: 0.3 });
  const disp = mesh(new THREE.PlaneGeometry(0.09, 0.045), dispMat, { p: [-0.04, 0.066, 0.2795], r: [-0.5, 0, 0], name: 'display' });
  group.add(disp);
  let dState = { temp: 25, secs: 0, heating: false };
  let blink = true;
  const redraw = () => {
    drawDisplay(canvas.getContext('2d'), canvas.width, canvas.height, dState.temp, dState.secs, dState.heating, blink);
    tex.needsUpdate = true;
  };
  redraw();

  // plancha superior: pivota en la bisagra trasera
  const pivot = new THREE.Group();
  place(pivot, [0, 0.205, -0.25]);
  group.add(pivot);
  const up = new THREE.Group();
  pivot.add(up);
  const zc = 0.25; // centro de la plancha relativo al pivote
  const yPlate = LOWER_TOP + 0.004 + 0.011 - 0.205;
  up.add(mesh(new THREE.BoxGeometry(PLATEN, 0.022, PLATEN), alu, { p: [0, yPlate, zc], cast: true }));
  const housing = mesh(new RoundedBoxGeometry(PLATEN - 0.01, 0.05, PLATEN - 0.01, 3, 0.012), black, { p: [0, yPlate + 0.036, zc], cast: true });
  up.add(housing);
  up.add(mesh(new RoundedBoxGeometry(0.3, 0.014, 0.3, 2, 0.006), std('prensa-tapa', { color: '#3a3b3f', roughness: 0.35, metalness: 0.35 }), { p: [0, yPlate + 0.064, zc] }));
  // brazo hacia la bisagra
  up.add(mesh(new THREE.BoxGeometry(0.09, 0.05, 0.14), black, { p: [0, yPlate + 0.06, 0.06], cast: true }));
  // manija: dos brazos que salen del techo de la carcasa, suben y pasan por delante
  const yTop = yPlate + 0.073;
  for (const sx of [-1, 1]) {
    const arm = tube([[sx * 0.075, yTop, zc + 0.05], [sx * 0.075, yTop + 0.05, zc + 0.16], [sx * 0.075, yTop + 0.075, zc + PLATEN / 2 + 0.04], [sx * 0.075, yTop + 0.07, zc + PLATEN / 2 + 0.085]], 0.008, { tubular: 16, radial: 8 });
    up.add(mesh(arm, chrome(), { cast: true }));
  }
  up.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 16).rotateZ(Math.PI / 2), rubber(), { p: [0, yTop + 0.07, zc + PLATEN / 2 + 0.085], cast: true }));
  // termostato / sensor sobre la carcasa
  up.add(mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.018, 16), std('prensa-termostato', { color: '#c43a3a', roughness: 0.4 }), { p: [0.11, yTop + 0.009, zc - 0.08] }));
  // etiqueta de peligro "caliente"
  const warnMat = std('aviso-caliente', { color: '#e0b72e', roughness: 0.5 });
  up.add(mesh(new THREE.PlaneGeometry(0.05, 0.02), warnMat, { p: [0, yPlate + 0.036, zc + (PLATEN - 0.02) / 2 + 0.0006] }));

  let open = 0;
  let target = 0;
  let acc = 0;
  return {
    group,
    platenCenter: V3(position[0], topY + LOWER_TOP, position[1]),
    platenSize: [PLATEN, PLATEN],
    setOpen(t) {
      target = clamp(t, 0, 1);
    },
    setDisplay(tempC, seconds, { heating = false } = {}) {
      dState = { temp: tempC, secs: seconds, heating };
      redraw();
    },
    update(dt) {
      open = damp(open, target, 7, dt);
      pivot.rotation.x = -open * 60 * DEG;
      if (dState.heating) {
        acc += dt;
        if (acc > 0.45) {
          acc = 0;
          blink = !blink;
          redraw();
        }
      } else if (!blink) {
        blink = true;
        redraw();
      }
    },
  };
}
