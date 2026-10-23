// Calor acumulado en la tela por lado (grilla gruesa en coordenadas de prenda).
// Bajo la suela sube; fuera de la suela se enfría. Al pasar 1 la tela se marca.

import { WBOX } from '../../shirt/wrinkles.js';

const CELL = 0.02;

export function createHeatMap() {
  const nx = Math.ceil((WBOX.x1 - WBOX.x0) / CELL) + 1;
  const ny = Math.ceil((WBOX.y1 - WBOX.y0) / CELL) + 1;
  const grids = { frente: new Float32Array(nx * ny), espalda: new Float32Array(nx * ny) };
  const touched = new Uint8Array(nx * ny);
  const hot = { frente: false, espalda: false };

  const idx = (x, y) => {
    const i = Math.round((x - WBOX.x0) / CELL);
    const j = Math.round((y - WBOX.y0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    return j * nx + i;
  };

  return {
    // Suma calor bajo un círculo de la suela. inside(x, y) dice si la celda cae sobre la tela.
    // Devuelve la celda más caliente tocada { heat, x, y }.
    add(side, cx, cy, radius, amount, inside, out) {
      const g = grids[side];
      const i0 = Math.max(0, Math.floor((cx - radius - WBOX.x0) / CELL));
      const i1 = Math.min(nx - 1, Math.ceil((cx + radius - WBOX.x0) / CELL));
      const j0 = Math.max(0, Math.floor((cy - radius - WBOX.y0) / CELL));
      const j1 = Math.min(ny - 1, Math.ceil((cy + radius - WBOX.y0) / CELL));
      for (let j = j0; j <= j1; j++) {
        const y = WBOX.y0 + j * CELL;
        for (let i = i0; i <= i1; i++) {
          const x = WBOX.x0 + i * CELL;
          const d = Math.hypot(x - cx, y - cy);
          if (d > radius) continue;
          const k = j * nx + i;
          if (touched[k]) continue; // una sola vez por cuadro aunque se superpongan los círculos
          if (!inside(x, y)) continue;
          touched[k] = 1;
          const f = 1 - (d / radius) ** 2 * 0.6;
          g[k] += amount * f;
          hot[side] = true;
          if (out && g[k] > out.heat) {
            out.heat = g[k];
            out.x = x;
            out.y = y;
          }
        }
      }
    },
    // Fin del cuadro: enfría todo lo que no estuvo bajo la suela.
    cool(dt, rate = 0.35) {
      for (const side of ['frente', 'espalda']) {
        if (!hot[side]) continue;
        const g = grids[side];
        let any = false;
        const dec = rate * dt;
        for (let k = 0; k < g.length; k++) {
          if (g[k] <= 0) continue;
          if (!touched[k]) g[k] = Math.max(0, g[k] - dec);
          if (g[k] > 0) any = true;
        }
        hot[side] = any;
      }
      touched.fill(0);
    },
    // Apaga el calor alrededor de un punto (después de marcar, para no repetir la marca).
    clear(side, cx, cy, radius) {
      const g = grids[side];
      for (let j = 0; j < ny; j++) {
        const y = WBOX.y0 + j * CELL;
        if (Math.abs(y - cy) > radius) continue;
        for (let i = 0; i < nx; i++) {
          const x = WBOX.x0 + i * CELL;
          if (Math.hypot(x - cx, y - cy) <= radius) g[j * nx + i] = 0;
        }
      }
    },
    at(side, x, y) {
      const k = idx(x, y);
      return k < 0 ? 0 : grids[side][k];
    },
    reset() {
      grids.frente.fill(0);
      grids.espalda.fill(0);
      hot.frente = hot.espalda = false;
    },
  };
}
