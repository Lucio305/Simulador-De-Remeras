// Reglas del planchado: temperatura de la suela, eficacia para alisar, calor que marca la tela
// y puntaje. Todo sale del catálogo (FABRICS.ironLevel / ironSteam / wrinkle, IRON_LEVELS).

import { clamp } from '../../core/utils.js';

export const ROOM_TEMP = 25;
// Temperatura mínima para que la plancha haga vapor (por debajo, gotea agua).
export const STEAM_MIN_TEMP = 140;
// Por debajo de este nivel de arrugas (por lado) se da por planchado.
export const DONE_LEVEL = 0.08;

export function levelTemp(catalog, level) {
  if (!level) return ROOM_TEMP;
  const l = catalog.IRON_LEVELS.find((x) => x.level === level);
  return l ? l.temp : ROOM_TEMP;
}

export function idealTemp(catalog, fabric) {
  return levelTemp(catalog, fabric.ironLevel);
}

// Fibras que se derriten (brillo plástico) en vez de tostarse.
export function meltsInsteadOfScorch(fabric) {
  return fabric.id === 'poliester' || fabric.id === 'mezcla' || /poli[eé]ster/i.test(fabric.composition || '');
}

// Arrugas extra del prelavado (centrifugado fuerte en lino/modal → wrinkleBoost 0.3).
export const prewashBoost = (prewash) => Math.max(0, +(prewash?.wrinkleBoost || 0));

// "Dureza" de las arrugas: con centrifugado fuerte la tela llega más marcada y cuesta más.
export const hardnessFor = (prewash) => 1 + prewashBoost(prewash);

// Cuánto se arruga la remera al llegar a la tabla (multiplicador de Shirt3D.setWrinkles).
// Base del catálogo (tendencia a arrugarse × centrifugado del prelavado), llevada a un rango
// en el que las arrugas se ven claras en cualquier tela. En colores oscuros el relieve se
// lleva al máximo (el sombreado casi no se nota en tela negra).
export function wrinkleAmountFor(fabric, prewash, dark = false) {
  const raw = (fabric.wrinkle ?? 1) * hardnessFor(prewash);
  return clamp(0.85 + 0.5 * raw + (dark ? 0.15 : 0), 1.0, 1.5);
}

// Calentamiento / enfriamiento de la suela (primer orden): ~5 s para llegar, más lento al enfriar.
export function stepTemp(T, target, dt) {
  const k = target > T ? 0.75 : 0.3;
  const nt = target + (T - target) * Math.exp(-k * dt);
  return Math.abs(nt - target) < 0.3 ? target : nt;
}

// Exceso de temperatura relativo a lo que tolera la tela (0 = dentro de lo tolerable).
export function overHeat(T, Ti) {
  return Math.max(0, (T - Ti) / Ti - 0.04);
}

// ¿El vapor funciona? Necesita la suela caliente.
export function steamWorks(T, steamOn) {
  return !!steamOn && T >= STEAM_MIN_TEMP;
}

// Fuerza de alisado por segundo (en el centro de la suela) para la temperatura y el vapor actuales.
// hardness (≥ 1): arrugas más marcadas por el centrifugado del prelavado → más pasadas.
export function smoothRate(fabric, T, Ti, steamActive, hardness = 1) {
  let temp;
  if (T <= 70) temp = 0;
  else if (T < Ti) temp = Math.pow(clamp((T - 70) / (Ti - 70)), 1.25);
  else temp = 1 + Math.min(0.2, ((T - Ti) / Ti) * 0.5);
  let steam = 1;
  if (steamActive) steam = fabric.ironSteam ? 1.75 : 1.15;
  const difficulty = 1 / Math.pow(Math.max(0.3, fabric.wrinkle ?? 1), 0.55);
  return (1.3 * temp * steam * difficulty) / Math.max(1, hardness);
}

// Calor que acumula la tela bajo la suela por segundo. Quieta y a la temperatura justa marca en ~3 s;
// en movimiento casi no acumula, salvo que la plancha esté más caliente de lo que la tela aguanta.
export function heatRate(T, Ti, speed) {
  if (T <= 60) return 0;
  const dwell = 0.28 * clamp((T - 60) / (Ti - 60), 0, 1.6);
  const move = 1 / (1 + (speed / 0.1) ** 2);
  return dwell * move + overHeat(T, Ti) * 1.55;
}

