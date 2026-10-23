// Cálculos del informe final: nota global, categoría, costos y precio, pedido del cliente
// y resultado de la prueba de lavado. Funciones puras: leen el estado y el catálogo.

import { clamp } from '../../core/utils.js';
import { PROCESS } from './process.js';

// ---------- Nota global ----------
export function globalScore(state, catalog) {
  const W = catalog.SCORE_WEIGHTS;
  let sum = 0;
  let wsum = 0;
  for (const [id, s] of Object.entries(state.scores || {})) {
    const w = W[id];
    if (!w || !s || typeof s.score !== 'number') continue;
    sum += clamp(s.score, 0, 100) * w;
    wsum += w;
  }
  return wsum ? sum / wsum : 0;
}

const TIERS = [
  { min: 92, emoji: '🏆', title: 'Remera de colección', line: 'Terminación de primera: podría estar en la vidriera de una boutique.' },
  { min: 82, emoji: '🌟', title: 'Calidad boutique', line: 'Prolija y bien resuelta. Se vende sola.' },
  { min: 70, emoji: '👍', title: 'Muy buena', line: 'Lista para la venta, con algún detalle para pulir.' },
  { min: 58, emoji: '🧺', title: 'Para la feria del barrio', line: 'Se puede vender, pero un ojo atento nota los errores.' },
  { min: 45, emoji: '🎁', title: 'Para regalar a la tía', line: 'Con cariño se usa… pero mejor no la pongas en la vidriera.' },
  { min: 30, emoji: '🛋️', title: 'Para andar por casa', line: 'Ideal para pintar la pieza o dormir la siesta.' },
  { min: -1, emoji: '🧽', title: 'Trapo de piso de lujo', line: 'Bueno, todos empezamos por algún lado. ¡A practicar!' },
];

export function tierFor(score) {
  return TIERS.find((t) => score >= t.min) || TIERS[TIERS.length - 1];
}

export function scoreColor(score) {
  if (score >= 85) return '#3c8a4f';
  if (score >= 70) return '#2f6f6a';
  if (score >= 55) return '#d9a43b';
  if (score >= 40) return '#e08a3c';
  return '#c0392b';
}

// Pasos con puntaje, en el orden del proceso (y los que no estén en la lista, al final).
export function stepRows(state) {
  const rows = [];
  const seen = new Set();
  for (const p of PROCESS) {
    const s = state.scores?.[p.id];
    if (!s || typeof s.score !== 'number') continue;
    seen.add(p.id);
    rows.push({ id: p.id, icon: p.icon, name: s.title || p.title, short: p.short, score: s.score, notes: s.notes || [] });
  }
  for (const [id, s] of Object.entries(state.scores || {})) {
    if (seen.has(id) || !s || typeof s.score !== 'number') continue;
    rows.push({ id, icon: '•', name: s.title || id, short: s.title || id, score: s.score, notes: s.notes || [] });
  }
  return rows;
}

// ---------- Costos y precio ----------
const RX = {
  tela: /tela/i,
  hilo: /hilo/i,
  estampa: /estamp|serigraf|vinilo|bordad|dtf|sublim|foil|glitter|pintura|puff|tinta/i,
  etiqueta: /etiqueta/i,
  pack: /packaging|bolsa|caja|sobre|embalaje|empaque/i,
  tag: /tag|colgante|hangtag/i,
};

export function costBreakdown(state, catalog, grade) {
  const C = catalog.COSTS;
  const costs = (state.costs || []).filter((c) => c && typeof c.amount === 'number');
  const has = (rx) => costs.some((c) => rx.test(c.label));
  const materials = costs.map((c) => ({ label: c.label, amount: c.amount }));
  const estimated = [];
  const fabric = catalog.fabricById(state.fabric?.id);
  // Si un paso no registró su costo (p. ej. entrando directo al final), lo estimamos.
  if (!has(RX.tela) && fabric) estimated.push({ label: 'Tela (estimada)', amount: Math.round(C.fabricMetersBase * fabric.pricePerMeter) });
  const thread = catalog.threadById(state.thread?.id);
  if (!has(RX.hilo) && thread) estimated.push({ label: 'Hilo (estimado)', amount: thread.price });
  const techId = state.print?.technique || state.design?.technique;
  const tech = techId ? catalog.techniqueById(techId) : null;
  if (!has(RX.estampa) && tech) estimated.push({ label: `Estampa: ${tech.name} (estimada)`, amount: tech.cost });
  const finishing = [];
  if (!has(RX.etiqueta)) finishing.push({ label: 'Etiqueta', amount: C.label });
  if (!has(RX.pack)) finishing.push({ label: 'Packaging', amount: C.packaging });
  if (state.finishing?.hangtag && !has(RX.tag)) finishing.push({ label: 'Tag colgante', amount: C.hangtag });
  const stepsDone = Object.keys(state.scores || {}).filter((id) => catalog.SCORE_WEIGHTS[id]).length || PROCESS.length;
  const labor = { label: `Mano de obra (${stepsDone} pasos × ${C.laborPerStep})`, amount: C.laborPerStep * stepsDone };
  const sum = (l) => l.reduce((a, c) => a + c.amount, 0);
  const materialsTotal = sum(materials) + sum(estimated);
  const total = materialsTotal + sum(finishing) + labor.amount;
  const factor = 0.7 + 0.6 * clamp(grade / 100);
  const price = Math.round((total * C.markup * factor) / 100) * 100;
  return { materials, estimated, finishing, labor, materialsTotal, total, price, factor, markup: C.markup };
}

