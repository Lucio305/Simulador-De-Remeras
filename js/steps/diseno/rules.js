// Reglas del paso Diseño: compatibilidad técnica/tela, ubicaciones rápidas, límites del área
// estampable, resolución, contraste, costo estimado y puntaje. Sin UI ni escena (se puede
// reutilizar desde otros pasos o pruebas).

import { clamp } from '../../core/utils.js';

export const DEG = Math.PI / 180;

// Nombres cortos para tarjetas y resúmenes.
export const TECH_SHORT = {
  serigrafia: 'Serigrafía',
  vinilo: 'Vinilo',
  dtf: 'DTF',
  sublimacion: 'Sublimación',
  bordado: 'Bordado',
  puff: 'Puff',
  glitter: 'Glitter',
  foil: 'Foil',
  pintura: 'Pintura',
};

// Cómo se llama cada "color" según la técnica.
export function inkWord(techId, n = 2) {
  const one = techId === 'bordado' ? 'hilo' : techId === 'vinilo' ? 'capa' : 'tinta';
  return n === 1 ? one : `${one}s`;
}

// Consejo de oficio de cada técnica (se muestra en el detalle).
export const TECH_TIPS = {
  serigrafia: 'Cada color es un shablón aparte, así que conviene diseñar con <b>1 a 4 tintas planas</b>. En tela oscura se imprime antes una base blanca para que los colores no se apaguen.',
  vinilo: 'Se corta con plotter y se “pela” a mano: perfecto para <b>nombres, números y logos simples</b>. Los detalles muy finos se despegan.',
  dtf: 'Imprime <b>a todo color</b> (degradés y fotos incluidos) sobre cualquier tela y color. Queda una película finita, apenas se siente al tacto.',
  sublimacion: 'La tinta se vuelve gas y <b>tiñe el poliéster</b>: no tiene tacto ni se agrieta nunca. Pero no imprime blanco y en algodón se va con los lavados.',
  bordado: 'Puntada por puntada con hilo brillante: el relieve más artesanal. Luce en <b>tamaños chicos</b> (un logo de pecho mide 8–12 cm).',
  puff: 'Tinta con espumante que <b>se infla al curarla</b> y queda acolchada. Va mejor con trazos gruesos: los detalles finos se empastan.',
  glitter: 'Vinilo con purpurina de <b>un solo color</b>: brilla con cada movimiento. Funciona con formas simples y bloques.',
  foil: 'Lámina metálica espejada que se pega sobre un adhesivo. Llamativísimo… y el que <b>menos aguanta los lavados</b>.',
  pintura: 'Pintás <b>a mano</b> sobre la remera con pintura textil y después se fija con calor. Cada pieza es única.',
};

export function processLabel(tech) {
  if (tech.process === 'screen') return `Shablón y racleta · curado ${tech.cure.temp} °C`;
  if (tech.process === 'press') return `Prensa térmica ${tech.press.temp} °C · ${tech.press.time} s`;
  if (tech.process === 'embroidery') return 'Bordadora con bastidor';
  if (tech.process === 'paint') return `Pincel · fijado con calor ${tech.cure.temp} °C`;
  return tech.process;
}

// 0..4 "puntitos" de relieve.
export function reliefLevel(mm) {
  if (!mm) return 0;
  if (mm <= 0.15) return 1;
  if (mm <= 0.4) return 2;
  if (mm <= 1.2) return 3;
  return 4;
}

export const fmtNum = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',');

export function reliefText(mm) {
  return mm ? `${fmtNum(mm, 2)} mm` : 'sin relieve';
}

