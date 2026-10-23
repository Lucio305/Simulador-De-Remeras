// Símbolos de cuidado textil (estilo norma ISO 3758 / GINETEX) dibujados en SVG inline.
// careSymbol(kind, id) → string SVG (trazo = currentColor, viewBox 40×40).

const SW = 2.4;
const wrap = (inner, { title = '', size = null } = {}) =>
  `<svg class="term-care" viewBox="0 0 40 40"${size ? ` width="${size}" height="${size}"` : ''} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">${title ? `<title>${title}</title>` : ''}${inner}</svg>`;

const CROSS = '<path d="M5 6 L35 35 M35 6 L5 35" stroke-width="2.6"/>';

// --- lavado: batea con la línea de agua ---
const TUB = '<path d="M4.5 13 L9 32 H31 L35.5 13"/><path d="M4 12.2 q4 -3.6 8 0 t8 0 t8 0 t8 0"/>';
function wash(id) {
  if (id === 'no') return TUB + CROSS;
  if (id === 'mano') {
    // mano metida en el agua
    return (
      TUB +
      '<path d="M15.5 30 V22.5 q0 -1.6 1.5 -1.6 t1.5 1.6 V19.8 q0 -1.6 1.5 -1.6 t1.5 1.6 v1 q0 -1.5 1.5 -1.5 t1.5 1.5 v2.6 q0 -1.4 1.4 -1.4 t1.4 1.4 V27 q0 3 -3 3 Z" stroke-width="1.7"/>'
    );
  }
  const t = String(id);
  return TUB + `<text x="20" y="28.2" text-anchor="middle" font-size="11.5" font-weight="800" fill="currentColor" stroke="none" font-family="Arial, Helvetica, sans-serif">${t}</text>`;
}

// --- lavandina: triángulo ---
const TRI = '<path d="M20 5.5 L36 33 H4 Z"/>';
function bleach(id) {
  if (id === 'no') return TRI + CROSS;
  if (id === 'sin_cloro') return TRI + '<path d="M13.6 31 L22.4 15.6 M18.6 31 L26 18" stroke-width="2"/>';
  return TRI;
}

// --- secado: cuadrado ---
const SQ = '<rect x="5" y="5" width="30" height="30" rx="1.5"/>';
function dry(id) {
  if (id === 'secarropas') return SQ + '<circle cx="20" cy="20" r="10.5"/><circle cx="16.5" cy="20" r="1.7" fill="currentColor" stroke="none"/><circle cx="23.5" cy="20" r="1.7" fill="currentColor" stroke="none"/>';
  if (id === 'secarropas_bajo') return SQ + '<circle cx="20" cy="20" r="10.5"/><circle cx="20" cy="20" r="1.8" fill="currentColor" stroke="none"/>';
  if (id === 'no_secarropas') return SQ + '<circle cx="20" cy="20" r="10.5"/>' + CROSS;
  if (id === 'plano') return SQ + '<path d="M11 20.5 H29"/>';
  // colgar a la sombra: curva de tendedero + dos rayitas de sombra en la esquina
  return SQ + '<path d="M5.6 9.5 Q20 22 34.4 9.5"/><path d="M5.5 19 L12.5 12 M5.5 24.5 L16.5 13.5" stroke-width="1.8"/>';
}

// --- planchado: plancha con puntos ---
const IRON = '<path d="M4 31.5 Q5 21.5 14.5 20 H35.5 V31.5 Z"/><path d="M15.5 20 Q15.5 12.5 22.5 12.5 H35.5 V20"/>';
function iron(id) {
  if (id === 'no') return IRON + CROSS;
  const n = Math.max(1, Math.min(4, parseInt(id, 10) || 1));
  const gap = 4.6;
  const x0 = 22.5 - ((n - 1) * gap) / 2;
  let dots = '';
  for (let i = 0; i < n; i++) dots += `<circle cx="${(x0 + i * gap).toFixed(2)}" cy="26" r="1.55" fill="currentColor" stroke="none"/>`;
  return IRON + dots;
}

// --- limpieza en seco (decorativo, fijo en la etiqueta) ---
function dryClean() {
  return '<circle cx="20" cy="20" r="14"/><text x="20" y="25.2" text-anchor="middle" font-size="14" font-weight="800" fill="currentColor" stroke="none" font-family="Arial, Helvetica, sans-serif">P</text>';
}

// Planchar del revés: una remerita dada vuelta con una flechita circular.
function reverse() {
  return '<path d="M12 9 L16 6.5 Q20 9 24 6.5 L28 9 L33 13 L30 17 L27.5 15.5 V33 H12.5 V15.5 L10 17 L7 13 Z" stroke-width="2"/><path d="M15 25 a5 5 0 1 0 5 -5" stroke-width="1.9"/><path d="M18.4 17.8 L20.6 20 L18.4 22.3" stroke-width="1.9"/>';
}

const INNER = { wash, bleach, dry, iron, dryClean, reverse };

export function careInner(kind, id) {
  const f = INNER[kind];
  return f ? f(id) : '';
}

export function careSymbol(kind, id, opts) {
  return wrap(careInner(kind, id), opts);
}

// Grupo SVG para incrustar en otra figura: posición (x, y) y tamaño s (px).
export function careGroup(kind, id, x, y, s, color) {
  const k = s / 40;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})" fill="none" stroke="${color}" color="${color}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round">${careInner(kind, id)}</g>`;
}
