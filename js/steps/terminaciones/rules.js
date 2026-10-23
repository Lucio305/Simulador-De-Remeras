// Reglas del paso Terminaciones: símbolos de cuidado correctos según la tela, puntaje de la
// etiqueta, cantidad de hilos sueltos según la costura y mediciones del control de calidad.
// Todo puro (sin escena ni DOM) para poder reutilizarlo en defaults() y en pruebas.

import { clamp, rng } from '../../core/utils.js';

export const OK = '<span class="term-mark ok">✓</span>';
export const NO = '<span class="term-mark no">✗</span>';
export const MID = '<span class="term-mark mid">≈</span>';

// ---------------------------------------------------------------------------
// Símbolos de cuidado (opciones que ofrece la etiqueta)
// ---------------------------------------------------------------------------
export const CARE = {
  wash: {
    title: 'Lavado',
    options: [
      { id: '30', label: '30 °C', sub: 'Tibia' },
      { id: '40', label: '40 °C', sub: 'Templada' },
      { id: '60', label: '60 °C', sub: 'Caliente' },
      { id: 'mano', label: 'A mano', sub: 'Máx. 40 °C' },
      { id: 'no', label: 'No lavar', sub: 'Solo seco' },
    ],
  },
  bleach: {
    title: 'Lavandina',
    options: [
      { id: 'si', label: 'Cualquiera', sub: 'Con cloro' },
      { id: 'sin_cloro', label: 'Sin cloro', sub: 'Oxígeno activo' },
      { id: 'no', label: 'No usar', sub: 'Nada de lavandina' },
    ],
  },
  dry: {
    title: 'Secado',
    options: [
      { id: 'secarropas', label: 'Secarropas', sub: 'Calor normal' },
      { id: 'secarropas_bajo', label: 'Secarropas', sub: 'Calor bajo' },
      { id: 'sombra', label: 'Colgar', sub: 'A la sombra' },
      { id: 'plano', label: 'En plano', sub: 'Sin colgar' },
    ],
  },
  iron: {
    title: 'Planchado',
    options: [
      { id: '1', label: '•', sub: '110 °C' },
      { id: '2', label: '••', sub: '150 °C' },
      { id: '3', label: '•••', sub: '200 °C' },
      { id: '4', label: '••••', sub: '230 °C' },
      { id: 'no', label: 'No planchar', sub: '' },
    ],
  },
};

export const LABEL_MATERIALS = [
  { id: 'raso', name: 'Raso', sub: 'Satinado, look premium', icon: '🎀' },
  { id: 'algodon', name: 'Algodón', sub: 'Mate y suave', icon: '🌿' },
  { id: 'estampada', name: 'Estampada', sub: 'Sin etiqueta: no pica', icon: '🖨️' },
];

export const LABEL_COLORS = [
  { id: 'negro', name: 'Negro', bg: '#24201d', ink: '#f1e7d6', accent: '#c9a24a' },
  { id: 'crudo', name: 'Crudo', bg: '#efe4cf', ink: '#2b2420', accent: '#b2553f' },
  { id: 'marino', name: 'Marino', bg: '#1f2a46', ink: '#eef1f7', accent: '#e0b65a' },
  { id: 'blanco', name: 'Blanco', bg: '#fbfaf6', ink: '#2b2420', accent: '#2f6f6a' },
];

export const PACKAGING = [
  { id: 'bolsa', name: 'Bolsa compostable', sub: 'Liviana y sin plástico', icon: '🌱', cost: 1 },
  { id: 'caja', name: 'Caja kraft', sub: 'Para regalo, protege más', icon: '📦', cost: 1.8 },
  { id: 'sobre', name: 'Sobre de papel', sub: 'Ideal para mandar por correo', icon: '✉️', cost: 0.8 },
];

export function packagingCost(catalog, id) {
  const p = PACKAGING.find((x) => x.id === id) || PACKAGING[0];
  return Math.round((catalog.COSTS.packaging * p.cost) / 10) * 10;
}

export function labelCost(catalog, material) {
  return Math.round((catalog.COSTS.label * (material === 'estampada' ? 0.8 : material === 'raso' ? 1.15 : 1)) / 10) * 10;
}

