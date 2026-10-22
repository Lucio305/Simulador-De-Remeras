// Utilidades generales: matemática, ruido, canvas y formato.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Generador pseudoaleatorio determinístico (mulberry32).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de valor 2D suave y tileable (período `period` en celdas).
export function makeValueNoise(seed = 7, period = 256) {
  const r = rng(seed);
  const size = period;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = r();
  const at = (x, y) => table[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

// Ruido fractal (fBm) a partir de un ruido base.
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Convierte un mapa de alturas (Float32Array 0..1, w*h) en un canvas de normales
// en espacio tangente (formato OpenGL, Y arriba). `strength` escala la pendiente.
// Si `wrap` es true trata el mapa como tileable.
export function heightToNormalCanvas(height, w, h, strength = 2, wrap = false, canvas = null) {
  const c = canvas || makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const idx = (x, y) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = x < 0 ? 0 : x >= w ? w - 1 : x;
      y = y < 0 ? 0 : y >= h ? h - 1 : y;
    }
    return y * w + x;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel
      const tl = height[idx(x - 1, y - 1)];
      const t = height[idx(x, y - 1)];
      const tr = height[idx(x + 1, y - 1)];
      const l = height[idx(x - 1, y)];
      const r = height[idx(x + 1, y)];
      const bl = height[idx(x - 1, y + 1)];
      const b = height[idx(x, y + 1)];
      const br = height[idx(x + 1, y + 1)];
      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      // en canvas la Y crece hacia abajo; en tangent space +Y es "arriba" de la textura
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      let nx = -dx;
      let ny = dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * w + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255;
      d[o + 1] = (ny * 0.5 + 0.5) * 255;
      d[o + 2] = (nz * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Desenfoque de caja rápido (separable) sobre un Float32Array.
export function boxBlur(src, w, h, radius = 1, passes = 1) {
  if (radius < 1) return src;
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (radius * 2 + 1);
        const xOut = clamp(x - radius, 0, w - 1);
        const xIn = clamp(x + radius + 1, 0, w - 1);
        acc += a[row + xIn] - a[row + xOut];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -radius; y <= radius; y++) acc += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (radius * 2 + 1);
        const yOut = clamp(y - radius, 0, h - 1);
        const yIn = clamp(y + radius + 1, 0, h - 1);
        acc += b[yIn * w + x] - b[yOut * w + x];
      }
    }
  }
  return a;
}

export function hexToRgb(hex) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(lerp(A.r, B.r, t), lerp(A.g, B.g, t), lerp(A.b, B.b, t));
}

export function money(n) {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

export function pct(n) {
  return `${Math.round(n)}%`;
}

export function stars(score) {
  // 0..100 → 0..5 estrellas (medias incluidas)
  const s = Math.round((clamp(score, 0, 100) / 100) * 10) / 2;
  return s;
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Distancia de un punto a un segmento en 2D.
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Punto dentro de polígono (array de {x, y}).
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}

// Remuestrea una polilínea para que sus puntos queden a distancia `step`.
export function resamplePolyline(points, step, closed = false) {
  const pts = closed ? [...points, points[0]] : points;
  const out = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    let d = step - carry;
    while (d <= segLen) {
      const t = d / segLen;
      out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
      d += step;
    }
    carry = segLen - (d - step);
  }
  if (!closed) {
    const last = pts[pts.length - 1];
    const prev = out[out.length - 1];
    if (Math.hypot(last.x - prev.x, last.y - prev.y) > step * 0.25) out.push({ ...last });
  }
  return out;
}

export function polylineLength(points, closed = false) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  if (closed && points.length > 1) {
    const a = points[points.length - 1];
    const b = points[0];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

// Muestra un punto en una curva Catmull-Rom (para trazar curvas suaves de moldería).
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

// Bézier cuadrática y cúbica en 2D
export function quadBezier(a, c, b, t) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}
export function cubicBezier(a, c1, c2, b, t) {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

// Descarga un dataURL como archivo.
export function downloadDataURL(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Libera recursivamente geometrías, materiales y texturas de un Object3D.
export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData && m.userData.shared) continue;
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture && !(v.userData && v.userData.shared)) v.dispose();
        }
        m.dispose();
      }
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}