// Colores de tinta para texto y vinilo.
export const INK_COLORS = [
  { id: 'negro', name: 'Negro', hex: '#1e1e21' },
  { id: 'blanco', name: 'Blanco', hex: '#f7f5ef' },
  { id: 'rojo', name: 'Rojo', hex: '#c8302c' },
  { id: 'naranja', name: 'Naranja', hex: '#e86f2a' },
  { id: 'amarillo', name: 'Amarillo', hex: '#f2c641' },
  { id: 'verde', name: 'Verde', hex: '#2f8a57' },
  { id: 'celeste', name: 'Celeste', hex: '#5fb4e0' },
  { id: 'azul', name: 'Azul', hex: '#2850a8' },
  { id: 'violeta', name: 'Violeta', hex: '#6c4aa0' },
  { id: 'rosa', name: 'Rosa', hex: '#ec7fae' },
  { id: 'marron', name: 'Marrón', hex: '#6e4128' },
  { id: 'ocre', name: 'Ocre', hex: '#c8962e' },
];

// Frascos de pintura textil (los mismos tonos del kit 3D + algunos más).
export const PAINT_COLORS = [
  { id: 'rojo', name: 'Rojo', hex: '#c42b2b' },
  { id: 'naranja', name: 'Naranja', hex: '#e5732b' },
  { id: 'amarillo', name: 'Amarillo', hex: '#f1cc4e' },
  { id: 'verde', name: 'Verde', hex: '#3f9a6c' },
  { id: 'azul', name: 'Azul', hex: '#2f5cb6' },
  { id: 'violeta', name: 'Violeta', hex: '#6b4b9b' },
  { id: 'rosa', name: 'Rosa', hex: '#ec7fae' },
  { id: 'celeste', name: 'Celeste', hex: '#6cb8e2' },
  { id: 'marron', name: 'Marrón', hex: '#7a4a2c' },
  { id: 'blanco', name: 'Blanco', hex: '#f3f1ea' },
  { id: 'negro', name: 'Negro', hex: '#1e1e21' },
];

