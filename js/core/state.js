// Estado global de la partida + bus de eventos.
// Los pasos leen y escriben acá; `main.js` usa `scores` y `costs` para el informe final.

export const bus = (() => {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt).delete(fn);
    },
    emit(evt, payload) {
      const set = map.get(evt);
      if (set) for (const fn of [...set]) fn(payload);
    },
  };
})();

export function createInitialState() {
  return {
    mode: 'libre',            // 'libre' | 'pedido'
    order: null,              // cliente del catálogo CLIENTS (modo pedido)
    brand: 'Mi Taller',       // nombre de la marca (etiqueta)
    fabric: { id: 'algodon_jersey', color: '#f3f1ea', colorId: 'blanco', heather: false },
    thread: { id: 'poliester', color: '#f3f1ea', colorId: 'blanco', match: true, thickness: 'medio', needle: 'punta_bola' },
    pattern: { size: 'M', fit: 'regular', sleeve: 'corta', neck: 'redondo' },
    prewash: { done: false, skipped: false, temp: null, spin: null },
    layout: null,             // { placements: [{id, x, y, rot}], fabricLength, efficiency }
    cut: null,                // { tool, pieces: {id: accuracy} , accuracy }
    sewing: null,             // { seams: {id: {score, stitch, accuracy}}, stitchLength, tension }
    ironing: null,            // { smooth, burns, level, steam }
    design: null,             // { technique, source (canvas), placement, options, side }
    print: null,              // { technique, quality, params, cured }
    finishing: null,          // { threadsCut, threadsTotal, label, hangtag, folded }
    wash: null,               // resultado de la prueba de lavado
    scores: {},               // { [stepId]: { score: 0..100, notes: [string], title } }
    costs: [],                // [{ label, amount }]
    startedAt: Date.now(),
  };
}

export const state = createInitialState();

export function resetState() {
  const fresh = createInitialState();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  bus.emit('state:reset', state);
}

export function addCost(label, amount) {
  const existing = state.costs.find((c) => c.label === label);
  if (existing) existing.amount = amount;
  else state.costs.push({ label, amount });
  bus.emit('cost:change', totalCost());
}

export function removeCost(label) {
  const i = state.costs.findIndex((c) => c.label === label);
  if (i >= 0) state.costs.splice(i, 1);
  bus.emit('cost:change', totalCost());
}

export function totalCost() {
  return state.costs.reduce((a, c) => a + c.amount, 0);
}
