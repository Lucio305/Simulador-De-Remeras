// Caída de la tela por los bordes de la tabla: lo que sobresale de la tabla (los costados del
// cuerpo y las mangas) se dobla sobre el borde y cuelga, en vez de quedar duro en el aire.
//
// Si la remera trae `setDrape(opts)` se usa eso. Si no, se envuelve `computeBase` de los dos
// paneles de ESTA instancia de Shirt3D (no se toca el módulo): la posición base de cada vértice
// que pasa el borde se "enrolla" alrededor de un cilindro de radio R conservando el largo de la
// tela y su espesor (frente y espalda no se cruzan), y después sigue derecho hacia abajo.
// Las arrugas, el cuello, los dobladillos, las puntadas y las marcas siguen a la base sola.
// dispose() saca el envoltorio y deja la base plana recalculada.

import { clamp } from '../../core/utils.js';

// Medio ancho de la tabla de planchar (props/ironing.js → boardShape) a una distancia `x` del
// centro a lo largo de la tabla (punta hacia +x). Tramo recto hasta 0.05·L y después la curva
// de la punta (Bézier cúbica). Devuelve una función x → medio ancho.
export function boardHalfWidth(length, width) {
  const L = length;
  const hw = width / 2;
  const P = [
    [L * 0.05, hw],
    [L * 0.32, hw],
    [L / 2, hw * 0.42],
    [L / 2, 0],
  ];
  const xs = [];
  const ys = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const u = 1 - t;
    const b0 = u * u * u;
    const b1 = 3 * u * u * t;
    const b2 = 3 * u * t * t;
    const b3 = t * t * t;
    xs.push(b0 * P[0][0] + b1 * P[1][0] + b2 * P[2][0] + b3 * P[3][0]);
    ys.push(b0 * P[0][1] + b1 * P[1][1] + b2 * P[2][1] + b3 * P[3][1]);
  }
  return (x) => {
    if (x <= xs[0]) return hw;
    if (x >= L / 2) return 0;
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const k = (x - xs[i - 1]) / Math.max(1e-6, xs[i] - xs[i - 1]);
        return ys[i - 1] + (ys[i] - ys[i - 1]) * k;
      }
    }
    return 0;
  };
}

// shirt: Shirt3D. limitAt(y): medio ancho (coords de prenda, x) donde empieza el doblez para un
// punto de prenda a la altura y. radius: radio del doblez. maxAngle: inclinación final (rad).
export function createDrape(shirt, { limitAt, radius = 0.03, maxAngle = 1.42 }) {
  let up = 1; // +1: el frente mira hacia arriba (z local +); -1: la espalda
  let amount = 0; // 0 = plana, 1 = caída completa
  const R = radius;
  const native = typeof shirt.setDrape === 'function';
  const patched = [];

  function bend(B, n) {
    const amax = maxAngle * amount;
    if (amax <= 1e-4) return;
    const s = up;
    for (let v = 0; v < n; v++) {
      const o = v * 3;
      const x = B[o];
      const L = limitAt(B[o + 1]);
      const ax = Math.abs(x);
      const ex = ax - L;
      if (ex <= 0) continue;
      const zz = s * B[o + 2];
      const a = Math.min(amax, ex / R);
      const along = Math.max(0, ex - a * R);
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const cx = L + R * sa + along * ca;
      const cz = -R * (1 - ca) - along * sa;
      B[o] = Math.sign(x) * (cx + zz * sa);
      B[o + 2] = s * (cz + zz * ca);
    }
  }

  function install() {
    if (native) return;
    for (const P of [shirt._front, shirt._back]) {
      if (!P || typeof P.computeBase !== 'function' || !P.base) continue;
      if (Object.prototype.hasOwnProperty.call(P, 'computeBase')) continue;
      const orig = Object.getPrototypeOf(P).computeBase;
      if (typeof orig !== 'function') continue;
      P.computeBase = function (k) {
        orig.call(this, k);
        bend(this.base, this.n);
      };
      patched.push(P);
    }
  }

  function refresh() {
    if (native) {
      shirt.setDrape(amount > 1e-4 ? { limit: limitAt, radius: R, maxAngle: maxAngle * amount, up } : null);
      return;
    }
    if (!patched.length) return;
    // la base se recalcula en el próximo _flush (con el envoltorio puesto)
    shirt._dirtyBase = true;
  }

  install();

  return {
    get supported() {
      return native || patched.length > 0;
    },
    get amount() {
      return amount;
    },
    // up: 'frente' | 'espalda' (lado que mira arriba); k: 0..1
    set(side, k) {
      const nu = side === 'espalda' ? -1 : 1;
      const nk = clamp(k);
      if (nu === up && Math.abs(nk - amount) < 1e-4) return;
      up = nu;
      amount = nk;
      refresh();
    },
    dispose() {
      amount = 0;
      if (native) {
        shirt.setDrape(null);
        return;
      }
      for (const P of patched) delete P.computeBase;
      if (patched.length) {
        shirt._dirtyBase = true;
        shirt.update?.();
      }
      patched.length = 0;
    },
  };
}
