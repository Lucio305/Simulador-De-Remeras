// Cadena de mipmaps propia para texturas tileables (RGBA8).
// Cada nivel se reduce 2x con un filtro binomial [1,3,3,1] (con wrap) en vez de
// la caja 2x2 de la GPU: filtra antes de diezmar, así los patrones regulares del
// tejido (columnas de punto, poros, hilos) no generan moiré a media distancia.
//   kind: 'srgb'   → color en sRGB (se promedia en lineal)
//         'normal' → normal map (se promedia el vector y se renormaliza)
//         'linear' → datos lineales (rugosidad)

const SRGB_TO_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();
const LIN_TO_SRGB = (() => {
  const t = new Uint8Array(4097);
  for (let k = 0; k <= 4096; k++) {
    const l = k / 4096;
    t[k] = Math.round((l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055) * 255);
  }
  return t;
})();

function decode(data, n, kind) {
  const f = new Float32Array(n * 3);
  if (kind === 'srgb') {
    for (let i = 0, q = 0; i < n; i++, q += 3) {
      const o = i * 4;
      f[q] = SRGB_TO_LIN[data[o]];
      f[q + 1] = SRGB_TO_LIN[data[o + 1]];
      f[q + 2] = SRGB_TO_LIN[data[o + 2]];
    }
  } else {
    const a = kind === 'normal' ? 2 / 255 : 1 / 255;
    const b = kind === 'normal' ? -1 : 0;
    for (let i = 0, q = 0; i < n; i++, q += 3) {
      const o = i * 4;
      f[q] = data[o] * a + b;
      f[q + 1] = data[o + 1] * a + b;
      f[q + 2] = data[o + 2] * a + b;
    }
  }
  return f;
}

const toByte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);
const toSrgbByte = (v) => LIN_TO_SRGB[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0];

function encode(f, n, kind) {
  const out = new Uint8Array(n * 4);
  for (let i = 0, q = 0; i < n; i++, q += 3) {
    const o = i * 4;
    if (kind === 'normal') {
      const x = f[q];
      const y = f[q + 1];
      const z = f[q + 2] > 0.05 ? f[q + 2] : 0.05;
      const inv = 0.5 / Math.sqrt(x * x + y * y + z * z);
      out[o] = toByte(x * inv + 0.5);
      out[o + 1] = toByte(y * inv + 0.5);
      out[o + 2] = toByte(z * inv + 0.5);
    } else if (kind === 'srgb') {
      out[o] = toSrgbByte(f[q]);
      out[o + 1] = toSrgbByte(f[q + 1]);
      out[o + 2] = toSrgbByte(f[q + 2]);
    } else {
      out[o] = toByte(f[q]);
      out[o + 1] = toByte(f[q + 1]);
      out[o + 2] = toByte(f[q + 2]);
    }
    out[o + 3] = 255;
  }
  return out;
}

// Reducción 2x con filtro binomial [1,3,3,1]/8 separable (wrap): filtra antes de
// diezmar, así las frecuencias que no entran en el nivel nuevo no se "doblan".
function halve(f, s) {
  const h = s >> 1;
  const t = new Float32Array(h * s * 3); // paso horizontal: s filas x h columnas
  for (let y = 0; y < s; y++) {
    const row = y * s;
    for (let x = 0; x < h; x++) {
      const a = (row + ((2 * x - 1 + s) % s)) * 3;
      const b = (row + 2 * x) * 3;
      const c = b + 3;
      const d = (row + ((2 * x + 2) % s)) * 3;
      const q = (y * h + x) * 3;
      t[q] = (f[a] + 3 * (f[b] + f[c]) + f[d]) * 0.125;
      t[q + 1] = (f[a + 1] + 3 * (f[b + 1] + f[c + 1]) + f[d + 1]) * 0.125;
      t[q + 2] = (f[a + 2] + 3 * (f[b + 2] + f[c + 2]) + f[d + 2]) * 0.125;
    }
  }
  const o = new Float32Array(h * h * 3);
  for (let y = 0; y < h; y++) {
    const ra = ((2 * y - 1 + s) % s) * h;
    const rb = 2 * y * h;
    const rc = rb + h;
    const rd = ((2 * y + 2) % s) * h;
    for (let x = 0; x < h; x++) {
      const a = (ra + x) * 3;
      const b = (rb + x) * 3;
      const c = (rc + x) * 3;
      const d = (rd + x) * 3;
      const q = (y * h + x) * 3;
      o[q] = (t[a] + 3 * (t[b] + t[c]) + t[d]) * 0.125;
      o[q + 1] = (t[a + 1] + 3 * (t[b + 1] + t[c + 1]) + t[d + 1]) * 0.125;
      o[q + 2] = (t[a + 2] + 3 * (t[b + 2] + t[c + 2]) + t[d + 2]) * 0.125;
    }
  }
  return o;
}

// Devuelve [{data, width, height}, ...] desde el nivel 0 (el original) hasta 1x1.
export function buildMipChain(data, size, kind) {
  const chain = [{ data, width: size, height: size }];
  let f = decode(data, size * size, kind);
  let s = size;
  while (s > 1) {
    f = halve(f, s);
    s >>= 1;
    chain.push({ data: encode(f, s * s, kind), width: s, height: s });
  }
  return chain;
}