// ---------- Pedido del cliente ----------
export function orderChecklist(state, catalog) {
  const o = state.order;
  if (!o) return [];
  const r = o.req || {};
  const list = [];
  const fab = catalog.fabricById(state.fabric?.id);
  const colorName = (id) => catalog.colorById(id)?.name || id;
  const sameColor = (id) => {
    const c = catalog.colorById(id);
    if (!c) return false;
    if (state.fabric?.colorId) return state.fabric.colorId === id;
    return (state.fabric?.color || '').toLowerCase() === c.hex.toLowerCase();
  };
  const currentColor = () => catalog.colorById(state.fabric?.colorId)?.name || (state.fabric?.color ? `personalizado ${state.fabric.color}` : '—');
  if (r.fabrics) {
    list.push({ key: 'fabric', icon: '🧶', label: `Tela: ${r.fabrics.map((id) => catalog.fabricById(id)?.short || id).join(' o ')}`, ok: r.fabrics.includes(state.fabric?.id), got: fab?.short || '—' });
  }
  if (r.color) list.push({ key: 'color', icon: '🎨', label: `Color: ${colorName(r.color)}`, ok: sameColor(r.color), got: currentColor() });
  if (r.colors) list.push({ key: 'color', icon: '🎨', label: `Color: ${r.colors.map(colorName).join(' o ')}`, ok: r.colors.some(sameColor), got: currentColor() });
  if (r.size) list.push({ key: 'size', icon: '📏', label: `Talle ${r.size}`, ok: state.pattern?.size === r.size, got: `talle ${state.pattern?.size}` });
  if (r.fit) list.push({ key: 'fit', icon: '👕', label: `Calce ${catalog.fitById(r.fit)?.name || r.fit}`, ok: state.pattern?.fit === r.fit, got: catalog.fitById(state.pattern?.fit)?.name || '—' });
  if (r.sleeve) list.push({ key: 'sleeve', icon: '💪', label: catalog.sleeveById(r.sleeve)?.name || r.sleeve, ok: state.pattern?.sleeve === r.sleeve, got: catalog.sleeveById(state.pattern?.sleeve)?.name || '—' });
  if (r.neck) list.push({ key: 'neck', icon: '🔻', label: catalog.neckById(r.neck)?.name || r.neck, ok: state.pattern?.neck === r.neck, got: catalog.neckById(state.pattern?.neck)?.name || '—' });
  if (r.technique) {
    const tid = state.print?.technique || state.design?.technique;
    list.push({ key: 'technique', icon: catalog.techniqueById(r.technique)?.icon || '🖨️', label: `Estampa: ${catalog.techniqueById(r.technique)?.name || r.technique}`, ok: tid === r.technique, got: tid ? catalog.techniqueById(tid)?.name : 'sin estampa' });
  }
  return list;
}

const COMPLAINTS = {
  fabric: (c) => `La tela no es la que te pedí: esto es ${c.got}.`,
  color: (c) => `¡Te la pedí de otro color! Me trajiste ${c.got}.`,
  size: (c) => `Es ${c.got} y yo te pedí ${c.label.toLowerCase()}.`,
  fit: (c) => `El calce no es el que hablamos: es ${c.got.toLowerCase()}.`,
  sleeve: (c) => `Te pedí ${c.label.toLowerCase()}, no ${c.got.toLowerCase()}.`,
  neck: (c) => `¿Y el ${c.label.toLowerCase()} que te pedí?`,
  technique: (c) => `¿Y la ${c.label.replace('Estampa: ', '').toLowerCase()}? Esto tiene ${c.got.toLowerCase()}.`,
};

