// Campo de arrugas procedural en espacio de prenda (metros): pliegues blandos largos,
// quiebres finos y "estrellas" de arrugado. Se genera una vez por lado y se reutiliza
// para cualquier molde; la máscara (lo que falta planchar) vive aparte.

import { rng, makeValueNoise, fbm, clamp } from '../core/utils.js';

export const WBOX = { x0: -0.84, y0: -1.04, x1: 0.84, y1: 0.14 };
const CELL = 0.004;

export function makeWrinkleField(seed = 1) {
  const nx = Math.ceil((WBOX.x1 - WBOX.x0) / CELL) + 1;
  const ny = Math.ceil((WBOX.y1 - WBOX.y0) / CELL) + 1;
  const soft = new Float32Array(nx * ny);
  const sharp = new Float32Array(nx * ny);
  const r = rng(seed * 7919 + 13);

  // Estampa una arruga a lo largo de una polilínea (perfil gaussiano o "carpa" filosa).
  const stamp = (arr, pts, width, amp, sharpProfile) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const cum = [0];
    for (let i = 0; i < pts.length; i++) {
      minX = Math.min(minX, pts[i][0]);
      maxX = Math.max(maxX, pts[i][0]);
      minY = Math.min(minY, pts[i][1]);
      maxY = Math.max(maxY, pts[i][1]);
      if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = cum[cum.length - 1] || 1;
    const reach = sharpProfile ? width : width * 2.3;
    const i0 = Math.max(0, Math.floor((minX - reach - WBOX.x0) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((maxX + reach - WBOX.x0) / CELL));
    const j0 = Math.max(0, Math.floor((minY - reach - WBOX.y0) / CELL));
    const j1 = Math.min(ny - 1, Math.ceil((maxY + reach - WBOX.y0) / CELL));
    for (let j = j0; j <= j1; j++) {
      const y = WBOX.y0 + j * CELL;
      for (let i = i0; i <= i1; i++) {
        const x = WBOX.x0 + i * CELL;
        let bestD = Infinity;
        let bestS = 0;
        for (let k = 0; k < pts.length - 1; k++) {
          const ax = pts[k][0];
          const ay = pts[k][1];
          const dx = pts[k + 1][0] - ax;
          const dy = pts[k + 1][1] - ay;
          const l2 = dx * dx + dy * dy;
          let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
          if (d < bestD) {
            bestD = d;
            bestS = cum[k] + t * Math.sqrt(l2);
          }
        }
        if (bestD > reach) continue;
        const u = bestS / total;
        const taper = Math.pow(Math.sin(Math.PI * clamp(u, 0, 1)), 0.55);
        const prof = sharpProfile ? Math.pow(1 - bestD / width, 1.8) : Math.exp(-((bestD / width) ** 2));
        arr[j * nx + i] += amp * taper * prof;
      }
    }
  };
  const randIn = (a, b) => a + (b - a) * r();
  const path = (x, y, ang, segs, segLen, bend) => {
    const pts = [[x, y]];
    let a = ang;
    for (let s = 0; s < segs; s++) {
      a += (r() - 0.5) * bend;
      x += Math.cos(a) * segLen * randIn(0.7, 1.3);
      y += Math.sin(a) * segLen * randIn(0.7, 1.3);
      pts.push([x, y]);
    }
    return pts;
  };

  // pliegues blandos largos (sobre todo horizontales/diagonales: la tela se junta al apoyarla)
  for (let k = 0; k < 110; k++) {
    const x = randIn(-0.66, 0.66);
    const y = randIn(-0.9, 0.04);
    const ang = (r() - 0.5) * 1.4 + (r() < 0.25 ? Math.PI / 2 : 0);
    const len = randIn(0.08, 0.3);
    const pts = path(x - (Math.cos(ang) * len) / 2, y - (Math.sin(ang) * len) / 2, ang, 3, len / 3, 0.6);
    stamp(soft, pts, randIn(0.011, 0.026), (r() < 0.7 ? 1 : -1) * randIn(0.0022, 0.0055), false);
  }
  // marcas de doblado de guardado: una línea vertical a cada lado y una horizontal
  for (const fx of [-0.13, 0.13]) stamp(sharp, [[fx + randIn(-0.02, 0.02), 0.05], [fx + randIn(-0.03, 0.03), -0.45], [fx + randIn(-0.02, 0.02), -0.95]], 0.008, 0.0018, true);
  stamp(sharp, [[-0.75, -0.38 + randIn(-0.03, 0.03)], [0, -0.36], [0.75, -0.38 + randIn(-0.03, 0.03)]], 0.009, -0.0016, true);
  // quiebres filosos sueltos
  for (let k = 0; k < 260; k++) {
    const x = randIn(-0.68, 0.68);
    const y = randIn(-0.92, 0.06);
    const ang = r() * Math.PI * 2;
    const segs = 1 + Math.floor(r() * 3);
    const pts = path(x, y, ang, segs, randIn(0.02, 0.055), 0.9);
    stamp(sharp, pts, randIn(0.006, 0.012), (r() < 0.68 ? 1 : -1) * randIn(0.0012, 0.0032), true);
  }
  // estrellas: varios quiebres que salen de un mismo punto (donde la tela quedó apretada)
  for (let k = 0; k < 40; k++) {
    const x = randIn(-0.55, 0.55);
    const y = randIn(-0.85, -0.02);
    const arms = 3 + Math.floor(r() * 3);
    const a0 = r() * Math.PI * 2;
    for (let m = 0; m < arms; m++) {
      const ang = a0 + (m / arms) * Math.PI * 2 + (r() - 0.5) * 0.8;
      const pts = path(x, y, ang, 2, randIn(0.025, 0.05), 0.5);
      stamp(sharp, pts, randIn(0.006, 0.011), randIn(0.0014, 0.003), true);
    }
  }
  // red de arrugado (ruido "ridged" con deformación de dominio) + ondulación de baja frecuencia
  const noise = makeValueNoise(seed * 31 + 5, 128);
  const warp = makeValueNoise(seed * 17 + 3, 128);
  let mean = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = WBOX.x0 + i * CELL;
      const y = WBOX.y0 + j * CELL;
      const wx = (warp(x * 11 + 1.3, y * 11 + 4.1) - 0.5) * 0.9;
      const wy = (warp(x * 11 + 8.7, y * 11 + 2.2) - 0.5) * 0.9;
      let rid = 0;
      let amp = 1;
      let f = 10;
      for (let o = 0; o < 3; o++) {
        const nv = noise((x + wx * 0.05) * f * 0.75 + o * 17.1, (y + wy * 0.05) * f + o * 9.3);
        const rr = 1 - Math.abs(nv * 2 - 1);
        rid += amp * rr * rr * rr;
        amp *= 0.5;
        f *= 2.1;
      }
      const k = j * nx + i;
      sharp[k] += rid * 0.0042;
      mean += rid * 0.0042;
      soft[k] += (fbm(noise, x * 7 + 3.1, y * 7 + 7.7, 3) - 0.5) * 0.006;
    }
  }
  mean /= nx * ny;
  for (let k = 0; k < sharp.length; k++) sharp[k] -= mean;
  return { nx, ny, cell: CELL, soft, sharp };
}