// ---------------------------------------------------------------------------
// Lo correcto para una tela
// ---------------------------------------------------------------------------
export function hasPrintIn(state) {
  return !!(state.design || state.print);
}

// Secados aceptables: { best: [...], ok: [...] } (ok = media nota)
export function dryRules(fabric) {
  if (fabric.id === 'poliester') return { best: ['secarropas_bajo', 'sombra'], ok: ['plano'] };
  if (fabric.id === 'modal') return { best: ['plano', 'sombra'], ok: [] };
  if (fabric.id === 'mezcla') return { best: ['sombra'], ok: ['plano', 'secarropas_bajo'] };
  return { best: ['sombra'], ok: ['plano'] };
}

export function bestMaterials(fabric) {
  if (fabric.id === 'poliester') return ['estampada'];
  if (fabric.id === 'modal') return ['raso', 'estampada'];
  if (fabric.id === 'mezcla') return ['estampada', 'algodon', 'raso'];
  return ['algodon', 'estampada'];
}

export function correctCare(fabric, state) {
  const white = isWhiteish(state.fabric?.color);
  const print = hasPrintIn(state);
  return {
    wash: String(fabric.washTemp),
    bleach: white && !print ? 'sin_cloro' : 'no',
    dry: dryRules(fabric).best[0],
    iron: String(fabric.ironLevel),
    reverse: print,
  };
}

function isWhiteish(hex) {
  if (!hex) return false;
  const c = String(hex).replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return Math.min(r, g, b) > 215;
}

// Elección "del montón" (la que usa el modo automático): correcta en lo básico, genérica en lo fino.
export function autoLabel(fabric, state) {
  return {
    material: 'algodon',
    color: 'negro',
    care: { wash: String(fabric.washTemp), bleach: 'sin_cloro', dry: 'sombra', iron: String(Math.max(1, fabric.ironLevel - 1)), reverse: false },
  };
}

export function idealLabel(fabric, state) {
  return { material: bestMaterials(fabric)[0], color: 'negro', care: correctCare(fabric, state) };
}