export function luminanceOf(hex) {
  const c = String(hex || '#ffffff').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Compatibilidad técnica ↔ tela/color
// ---------------------------------------------------------------------------

// → { level: 'ok'|'info'|'warn'|'bad', badge, html, penalty }
export function compatibility(tech, fabric, fabricHex) {
  const lum = luminanceOf(fabricHex);
  const dark = lum < 0.5;
  if (tech.id === 'sublimacion') {
    let penalty = 0;
    const why = [];
    if ((fabric.sublimation ?? 1) < 0.4) {
      penalty += 40;
      why.push(`la sublimación solo tiñe <b>poliéster</b>: en ${fabric.short.toLowerCase()} casi no toma y se va con los lavados`);
    } else if ((fabric.sublimation ?? 1) < 0.9) {
      penalty += 10;
      why.push(`en ${fabric.short} solo tiñe la parte de poliéster: queda con <b>look vintage</b> (desteñido)`);
    }
    if (dark) {
      penalty += 40;
      why.push('no tiene tinta blanca: <b>en tela oscura no se ve</b>');
    }
    penalty = Math.min(50, penalty);
    if (penalty >= 40) return { level: 'bad', badge: 'No recomendado', html: `Ojo: ${why.join(' y ')}.`, penalty };
    if (penalty > 0) return { level: 'warn', badge: 'Vintage', html: `${why[0][0].toUpperCase()}${why[0].slice(1)}.`, penalty };
    return { level: 'ok', badge: 'Ideal', html: 'Poliéster claro: <b>el ideal de la sublimación</b>. Colores vivos que no se agrietan nunca.', penalty: 0 };
  }
  if (tech.id === 'pintura' && fabric.id === 'poliester') {
    return { level: 'warn', badge: 'Ojo', html: 'La pintura textil al agua <b>no agarra bien en poliéster</b>: se cuartea. Para dry-fit, mejor sublimación o vinilo.', penalty: 10 };
  }
  if (tech.id === 'bordado' && fabric.gsm < 150) {
    return { level: 'warn', badge: 'Ojo', html: 'Tela liviana: el bordado tiende a <b>fruncirla</b>. Se puede, pero con estabilizador recortable y un diseño chico.', penalty: 5 };
  }
  if (tech.id === 'foil' && fabric.id === 'lino') {
    return { level: 'warn', badge: 'Ojo', html: 'La trama irregular del lino deja el foil <b>con fallas</b>: el adhesivo no apoya parejo.', penalty: 5 };
  }
  if (tech.id === 'puff' && fabric.id === 'poliester') {
    return { level: 'info', badge: null, html: 'En poliéster el puff necesita tinta de <b>baja curación</b>, si no el color de la tela migra a la tinta.', penalty: 0 };
  }
  if (tech.id === 'serigrafia' && dark) {
    return { level: 'info', badge: null, html: 'Tela oscura: se imprime primero una <b>base blanca</b> para que los colores no se apaguen.', penalty: 0 };
  }
  if (tech.id === 'bordado' && fabric.id === 'pique') {
    return { level: 'ok', badge: 'Ideal', html: 'El piqué es firme: <b>el bordado le queda bárbaro</b> (es lo típico de las chombas).', penalty: 0 };
  }
  if (tech.id === 'dtf') return { level: 'ok', badge: null, html: 'El DTF va bien en <b>cualquier tela y color</b>: trae su propia base blanca.', penalty: 0 };
  return { level: 'ok', badge: null, html: '', penalty: 0 };
}

// Técnica sugerida para el modo automático (lo del pedido, o lo más noble para la tela).
export function suggestedTechnique(catalog, state) {
  const req = state.order?.req?.technique;
  if (req && catalog.techniqueById(req)) return req;
  const fab = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
  if (fab.sublimation >= 0.9 && luminanceOf(state.fabric?.color) > 0.6) return 'sublimacion';
  return 'serigrafia';
}

// Tinta inicial por técnica (dentro del máximo, sin pasarse).
export function defaultColors(tech) {
  if (!tech.maxColors) return null;
  if (tech.id === 'serigrafia') return 3;
  if (tech.id === 'bordado') return 4;
  return tech.maxColors;
}

// ---------------------------------------------------------------------------
// Geometría de la estampa (coords de prenda; para la espalda x "vista desde atrás")
// ---------------------------------------------------------------------------

// processPrint agrega ~2 % de margen transparente por lado: el ancho del parche es el
// del contenido / fracción visible. Replica el cálculo de printEngine.prepare().
export function padFractions(srcW, srcH, res) {
  const inner = res / 1.04;
  const s = inner / Math.max(srcW, srcH);
  const dw0 = Math.max(1, Math.round(srcW * s));
  const dh0 = Math.max(1, Math.round(srcH * s));
  const padX = Math.max(3, Math.round(dw0 * 0.02));
  const padY = Math.max(3, Math.round(dh0 * 0.02));
  const dw = srcW >= srcH ? Math.max(1, res - padX * 2) : dw0;
  const dh = srcW < srcH ? Math.max(1, res - padY * 2) : dh0;
  const w = dw + padX * 2;
  const h = dh + padY * 2;
  return { fx: dw / w, fy: dh / h, aspect: w / h };
}

// Medidas del parche: W/H = rectángulo completo (con margen), cw/ch = contenido visible.
export function printDims(placement, aspect, fx = 1 / 1.04, fy = 1 / 1.04) {
  const W = placement.width;
  const H = W / (aspect || 1);
  return { W, H, cw: W * fx, ch: H * fy };
}

// Semiejes de la caja (alineada a los ejes) que ocupa el contenido rotado.
function rotatedHalfExtents(cw, ch, rotDeg) {
  const r = (rotDeg || 0) * DEG;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { hx: (cw * c + ch * s) / 2, hy: (cw * s + ch * c) / 2 };
}

// Ancho máximo del parche que entra en el área (para el slider de tamaño).
export function maxWidthFor(area, aspect, fx, fy, rotDeg = 0) {
  const aw = area.maxX - area.minX;
  const ah = area.maxY - area.minY;
  // contenido rotado: hx = W·(fx·c + fy·s/aspect)/2 ≤ aw/2, hy = W·(fx·s + fy·c/aspect)/2 ≤ ah/2
  const r = (rotDeg || 0) * DEG;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const kx = fx * c + (fy * s) / aspect;
  const ky = fx * s + (fy * c) / aspect;
  return Math.max(0.03, Math.min(aw / kx, ah / ky));
}

// Deja la estampa adentro del área estampable (achica si no entra y corre el centro).
export function clampPlacement(pl, area, aspect, fx, fy) {
  const out = { ...pl };
  const maxW = maxWidthFor(area, aspect, fx, fy, out.rotation);
  out.width = clamp(out.width, 0.03, maxW);
  const { cw, ch } = printDims(out, aspect, fx, fy);
  const { hx, hy } = rotatedHalfExtents(cw, ch, out.rotation);
  const minX = area.minX + hx;
  const maxX = area.maxX - hx;
  const minY = area.minY + hy;
  const maxY = area.maxY - hy;
  out.x = minX > maxX ? (area.minX + area.maxX) / 2 : clamp(out.x, minX, maxX);
  out.y = minY > maxY ? (area.minY + area.maxY) / 2 : clamp(out.y, minY, maxY);
  return out;
}

// Ubicaciones rápidas (anchos de contenido reales del oficio).
export const QUICK_SPOTS = [
  { id: 'pecho', label: 'Pecho centrado', sub: '24–28 cm', side: 'frente' },
  { id: 'corazon', label: 'Corazón', sub: 'logo 9 cm', side: 'frente' },
  { id: 'espalda', label: 'Espalda alta', sub: '26 cm', side: 'espalda' },
  { id: 'gigante', label: 'Gigante', sub: 'todo el frente', side: 'frente' },
];

export function quickPlacement(id, pattern, aspect, fx, fy) {
  const spot = QUICK_SPOTS.find((s) => s.id === id) || QUICK_SPOTS[0];
  const side = spot.side;
  const area = pattern.printArea[side];
  const contentAspect = (aspect * fy) / fx; // ancho/alto del contenido
  let cw;
  let x = 0;
  let topGap;
  if (id === 'corazon') {
    cw = Math.min(0.09, 0.09 * Math.sqrt(contentAspect)); // logos altos: un poco más angostos
    x = Math.min(0.1, area.maxX - cw / 2 - 0.01);
    topGap = 0.045;
  } else if (id === 'gigante') {
    cw = (area.maxX - area.minX) * 0.94;
    topGap = 0.02;
  } else if (id === 'espalda') {
    cw = 0.26;
    topGap = 0.02;
  } else {
    cw = 0.26;
    topGap = 0.045;
  }
  // que no quede demasiado alto (diseños verticales)
  const maxCh = id === 'gigante' ? area.maxY - area.minY - 0.04 : id === 'corazon' ? 0.11 : 0.3;
  if (cw / contentAspect > maxCh) cw = maxCh * contentAspect;
  const W = cw / fx;
  const ch = (W / aspect) * fy;
  const y = area.maxY - topGap - ch / 2;
  return { side, placement: clampPlacement({ x, y, width: W, rotation: 0 }, area, aspect, fx, fy) };
}

// ---------------------------------------------------------------------------
// Imagen: resolución y colores
// ---------------------------------------------------------------------------

// dpi efectivos de una imagen subida al tamaño de estampa elegido.
export function dpiFor(srcPxW, contentWidthM) {
  if (!srcPxW || !contentWidthM) return Infinity;
  return srcPxW / (contentWidthM / 0.0254);
}

// Para estampar se piden 150–300 dpi al tamaño real.
//   'ok'   ≥ 150 dpi  nítida
//   'fair' 100–150    alcanza justo (de cerca se ve un poco blanda)
//   'low'  60–100     se notan los píxeles
//   'bad'  < 60       se pixela
export const DPI_GOOD = 150;
export function dpiLevel(dpi) {
  if (!isFinite(dpi)) return 'vector';
  if (dpi < 60) return 'bad';
  if (dpi < 100) return 'low';
  if (dpi < DPI_GOOD) return 'fair';
  return 'ok';
}
// Nivel para la interfaz (✓ / ! / ✗).
export const dpiUi = (lv) => (lv === 'bad' ? 'bad' : lv === 'low' || lv === 'fair' ? 'warn' : 'ok');
export const DPI_PENALTY = { bad: 20, low: 8, fair: 3, ok: 0, vector: 0 };

// Desde cuántos "colores" una imagen se considera foto o degradé.
export const PHOTO_COLORS = 24;

// Cuántos colores hacen falta para representar la imagen: se arma un histograma de 512 tonos
// (3 bits por canal) con los píxeles opacos y se cuentan los tonos necesarios para cubrir el 90 %
// de la imagen. Un logo plano da 2–6 (los bordes suavizados no llegan a pesar), una ilustración
// 8–15 y una foto o un degradé, cientos.
export function countColors(canvas, cover = 0.9) {
  const w = canvas.width;
  const h = canvas.height;
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  let d;
  try {
    d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  } catch (e) {
    return 0;
  }
  const bins = new Uint32Array(512);
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 4;
      if (d[o + 3] < 128) continue;
      bins[((d[o] >> 5) << 6) | ((d[o + 1] >> 5) << 3) | (d[o + 2] >> 5)]++;
      n++;
    }
  }
  if (!n) return 0;
  const counts = Array.from(bins).filter((c) => c > 0).sort((a, b) => b - a);
  let acc = 0;
  let k = 0;
  for (const c of counts) {
    acc += c;
    k++;
    if (acc >= n * cover) break;
  }
  return k;
}