// ---------------------------------------------------------------------------
// Puntaje: lisura 60 + temperatura 20 + vapor 10 + tiempo 10 − 15 por quemadura.
// ---------------------------------------------------------------------------

const OK = '<span class="pl-mark ok">✓</span> ';
const NO = '<span class="pl-mark no">✗</span> ';
const MID = '<span class="pl-mark mid">≈</span> ';

export const dots = (n) => '•'.repeat(Math.max(0, n | 0));

export function levelPoints(level, ideal) {
  if (level === ideal) return 20;
  if (level === ideal - 1) return 10;
  if (level === ideal + 1) return 6;
  return 0;
}

// Tiempo esperable de plancha (los dos lados) para alguien prolijo: una recorrida pareja por lado
// a ritmo de taller. Más largo si el centrifugado la dejó más arrugada.
export function parTime(fabric, prewash) {
  return 58 * (0.8 + 0.2 * (fabric.wrinkle ?? 1)) * (1 + 0.6 * prewashBoost(prewash));
}

// stats: { contact: {1..4: s}, steamContact, contact total, activeTime, burns, melts, sides: {frente, espalda}, flipped }
export function scoreIroning(catalog, state, fabric, stats, { auto = false } = {}) {
  const notes = [];
  const ideal = fabric.ironLevel;
  const idealInfo = catalog.IRON_LEVELS.find((l) => l.level === ideal);
  const sides = stats.sides;
  const smooth = clamp(1 - (sides.frente + sides.espalda) / 2);
  let score = 0;

  // 1) lisura (60)
  const lis = 60 * Math.pow(clamp((smooth - 0.45) / (1 - DONE_LEVEL - 0.45)), 1.15);
  score += lis;
  const pf = Math.round(sides.frente * 100);
  const pe = Math.round(sides.espalda * 100);
  if (sides.frente <= DONE_LEVEL + 0.005 && sides.espalda <= DONE_LEVEL + 0.005) notes.push(`${OK} Quedó <b>lisita</b> de los dos lados: ${Math.round(smooth * 100)} % sin arrugas.`);
  else if (!stats.flipped && sides.espalda > 0.5) notes.push(`${NO} No le diste vuelta: la <b>espalda</b> quedó toda arrugada (${pe} %). Siempre se plancha de los dos lados.`);
  else if (smooth >= 0.8) notes.push(`${MID} Casi: quedaron algunas arrugas (frente ${pf} %, espalda ${pe} %). Repasá las mangas y los bordes, que son los que más se escapan.`);
  else notes.push(`${NO} Quedó bastante arrugada (frente ${pf} %, espalda ${pe} %). Pasadas largas y parejas, sin dejar franjas sin planchar.`);

  // 2) temperatura (20), ponderada por el tiempo de contacto en cada nivel
  const total = Object.values(stats.contact).reduce((a, b) => a + b, 0);
  let dominant = 0;
  let best = -1;
  let tPts = 0;
  for (const [lv, t] of Object.entries(stats.contact)) {
    const l = +lv;
    if (t > 0 && t > best) {
      best = t;
      dominant = l;
    }
    if (total > 0) tPts += (t / total) * levelPoints(l, ideal);
  }
  score += tPts;
  const fabName = fabric.short;
  if (total <= 0) notes.push(`${NO} No llegaste a apoyar la plancha caliente sobre la tela.`);
  else if (dominant === ideal) notes.push(`${OK} Plancha en <b>${dots(ideal)} ${idealInfo?.label || ''}</b> (${idealInfo?.temp} °C): la temperatura justa para ${fabName}.`);
  else if (dominant < ideal) notes.push(`${MID} Planchaste en ${dots(dominant)}: no quema, pero a ${fabName} le hace falta ${dots(ideal)} (${idealInfo?.temp} °C) y por eso las arrugas costaban tanto (−${Math.round(20 - tPts)}).`);
  else notes.push(`${NO} ${dots(dominant)} es demasiado para ${fabName}: lo suyo es ${dots(ideal)} (${idealInfo?.temp} °C). Mirá siempre la etiqueta de cuidado (−${Math.round(20 - tPts)}).`);

  // 3) vapor (10)
  const fSteam = total > 0 ? stats.steamContact / total : 0;
  let vPts;
  if (fabric.ironSteam) {
    vPts = total > 0 ? 10 * clamp(fSteam / 0.6) : 0;
    if (fSteam >= 0.6) notes.push(`${OK} Usaste <b>vapor</b>: relaja las fibras de ${fabName} y las arrugas salen de una pasada.`);
    else notes.push(`${MID} A ${fabName} le viene muy bien el <b>vapor</b> (desde ${dots(2)}): con humedad y calor la fibra se relaja y se plancha el doble de rápido (−${Math.round(10 - vPts)}).`);
  } else {
    vPts = total > 0 ? 10 * clamp(1 - fSteam / 0.5) : 0;
    if (fSteam < 0.2) notes.push(`${OK} Sin vapor: ${fabName} no lo necesita y así no quedan aureolas de agua.`);
    else notes.push(`${MID} ${fabName} no necesita vapor: no ayuda mucho y puede dejar <b>aureolas de agua</b> o brillos (−${Math.round(10 - vPts)}).`);
  }
  score += vPts;

  // 4) tiempo (10), solo cuenta si la remera quedó bien
  const par = parTime(fabric, state.prewash);
  const t = stats.activeTime;
  const timeFactor = t <= par ? 1 : clamp(1 - (t - par) / (par * 1.5));
  const tmPts = 10 * timeFactor * clamp((smooth - 0.5) / 0.4);
  score += tmPts;
  if (total > 0 && smooth > 0.7 && !auto) {
    if (timeFactor >= 0.99) notes.push(`${OK} Ritmo de taller: ${Math.round(t)} s de plancha.`);
    else {
      const how = fabric.ironSteam ? 'con la temperatura justa y vapor alcanza una pasada' : 'con la temperatura justa alcanza una pasada pareja';
      notes.push(`${MID} Tardaste ${Math.round(t)} s (lo esperable es ~${Math.round(par)} s): ${how}, así que podés mover la plancha un poco más rápido y no volver sobre lo que ya quedó liso.`);
    }
  }

  // 5) quemaduras (−15 c/u)
  const burns = stats.burns;
  const burnPenalty = Math.min(60, burns * 15);
  if (burns > 0) {
    const marks = burns === 1 ? 'Una marca' : `${burns} marcas`;
    if (stats.melts > 0) notes.push(`${NO} ${marks} de plancha: el poliéster <b>se derrite</b> antes de quemarse y queda un brillo plástico que no sale más (−${burnPenalty}).`);
    else if (stats.hotBurns > 0) notes.push(`${NO} ${marks} de <b>quemado</b> (−${burnPenalty}): la plancha estaba más caliente de lo que ${fabName} aguanta. Ante la duda, empezá con menos puntos y subí de a uno.`);
    else notes.push(`${NO} ${marks} de <b>quemado</b> (−${burnPenalty}). Nunca dejes la plancha quieta apoyada: cuando pares, llevala al apoya-plancha.`);
  } else if (total > 0) notes.push(`${OK} Ninguna marca de plancha.`);

  if (prewashBoost(state.prewash) > 0) notes.push('🌀 El centrifugado fuerte del prelavado la dejó con arrugas más marcadas: por eso costó más. Con 800 rpm la tela sale más fácil de planchar.');

  // tip extra de oficio
  if (catalog.luminance(state.fabric.color) < 0.2 && burns === 0) notes.push('💡 En colores oscuros conviene planchar <b>del revés</b>: así no aparecen brillos en la tela.');
  else if (!fabric.knit) notes.push('💡 El lino se plancha apenas húmedo y bien caliente: es la única forma de que quede lisito.');
  else notes.push('💡 En tejido de punto no arrastres la plancha con fuerza: apoyá y deslizá, que el jersey se deforma.');

  if (auto) {
    score = clamp(score, 65, 74);
    const how = fabric.ironSteam ? 'con la temperatura justa y vapor' : 'con la temperatura justa (sin vapor)';
    notes.unshift(`${MID} La planchó el taller en automático. Probá vos la próxima: ${how} sale perfecta.`);
  }
  score -= burnPenalty; // las marcas cuentan siempre (también si después se terminó en automático)
  return {
    score: clamp(Math.round(score), 0, 100),
    notes,
    smooth,
    dominant: dominant || ideal,
    steam: fSteam >= 0.5,
  };
}