// ---------------------------------------------------------------------------
// Puntaje de la etiqueta (0..100): lavado 25 + lavandina 20 + secado 20 + plancha 25 + material 10
// ---------------------------------------------------------------------------
export function scoreLabel(catalog, state, label) {
  const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
  const care = label.care || {};
  const notes = [];
  const parts = {};
  const print = hasPrintIn(state);
  const white = isWhiteish(state.fabric?.color);
  const fname = fabric.short;

  // lavado
  const ideal = fabric.washTemp;
  const w = care.wash;
  if (w === String(ideal)) {
    parts.wash = 25;
    notes.push(`${OK} Lavado a <b>${ideal} °C</b>: lo justo para ${fname}.`);
  } else if (w === '30' && ideal === 40) {
    parts.wash = 16;
    notes.push(`${MID} Pusiste 30 °C: no la daña, pero ${fname} aguanta 40 °C y lava mejor (−9).`);
  } else if (w === 'mano') {
    parts.wash = 12;
    notes.push(`${MID} "Lavar a mano" asusta al cliente: ${fname} va al lavarropas a ${ideal} °C sin drama (−13).`);
  } else if (w === 'no') {
    parts.wash = 0;
    notes.push(`${NO} "No lavar" en una remera… nadie la va a llevar a la tintorería (−25). Lavado a ${ideal} °C.`);
  } else if (w == null) {
    parts.wash = 0;
    notes.push(`${NO} Faltó el símbolo de lavado (−25).`);
  } else {
    parts.wash = 0;
    notes.push(`${NO} Lavado a ${w} °C: más caliente de lo que soporta ${fname}, encoge y destiñe (−25). Lo indicado: ${ideal} °C.`);
  }

  // lavandina
  const bl = care.bleach;
  if (bl === 'no') {
    parts.bleach = 20;
    notes.push(`${OK} <b>No usar lavandina</b>: el cloro come el color${print ? ' y el estampado' : ''}.`);
  } else if (bl === 'sin_cloro') {
    parts.bleach = white && !print ? 20 : 10;
    if (white && !print) notes.push(`${OK} Blanqueador <b>sin cloro</b>: en una remera blanca lisa sirve para mantenerla blanca.`);
    else notes.push(`${MID} El blanqueador sin cloro es suave, pero ${print ? 'con estampa' : 'en color'} lo más seguro es "no usar lavandina" (−10).`);
  } else {
    parts.bleach = 0;
    notes.push(`${NO} Lavandina con cloro: amarillea el algodón, ${print ? 'borra la estampa' : 'mancha los colores'} y debilita la fibra (−20).`);
  }

  // secado
  const dr = dryRules(fabric);
  const d = care.dry;
  if (dr.best.includes(d)) {
    parts.dry = 20;
    const why = {
      sombra: 'colgada a la sombra no encoge ni se destiñe',
      secarropas_bajo: 'el poliéster casi no encoge: secarropas suave está bien',
      plano: `${fname} estira mojado: en plano no se deforma`,
    }[d];
    notes.push(`${OK} Secado: ${why}.`);
  } else if (dr.ok.includes(d)) {
    parts.dry = 11;
    notes.push(`${MID} Secado ${d === 'plano' ? 'en plano' : 'con secarropas suave'}: anda, pero para ${fname} lo ideal es ${dr.best[0] === 'sombra' ? 'colgarla a la sombra' : dr.best[0] === 'plano' ? 'secar en plano' : 'secarropas suave'} (−9).`);
  } else if (d === 'secarropas' || d === 'secarropas_bajo') {
    parts.dry = 0;
    const ideal = { sombra: 'colgarla a la sombra', plano: 'secarla en plano', secarropas_bajo: 'secarropas con calor bajo' }[dr.best[0]];
    if (fabric.id === 'poliester') notes.push(`${NO} El calor fuerte del secarropas le saca brillo al poliéster y le hace bolitas (pilling): indicá calor bajo o colgarla a la sombra (−20).`);
    else if (fabric.id === 'modal') notes.push(`${NO} El secarropas encoge y deforma el modal, que es muy delicado mojado: indicá ${ideal} (−20).`);
    else notes.push(`${NO} El secarropas encoge y arruga ${fname}: indicá ${ideal} (−20).`);
  } else {
    parts.dry = 0;
    notes.push(`${NO} Faltó el símbolo de secado (−20).`);
  }

  // plancha
  const lvl = fabric.ironLevel;
  const ir = care.iron;
  if (ir === String(lvl)) {
    parts.iron = 25;
    notes.push(`${OK} Plancha <b>${'•'.repeat(lvl)}</b>: la temperatura de ${fname}.`);
  } else if (ir === 'no') {
    parts.iron = lvl === 1 ? 10 : 5;
    notes.push(`${NO} "No planchar": ${fname} se plancha a ${'•'.repeat(lvl)} (−${lvl === 1 ? 15 : 20}).`);
  } else if (+ir === lvl - 1) {
    parts.iron = 14;
    notes.push(`${MID} Plancha a ${'•'.repeat(+ir)}: no quema, pero no saca las arrugas de ${fname}; va a ${'•'.repeat(lvl)} (−11).`);
  } else if (+ir < lvl) {
    parts.iron = 8;
    notes.push(`${NO} Plancha muy tibia (${'•'.repeat(+ir)}) para ${fname}: no va a quedar lisa nunca (−17).`);
  } else if (ir) {
    parts.iron = 0;
    notes.push(`${NO} Plancha a ${'•'.repeat(+ir)}: ${fabric.ironLevel <= 2 ? 'derrite' : 'quema'} ${fname}. Lo indicado: ${'•'.repeat(lvl)} (−25).`);
  } else {
    parts.iron = 0;
    notes.push(`${NO} Faltó el símbolo de planchado (−25).`);
  }
  const ironing = ir != null && ir !== 'no';
  if (print && ironing && !care.reverse && parts.iron > 0) {
    parts.iron = Math.max(0, parts.iron - 6);
    notes.push(`${MID} Con estampa conviene aclarar <b>"planchar del revés"</b>: la plancha directa la despega o la brilla (−6).`);
  } else if (print && ironing && care.reverse) {
    notes.push(`${OK} Aclaraste "planchar del revés": la estampa te lo agradece.`);
  }

  // material
  const best = bestMaterials(fabric);
  const m = label.material;
  if (best.includes(m)) {
    parts.material = 10;
    const why = {
      estampada: fabric.id === 'poliester' ? 'en ropa deportiva no raspa con el sudor' : 'va impresa adentro del cuello y no pica nunca',
      algodon: 'suave, mate y en sintonía con una tela natural',
      raso: 'acompaña el brillo sedoso de la tela',
    }[m];
    notes.push(`${OK} Etiqueta <b>${matLabel(m)}</b>: ${why}.`);
  } else {
    parts.material = 6;
    notes.push(
      `${MID} Etiqueta ${matLabel(m)}: está bien, aunque para ${fname} ${m === 'raso' ? 'los bordes del raso pueden raspar' : 'queda mejor otra'}; probá ${best.map(matName).join(' o ')} (−4).`,
    );
  }
  if (!String(label.brand || state.brand || '').trim()) notes.push(`${MID} La etiqueta salió sin marca: ¡firmá tu trabajo!`);
  const score = parts.wash + parts.bleach + parts.dry + parts.iron + parts.material;
  const correct = ['wash', 'bleach', 'dry', 'iron'].filter((k) => parts[k] >= (k === 'wash' || k === 'iron' ? 25 : 20) - 6).length;
  return { score: clamp(score, 0, 100), notes, parts, correct };
}

