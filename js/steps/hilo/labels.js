// Etiquetas DOM sobre objetos 3D (rollos de tela, conos de hilo) compartidas por los
// pasos tela e hilo.

// Ubica una etiqueta DOM sobre un punto 3D sin que quede debajo de la barra superior ni
// (en el celular) detrás de la hoja del panel.
export function placeWorldLabel(engine, el, worldPos, panelEl) {
  const sp = engine.worldToScreen(worldPos);
  const W = engine.canvas.clientWidth || window.innerWidth;
  const H = engine.canvas.clientHeight || window.innerHeight;
  const lh = el.offsetHeight || 26;
  const half = (el.offsetWidth || 80) / 2 + 8;
  const top = document.getElementById('topbar')?.getBoundingClientRect().bottom || 0;
  const mobile = window.matchMedia('(max-width: 820px)').matches;
  const bottom = mobile && panelEl && !panelEl.classList.contains('hidden') ? panelEl.getBoundingClientRect().top : H;
  const off = sp.behind || sp.x < -W * 0.2 || sp.x > W * 1.2 || sp.y < top - lh * 0.6 || sp.y > bottom - lh * 0.5;
  el.style.display = off ? 'none' : '';
  if (off) return;
  // que no se salga de la pantalla (p. ej. el rollo cortado por el borde en el celular)
  el.style.left = `${Math.min(Math.max(sp.x, half), W - half)}px`;
  el.style.top = `${Math.max(sp.y, top + lh / 2 + 4)}px`;
}
