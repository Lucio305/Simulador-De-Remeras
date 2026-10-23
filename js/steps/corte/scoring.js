// Corte · reglas del puntaje (puras, para poder probarlas aparte).

import { clamp } from '../../core/utils.js';

export const DEV_SCALE = 0.009; // desvío medio (m) que lleva la precisión a 0
export const SALIDA_PEN = 0.03; // precisión que se pierde por cada salida de la línea
export const MAX_SALIDAS = 6;

export const TOOLS = {
  tijera: {
    id: 'tijera',
    name: 'Tijera de sastre',
    short: 'Tijera',
    icon: '✂️',
    vmax: 0.2, // m/s en recta
    vCurve: 0.55, // fracción de la velocidad que conserva en curvas cerradas
    gain: 0.5, // cuánto del desvío del pulso pasa al corte (la hoja larga "guía" sola)
    smooth: 0.09, // s: la tijera filtra el temblor
    precision: 4,
    speed: 2,
    desc: 'Precisa y noble: corta más despacio, pero perdona el pulso y va bien en curvas.',
  },
  cutter: {
    id: 'cutter',
    name: 'Cúter circular',
    short: 'Cúter',
    icon: '🌀',
    vmax: 0.46,
    vCurve: 1,
    gain: 0.72,
    smooth: 0.035,
    curveSafe: 0.13, // m/s seguros en curvas cerradas (más rápido, la cuchilla derrapa)
    precision: 2,
    speed: 4,
    desc: 'Rapidísimo y no levanta la tela. Exige pulso firme y frenar en las curvas. Siempre sobre la base de corte.',
  },
};

// Desvío medio (m) → precisión 0..1 (antes de las salidas)
export function accuracyFromDev(meanDev) {
  return clamp(1 - meanDev / DEV_SCALE);
}

export function pieceAccuracy(meanDev, salidas = 0) {
  return clamp(accuracyFromDev(meanDev) - SALIDA_PEN * Math.min(MAX_SALIDAS, salidas));
}

// Tiras con regla: la regla quedó corrida `off` (m) de la tiza al fijarla. Medio milímetro no se
// nota; con 12 mm la tira sale de otro ancho.
export const RULER_AMP = 0.009; // cuánto se mueve la regla (m) antes de fijarla
export function rulerAccuracy(off) {
  return clamp(1 - Math.max(0, Math.abs(off) - 0.0005) / 0.0115);
}

// Herramienta recomendada según la tela (null = las dos van bien).
export function recommendedTool(fabric) {
  if (!fabric) return null;
  if (fabric.knit && fabric.stretch >= 0.6) return 'cutter';
  return null;
}

// Arrastre de la tijera en telas muy elásticas o resbalosas (m de desvío extra que mete).
export function scissorsDrag(fabric) {
  if (!fabric) return 0;
  return fabric.knit && fabric.stretch >= 0.6 ? 0.0011 + (fabric.stretch - 0.6) * 0.003 : 0;
}

// Bonificación por velocidad con cúter: tiempo de corte activo frente al de referencia.
export function speedBonus(tool, cutTime, cutLength) {
  if (tool !== 'cutter' || !(cutTime > 0) || !(cutLength > 0)) return 0;
  const ref = cutLength / 0.24; // a 24 cm/s
  return Math.round(6 * clamp((ref / cutTime - 0.8) / 0.7));
}

const mmTxt = (m) => `${String(Math.round(m * 10000) / 10).replace('.', ',')} mm`;
const pctTxt = (v) => `${Math.round(v * 100)}%`;