function matName(id) {
  return { raso: 'raso', algodon: 'algodón', estampada: 'estampada' }[id] || id;
}
// "Etiqueta de raso" / "Etiqueta de algodón" / "Etiqueta estampada"
function matLabel(id) {
  return { raso: 'de raso', algodon: 'de algodón', estampada: 'estampada' }[id] || id;
}

// ---------------------------------------------------------------------------
// Hilos sueltos según la costura
// ---------------------------------------------------------------------------
export function sewingScore(state) {
  const seams = state.sewing?.seams;
  if (seams && typeof seams === 'object') {
    const vals = Object.values(seams)
      .map((s) => (typeof s === 'number' ? s : s?.score))
      .filter((v) => typeof v === 'number' && isFinite(v))
      .map((v) => (v <= 1.0001 ? v * 100 : v));
    if (vals.length) return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const sc = state.scores?.costura?.score;
  return typeof sc === 'number' ? sc : 75;
}

export function threadCountFor(state) {
  const s = sewingScore(state);
  return Math.round(16 - 10 * clamp((s - 40) / 55));
}

// Zona de un hilo (para las pistas del panel), a partir de su posición en coords de prenda.
export function threadZone(pattern, x, y) {
  const c = pattern.construction;
  if (y > -0.045) return 'cuello';
  if (y < -c.L + 0.065) return 'ruedo';
  if (c.hasSleeves && c.sleeve) {
    const mx = (c.sleeve.CT.x + c.sleeve.CB.x) / 2;
    const my = (c.sleeve.CT.y + c.sleeve.CB.y) / 2;
    if (Math.hypot(Math.abs(x) - mx, y - my) < 0.07) return 'punos';
  }
  return 'axilas';
}

export const ZONES = [
  { id: 'cuello', name: 'Cuello', en: 'en el cuello', de: 'del cuello' },
  { id: 'axilas', name: 'Axilas', en: 'en la axila', de: 'de las axilas' },
  { id: 'punos', name: 'Puños', en: 'en el puño', de: 'de los puños' },
  { id: 'ruedo', name: 'Ruedo', en: 'en el ruedo', de: 'del ruedo' },
];

// Puntaje de hilos (0..100): cortados + tiempo + pistas + tijeretazos a la tela.
// autoCut = cuántos de los cortados los cortó el modo automático (valen 70 %).
export const AUTO_THREAD_VALUE = 0.7;
export function scoreThreads({ total, cut, autoCut = 0, time, hints, slips, auto }) {
  const notes = [];
  if (!total) return { score: 100, notes: [`${OK} La costura salió tan prolija que no quedaron hilos sueltos.`] };
  const mine = cut - autoCut;
  let s = (100 * (mine + AUTO_THREAD_VALUE * autoCut)) / total;
  const left = total - cut;
  if (autoCut > 0) {
    if (mine > 0) notes.push(`${OK} Cortaste <b>${mine}</b> hilo${mine === 1 ? '' : 's'} a mano.`);
    notes.push(`${MID} El taller cortó ${mine > 0 ? 'los otros ' : ''}<b>${autoCut}</b> a las apuradas, en automático: cada uno vale menos que uno tuyo.`);
  } else if (left === 0) notes.push(`${OK} Cortaste los <b>${total}</b> hilos sueltos: la remera quedó prolija por dentro y por fuera.`);
  if (left > 0) notes.push(`${NO} ${left === 1 ? 'Quedó' : 'Quedaron'} <b>${left}</b> hilo${left === 1 ? '' : 's'} suelto${left === 1 ? '' : 's'}: es lo primero que ve un cliente exigente (−${Math.round((100 * left) / total)}).`);
  if (!auto && cut > 0) {
    const par = 12 + total * 4.5;
    const over = Math.max(0, time - par);
    const pen = Math.min(15, Math.round(over / 3));
    if (pen > 0) {
      s -= pen;
      notes.push(`${MID} Tardaste ${Math.round(time)} s: en el taller se repasa en una pasada, empezando por los remates (−${pen}).`);
    } else if (left === 0) notes.push(`${OK} ¡Y rápido! ${Math.round(time)} s: ojo de inspector.`);
  }
  if (hints > 0) {
    const pen = Math.min(15, hints * 4);
    s -= pen;
    notes.push(`${MID} Usaste ${hints} pista${hints === 1 ? '' : 's'} (−${pen}). Truco: los hilos quedan donde empieza o termina una costura.`);
  }
  if (slips > 2) {
    const pen = Math.min(12, (slips - 2) * 3);
    s -= pen;
    notes.push(`${NO} ${slips} tijeretazos sobre la tela sin hilo: un descuido así deja un agujero (−${pen}).`);
  }
  if (!auto) notes.push('Tip: el hilo se corta al ras, nunca se tira: si tirás, fruncís la costura o la desarmás.');
  return { score: clamp(s, 0, 100), notes };
}

// ---------------------------------------------------------------------------
// Control de calidad
// ---------------------------------------------------------------------------
function seamScores(state) {
  const seams = state.sewing?.seams;
  const out = [];
  if (seams && typeof seams === 'object') {
    for (const [id, s] of Object.entries(seams)) {
      let v = typeof s === 'number' ? s : s?.score;
      if (typeof v !== 'number' || !isFinite(v)) continue;
      if (v <= 1.0001) v *= 100;
      out.push({ id, score: v });
    }
  }
  return out;
}

export function qcItems({ state, catalog, pattern, shirt, threadsLeft, seed = 1 }) {
  const r = rng(seed);
  const m = pattern.measurements;
  const acc = clamp(state.cut?.accuracy ?? (state.scores?.corte?.score ?? 78) / 100, 0, 1);
  const hasSleeve = !!(pattern.construction.hasSleeves && m.sleeveLength > 0);
  // Desvíos de las medidas: normales con σ ∝ (1 − precisión del corte) y una de las medidas
  // siempre cerca del límite (adentro o apenas afuera), para que haya que leer bien la cinta.
  // Con mejor corte, menos probable que esa medida quede afuera.
  const gauss = () => {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  const edge = Math.floor(r() * (hasSleeve ? 3 : 2));
  const pOut = clamp(0.3 + 1.25 * (1 - acc), 0.3, 0.85);
  let tapeN = 0;
  const dev = (tol) => {
    const i = tapeN++;
    let mag;
    if (i === edge) mag = r() < pOut ? tol * (1.12 + 0.4 * r()) : tol * (0.6 + 0.3 * r());
    else mag = Math.abs(gauss()) * tol * (0.25 + 1.2 * (1 - acc));
    mag = Math.round(mag * 10) / 10;
    // nunca justo en el límite: que la decisión sea clara con la cinta en la mano
    if (Math.abs(mag - tol) < 0.05) mag = Math.round((tol + (r() < 0.5 ? -0.2 : 0.2)) * 10) / 10;
    return (r() < 0.5 ? -1 : 1) * mag;
  };
  const items = [];
  const fmt = (v) => `${v.toFixed(1).replace('.', ',')} cm`;
  // medidas
  {
    const d = dev(1);
    const val = m.chest + d;
    items.push({ id: 'pecho', icon: '📏', name: 'Ancho de pecho', kind: 'tape', tape: 'chest', target: m.chest, value: val, tol: 1, unit: 'cm', reading: fmt(val), criterion: `Molde ${fmt(m.chest)} · tolerancia ±1 cm`, pass: Math.abs(d) <= 1, howTo: 'Se mide plano, de costura a costura, 2,5 cm debajo de la sisa.' });
  }
  {
    const d = dev(1.5);
    const val = m.length + d;
    items.push({ id: 'largo', icon: '📐', name: 'Largo total', kind: 'tape', tape: 'length', target: m.length, value: val, tol: 1.5, unit: 'cm', reading: fmt(val), criterion: `Molde ${fmt(m.length)} · tolerancia ±1,5 cm`, pass: Math.abs(d) <= 1.5, howTo: 'Desde el punto más alto del hombro, junto al cuello, hasta el ruedo.' });
  }
  if (hasSleeve) {
    const d = dev(1);
    const val = m.sleeveLength + d;
    items.push({ id: 'manga', icon: '📏', name: 'Largo de manga', kind: 'tape', tape: 'sleeve', target: m.sleeveLength, value: val, tol: 1, unit: 'cm', reading: fmt(val), criterion: `Molde ${fmt(m.sleeveLength)} · tolerancia ±1 cm`, pass: Math.abs(d) <= 1, howTo: 'Por arriba, desde la costura del hombro hasta el borde del puño.' });
  }
  // costuras
  {
    const ss = seamScores(state);
    const base = state.scores?.costura?.score ?? 75;
    const list = ss.length ? ss : [{ id: 'costados', score: base }];
    const avg = list.reduce((a, s) => a + s.score, 0) / list.length;
    const worst = list.reduce((a, s) => (s.score < a.score ? s : a), list[0]);
    const seamName = catalog.SEAMS.find((s) => s.id === worst.id)?.name || 'Costura';
    items.push({
      id: 'costuras',
      icon: '🧵',
      name: 'Costuras',
      kind: 'look',
      focus: 'seam',
      value: worst.score,
      reading: `Promedio ${Math.round(avg)}/100 · la más floja: ${seamName.toLowerCase()} (${Math.round(worst.score)})`,
      criterion: 'Ninguna costura por debajo de 60: sin saltos, frunces ni puntadas flojas',
      pass: worst.score >= 60,
      howTo: 'Estirá suave cada costura: tiene que acompañar sin crujir ni abrirse.',
    });
  }
  // planchado
  {
    let wr = null;
    try {
      if (shirt && shirt.wrinkleAmount > 0.001) wr = shirt.wrinkleLevel() * Math.min(1, shirt.wrinkleAmount);
    } catch (e) {
      wr = null;
    }
    if (wr == null) wr = state.ironing ? 1 - (state.ironing.smooth ?? 0.9) : 0.08;
    const burns = state.ironing?.burns || 0;
    const pct = Math.round(wr * 100);
    items.push({
      id: 'planchado',
      icon: '♨️',
      name: 'Planchado',
      kind: 'look',
      focus: 'whole',
      value: pct,
      reading: `Arrugas: ${pct} % · marcas de plancha: ${burns}`,
      criterion: 'Máximo 15 % de arrugas y ninguna marca de quemado',
      pass: pct <= 15 && burns === 0,
      howTo: 'Mirala con luz rasante: las arrugas y los brillos de plancha saltan a la vista.',
    });
  }
  // estampa
  if (state.design || state.print) {
    const q = clamp(state.print?.quality ?? 0.8);
    const tech = catalog.techniqueById(state.print?.technique || state.design?.technique);
    const defs = state.print?.defects || {};
    const names = { patchy: 'cobertura despareja', lift: 'bordes levantados', scorch: 'aureola de calor', ghost: 'imagen fantasma', under: 'poca tinta' };
    const found = Object.entries(defs)
      .filter(([, v]) => (v === true ? 0.7 : +v || 0) > 0.25)
      .map(([k]) => names[k])
      .filter(Boolean);
    items.push({
      id: 'estampa',
      icon: '🎨',
      name: 'Estampa',
      kind: 'look',
      focus: 'print',
      value: Math.round(q * 100),
      reading: `${tech ? tech.name : 'Estampa'}: calidad ${Math.round(q * 100)} %${found.length ? ' · ' + found.join(', ') : ''}`,
      criterion: 'Calidad mínima 70 %: bien adherida, centrada y pareja',
      pass: q >= 0.7,
      howTo: 'Estirala apenas: no tiene que cuartearse ni levantarse en los bordes.',
    });
  }
  // hilos
  items.push({
    id: 'hilos',
    icon: '✂️',
    name: 'Hilos sueltos',
    kind: 'look',
    focus: 'whole',
    value: threadsLeft,
    reading: threadsLeft ? `Quedan ${threadsLeft} hilo${threadsLeft === 1 ? '' : 's'} sin cortar` : 'Ningún hilo suelto',
    criterion: 'Cero hilos sueltos a la vista',
    pass: threadsLeft === 0,
    howTo: 'Una pasada final por remates, puños y ruedo.',
  });
  return items;
}

export function verdictFor(fails) {
  if (fails === 0) return { id: 'aprobada', name: 'Aprobada', stamp: 'APROBADA', cls: 'ok' };
  if (fails <= 2) return { id: 'observada', name: 'Aprobada con observaciones', stamp: 'CON OBSERVACIONES', cls: 'warn' };
  return { id: 'segunda', name: 'Segunda selección', stamp: 'SEGUNDA SELECCIÓN', cls: 'bad' };
}
// Dictamen real (según las mediciones)
export function qcVerdict(items) {
  return verdictFor(items.filter((i) => !i.pass).length);
}
// Dictamen que puso el jugador (según lo que marcó como "observar")
export function playerVerdict(items, judged) {
  return verdictFor(items.filter((i) => judged[i.id] === 'obs').length);
}

// autoIds = puntos que juzgó el modo automático (no se le atribuyen al jugador en las notas)
export function scoreQC(items, judged, { autoIds = null } = {}) {
  const notes = [];
  if (!items.length) return { score: 100, notes };
  let right = 0;
  let mineN = 0;
  let mineRight = 0;
  for (const it of items) {
    const j = judged[it.id];
    if (j === undefined) continue;
    const ok = (j === 'ok') === it.pass;
    if (ok) right++;
    if (autoIds && autoIds.has(it.id)) continue;
    mineN++;
    if (ok) mineRight++;
    else if (it.pass) notes.push(`${MID} Observaste <b>${it.name.toLowerCase()}</b>, pero estaba dentro de tolerancia: rechazar de más también cuesta plata.`);
    else notes.push(`${NO} Aprobaste <b>${it.name.toLowerCase()}</b> fuera de norma (${it.reading.toLowerCase()}): el control está para frenar eso antes de que llegue al cliente.`);
  }
  const score = (100 * right) / items.length;
  if (autoIds && autoIds.size) {
    notes.unshift(`${MID} El control de calidad lo ${mineN ? 'terminó' : 'hizo'} el taller en automático${mineN ? ` (vos juzgaste ${mineN} de ${items.length} puntos y acertaste ${mineRight})` : ''}.`);
  } else if (right === items.length) notes.unshift(`${OK} Control de calidad impecable: juzgaste bien los ${items.length} puntos.`);
  return { score, notes };
}

export function scoreFold(errors) {
  return clamp(100 - errors * 20, 40, 100);
}