// Reacción del cliente: depende de si se cumplió lo pedido y de la calidad. El cliente paga lo
// acordado (su presupuesto): con propina si queda encantado, con descuento si queda a medias y
// la mitad si se enoja. El costo y el valor de mercado se comparan aparte (rentabilidad).
export function clientVerdict(state, catalog, grade, price, cost) {
  const o = state.order;
  if (!o) return null;
  const checks = orderChecklist(state, catalog);
  const met = checks.filter((c) => c.ok).length;
  const ratio = checks.length ? met / checks.length : 1;
  const failed = checks.filter((c) => !c.ok);
  const level = ratio === 1 && grade >= 70 ? 2 : ratio >= 0.6 && grade >= 50 ? 1 : 0;
  const lines = [];
  if (level === 2) lines.push(grade >= 85 ? '¡Es tal cual la imaginaba! Te voy a recomendar con todo el mundo.' : '¡Me encanta! Es justo lo que te pedí.');
  else if (level === 1) lines.push(failed.length ? 'Está bien, me la llevo… aunque no es exactamente lo que te pedí.' : 'Cumple con lo que te pedí, pero le faltan detalles de terminación.');
  else lines.push(failed.length ? '¡Esto no es lo que te pedí!' : 'Lo que pedí está, pero la calidad deja mucho que desear.');
  if (failed.length) lines.push(COMPLAINTS[failed[0].key]?.(failed[0]) || 'Hay cosas que no respetaste.');
  const budget = o.budget || 0;
  const tip = level === 2 && grade >= 85 ? Math.round((budget * 0.1) / 100) * 100 : 0;
  const pays = level === 2 ? budget + tip : level === 1 ? Math.round((budget * 0.9) / 100) * 100 : Math.round((budget * 0.5) / 100) * 100;
  if (level === 2 && tip) lines.push('Tomá, te dejo una propina.');
  else if (level === 1) lines.push('¿Me hacés un descuentito?');
  const how = ['Paga la mitad de lo acordado y se va masticando bronca.', 'Pide un descuento: paga el 90% de lo acordado.', tip ? `Paga lo acordado y te deja ${Math.round((tip / Math.max(1, budget)) * 100)}% de propina.` : 'Paga lo acordado.'][level];
  const profit = pays - (cost || 0);
  const advice = [];
  if (cost > budget) advice.push('Gastaste más de lo que te pagan: para este presupuesto elegí materiales o técnicas más económicos.');
  else if (price > budget * 1.1) advice.push('Tu remera vale más de lo que pagó el cliente: con esta calidad, la próxima cotizá más alto.');
  const mood = ['enojado', 'conforme', 'feliz'][level];
  const face = ['😠', '🙂', '😍'][level];
  return { mood, face, level, lines, checks, met, ratio, budget, price, cost, pays, tip, how, profit, advice };
}