// results: [{ id, name, acc, dev, salidas, len, method: 'trazo'|'gemela'|'regla', auto }]
export function scoreCut({ tool, results, fabric, cutTime = 0, cutLength = 0, autoAll = false, autoSome = false, state = null }) {
  const notes = [];
  let wsum = 0;
  let asum = 0;
  let dsum = 0;
  let salidas = 0;
  for (const r of results) {
    wsum += r.len;
    asum += r.acc * r.len;
    dsum += r.dev * r.len;
    salidas += r.salidas || 0;
  }
  const accuracy = wsum > 0 ? asum / wsum : 0;
  const meanDev = wsum > 0 ? dsum / wsum : 0;
  let score = accuracy * 100;
  const t = tool === 'cutter' ? '🌀 cúter' : '✂️ tijera';
  if (autoAll) {
    score = clamp(score, 65, 75);
    notes.push(`🤖 Corte automático con ${t}: precisión media <b>${pctTxt(accuracy)}</b> (desvío ${mmTxt(meanDev)}). A mano, siguiendo la tiza con calma, se llega a más del 90%.`);
  } else {
    const grade = meanDev < 0.0012 ? '¡Cortaste justo por el medio de la tiza!' : meanDev < 0.0025 ? 'El margen de costura de 1 cm queda parejo y las piezas van a calzar.' : meanDev < 0.0045 ? 'Se nota en algunos tramos: al coser, los bordes no van a coincidir del todo.' : 'Con tanto desvío las piezas no calzan al coser: la remera puede quedar torcida o de otro talle.';
    notes.push(`📏 Precisión media <b>${pctTxt(accuracy)}</b> con ${t} (desvío medio ${mmTxt(meanDev)}). ${grade}`);
  }
  // mejor y peor pieza
  const manual = results.filter((r) => !r.auto && r.method !== 'gemela');
  if (manual.length >= 2) {
    const best = manual.reduce((a, b) => (b.acc > a.acc ? b : a));
    const worst = manual.reduce((a, b) => (b.acc < a.acc ? b : a));
    const curveOf = (r) => (/^manga/.test(r.id) ? 'la copa de la manga (la curva de arriba) pide' : r.id === 'frente' ? 'el escote y las sisas piden' : r.id === 'espalda' ? 'las sisas y el escote de atrás piden' : 'las curvas piden');
    const why = worst.method === 'regla' ? ': la regla hay que fijarla justo cuando sus bordes se ponen verdes.' : worst.curvy ? `: ${curveOf(worst)} ir más despacio.` : '.';
    if (best.acc - worst.acc > 0.06) notes.push(`🔍 Tu mejor corte: <b>${best.name}</b> (${pctTxt(best.acc)}). El que más costó: <b>${worst.name}</b> (${pctTxt(worst.acc)})${why}`);
  }
  if (salidas > 0) {
    notes.push(`⚠️ Te saliste de la línea <b>${salidas} ${salidas === 1 ? 'vez' : 'veces'}</b> (−${Math.round(SALIDA_PEN * 100)}% de precisión en esa pieza cada vez): cada mordida en el margen de costura se nota al coser.`);
  }
  // bonificación por velocidad (solo si todo el corte fue a mano: con piezas automáticas la nota tiene tope)
  const bonus = autoAll || autoSome ? 0 : speedBonus(tool, cutTime, cutLength);
  if (bonus > 0) {
    score += bonus;
    notes.push(`⚡ Cúter a buen ritmo: ${String(Math.round(cutLength * 10) / 10).replace('.', ',')} m de corte en ${Math.round(cutTime)} s (+${bonus}).`);
  }
  if (!autoAll && autoSome) {
    score = Math.min(score, 75);
    notes.push('🤖 Algunas piezas las cortó el modo automático (la nota queda como máximo en 75).');
  }
  // herramienta vs tela
  const rec = recommendedTool(fabric);
  if (fabric) {
    if (tool === 'tijera' && rec === 'cutter') notes.push(`🧵 El <b>${fabric.short}</b> estira mucho: la tijera lo levanta y lo arrastra un poco en cada tijeretada. Con cúter y base de corte la tela no se mueve.`);
    else if (tool === 'cutter' && rec === 'cutter') notes.push(`🧵 Bien elegido: en <b>${fabric.short}</b>, que estira y resbala, el cúter corta sin mover la tela.`);
    else if (!fabric.knit) notes.push(`🧵 El ${fabric.short.toLowerCase()} se deshilacha: cortá con la herramienta bien afilada y terminá los bordes con overlock.`);
  }
  if (tool === 'tijera') notes.push('💡 Tijera de sastre: la hoja de abajo siempre apoyada en la mesa y tijeretadas largas sin cerrar del todo la punta; así el borde no queda escalonado.');
  else notes.push('💡 Cúter circular: siempre sobre la base de corte y empujando hacia adelante, lejos de los dedos. Cambiá la cuchilla cuando empiece a saltearse hilos.');
  if (results.some((r) => r.method === 'gemela')) notes.push('✂️✂️ Las mangas salen gemelas porque se cortan con el mismo trazo: en el taller se cortan juntas, con la tela doblada al medio.');
  if (results.some((r) => r.method === 'regla')) notes.push('📐 Las tiras rectas (cuello, ribetes) se cortan con regla: es más rápido y queda un ancho parejo, clave para que el cuello no haga ondas.');
  if (state?.prewash?.skipped) notes.push('💡 Sin prelavado, las piezas pueden encoger después de cortadas: hay talleres que cortan con un margen extra.');
  return { score: Math.round(clamp(score, 0, 100)), notes, accuracy, meanDev, salidas, bonus };
}
