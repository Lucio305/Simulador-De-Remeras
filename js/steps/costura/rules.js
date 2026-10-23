// Reglas del paso de costura: qué costuras lleva la remera, qué puntada conviene en cada una,
// cómo se puntúan los ajustes de la máquina y qué efectos tienen el hilo y la aguja elegidos.
// Todo se calcula contra js/data/catalog.js (SEAMS, STITCHES, MACHINE, THREADS, NEEDLES).

import { SEAMS, STITCHES, MACHINE, threadById, NEEDLES } from '../../data/catalog.js';
import { clamp } from '../../core/utils.js';

export const OK = '<span class="cos-mark ok">✓</span> ';
export const NO = '<span class="cos-mark no">✗</span> ';
export const MID = '<span class="cos-mark mid">≈</span> ';

export const fmtMm = (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} mm`;

// Costuras que lleva el molde elegido, en el orden de armado.
export function seamsFor(patternOpts) {
  const hasSleeves = (patternOpts?.sleeve || 'corta') !== 'sin';
  return SEAMS.filter((s) => !s.requires || (s.requires === 'mangas' ? hasSleeves : !hasSleeves));
}

export const stitchById = (id) => STITCHES.find((s) => s.id === id) || STITCHES[0];
export const bestStitches = (seam, fabric) => seam.best[fabric.knit ? 'knit' : 'woven'] || ['recta'];
export const idealStitch = (seam, fabric) => bestStitches(seam, fabric)[0];

const HEMS = ['punos', 'ruedo'];
const BANDS = ['cuello', 'sisas'];
export const isHem = (seamId) => HEMS.includes(seamId);
export const isBand = (seamId) => BANDS.includes(seamId);

// Qué máquina usa cada puntada.
export const machineFor = (stitchId) => (stitchId === 'overlock' ? 'overlock' : 'maquina');

// Puntos de la puntada (0..25) y una explicación con el porqué.
export function stitchFit(seam, stitchId, fabric) {
  const best = bestStitches(seam, fabric);
  const st = stitchById(stitchId);
  const name = `<b>${st.name.toLowerCase()}</b>`;
  if (best.includes(stitchId)) {
    const why = fabric.knit
      ? {
          overlock: 'une y remata el borde en una pasada, y estira con el tejido',
          zigzag: 'acompaña el estiramiento del punto sin cortarse',
          recubridora: 'el doble pespunte elástico de los dobladillos profesionales',
        }[stitchId]
      : 'en un tejido plano que no estira, la recta es firme y prolija';
    return { pts: 25, ok: 'ok', note: `${name}: ${why || 'la indicada'}.` };
  }
  if (fabric.knit) {
    if (stitchId === 'recta') return { pts: 0, ok: 'no', note: `La ${name} no estira: en tejido de punto la costura se corta al ponerte la remera.` };
    if (stitchId === 'recubridora' && !isHem(seam.id)) return { pts: 8, ok: 'no', note: `La ${name} es para dobladillos: no sirve para unir dos piezas por el borde.` };
    if (stitchId === 'overlock' && isHem(seam.id)) return { pts: 10, ok: 'mid', note: `El ${name} remata el borde pero no hace el dobladillo: queda con cara de prenda sin terminar.` };
    if (stitchId === 'zigzag') return { pts: 17, ok: 'mid', note: `El ${name} estira, pero deja el borde crudo: el overlock une y remata a la vez.` };
    if (stitchId === 'overlock' && isBand(seam.id)) return { pts: 14, ok: 'mid', note: `El ${name} pega el ribete, pero la costura queda a la vista y abultada: la recubridora (o el zigzag) lo terminan más prolijo.` };
    return { pts: 14, ok: 'mid', note: `${stitchId === 'recubridora' ? 'La' : 'El'} ${name} sirve, pero no es ${stitchId === 'recubridora' ? 'la ideal' : 'el ideal'} para esta costura.` };
  }
  // tejido plano
  if (stitchId === 'overlock') return { pts: isHem(seam.id) ? 8 : 15, ok: 'mid', note: isHem(seam.id) ? `El ${name} no dobla el ruedo: en un plano se hace un dobladillo con recta.` : `El ${name} remata lindo el borde, pero en tejido plano lo clásico (y más firme) es la recta.` };
  if (stitchId === 'recubridora') return { pts: isHem(seam.id) ? 15 : 5, ok: isHem(seam.id) ? 'mid' : 'no', note: isHem(seam.id) ? `La ${name} anda en el ruedo, pero el plano no necesita una puntada elástica.` : `La ${name} es para dobladillos de punto: no une piezas.` };
  return { pts: 10, ok: 'mid', note: `El ${name} no hace falta en un tejido que no estira: queda menos prolijo que la recta.` };
}

// Ajustes de la máquina (0..15): 7,5 por largo de puntada y 7,5 por tensión.
export function settingsFit(stitchLength, tension) {
  const [a, b] = MACHINE.stitchLength.ideal;
  const [c, d] = MACHINE.tension.ideal;
  const dl = stitchLength < a ? a - stitchLength : stitchLength > b ? stitchLength - b : 0;
  const dt = tension < c ? c - tension : tension > d ? tension - d : 0;
  const pl = dl < 1e-6 ? 7.5 : dl <= 0.5 + 1e-6 ? 4 : 0;
  const pt = dt < 1e-6 ? 7.5 : dt <= 1 + 1e-6 ? 4 : 0;
  return {
    pts: pl + pt,
    len: { pts: pl, state: dl < 1e-6 ? 'ok' : stitchLength < a ? 'short' : 'long' },
    tension: { pts: pt, state: dt < 1e-6 ? 'ok' : tension < c ? 'low' : 'high' },
  };
}

// Precisión de una puntada según el desvío (mm) respecto de la línea de tiza.
export function stitchAccuracy(errMm) {
  const e = Math.abs(errMm);
  if (e <= 1.2) return 1;
  if (e <= 2.5) return 1 - ((e - 1.2) / 1.3) * 0.2;
  if (e <= 4.5) return 0.8 - ((e - 2.5) / 2) * 0.4;
  if (e <= 7) return 0.4 - ((e - 4.5) / 2.5) * 0.4;
  return 0;
}

// Nota de una costura: precisión 60 % + puntada 25 % + ajustes 15 %, −2 por cada punta sin rematar.
export function seamScore({ accuracy, stitchPts, settingsPts, remateStart = true, remateEnd = true, needsRemate = true }) {
  let s = 60 * clamp(accuracy) + stitchPts + settingsPts;
  if (needsRemate) s -= (remateStart ? 0 : 2) + (remateEnd ? 0 : 2);
  return clamp(Math.round(s), 0, 100);
}

// Efectos del hilo y la aguja elegidos en el paso anterior.
export function machineIssues(fabric, threadState) {
  const thread = threadById(threadState?.id) || threadById('poliester');
  const needle = threadState?.needle || 'universal';
  const notes = [];
  let penalty = 0;
  let skip = 0; // probabilidad de puntada salteada
  let holes = false; // agujeritos (aguja afilada en punto)
  let breakRate = 0; // cortes de hilo por puntada a toda velocidad
  if (!thread.goodFor.includes(fabric.id)) {
    penalty += 10;
    if (thread.id === 'rayon') {
      breakRate = 0.0045;
      notes.push(`${NO} El <b>rayón</b> es hilo de bordar: a máquina se corta y una costura de armado no aguanta el uso (−10).`);
    } else if (thread.elastic < 0.3 && fabric.knit) {
      notes.push(`${NO} El hilo de <b>algodón</b> no estira: estas costuras en ${fabric.short} se van a cortar al ponerte la remera (−10).`);
    } else {
      notes.push(`${NO} El <b>${thread.name}</b> estira de más para ${fabric.short}: las costuras quedan onduladas (−10).`);
    }
  }
  if (fabric.knit) {
    if (needle === 'microtex') {
      penalty += 10;
      skip = 0.05;
      holes = true;
      notes.push(`${NO} Aguja <b>microtex</b> en tejido de punto: corta las mallas, saltea puntadas y deja agujeritos (−10).`);
    } else if (needle === 'universal') {
      penalty += 4;
      skip = 0.035;
      notes.push(`${MID} Con la aguja <b>universal</b> en punto aparecieron puntadas salteadas: la punta bola es la indicada (−4).`);
    }
  } else if (needle === 'punta_bola') {
    penalty += 10;
    skip = 0.1;
    notes.push(`${NO} Aguja <b>punta bola</b> en tejido plano: no perfora limpio y saltea muchas puntadas (−10).`);
  } else if (needle === 'universal') {
    penalty += 3;
    skip = 0.015;
    notes.push(`${MID} La aguja <b>universal</b> anda en el plano, pero la microtex da una puntada más pareja (−3).`);
  }
  const needleName = NEEDLES.find((n) => n.id === needle)?.name || needle;
  return { thread, needle, needleName, notes, penalty, skip, holes, breakRate };
}

// Recorrido de cada costura en el mini-juego: tramos de tela (cosidos "en cadena" si son dos),
// forma de la línea guía (desvío lateral g(v) en metros) y tipo de tira.
const GAP = 0.026;
export function courseFor(seamId, { hasSleeves = true, fabric } = {}) {
  const kind = isHem(seamId) ? 'hem' : isBand(seamId) ? 'band' : 'union';
  const allow = kind === 'hem' ? 0.018 : kind === 'band' ? 0.008 : 0.01;
  const S = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));
  let lengths;
  let shape;
  let offsets = [0, 0.0045];
  switch (seamId) {
    case 'hombros':
      lengths = [0.1, 0.1];
      shape = (t, k) => 0.0015 * Math.sin(Math.PI * t) * (k ? -1 : 1);
      break;
    case 'cuello':
      lengths = [0.3];
      shape = (t) => 0.016 * Math.sin(2 * Math.PI * t) - 0.005 * Math.sin(6 * Math.PI * t + 0.6) + 0.005 * Math.sin(0.6);
      break;
    case 'mangas':
    case 'sisas': {
      // La segunda sisa es la misma curva en espejo, recorrida desde el otro lado: arranca a la
      // misma distancia lateral en que terminó la primera (solo hay que acomodarla 4 mm en el hueco).
      lengths = [0.15, 0.15];
      offsets = [0, -0.004];
      const arm = (t) => 0.03 * (1 - Math.cos(Math.PI * t)) * 0.5 + 0.004 * Math.sin(3 * Math.PI * t);
      shape = (t, k) => arm(k ? 1 - t : t);
      break;
    }
    case 'costados':
      lengths = [0.2, 0.2];
      offsets = [0, 0.005];
      shape = hasSleeves ? (t, k) => (k ? -1 : 1) * 0.014 * S((t - 0.18) / 0.26) : (t, k) => (k ? -1 : 1) * 0.004 * Math.sin(Math.PI * t);
      break;
    case 'punos':
      lengths = [0.1, 0.1];
      offsets = [0, -0.004];
      shape = () => 0;
      break;
    case 'ruedo':
    default:
      lengths = [0.3];
      shape = (t) => 0.0025 * Math.sin(Math.PI * t * 1.3);
      break;
  }
  const pieces = [];
  let v = 0;
  lengths.forEach((L, k) => {
    const a = v;
    const b = v + L;
    const off = offsets[k] || 0;
    pieces.push({ a, b, L, k, g: (vv) => off + shape(clamp((vv - a) / L), k) });
    v = b + GAP;
  });
  const end = pieces[pieces.length - 1].b;
  // Pendiente de la guía (para avisar de curvas). En el hueco entre tramos la tela todavía no
  // llegó: la "guía" es recta, a la altura del arranque del tramo siguiente.
  const slopeAt = (vv) => {
    const p = pieceAt(pieces, vv);
    if (!p) return 0;
    const d = 0.002;
    return Math.abs(p.g(vv + d) - p.g(vv - d)) / (2 * d);
  };
  // Dónde tiene que caer la aguja en v: sobre la tiza dentro de un tramo; en el hueco entre dos
  // tramos, donde arranca el siguiente (para acomodar la tela antes de que llegue).
  const guideAt = (vv) => {
    const p = pieceAt(pieces, vv);
    if (p) return { g: p.g(vv), piece: p, gap: false };
    const next = pieces.find((q) => q.a > vv);
    if (next) return { g: next.g(next.a), piece: next, gap: vv > pieces[0].a };
    const last = pieces[pieces.length - 1];
    return { g: last.g(last.b), piece: last, gap: false };
  };
  const stretch = fabric?.stretch ?? 0.5;
  // canto de la tela respecto de la tiza (la tira de strip.js termina ahí: doblez del dobladillo o borde crudo)
  const edge = allow + (kind === 'hem' ? 0.0004 : 0.0014);
  return { seamId, kind, allow, edge, pieces, end, gap: GAP, slopeAt, guideAt, drift: 0.0016 + 0.0026 * stretch };
}

// Tramo que contiene v (tol: cuánto se acepta fuera de las puntas de la tiza).
export function pieceAt(pieces, v, tol = 1e-6) {
  for (const p of pieces) if (v >= p.a - tol && v <= p.b + tol) return p;
  return null;
}

// Nombre de la máquina / pie para la UI.
export function stitchMachineLabel(stitchId) {
  if (stitchId === 'overlock') return 'en el overlock';
  if (stitchId === 'recubridora') return 'aguja doble';
  return 'máquina recta';
}

// Tips del oficio por costura.
export const SEAM_TIPS = {
  hombros: 'Cosé los dos hombros “en cadena”: al terminar el primero seguí con el segundo sin cortar el hilo.',
  cuello: 'Estirá apenas la tira de ribb (no la remera) para que el cuello quede plano y no se abra.',
  mangas: 'Pegá las mangas con la remera abierta, en plano: es mucho más fácil que coserlas en redondo.',
  sisas: 'Estirá un poquito el ribete en la parte baja de la sisa para que no quede abierta.',
  costados: 'De un tirón desde el puño hasta el ruedo: hacé coincidir la costura de la axila.',
  punos: 'Doblá y planchá el dobladillo antes de coser: guía sola la tela.',
  ruedo: 'Un ruedo parejo se mide: 2 cm doblados y la costura siempre a la misma distancia del borde.',
};
const SEAM_TIPS_SIN_MANGAS = {
  costados: 'De un tirón desde la sisa hasta el ruedo: hacé coincidir las puntas del ribete de la sisa.',
};
export const seamTip = (seamId, hasSleeves = true) => (!hasSleeves && SEAM_TIPS_SIN_MANGAS[seamId]) || SEAM_TIPS[seamId] || '';

// Descripción de la costura para la remera elegida (el catálogo la describe con mangas).
export function seamDesc(seam, hasSleeves = true) {
  if (!hasSleeves && seam.id === 'costados') return 'Desde la sisa hasta el ruedo, de un tirón.';
  return seam.desc;
}

// Pista (sin dar la respuesta) para elegir la puntada.
export function stitchHint(seam, fabric) {
  if (fabric.knit) {
    if (isHem(seam.id)) return 'Es un dobladillo en tejido de punto: tiene que estirar y verse prolijo.';
    if (seam.id === 'sisas') return 'Es un ribete en tejido de punto: tiene que estirar con la sisa y quedar prolijo por fuera, como un dobladillo.';
    return 'Tejido de punto: la costura tiene que estirar, y el borde conviene rematarlo.';
  }
  return 'Tejido plano: casi no estira, así que la costura no necesita ser elástica.';
}

export { STITCHES, MACHINE };