// ---------- Prueba de lavado ----------
export function computeWash(state, catalog, pattern) {
  const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
  const pre = state.prewash || {};
  const prewashed = !!pre.done && !pre.skipped;
  let shrink = fabric.shrink;
  let shrinkNote;
  if (prewashed) {
    const cold = pre.temp != null && pre.temp < fabric.washTemp - 5;
    shrink = fabric.shrink * (cold ? 0.4 : 0.12);
    shrinkNote = cold
      ? 'El prelavado fue con agua más fría que la del uso: le quedó algo por encoger.'
      : '¡Bien ahí el prelavado! La tela ya había encogido antes de cortar.';
  } else {
    shrinkNote = 'Sin prelavado, la tela encogió recién ahora, con la remera ya cosida.';
  }
  const sy = 1 - shrink;
  const sx = 1 - shrink * 0.55;
  const m = pattern?.measurements || {};
  const length = m.length || 72;
  const chest = m.chest || 52;
  const lengthLoss = length * shrink;
  const chestLoss = chest * shrink * 0.55;
  const sizes = catalog.SIZES;
  const si = sizes.findIndex((s) => s.id === state.pattern?.size);
  let sizeDown = null;
  if (lengthLoss >= 2.6 && si > 0) sizeDown = sizes[si - 1].id;
  else if (lengthLoss >= 2.6 && si === 0) sizeDown = 'XXS';

  // Estampa: durabilidad de la técnica × calidad del estampado.
  const techId = state.print?.technique || state.design?.technique || null;
  const tech = techId ? catalog.techniqueById(techId) : null;
  let fade = 0;
  let crack = 0;
  let printNote = 'La remera no tiene estampa: nada que se pueda gastar.';
  if (tech) {
    const q = clamp(state.print?.quality ?? 0.8);
    const dur = tech.durability ?? 0.85;
    const under = clamp(state.print?.defects?.under ?? 0);
    fade = clamp((1 - dur) * 0.8 + (1 - q) * 0.45 + under * 0.15, 0, 0.85);
    crack = tech.id === 'sublimacion' || tech.id === 'bordado' ? 0 : clamp((1 - dur) * 0.9 + (1 - q) * 0.7 + under * 0.25 - 0.04, 0, 0.9);
    // La sublimación en algodón se lava mucho más (la tinta no se fija en la fibra natural).
    if (tech.id === 'sublimacion') fade = clamp(fade + (1 - (fabric.sublimation ?? 1)) * 0.45, 0, 0.85);
    if (tech.id === 'bordado') printNote = fade < 0.1 ? 'El bordado quedó intacto: el hilo no se despinta.' : 'El bordado aguantó, aunque el hilo perdió un poco de brillo.';
    else if (tech.id === 'sublimacion') printNote = fade < 0.12 ? 'La sublimación tiñe la fibra: ni grietas ni despegues.' : 'La sublimación se lavó bastante: en esta tela la tinta no se fijó bien.';
    else if (crack > 0.3) printNote = `La estampa de ${tech.name.toLowerCase()} se agrietó y perdió color.`;
    else if (crack > 0.12 || fade > 0.2) printNote = `La estampa de ${tech.name.toLowerCase()} se gastó un poco: algunas grietitas finas.`;
    else printNote = `La estampa de ${tech.name.toLowerCase()} quedó como nueva.`;
  }

  // Costuras: hilo apto + puntadas elásticas en tejido de punto.
  const thread = catalog.threadById(state.thread?.id);
  const threadOk = !thread || thread.goodFor.includes(fabric.id);
  const seams = Object.values(state.sewing?.seams || {});
  const seamAvg = seams.length ? seams.reduce((a, s) => a + (s.score ?? 75), 0) / seams.length : 75;
  const rigid = fabric.knit && seams.some((s) => s.stitch === 'recta');
  let seamRisk = clamp((70 - seamAvg) / 60) + (threadOk ? 0 : 0.45) + (rigid ? 0.25 : 0);
  seamRisk = clamp(seamRisk);
  let seamNote;
  if (seamRisk < 0.15) seamNote = 'Las costuras aguantaron firmes, sin un solo punto corrido.';
  else if (!threadOk) seamNote = `El hilo de ${thread?.name.toLowerCase()} no acompaña esta tela: se cortaron algunas puntadas.`;
  else if (rigid) seamNote = 'Las costuras con puntada recta se cortaron al estirar: en tejido de punto va overlock o zigzag.';
  else seamNote = 'Alguna costura floja se abrió un poquito.';

  const shrinkPenalty = clamp(shrink / 0.06) * 38;
  const score = Math.round(clamp(100 - shrinkPenalty - fade * 45 - crack * 40 - seamRisk * 25, 0, 100));
  const verdict = score >= 85 ? '¡Aprobó con honores!' : score >= 68 ? 'Aprobada' : score >= 50 ? 'Pasable' : 'Reprobada';
  const tips = [];
  if (!prewashed) tips.push('Prelavá siempre la tela a la temperatura de uso <b>antes</b> de cortar: así encoge antes y no después.');
  if (tech && crack > 0.12) tips.push('Lavá las remeras estampadas del revés y con agua fría: la estampa dura mucho más.');
  if (tech && tech.id === 'foil') tips.push('El foil es delicado: nada de secarropas ni plancha directa sobre la estampa.');
  if (tech && tech.id === 'sublimacion' && (fabric.sublimation ?? 1) < 0.6) tips.push('La sublimación necesita poliéster: en algodón se va con los lavados.');
  if (!threadOk) tips.push('Para tejido de punto usá hilo de poliéster o nylon, que estiran con la tela.');
  if (!tips.length) tips.push('Para que dure: lavar con agua tibia, del revés y secar a la sombra.');
  return {
    done: true,
    washes: 10,
    temp: fabric.washTemp,
    prewashed,
    shrink,
    sx,
    sy,
    lengthCm: length,
    chestCm: chest,
    lengthLoss,
    chestLoss,
    sizeDown,
    shrinkNote,
    technique: tech?.id || null,
    techniqueName: tech?.name || null,
    fade,
    crack,
    colorKept: 1 - fade,
    printNote,
    seamRisk,
    seamNote,
    score,
    verdict,
    tips,
  };
}
