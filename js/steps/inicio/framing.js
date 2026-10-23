// Encuadre de la remera de muestra en la bienvenida: busca en la pantalla el hueco libre
// (sin textos ni la etiqueta encima) donde la remera entra más grande, y lo devuelve en px.
// Función pura: se puede probar sin navegador.

// Rectángulo {x0, y0, x1, y1} que envuelve a todos los dados (ignora los null).
export function unionRect(list) {
  let r = null;
  for (const b of list) {
    if (!b) continue;
    if (!r) r = { ...b };
    else {
      r.x0 = Math.min(r.x0, b.x0);
      r.y0 = Math.min(r.y0, b.y0);
      r.x1 = Math.max(r.x1, b.x1);
      r.y1 = Math.max(r.y1, b.y1);
    }
  }
  return r;
}

// W, H: pantalla (px). obstacles: rectángulos a evitar. aspect: ancho/alto de la remera.
// sPref: alto ideal de la remera (px); no se agranda más que eso.
// prefX, prefY: punto preferido (desempata entre huecos parecidos).
// margin: aire alrededor de los obstáculos; top/bottom: márgenes con el borde de la pantalla.
// Devuelve { cx, cy, s } (centro y alto en px) y fit = s / sPref (1 = entra a tamaño ideal).
export function findShirtSlot({ W, H, obstacles = [], aspect = 1, sPref = 300, prefX = W / 2, prefY = H * 0.5, margin = 14, top = 12, bottom = 6, step = 10 }) {
  const obs = obstacles.filter(Boolean).map((o) => ({
    cx: (o.x0 + o.x1) / 2,
    cy: (o.y0 + o.y1) / 2,
    hw: (o.x1 - o.x0) / 2 + margin,
    hh: (o.y1 - o.y0) / 2 + margin,
  }));
  const cap = sPref * 1.35;
  let best = null;
  for (let cy = step / 2; cy < H; cy += step) {
    for (let cx = step / 2; cx < W; cx += step) {
      // el alto más grande con el que la remera, centrada en (cx, cy), no pisa nada
      let s = Math.min(cap, (2 * (cx - margin)) / aspect, (2 * (W - margin - cx)) / aspect, 2 * (cy - top), 2 * (H - bottom - cy));
      if (s <= 0) continue;
      for (const o of obs) {
        const dx = Math.abs(cx - o.cx) - o.hw;
        const dy = Math.abs(cy - o.cy) - o.hh;
        const allowed = Math.max((2 * dx) / aspect, 2 * dy);
        if (allowed < s) s = allowed;
        if (s <= 0) break;
      }
      if (s <= 0) continue;
      const fit = Math.min(s, sPref) / sPref;
      // aire extra alrededor (que no quede pegada a los textos), cerca del centro vertical
      // y del punto preferido
      const room = Math.min(Math.max(0, s - sPref), sPref * 0.3) / sPref;
      const score = fit + 0.25 * room - 1.2 * Math.abs(cy / H - prefY / H) - 0.15 * (Math.abs(cx - prefX) / W);
      if (!best || score > best.score) best = { cx, cy, s: Math.min(s, sPref), fit, score };
    }
  }
  return best || { cx: W / 2, cy: H / 2, s: Math.min(sPref, H * 0.5), fit: 0, score: -1 };
}