// "unos 7 colores" / "colores de foto (degradés)"
export function colorsText(n) {
  return n >= PHOTO_COLORS ? 'colores de foto (degradés y cientos de tonos)' : `unos ${n} colores`;
}

// Contraste medio entre la estampa (resultado ya procesado) y la tela: 0 (no se ve) .. 1.
export function printContrast(result, fabricHex) {
  const c = result?.color;
  if (!c) return 1;
  const w = c.width;
  const h = c.height;
  let d;
  try {
    d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  } catch (e) {
    return 1;
  }
  const f = String(fabricHex || '#ffffff').replace('#', '');
  const fr = parseInt(f.slice(0, 2), 16);
  const fg = parseInt(f.slice(2, 4), 16);
  const fb = parseInt(f.slice(4, 6), 16);
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 16000)));
  let sum = 0;
  let wsum = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 4;
      const a = d[o + 3] / 255;
      if (a < 0.3) continue;
      const dr = d[o] - fr;
      const dg = d[o + 1] - fg;
      const db = d[o + 2] - fb;
      sum += (Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11) / 255) * a;
      wsum += a;
    }
  }
  return wsum ? sum / wsum : 1;
}

// ---------------------------------------------------------------------------
// Costo
// ---------------------------------------------------------------------------

export function estimateCost(tech, { cw, ch, colors = 1, coverage = 0.4 }) {
  const ref = 0.26 * 0.24;
  const size = clamp(Math.sqrt((cw * ch) / ref), 0.35, 1.7);
  let k = 0.55 + 0.45 * size;
  if (tech.process === 'screen') k *= 0.7 + 0.15 * (colors || 1); // un shablón por tinta
  else if (tech.id === 'vinilo') k *= 0.8 + 0.2 * (colors || 1);
  else if (tech.id === 'bordado') k = 0.3 + 0.75 * size * size * clamp(coverage * 2.2, 0.35, 1.3) + 0.04 * (colors || 1); // puntadas ∝ área cubierta
  else if (tech.id === 'pintura') k = 0.6 + 0.6 * size * clamp(coverage * 2, 0.3, 1.2);
  return Math.max(400, Math.round((tech.cost * k) / 50) * 50);
}