// Muestreo bilineal de un campo del cuadro WBOX.
export function sampleGrid(arr, nx, ny, cell, x, y) {
  const fx = (x - WBOX.x0) / cell;
  const fy = (y - WBOX.y0) / cell;
  const i = Math.max(0, Math.min(nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(ny - 2, Math.floor(fy)));
  const tx = clamp(fx - i, 0, 1);
  const ty = clamp(fy - j, 0, 1);
  const o = j * nx + i;
  const a = arr[o];
  const b = arr[o + 1];
  const c = arr[o + nx];
  const d = arr[o + nx + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

// Máscara de arrugas por lado (celdas de 1 cm) + celdas que caen dentro del panel.
export const MCELL = 0.01;
export function makeMask(value = 1) {
  const nx = Math.ceil((WBOX.x1 - WBOX.x0) / MCELL) + 1;
  const ny = Math.ceil((WBOX.y1 - WBOX.y0) / MCELL) + 1;
  const m = new Float32Array(nx * ny).fill(value);
  return { nx, ny, cell: MCELL, m, inside: new Uint8Array(nx * ny), insideCount: 1 };
}

// Rasteriza un polígono (coords de prenda) sobre la grilla de la máscara.
export function rasterInside(mask, poly) {
  const { nx, ny, cell } = mask;
  mask.inside.fill(0);
  let count = 0;
  const xs = [];
  for (let j = 0; j < ny; j++) {
    const y = WBOX.y0 + j * cell;
    xs.length = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const ya = poly[a].y;
      const yb = poly[b].y;
      if (ya > y !== yb > y) xs.push(poly[a].x + ((y - ya) / (yb - ya)) * (poly[b].x - poly[a].x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - WBOX.x0) / cell));
      const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - WBOX.x0) / cell));
      for (let i = i0; i <= i1; i++) {
        mask.inside[j * nx + i] = 1;
        count++;
      }
    }
  }
  mask.insideCount = Math.max(1, count);
}