// ---------------------------------------------------------------------------
// Pedidos: detalles que el cliente pidió en su texto
// ---------------------------------------------------------------------------

export const ORDER_EXTRAS = {
  'Don Ernesto': { maxCm: 13, side: 'frente', text: 'un bordadito chiquito en el pecho', sizeText: 'chiquito, en el pecho' },
  Caro: { minCm: 22, text: 'algo bien llamativo', sizeText: 'bien grande y llamativo' },
  'Joyería Brillo': { tint: 'oro', text: 'el logo en foil dorado' },
  Valen: { own: 'paint', text: 'una pieza única pintada a mano' },
};

// ---------------------------------------------------------------------------
// Chequeo + puntaje
// ---------------------------------------------------------------------------

// d = { tech, fabric, fabricHex, sourceType ('preset'|'upload'|'text'|'paint'), srcPxW, colors,
//       tintId, richColors, cw, ch, coverage, contrast, inArea, order }
// → { score, checks: [{ id, level, label, html }], notes: [html] }
export function evaluateDesign(d) {
  const { tech, fabric } = d;
  const checks = [];
  const notes = [];
  let score = 100;
  const OK = '<span class="dis-mark ok">✓</span>';
  const NO = '<span class="dis-mark no">✗</span>';
  const MID = '<span class="dis-mark mid">≈</span>';
  const mark = (lv) => (lv === 'ok' ? OK : lv === 'bad' ? NO : MID);
  const cwCm = d.cw * 100;
  const chCm = d.ch * 100;

  // 1) técnica ↔ tela
  const comp = compatibility(tech, fabric, d.fabricHex);
  score -= comp.penalty;
  const compLv = comp.penalty >= 30 ? 'bad' : comp.penalty > 0 ? 'warn' : 'ok';
  checks.push({ id: 'tecnica', level: compLv, label: compLv === 'ok' ? `${TECH_SHORT[tech.id]} va bien en ${fabric.short.toLowerCase()}` : `${TECH_SHORT[tech.id]} en ${fabric.short.toLowerCase()}`, html: comp.html });
  if (compLv === 'ok') notes.push(`${OK} <b>${tech.name}</b> sobre ${fabric.short.toLowerCase()}: buena combinación.${comp.html ? ' ' + comp.html : ''}`);
  else notes.push(`${mark(compLv)} ${comp.html} (−${comp.penalty})`);

  // 2) tintas / hilos
  if (tech.maxColors) {
    const word = inkWord(tech.id, d.colors);
    let lv = 'ok';
    let html = `${d.colors} ${word} de ${tech.maxColors} posibles.`;
    if (d.sourceType === 'upload' && d.richColors > Math.max(8, tech.maxColors * 2) && tech.maxColors <= 6) {
      lv = 'warn';
      score -= 8;
      const what = d.richColors >= PHOTO_COLORS ? 'es una foto (o tiene degradés)' : `tiene ${colorsText(d.richColors)}`;
      html = `Tu imagen ${what} y en ${TECH_SHORT[tech.id].toLowerCase()} se separa en ${d.colors} ${word}: <b>pierde detalle</b>. Para fotos van mejor el DTF o la sublimación.`;
      notes.push(`${MID} ${html} (−8)`);
    } else if (d.sourceType === 'upload' && tech.maxColors > 1 && d.richColors > d.colors + 1 && d.colors < tech.maxColors) {
      lv = 'warn';
      score -= 3;
      html = `Tu imagen tiene ${colorsText(d.richColors)} y elegiste ${d.colors} ${word}: <b>algunos colores se juntan</b> en la misma tinta. Probá con más ${inkWord(tech.id)} (hasta ${tech.maxColors}).`;
      notes.push(`${MID} ${html} (−3)`);
    } else if (d.sourceType === 'upload' && tech.maxColors > 1 && d.richColors > d.colors + 1) {
      html = `Tu imagen tiene ${colorsText(d.richColors)}: con ${d.colors} ${word} (el máximo de ${TECH_SHORT[tech.id].toLowerCase()}) algunos se juntan. Es parte del estilo de la técnica.`;
      notes.push(`${OK} ${html}`);
    } else if (tech.maxColors === 1 && d.sourceType !== 'text' && d.richColors > 3) {
      html = `${TECH_SHORT[tech.id]} es de un solo tono: del diseño se usa la silueta.`;
      notes.push(`${OK} ${html}`);
    } else notes.push(`${OK} ${d.colors} ${word} (máximo ${tech.maxColors} en ${TECH_SHORT[tech.id].toLowerCase()}).`);
    checks.push({ id: 'tintas', level: lv, label: `${d.colors}/${tech.maxColors} ${inkWord(tech.id)}`, html });
  } else {
    checks.push({ id: 'tintas', level: 'ok', label: tech.id === 'pintura' ? 'Colores libres' : 'A todo color', html: tech.id === 'pintura' ? 'Con pincel usás los colores que quieras.' : 'Imprime a todo color, sin separar tintas.' });
  }

  // 3) tamaño
  {
    let lv = 'ok';
    let html = `${fmtNum(cwCm, 0)} × ${fmtNum(chCm, 0)} cm.`;
    let pen = 0;
    const minW = tech.id === 'bordado' ? 4 : 5;
    if (cwCm < minW && chCm < minW + 1) {
      pen = 10;
      lv = 'warn';
      html = `Muy chiquita (${fmtNum(cwCm, 0)} cm): <b>se pierde el detalle</b> y casi no se ve.`;
    } else if (tech.id === 'bordado' && cwCm > 22) {
      pen = 10;
      lv = 'warn';
      html = `Un bordado de ${fmtNum(cwCm, 0)} cm <b>pesa, frunce la tela y cuesta una fortuna</b>: los bordados de pecho miden 8–12 cm.`;
    } else if (tech.id === 'puff' && cwCm < 7) {
      pen = 5;
      lv = 'warn';
      html = 'El puff en tamaño chico se empasta: los trazos se pegan al inflarse.';
    }
    score -= pen;
    checks.push({ id: 'tamano', level: lv, label: `${fmtNum(cwCm, 0)} × ${fmtNum(chCm, 0)} cm`, html });
    notes.push(`${mark(lv)} Tamaño: ${html}${pen ? ` (−${pen})` : ''}`);
  }

  // 4) resolución (solo imágenes subidas: lo demás es vectorial)
  if (d.sourceType === 'upload') {
    const dpi = dpiFor(d.srcPxW, d.cw);
    const lv0 = dpiLevel(dpi);
    const lv = dpiUi(lv0);
    const pen = DPI_PENALTY[lv0] || 0;
    score -= pen;
    const dpiTxt = `${Math.round(dpi)} dpi`;
    const html =
      lv0 === 'bad'
        ? `Tu imagen queda a <b>${dpiTxt}</b>: <b>se va a pixelar</b>. Para estampar se piden 150–300 dpi (usá una imagen más grande o achicá la estampa).`
        : lv0 === 'low'
          ? `${dpiTxt}: <b>se van a notar los píxeles</b>. Para estampar se piden 150 dpi o más: achicá la estampa o usá una imagen más grande.`
          : lv0 === 'fair'
            ? `${dpiTxt}: alcanza justo; de cerca se ve un poco blanda. Lo ideal para estampar son 150 dpi o más.`
            : `${dpiTxt}: nítida a este tamaño (se piden 150 dpi o más).`;
    checks.push({ id: 'resolucion', level: lv, label: `Resolución ${dpiTxt}`, html });
    notes.push(`${mark(lv)} ${html}${pen ? ` (−${pen})` : ''}`);
  } else {
    checks.push({ id: 'resolucion', level: 'ok', label: d.sourceType === 'paint' ? 'Pintado a mano' : 'Vectorial: nítido', html: d.sourceType === 'paint' ? 'No hay píxeles que valgan: es pintura de verdad.' : 'Los prediseños y textos son vectoriales: se ven nítidos a cualquier tamaño.' });
  }

  // 5) contraste con la tela
  if (tech.id !== 'foil' && tech.id !== 'glitter' && d.contrast != null) {
    const c = d.contrast;
    const lv = c < 0.1 ? 'bad' : c < 0.18 ? 'warn' : 'ok';
    const pen = lv === 'bad' ? 12 : lv === 'warn' ? 4 : 0;
    score -= pen;
    const html = lv === 'bad' ? 'La estampa <b>casi no se distingue</b> de la tela: probá otros colores o una tela que contraste.' : lv === 'warn' ? 'Poco contraste con la tela: de lejos se va a perder.' : 'Buen contraste con la tela.';
    checks.push({ id: 'contraste', level: lv, label: lv === 'ok' ? 'Buen contraste' : 'Poco contraste', html });
    if (lv !== 'ok') notes.push(`${mark(lv)} ${html} (−${pen})`);
  }

  // 6) área
  checks.push({ id: 'area', level: d.inArea ? 'ok' : 'warn', label: d.inArea ? 'Dentro del área estampable' : 'Fuera del área', html: 'Lejos de costuras y del cuello, donde la prensa y el shablón apoyan parejo.' });
  if (!d.inArea) score -= 10;

  // 7) diseño propio
  if (d.sourceType === 'preset') {
    score -= 4;
    notes.push(`${MID} Prediseño del taller: con un diseño propio (imagen, texto o pintura) la remera tiene más personalidad (−4).`);
  } else {
    const what = d.sourceType === 'upload' ? 'tu propia imagen' : d.sourceType === 'text' ? 'tu propio texto' : 'pintado a mano por vos';
    notes.push(`${OK} Diseño propio: ${what}. ¡Eso no tiene precio!`);
  }

  // 8) pedido
  const order = d.order;
  if (order) {
    const want = order.req?.technique;
    if (want) {
      if (want === tech.id) notes.push(`${OK} Técnica pedida por ${order.name}: <b>${tech.name}</b>.`);
      else {
        score -= 35;
        notes.push(`${NO} ${order.name} pidió <b>${d.wantName || want}</b> y elegiste ${tech.name} (−35).`);
      }
      checks.push({ id: 'pedido', level: want === tech.id ? 'ok' : 'bad', label: want === tech.id ? `Pedido: ${TECH_SHORT[want]}` : `Pedido: ${TECH_SHORT[want] || want}`, html: `${order.name} pidió ${d.wantName || want}.` });
    }
    const ex = ORDER_EXTRAS[order.name];
    // El tono del foil o la pintura a mano son parte de la técnica pedida: si la técnica ya no es
    // la del pedido, eso ya se descontó arriba (no se cobra dos veces).
    const techMiss = !!want && want !== tech.id;
    const exChecks = ex ? { size: !!(ex.maxCm || ex.minCm || ex.side), tech: !techMiss && !!(ex.tint || ex.own) } : null;
    if (ex && (exChecks.size || exChecks.tech)) {
      let ok = true;
      if (ex.maxCm && cwCm > ex.maxCm) ok = false;
      if (ex.side && d.side !== ex.side) ok = false;
      if (ex.minCm && cwCm < ex.minCm) ok = false;
      if (exChecks.tech && ex.tint && d.tintId !== ex.tint) ok = false;
      if (exChecks.tech && ex.own && d.sourceType !== ex.own) ok = false;
      // si la técnica no es la pedida, del pedido solo se evalúa el tamaño/lugar
      const exText = techMiss && ex.sizeText ? ex.sizeText : ex.text;
      if (ok) notes.push(techMiss ? `${OK} Al menos el tamaño quedó como lo pidió: ${exText}.` : `${OK} Cumpliste con “${exText}”.`);
      else {
        score -= 10;
        notes.push(`${MID} ${order.name} quería ${techMiss ? 'la estampa ' : ''}<b>${exText}</b> y no quedó así (−10).`);
      }
      if (!want) checks.push({ id: 'pedido', level: ok ? 'ok' : 'warn', label: ok ? 'Como lo pidió' : 'Revisá el pedido', html: `${order.name} quería ${ex.text}.` });
      else if (!ok) {
        const c = checks.find((x) => x.id === 'pedido');
        if (c && c.level === 'ok') {
          c.level = 'warn';
          c.html = `${order.name} quería ${ex.text}.`;
          c.label = 'Revisá el pedido';
        }
      }
    }
  }

  return { score: clamp(Math.round(score), 0, 100), checks, notes };
}
