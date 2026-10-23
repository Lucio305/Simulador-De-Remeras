// Paso 11 · Terminaciones y control de calidad.
// (1) Hilos sueltos: girás la remera en el soporte y con la "lupa" encontrás y cortás las colitas
//     de hilo que dejó la costura (más hilos cuanto peor salió la costura).
// (2) Etiqueta: marca, talle, composición y símbolos de cuidado (dibujados en SVG) que hay que
//     elegir bien según la tela; se ve en vivo cosida adentro del cuello.
// (3) Control de calidad: medís con cinta (pecho, largo, manga) y revisás costuras, planchado,
//     estampa e hilos; vos decidís si cada punto aprueba u observa.
// (4) Doblado y embolsado: doblás en la mesa de empaque en el orden correcto y elegís packaging.

import * as R from './terminaciones/rules.js';
import { createThreadHunt } from './terminaciones/threads.js';
import { createTurntable } from './terminaciones/turntable.js';
import { createTape } from './terminaciones/tape.js';
import { createFoldTable } from './terminaciones/fold.js';
import { labelSVG, createNeckLabel } from './terminaciones/label.js';
import { careSymbol } from './terminaciones/careSymbols.js';
import { fabricSwatch } from '../materials/fabric.js';
import { processPrint } from '../print/printEngine.js';
import { clamp, money } from '../core/utils.js';

const LS_BRAND = 'taller:marca';
const PHASES = [
  { id: 'hilos', icon: '✂️', name: 'Hilos sueltos' },
  { id: 'etiqueta', icon: '🏷️', name: 'Etiqueta' },
  { id: 'control', icon: '🔍', name: 'Control' },
  { id: 'doblado', icon: '👕', name: 'Doblado' },
];
const WEIGHTS = { threads: 0.4, label: 0.4, qc: 0.1, fold: 0.1 };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Si hay diseño pero la remera no tiene la estampa (p. ej. entrando con ?step=), la procesa y la aplica.
function ensurePrint(ctx) {
  const { state, shirt, catalog } = ctx;
  const d = state.design;
  if (!d || !d.source || !shirt?.setPrint) return;
  const side = d.side === 'espalda' ? 'espalda' : 'frente';
  if (shirt.hasPrint?.(side)) return;
  try {
    const techId = state.print?.technique || d.technique || 'serigrafia';
    const res = processPrint(d.source, catalog.techniqueById(techId) ? techId : 'serigrafia', {
      fabricId: state.fabric?.id,
      fabricColor: state.fabric?.color,
      colors: d.options?.colors,
      tint: d.options?.tint,
      quality: state.print?.quality ?? 0.8,
      defects: state.print?.defects,
      widthM: d.placement?.width,
      resolution: 512,
    });
    shirt.setPrint(side, res, d.placement);
  } catch (e) {
    console.warn('terminaciones: no se pudo aplicar la estampa', e);
  }
}

function saveBrand(b) {
  try {
    localStorage.setItem(LS_BRAND, b);
  } catch (e) {
    /* sin storage */
  }
}

export default {
  id: 'terminaciones',
  title: 'Terminaciones y control de calidad',
  short: 'Terminaciones',
  icon: '🔍',
  scored: true,
  help: `<p>Los detalles que separan una remera casera de una profesional, en cuatro partes:</p>
<ol>
<li><b>Hilos sueltos:</b> pasá la <b>lupa</b> por las costuras (puños, axilas, cuello y ruedo) y hacé clic sobre cada hilito para cortarlo. <b>Arrastrá</b> para girar la remera (o <span class="kbd">←</span> <span class="kbd">→</span>), <span class="kbd">Espacio</span> la da vuelta y la <b>rueda</b> acerca. En el celular: tocá una costura para prender la lupa ahí y tocá el hilo que brilla para cortarlo (tocar para buscar no cuenta como error).</li>
<li><b>Etiqueta:</b> poné tu marca y elegí los símbolos de cuidado que corresponden a tu tela: temperatura de lavado, lavandina, secado y puntos de plancha.</li>
<li><b>Control de calidad:</b> medí y revisá cada punto; decidí si <b>aprueba</b> o hay que <b>observarlo</b> según la tolerancia.</li>
<li><b>Doblado:</b> en la mesa de empaque tocá las flechas en el orden de tienda (mangas → costados → mitad; sin mangas, costados → mitad) y elegí el packaging.</li>
</ol>`,

  defaults(state, ctx) {
    const catalog = ctx.catalog;
    const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
    const lbl = R.idealLabel(fabric, state);
    state.finishing = {
      threadsCut: 0,
      threadsTotal: 0,
      label: { brand: state.brand, size: state.pattern?.size, composition: fabric.composition, material: lbl.material, color: lbl.color, care: { ...lbl.care }, correct: 4 },
      hangtag: true,
      folded: true,
      packaging: 'bolsa',
      qc: { verdict: 'aprobada', items: 0, right: 0 },
    };
    ctx.addCost?.('Etiqueta', R.labelCost(catalog, lbl.material));
    ctx.addCost?.('Packaging: bolsa compostable', R.packagingCost(catalog, 'bolsa'));
    ctx.addCost?.('Tag colgante', catalog.COSTS.hangtag);
    ctx.shirt?.clearLooseThreads?.();
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, shirt, audio, THREE } = ctx;
    const app = document.getElementById('app');
    const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const kicker = `Paso 11 · ${ctx.stations.exhibicion.name}`;
    const sleep = (ms) => new Promise((r) => ctx.timeout(r, ms));
    ui.panelEl?.classList.add('term-step');
    ctx.track(() => ui.panelEl?.classList.remove('term-step'));

    // ---------- escena ----------
    try {
      ctx.updateShirt();
    } catch (e) {
      console.warn(e);
    }
    const pattern = shirt.pattern || ctx.getPattern();
    ctx.placeShirt('exhibicion');
    ensurePrint(ctx);
    world.setShowcase(true);
    ctx.track(() => world.setShowcase(false));
    ctx.track(() => {
      shirt.group.rotation.set(0, 0, 0);
      shirt.group.visible = true;
    });
    const neck = (world.props.displayStand?.neckAnchor || new THREE.Vector3(...ctx.stations.exhibicion.shirtNeck)).clone();
    const Lm = pattern.construction.L;
    const center = neck.clone().add(new THREE.Vector3(0, -Lm * 0.5 + 0.03, 0));
    const silX = pattern.silhouette.front.outline.map((p) => p.x);
    const shirtW = Math.max(...silX) - Math.min(...silX);

    // hilos sueltos según cómo salió la costura
    shirt.clearLooseThreads();
    const nWanted = R.threadCountFor(state);
    const seed = 1 + Math.floor(Math.random() * 997);
    shirt.addLooseThreads(nWanted, seed);

    const turntable = createTurntable(ctx, { object: shirt.group, center });

    // ---------- encuadre según el área libre de pantalla ----------
    // El motor centra la cámara en el área que no tapa el panel; acá se calcula la región útil
    // (sin la barra de arriba) y, en la fase de hilos, se esquiva el HUD de arriba a la izquierda.
    const topbarH = () => document.getElementById('topbar')?.offsetHeight || (isMobile() ? 50 : 58);
    function screenRegion() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const panel = document.getElementById('panel');
      const mob = isMobile();
      const right = mob ? 0 : (panel?.offsetWidth || 400) + 24;
      const bottom = mob ? Math.min(panel?.offsetHeight || H * 0.48, H * 0.48) : 0;
      return { W, H, cx0: (W - right) / 2, cy0: (H - bottom) / 2, base: { x0: 0, y0: topbarH(), x1: W - right, y1: H - bottom } };
    }
    function hudRect() {
      const el = document.getElementById('hud');
      if (!el || !el.classList.contains('show') || !el.firstChild) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    }
    function frame(target, w, hgt, dir = [0, 0.12, 1], pad = 1.16, { avoidHud = false } = {}) {
      const S = screenRegion();
      const { H } = S;
      const tv = 2 * Math.tan(((engine.camera.fov || 45) * Math.PI) / 360);
      const fit = (reg) => {
        const rw = Math.max(40, reg.x1 - reg.x0);
        const rh = Math.max(40, reg.y1 - reg.y0);
        return { reg, d: clamp(Math.max((hgt * pad) / (tv * (rh / H)), (w * pad) / (tv * (rw / H))), 0.22, 4.5) };
      };
      let best = fit(S.base);
      const hr = avoidHud ? hudRect() : null;
      if (hr) {
        // ¿la remera centrada en toda el área choca con el HUD? (caja de la remera en pantalla)
        const ppm = H / (tv * best.d);
        const bx0 = (best.reg.x0 + best.reg.x1) / 2 - (w * ppm) / 2;
        const by0 = (best.reg.y0 + best.reg.y1) / 2 - (hgt * ppm) / 2;
        if (hr.right + 8 > bx0 && hr.bottom + 8 > by0) {
          const below = fit({ ...S.base, y0: Math.max(S.base.y0, hr.bottom + 10) });
          const beside = fit({ ...S.base, x0: Math.max(S.base.x0, hr.right + 12) });
          best = below.d <= beside.d ? below : beside;
        }
      }
      const { d, reg } = best;
      const v = new THREE.Vector3(...dir).normalize();
      const t = (target.isVector3 ? target : new THREE.Vector3(...target)).clone();
      // corrimiento (px) del centro de la región respecto del centro de la cámara → mundo
      const k = (tv * d) / H;
      const camRight = new THREE.Vector3(0, 1, 0).cross(v).normalize();
      const camUp = v.clone().cross(camRight).normalize();
      t.addScaledVector(camRight, -((reg.x0 + reg.x1) / 2 - S.cx0) * k);
      t.addScaledVector(camUp, ((reg.y0 + reg.y1) / 2 - S.cy0) * k);
      return { position: t.clone().addScaledVector(v, d).toArray(), target: t.toArray(), distance: d };
    }
    // punto de la remera (local del grupo) → mundo, con un giro dado
    const localToWorldAt = (p, yaw) => p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(shirt.group.position);
    const garmentWorld = (side, x, y, yaw = 0, off = 0) => localToWorldAt(shirt.garmentToLocal(side, x, y, off).position, yaw);
    const baseView = (avoidHud = false) => frame(center, shirtW + 0.04, Lm + 0.1, [0, 0.1, 1], isMobile() ? 1.22 : 1.1, { avoidHud });

    // ---------- estado del paso ----------
    let phase = null;
    let busy = false;
    let autoUsed = false;
    const results = {};
    const storedBrand = (() => {
      try {
        return localStorage.getItem(LS_BRAND) || '';
      } catch (e) {
        return '';
      }
    })();
    const label = {
      brand: (state.brand && state.brand !== 'Mi Taller' ? state.brand : storedBrand) || state.brand || 'Mi Taller',
      material: null,
      color: 'negro',
      care: { wash: null, bleach: null, dry: null, iron: null, reverse: false },
    };
    let hintsUsed = 0;
    let slips = 0;
    let slipWarned = false;
    let huntDone = false;

    // ---------- hilos ----------
    const hunt = createThreadHunt(ctx, {
      pattern,
      fabricColor: state.fabric.color,
      isMobile,
      canTap: () => phase === 'hilos' && !busy,
      startActive: false,
      onCut: (rec, { silent }) => {
        renderHud();
        renderZones();
        if (!silent && hunt.remaining() === 0 && phase === 'hilos' && !busy) {
          audio.play('good');
          ui.toast('✂️ ¡Ni un hilo suelto! Quedó prolijísima.', 'good', 2600);
          ctx.timeout(() => phase === 'hilos' && !busy && finishThreads(), 900);
        }
      },
      onSlip: () => {
        slips++;
        if (!slipWarned) {
          slipWarned = true;
          ui.toast('Ojo: la tijerita va sobre el hilo, no sobre la tela 😬', 'warn', 2600);
        }
        renderHud();
      },
    });
    const total = hunt.total;

    // ---------- panel: seguimiento de las 4 partes ----------
    function tracker() {
      const idx = PHASES.findIndex((p) => p.id === phase);
      return h(
        'ol',
        { class: 'term-track' },
        ...PHASES.map((p, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'cur' : '' }, h('span', { class: 'term-track-ico' }, i < idx ? '✓' : p.icon), h('span', { class: 'term-track-name' }, p.name))),
      );
    }
    const autoAction = { id: 'auto', label: 'Hacerlo automático', kind: 'auto', title: 'Termina lo que falta del paso solo, con una nota promedio en esas partes', onClick: (e) => (e?.currentTarget?.blur?.(), runAuto()) };
    // ¿interfaz táctil? (celular, o el último toque fue con el dedo)
    const touchUI = () => isMobile() || !matchMedia('(hover: hover)').matches;

    // ---------- HUD de hilos ----------
    // compacto en pantallas chicas: ocupa poco y no tapa la remera (además deja pasar los clics)
    const compactHud = () => isMobile() || window.innerHeight < 740 || window.innerWidth < 1180;
    const hudEl = h('div', { class: 'term-hud' });
    let hudKey = '';
    function renderHud() {
      if (phase !== 'hilos') return;
      const cnt = hunt.counts();
      const cut = total - hunt.remaining();
      const compact = compactHud();
      const key = `${cut}|${cnt.side.frente}|${cnt.side.espalda}|${Math.floor(hunt.time)}|${turntable.facing()}|${compact}`;
      if (key === hudKey) return;
      hudKey = key;
      const face = turntable.facing();
      hudEl.className = `term-hud${compact ? ' compact' : ''}`;
      hudEl.innerHTML = '';
      const bar = h('div', { class: 'term-hud-bar' }, h('i', { style: { width: `${total ? (100 * cut) / total : 100}%` } }));
      const sides = h(
        'div',
        { class: 'term-hud-sides' },
        h('span', { class: `term-side${face === 'frente' ? ' on' : ''}` }, 'Frente ', h('b', {}, String(cnt.side.frente || 0))),
        h('span', { class: `term-side${face === 'espalda' ? ' on' : ''}` }, 'Espalda ', h('b', {}, String(cnt.side.espalda || 0))),
      );
      if (compact) {
        hudEl.append(
          h('div', { class: 'term-hud-row' }, h('span', { class: 'term-hud-ico' }, '✂️'), h('span', { class: 'hud-big' }, `${cut}`, h('small', {}, `/${total}`)), bar, h('span', { class: 'term-hud-time' }, `⏱ ${fmtTime(hunt.time)}`)),
          sides,
        );
      } else {
        hudEl.append(
          h('div', { class: 'hud-title' }, '✂️ Hilos sueltos'),
          h('div', { class: 'term-hud-row' }, h('span', { class: 'hud-big' }, `${cut}`, h('small', {}, ` / ${total}`)), h('span', { class: 'term-hud-time' }, `⏱ ${fmtTime(hunt.time)}`)),
          bar,
          sides,
        );
      }
    }

    // mapa de zonas: dos siluetas chiquitas con la cantidad de hilos por zona y por lado
    // (frente visto de frente, espalda vista desde atrás: cada globo queda del lado en que lo vas a ver)
    let zoneSvg = null;
    const zoneKey = (r) => `${r.side}|${r.zone}|${r.lr}`;
    function buildZoneMap() {
      const c = pattern.construction;
      const S = 100;
      const sx = (p) => (p.x * S).toFixed(1);
      const sy = (p) => (-p.y * S).toFixed(1);
      const outline = (o) => `M${o.map((p) => `${sx(p)} ${sy(p)}`).join(' L')} Z`;
      const xs = silX.map((x) => x * S);
      const w = Math.max(...xs) - Math.min(...xs);
      const gap = 14;
      // anclas del lado derecho (x > 0 en coords de prenda); el izquierdo es el espejo
      const anchors = {
        cuello: { x: c.HPS.x + 0.012, y: -0.028 },
        axilas: { x: c.UA.x - 0.06, y: c.UA.y - 0.04 },
        punos: c.sleeve ? { x: (c.sleeve.CT.x + c.sleeve.CB.x) / 2 - 0.012, y: (c.sleeve.CT.y + c.sleeve.CB.y) / 2 + 0.012 } : null,
        ruedo: { x: Math.max(0.06, c.hw - 0.065), y: -c.L + 0.055 },
      };
      const present = new Set(hunt.recs.map(zoneKey));
      let inner = '';
      ['frente', 'espalda'].forEach((sd, k) => {
        const ox = k * (w + gap) + w / 2;
        const sil = sd === 'frente' ? pattern.silhouette.front.outline : pattern.silhouette.back.outline;
        inner += `<g transform="translate(${ox.toFixed(1)} 6)"><path d="${outline(sil)}" class="term-zm-shirt"/>`;
        inner += `<text x="0" y="${(c.L * S + 13).toFixed(1)}" text-anchor="middle" class="term-zm-cap">${sd === 'frente' ? 'Frente' : 'Espalda'}</text>`;
        for (const [z, a] of Object.entries(anchors)) {
          if (!a) continue;
          for (const lr of [-1, 1]) {
            if (!present.has(`${sd}|${z}|${lr}`)) continue;
            // la espalda se dibuja vista desde atrás: x de prenda espejada
            const ax = (sd === 'espalda' ? -lr : lr) * Math.abs(a.x);
            inner += `<g class="term-zm-b" data-key="${sd}|${z}|${lr}" transform="translate(${(ax * S).toFixed(1)} ${(-a.y * S).toFixed(1)})"><circle r="6.8"/><text y="3.1" text-anchor="middle">0</text></g>`;
          }
        }
        inner += '</g>';
      });
      const H = c.L * S + 22;
      const wrap = h('div', { class: 'term-zonemap', html: `<svg viewBox="-4 0 ${(w * 2 + gap + 8).toFixed(1)} ${H.toFixed(1)}" aria-label="Hilos por zona">${inner}</svg>` });
      zoneSvg = wrap.querySelector('svg');
      renderZones();
      return wrap;
    }
    function renderZones() {
      if (!zoneSvg) return;
      const per = {};
      for (const r of hunt.recs) if (r.alive) per[zoneKey(r)] = (per[zoneKey(r)] || 0) + 1;
      for (const b of zoneSvg.querySelectorAll('.term-zm-b')) {
        const n = per[b.dataset.key] || 0;
        b.classList.toggle('zero', n === 0);
        b.querySelector('text').textContent = n ? String(n) : '✓';
      }
    }

    // ---------- FASE 1: hilos ----------
    function panelThreads() {
      // los botones sueltan el foco al tocarlos: si no, Espacio los volvía a "apretar"
      const tool = (cls, title, fn, label) =>
        h('button', {
          class: `btn ${cls} btn-sm`,
          type: 'button',
          title,
          onClick: (e) => {
            e.currentTarget.blur();
            fn();
          },
        }, label);
      const tools = h(
        'div',
        { class: 'term-tools' },
        tool('btn-secondary', 'Gira la remera 180° · Espacio', () => flipShirt(), '↻ Dar vuelta'),
        tool('btn-secondary', 'Te señala un hilo (resta 4 puntos en esta parte) · tecla H', () => useHint(), '💡 Pista'),
        tool('btn-ghost', 'Vuelve a encuadrar la remera entera', () => resetView(), '⤢ Ver entera'),
      );
      const body = h(
        'div',
        { class: 'term-panel' },
        tracker(),
        h('p', { class: 'term-lead', html: `Al coser quedan <b>colitas de hilo</b> en los remates. ${touchUI() ? 'Tocá una costura para prender la <b>lupa</b> y tocá el hilo que brilla para cortarlo al ras. Arrastrá para girar la remera.' : 'Pasá la <b>lupa</b> por las costuras y cortá cada una al ras con la tijerita de hilos. Arrastrá para girar la remera y usá la rueda para acercarte.'}` }),
        tools,
        h('div', { class: 'term-zone-head' }, h('b', {}, '¿Dónde quedan?'), h('span', {}, 'hilos por zona y lado')),
        buildZoneMap(),
        ui.note('<b>Tip de taller:</b> el hilo se <b>corta</b>, nunca se tira: si tirás, fruncís la costura o la desarmás.', 'info'),
      );
      ui.panel({
        kicker,
        title: 'Hilos sueltos',
        subtitle: total ? `Tu costura dejó <b>${total}</b> hilitos. ¡Que no quede ninguno!` : 'La costura salió impecable: no quedaron hilos.',
        body,
        actions: [autoAction, { id: 'next', label: 'Listo, seguir →', kind: 'primary', onClick: (e) => (e?.currentTarget?.blur?.(), askFinishThreads()) }],
      });
      ui.hud(hudEl);
      hudKey = '';
      renderHud();
      ui.hint(touchUI() ? 'Tocá una costura: la lupa enciende los hilos · tocá el que brilla para cortarlo' : 'Pasá la lupa por las costuras y hacé clic en cada hilo · arrastrá para girar · <kbd>Espacio</kbd> da vuelta');
      ctx.timeout(() => phase === 'hilos' && ui.hint(null), isMobile() ? 6000 : 12000);
    }

    async function startThreads() {
      phase = 'hilos';
      panelThreads();
      // esperar a que el panel y el HUD tomen su tamaño para encuadrar esquivándolos
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!ctx.alive || phase !== 'hilos') return;
      const v = baseView(true);
      await ctx.flyTo(v, 1.4);
      if (!ctx.alive || phase !== 'hilos') return;
      turntable.resetAzimuth();
      turntable.enable({ target: v.target, minDistance: 0.3, maxDistance: v.distance * 1.3 });
      if (!huntDone) hunt.active = true;
      if (total === 0) ctx.timeout(() => phase === 'hilos' && finishThreads(), 1200);
    }

    function flipShirt() {
      if (phase !== 'hilos' || busy) return;
      audio.play('select');
      turntable.flip();
    }
    function resetView() {
      if (phase !== 'hilos' || busy) return;
      const v = baseView(true);
      turntable.disable();
      ctx.flyTo(v, 0.8).then(() => {
        if (!ctx.alive || phase !== 'hilos') return;
        turntable.resetAzimuth();
        turntable.enable({ target: v.target, minDistance: 0.3, maxDistance: v.distance * 1.3 });
      });
    }
    async function useHint() {
      if (phase !== 'hilos' || busy) return;
      const r = hunt.hint();
      if (!r) return;
      hintsUsed++;
      audio.play('pop');
      if (!r.visible) {
        // probar giros hasta encontrar uno desde el que se vea ese hilo
        const y0 = turntable.yaw;
        const base = r.side === 'espalda' ? Math.PI : 0;
        let want = base;
        for (const cand of [base, base + Math.PI / 2, base - Math.PI / 2, base + Math.PI / 4, base - Math.PI / 4, base + Math.PI]) {
          shirt.group.rotation.y = cand;
          if (hunt.screenOf(r.rec).visible) {
            want = cand;
            break;
          }
        }
        shirt.group.rotation.y = y0;
        shirt.group.updateMatrixWorld(true);
        const face = turntable.facing();
        ui.toast(r.side !== face ? `💡 Hay uno en ${r.side === 'espalda' ? 'la espalda' : 'el frente'}: te la giro.` : '💡 Está de este lado, pero escondido: te la giro un poco.', 'info', 2200);
        await turntable.turnTo(want, 0.9);
        if (!ctx.alive) return;
        hunt.pingRec(r.rec);
      } else {
        const z = R.ZONES.find((q) => q.id === r.rec.zone);
        const sx = hunt.screenOf(r.rec).x;
        const cx = engine.worldToScreen(center).x;
        const where = Math.abs(sx - cx) < 24 ? '' : sx < cx ? ', a tu izquierda' : ', a tu derecha';
        ui.toast(`💡 Fijate ${z ? z.en : 'en los remates'}${where}.`, 'info', 2200);
      }
    }

    async function askFinishThreads() {
      if (phase !== 'hilos' || busy) return;
      const left = hunt.remaining();
      if (left > 0) {
        const id = await ui.modal({
          title: `Quedan ${left} hilo${left === 1 ? '' : 's'}`,
          body: h('p', {}, 'Un hilo suelto es lo primero que ve un cliente exigente. ¿Seguís buscando o pasás a la etiqueta así?'),
          actions: [
            { id: 'back', label: 'Sigo buscando', kind: 'primary' },
            { id: 'go', label: 'Pasar igual', kind: 'secondary' },
          ],
        });
        if (id !== 'go' || !ctx.alive || phase !== 'hilos') return;
      }
      finishThreads();
    }

    function finishThreads() {
      if (results.threads || !ctx.alive) return;
      huntDone = true;
      hunt.active = false;
      const cut = total - hunt.remaining();
      results.threads = { ...R.scoreThreads({ total, cut, time: hunt.time, hints: hintsUsed, slips, auto: autoUsed }), cut, total };
      ui.hud(null);
      ui.hint(null);
      turntable.disable();
      startLabel();
    }

    // ---------- FASE 2: etiqueta ----------
    const swatchURL = (() => {
      try {
        return fabricSwatch(fabric.id, state.fabric.color, 160, { heather: !!state.fabric.heather });
      } catch (e) {
        return null;
      }
    })();
    const labelData = () => ({
      brand: label.brand,
      size: state.pattern?.size || 'M',
      composition: fabric.composition,
      material: label.material || 'algodon',
      color: label.color,
      care: label.care,
      fabricColor: state.fabric.color,
      swatch: swatchURL,
    });
    // el cuello de terciopelo del soporte tapa el interior del escote: en el primer plano de la
    // etiqueta se ocultan las piezas del soporte (se restauran al salir de la fase y del paso)
    const standMeshes = (world.props.displayStand?.group?.children || []).filter((o) => o.isMesh && /^tarima:/.test(o.name || ''));
    const standVis = new Map(standMeshes.map((m) => [m, m.visible]));
    const setStandHidden = (on) => {
      for (const [m, v] of standVis) m.visible = on ? false : v;
    };
    ctx.track(() => setStandHidden(false));
    let neckLabel = null;
    let neckLabelPrinted = null;
    let labelDirty = true;
    let labelT = 0;
    function ensureNeckLabel() {
      const printed = label.material === 'estampada';
      if (neckLabel && neckLabelPrinted === printed) return;
      if (neckLabel) neckLabel.dispose();
      neckLabel = createNeckLabel(shirt, { printed });
      neckLabelPrinted = printed;
      shirt.group.add(neckLabel.mesh);
      labelDirty = true;
    }
    ctx.track(() => neckLabel?.dispose());
    function labelView() {
      const bnd = pattern.construction.bnd;
      const p = garmentWorld('espalda', 0, -bnd - 0.035, 0, -0.002);
      const m = isMobile();
      const d = m ? 0.44 : 0.28;
      const dir = new THREE.Vector3(0, 0.6, 0.8).normalize();
      return { position: p.clone().addScaledVector(dir, d).toArray(), target: p.clone().add(new THREE.Vector3(0, -0.01, 0.01)).toArray() };
    }

    let previewEl = null;
    let careRows = {};
    function refreshLabel() {
      if (previewEl) previewEl.innerHTML = labelSVG(labelData(), { id: 'tp' });
      for (const [k, row] of Object.entries(careRows)) {
        for (const b of row.querySelectorAll('.term-care-btn')) b.classList.toggle('sel', b.dataset.id === String(label.care[k]));
        row.classList.toggle('missing-ok', label.care[k] != null);
      }
      labelDirty = true;
    }

    function panelLabel() {
      previewEl = h('div', { class: 'term-label-preview' });
      const brandInput = h('input', {
        class: 'term-input',
        type: 'text',
        maxlength: 20,
        value: label.brand,
        placeholder: 'Nombre de tu marca',
        'aria-label': 'Marca',
        onInput: (e) => {
          label.brand = e.target.value.replace(/\s+/g, ' ').trimStart().slice(0, 20);
          refreshLabel();
        },
      });
      brandInput.value = label.brand;
      const matGrid = ui.optionGrid({
        options: R.LABEL_MATERIALS.map((m) => ({ id: m.id, label: m.name, sub: m.sub, icon: m.icon })),
        value: label.material,
        columns: 3,
        compact: true,
        onChange: (id) => {
          label.material = id;
          colorRow.classList.toggle('hidden', id === 'estampada');
          ensureNeckLabel();
          refreshLabel();
          matGrid.closest('.term-field')?.classList.remove('term-missing');
        },
      });
      matGrid.classList.add('term-mat');
      const colorRow = h(
        'div',
        { class: `term-lcolors${label.material === 'estampada' ? ' hidden' : ''}` },
        h('span', { class: 'term-small' }, 'Color de la etiqueta:'),
        ...R.LABEL_COLORS.map((c) =>
          h('button', {
            class: `term-lcolor${c.id === label.color ? ' sel' : ''}`,
            type: 'button',
            title: c.name,
            dataset: { id: c.id },
            style: { background: c.bg, color: c.ink },
            onClick: (e) => {
              label.color = c.id;
              audio.play('select');
              for (const b of colorRow.querySelectorAll('.term-lcolor')) b.classList.toggle('sel', b.dataset.id === c.id);
              refreshLabel();
              void e;
            },
          }),
        ),
      );
      careRows = {};
      const careSections = Object.entries(R.CARE).map(([kind, def]) => {
        const row = h('div', { class: `term-care-row term-care-${kind}`, role: 'radiogroup', 'aria-label': def.title });
        for (const o of def.options) {
          const b = h(
            'button',
            {
              class: 'term-care-btn',
              type: 'button',
              role: 'radio',
              dataset: { id: o.id },
              title: `${def.title}: ${o.label}${o.sub ? ' · ' + o.sub : ''}`,
              onClick: () => {
                label.care[kind] = o.id;
                audio.play('select');
                row.closest('.term-field')?.classList.remove('term-missing');
                refreshLabel();
              },
            },
            h('span', { class: 'term-care-ico', html: careSymbol(kind, o.id) }),
            h('span', { class: 'term-care-cap' }, o.label, o.sub ? h('small', {}, o.sub) : null),
          );
          row.appendChild(b);
        }
        careRows[kind] = row;
        const extra =
          kind === 'iron'
            ? ui.toggle({
                label: h('span', { class: 'term-rev' }, h('span', { class: 'term-rev-ico', html: careSymbol('reverse', 1) }), 'Agregar “planchar del revés”'),
                value: label.care.reverse,
                onChange: (v) => {
                  label.care.reverse = !!v;
                  refreshLabel();
                },
              })
            : null;
        return h('div', { class: 'term-field', dataset: { kind } }, h('div', { class: 'term-field-title' }, def.title), row, extra);
      });

      // apuntes de pasos anteriores (lo que hiciste, no la respuesta)
      const notes = [];
      notes.push(`<b>Tela:</b> ${fabric.name} · ${fabric.composition} · ${fabric.gsm} g/m² · ${fabric.knit ? 'de punto' : 'plana'}`);
      if (state.prewash?.done && state.prewash.temp != null) notes.push(`<b>Prelavado:</b> la lavaste a ${state.prewash.temp ? state.prewash.temp + ' °C' : 'agua fría'}${state.prewash.dry ? `, secado ${state.prewash.dry === 'sombra' ? 'a la sombra' : state.prewash.dry === 'sol' ? 'al sol' : 'en secarropas'}` : ''}${typeof state.scores?.prelavado?.score === 'number' ? ` (nota ${Math.round(state.scores.prelavado.score)})` : ''}.`);
      else if (state.prewash?.skipped) notes.push('<b>Prelavado:</b> lo salteaste.');
      if (state.ironing?.level) notes.push(`<b>Planchado:</b> usaste la plancha en ${'•'.repeat(state.ironing.level)}${typeof state.scores?.planchado?.score === 'number' ? ` (nota ${Math.round(state.scores.planchado.score)})` : ''}.`);
      if (state.design || state.print) {
        const t = catalog.techniqueById(state.print?.technique || state.design?.technique);
        notes.push(`<b>Estampa:</b> ${t ? t.name : 'sí'}, en ${state.design?.side === 'espalda' ? 'la espalda' : 'el frente'}.`);
      } else notes.push('<b>Estampa:</b> remera lisa, sin estampado.');
      const apuntes = h('details', { class: 'term-apuntes' }, h('summary', {}, '📋 Tus apuntes del taller'), h('ul', {}, ...notes.map((n) => h('li', { html: n }))));

      const body = h(
        'div',
        { class: 'term-panel' },
        tracker(),
        h('div', { class: 'term-label-stage' }, previewEl),
        h('div', { class: 'term-field' }, h('div', { class: 'term-field-title' }, 'Marca'), brandInput, h('p', { class: 'term-small' }, `Talle ${state.pattern?.size || 'M'} y composición (${fabric.composition}) van solos: son obligatorios por ley.`)),
        h('div', { class: 'term-field', dataset: { kind: 'material' } }, h('div', { class: 'term-field-title' }, 'Material de la etiqueta'), matGrid, colorRow),
        h('div', { class: 'term-care-head' }, h('b', {}, 'Símbolos de cuidado'), h('span', {}, 'elegí uno de cada fila')),
        ...careSections,
        apuntes,
      );
      ui.panel({
        kicker,
        title: 'La etiqueta',
        subtitle: 'Tu firma y las instrucciones de cuidado: si están mal, la remera se arruina en el primer lavado.',
        body,
        wide: true,
        actions: [autoAction, { id: 'next', label: 'Coser la etiqueta →', kind: 'primary', onClick: () => confirmLabel() }],
      });
      refreshLabel();
      ui.hint(isMobile() ? 'La etiqueta va cosida adentro del cuello, en la espalda' : 'Así se ve tu etiqueta cosida adentro del cuello · los cambios se ven en vivo');
      ctx.timeout(() => phase === 'etiqueta' && ui.hint(null), 6000);
    }

    async function startLabel() {
      phase = 'etiqueta';
      ensureNeckLabel();
      panelLabel();
      turntable.turnTo(0, 0.8);
      await sleep(30);
      if (!ctx.alive) return;
      const fl = ctx.flyTo(labelView(), 1.3);
      ctx.timeout(() => phase === 'etiqueta' && setStandHidden(true), 450);
      await fl;
    }

    async function confirmLabel() {
      if (phase !== 'etiqueta' || busy) return;
      const missing = [];
      if (!label.material) missing.push('material');
      for (const k of Object.keys(R.CARE)) if (label.care[k] == null) missing.push(k);
      if (missing.length) {
        audio.play('bad');
        const names = { material: 'el material', wash: 'el lavado', bleach: 'la lavandina', dry: 'el secado', iron: 'la plancha' };
        ui.toast(`🏷️ Te falta elegir ${missing.map((m) => names[m]).join(', ')}.`, 'warn', 2800);
        let first = null;
        for (const f of ui.bodyEl.querySelectorAll('.term-field')) {
          const k = f.dataset.kind;
          if (k && missing.includes(k)) {
            f.classList.remove('term-missing');
            void f.offsetWidth;
            f.classList.add('term-missing');
            first = first || f;
          }
        }
        first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      busy = true;
      ui.enableAction('next', false);
      ui.enableAction('auto', false);
      finishLabelScore();
      audio.play('pop');
      ui.toast('🏷️ Etiqueta cosida en el cuello', 'good', 2000);
      const v = labelView();
      const p = new THREE.Vector3(...v.target);
      const cam = new THREE.Vector3(...v.position);
      await ctx.flyTo({ position: p.clone().lerp(cam, 0.72).toArray(), target: v.target }, 0.8);
      if (!ctx.alive) return;
      await sleep(700);
      if (!ctx.alive) return;
      busy = false;
      startControl();
    }
    function finishLabelScore() {
      label.brand = (label.brand || '').trim() || 'Mi Taller';
      state.brand = label.brand;
      saveBrand(label.brand);
      results.label = R.scoreLabel(catalog, state, label);
      labelDirty = true;
    }

    // ---------- FASE 3: control de calidad ----------
    let items = [];
    const judged = {};
    let qcCur = -1;
    let tape = null;
    let tapeAnim = null;
    let readingEl = null;
    let qcListEl = null;
    let verdict = null;
    const readingTag = h('div', { class: 'world-label term-reading' });
    readingTag.style.display = 'none';
    app.appendChild(readingTag);
    ctx.track(() => readingTag.remove());
    const oldTapes = new Set();
    ctx.track(() => {
      tape?.dispose();
      for (const tp of oldTapes) tp.dispose();
      oldTapes.clear();
    });

    function itemView(it) {
      const c = pattern.construction;
      const printSide = state.design?.side === 'espalda' ? 'espalda' : 'frente';
      const m = isMobile();
      switch (it.tape || it.focus) {
        case 'chest': {
          const y = c.UA.y - 0.025;
          return { yaw: 0, view: frame(garmentWorld('frente', 0, y, 0, 0.02), shirtW * 0.8, 0.3, [0, 0.16, 1]) };
        }
        case 'length':
          return { yaw: 0, view: frame(center, shirtW * 0.7, Lm + 0.1, [0.18, 0.08, 1], 1.1) };
        case 'sleeve': {
          const yaw = -0.45;
          const sp = c.SP;
          const ct = c.sleeve?.CT || sp;
          const p = garmentWorld('frente', (sp.x + ct.x) / 2, (sp.y + ct.y) / 2 - 0.03, yaw, 0.03);
          return { yaw, view: frame(p, 0.36, 0.3, [0.12, 0.22, 1]) };
        }
        case 'seam': {
          const yaw = -1.15;
          const p = garmentWorld('frente', c.hw - 0.01, -Lm * 0.55, yaw, 0.02);
          return { yaw, view: frame(p, 0.34, Lm * 0.75, [0.05, 0.1, 1]) };
        }
        case 'print': {
          const pl = state.design?.placement || { x: 0, y: -0.25, width: 0.25 };
          const yaw = printSide === 'espalda' ? Math.PI : 0;
          const gx = printSide === 'espalda' ? -pl.x : pl.x;
          const p = garmentWorld(printSide, gx, pl.y, yaw, 0.02);
          return { yaw, view: frame(p, (pl.width || 0.25) * 1.6, (pl.width || 0.25) * 1.4, [0, 0.1, 1]) };
        }
        default:
          return { yaw: it.id === 'planchado' ? 0.42 : 0, view: frame(center, shirtW + 0.04, Lm + 0.1, [m ? 0 : -0.12, 0.1, 1], 1.12) };
      }
    }

    function qcRow(it, i) {
      const j = judged[it.id];
      const cur = i === qcCur;
      const row = h('li', { class: `term-qc-row${cur ? ' cur' : ''}${j ? ' judged ' + j : ''}`, dataset: { id: it.id } });
      const head = h(
        'button',
        { class: 'term-qc-head', type: 'button', disabled: !!verdict || (!j && !cur), onClick: () => !verdict && j && activate(i) },
        h('span', { class: 'term-qc-ico' }, it.icon),
        h('span', { class: 'term-qc-name' }, it.name),
        h('span', { class: 'term-qc-state' }, j === 'ok' ? '✓ Aprueba' : j === 'obs' ? '⚠ Observar' : cur ? '…' : ''),
      );
      row.appendChild(head);
      if (verdict && j) {
        const right = (j === 'ok') === it.pass;
        row.classList.add(right ? 'right' : 'wrong');
        head.appendChild(h('span', { class: `term-qc-eval ${right ? 'ok' : 'no'}`, title: right ? 'Bien juzgado' : 'Mal juzgado' }, right ? '✔' : '✗'));
        if (!right) row.appendChild(h('div', { class: 'term-qc-miss' }, `${it.reading} → ${it.pass ? 'estaba dentro de norma' : 'estaba fuera de norma'}`));
      }
      if (cur) {
        readingEl = h('div', { class: 'term-qc-reading' }, h('span', { class: 'term-qc-measuring' }, it.kind === 'tape' ? '📏 Midiendo…' : '🔍 Revisando…'));
        row.append(
          h(
            'div',
            { class: 'term-qc-body' },
            readingEl,
            h('div', { class: 'term-qc-crit' }, h('b', {}, 'Criterio: '), it.criterion),
            h('div', { class: 'term-qc-how' }, it.howTo),
            h(
              'div',
              { class: 'term-qc-btns' },
              h('button', { class: 'btn btn-sm term-ok', type: 'button', disabled: true, onClick: () => judge(it, 'ok') }, '✓ Aprueba'),
              h('button', { class: 'btn btn-sm term-obs', type: 'button', disabled: true, onClick: () => judge(it, 'obs') }, '⚠ Observar'),
            ),
          ),
        );
      }
      return row;
    }
    function renderQC() {
      if (!qcListEl) return;
      qcListEl.replaceChildren(...items.map((it, i) => qcRow(it, i)));
    }
    function panelControl() {
      qcListEl = h('ol', { class: 'term-qc' });
      const body = h(
        'div',
        { class: 'term-panel' },
        tracker(),
        h('p', { class: 'term-lead', html: 'Antes de entregar, la remera pasa por <b>control de calidad</b>. Medí y revisá cada punto, y decidí con la tolerancia en la mano: ¿<b>aprueba</b> o hay que <b>observarlo</b>?' }),
        qcListEl,
        h('div', { class: 'term-verdict-slot' }),
      );
      ui.panel({
        kicker,
        title: 'Control de calidad',
        subtitle: 'Un buen control no aprueba todo: frena lo que está fuera de norma y no rechaza lo que está bien.',
        body,
        actions: [autoAction, { id: 'next', label: 'Doblar →', kind: 'primary', disabled: true, onClick: () => startFold() }],
      });
      renderQC();
    }

    async function startControl() {
      phase = 'control';
      setStandHidden(false);
      const left = hunt.remaining();
      items = R.qcItems({ state, catalog, pattern, shirt, threadsLeft: left, seed: (state.startedAt || 7) % 100000 });
      panelControl();
      ui.hint(null);
      activate(0);
    }

    let activeToken = 0;
    async function activate(i) {
      if (phase !== 'control') return;
      const token = ++activeToken;
      qcCur = i;
      renderQC();
      const row = qcListEl.querySelector('.term-qc-row.cur');
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const it = items[i];
      if (tape) {
        tape.dispose();
        tape = null;
      }
      readingTag.style.display = 'none';
      const { yaw, view } = itemView(it);
      await Promise.all([turntable.turnTo(yaw, 0.85), ctx.flyTo(view, 0.95)]);
      if (!ctx.alive || token !== activeToken) return;
      if (it.kind === 'tape') {
        tape = createTape(shirt, pattern, it.tape, it.value);
        shirt.group.add(tape.mesh);
        tapeAnim = { t: 0, dur: 1.1, it, token };
        audio.play('tick');
        await new Promise((r) => (tapeAnim.done = r));
        if (!ctx.alive || token !== activeToken) return;
      } else {
        await sleep(650);
        if (!ctx.alive || token !== activeToken) return;
      }
      audio.play('pop');
      showReading(it);
    }
    function showReading(it) {
      if (!readingEl) return;
      readingEl.replaceChildren(h('span', { class: 'term-qc-val' }, it.reading));
      for (const b of qcListEl.querySelectorAll('.term-qc-row.cur .term-qc-btns button')) b.disabled = false;
    }
    function judge(it, v) {
      if (phase !== 'control' || verdict) return;
      judged[it.id] = v;
      audio.play(v === 'ok' ? 'select' : 'tick');
      if (tape) {
        const tp = tape;
        tape = null;
        oldTapes.add(tp);
        ctx.timeout(() => {
          tp.dispose();
          oldTapes.delete(tp);
        }, 250);
      }
      readingTag.style.display = 'none';
      const next = items.findIndex((x) => !judged[x.id]);
      if (next >= 0) activate(next);
      else emitVerdict();
    }
    function emitVerdict() {
      qcCur = -1;
      activeToken++;
      verdict = R.qcVerdict(items); // el real, según las mediciones
      const mine = R.playerVerdict(items, judged); // el sello que pusiste vos
      const sc = R.scoreQC(items, judged);
      results.qc = { ...sc, verdict, mine, items: items.length, right: items.filter((i) => (judged[i.id] === 'ok') === i.pass).length };
      renderQC();
      const slot = ui.bodyEl.querySelector('.term-verdict-slot');
      if (slot) {
        const same = mine.id === verdict.id;
        slot.replaceChildren(
          h(
            'div',
            { class: `term-verdict ${mine.cls}` },
            h('div', { class: 'term-stamp' }, h('span', {}, 'TU DICTAMEN'), h('b', {}, mine.stamp), h('span', {}, new Date().toLocaleDateString('es-AR'))),
            h(
              'div',
              { class: 'term-verdict-txt' },
              h('p', { html: `Juzgaste bien <b>${results.qc.right} de ${items.length}</b> puntos.` }),
              h('p', { class: same ? 'ok' : 'no', html: same ? '✓ Coincide con el dictamen correcto.' : `El dictamen correcto era <b>${verdict.name.toLowerCase()}</b>.` }),
            ),
          ),
        );
        slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      audio.play(results.qc.right === items.length ? 'good' : 'press');
      ui.enableAction('next', true);
      const v = baseView();
      turntable.turnTo(0, 0.8);
      ctx.flyTo(v, 1.0);
    }

    // ---------- FASE 4: doblado y embolsado ----------
    let fold = null;
    let pack = 'bolsa';
    let hangtag = true;
    ctx.track(() => fold?.dispose());
    function printInfo() {
      const side = state.design?.side === 'espalda' ? 'espalda' : 'frente';
      const pr = shirt._prints?.[side]?.print;
      const pl = state.design?.placement || shirt._prints?.[side]?.placement;
      if (!pr || !pl) return { url: null };
      try {
        const cv = pr.color;
        return { url: cv?.toDataURL ? cv.toDataURL('image/png') : null, placement: { ...pl, aspect: pr.aspect || (cv ? cv.width / cv.height : 1) }, side };
      } catch (e) {
        return { url: null };
      }
    }
    const hasSleeves = !!pattern.construction.hasSleeves;
    const printSide = state.design || state.print ? (state.design?.side === 'espalda' ? 'espalda' : 'frente') : null;
    const foldOrder = hasSleeves ? 'mangas → costados → mitad' : 'costados → mitad';
    function panelFold() {
      const btn = (id, txt) =>
        fold.folds[id]
          ? h('button', { class: `term-fbtn${fold.isDone(id) ? ' done' : ''}`, type: 'button', dataset: { id }, onClick: () => doFold(id) }, txt)
          : h('span', { class: 'term-fbtn empty' });
      const grid = h(
        'div',
        { class: 'term-fold-grid' },
        btn('mangaIzq', '↘ Manga izq.'),
        btn('mangaDer', '↙ Manga der.'),
        btn('costadoIzq', '→ Costado izq.'),
        btn('costadoDer', '← Costado der.'),
        h('span', { class: 'term-fbtn-mid' }, btn('mitad', '↑ A la mitad')),
      );
      const packGrid = ui.optionGrid({
        options: R.PACKAGING.map((p) => ({ id: p.id, label: p.name, sub: `${p.sub} · ${money(R.packagingCost(catalog, p.id))}`, icon: p.icon })),
        value: pack,
        columns: 1,
        compact: true,
        onChange: (id) => {
          pack = id;
          fold.setPackaging(id);
        },
      });
      packGrid.classList.add('term-pack');
      const tagToggle = ui.toggle({
        label: `Tag colgante de cartón (+${money(catalog.COSTS.hangtag)})`,
        value: hangtag,
        onChange: (v) => {
          hangtag = !!v;
          fold.setHangtag(hangtag);
        },
      });
      const body = h(
        'div',
        { class: 'term-panel' },
        tracker(),
        h('p', {
          class: 'term-lead',
          html: `El <b>doblado de tienda</b> deja la remera plana, angosta y ${printSide === 'frente' ? 'con la estampa a la vista' : 'pareja, lista para la vidriera'}. Doblá en el orden correcto tocando las flechas (o estos botones).`,
        }),
        grid,
        h('div', { class: 'term-field' }, h('div', { class: 'term-field-title' }, 'Packaging'), packGrid, tagToggle),
      );
      ui.panel({
        kicker,
        title: 'Doblado y embolsado',
        subtitle: 'Último paso en la mesa de empaque: así llega a manos del cliente.',
        body,
        actions: [autoAction, { id: 'next', label: 'Terminar ✓', kind: 'primary', disabled: !fold.packed, onClick: () => finish(false) }],
      });
      if (fold.folded) lockPackaging();
    }
    // una vez doblada, el packaging y el tag ya no se cambian (el paquete se arma con eso)
    function lockPackaging() {
      const f = ui.bodyEl.querySelector('.term-pack')?.closest('.term-field');
      if (!f) return;
      f.classList.add('locked');
      for (const el of f.querySelectorAll('input, button')) el.disabled = true;
    }
    function refreshFoldButtons() {
      for (const b of ui.bodyEl.querySelectorAll('.term-fbtn[data-id]')) b.classList.toggle('done', fold.isDone(b.dataset.id));
    }
    function doFold(id) {
      if (phase !== 'doblado' || busy || !fold) return;
      fold.request(id);
    }

    async function startFold() {
      if (phase !== 'control' || busy) return;
      phase = 'doblado';
      ui.hint(null);
      readingTag.style.display = 'none';
      const pi = printInfo();
      fold = createFoldTable({
        pattern,
        fabricColor: state.fabric.color,
        swatch: swatchURL,
        printURL: pi.url,
        printPlacement: pi.placement,
        printSide: pi.side,
        brand: label.brand,
        h,
        isMobile,
      });
      fold.setPackaging(pack);
      fold.setHangtag(hangtag);
      fold.onChange = (ev) => {
        if (ev.type === 'error') {
          audio.play('bad');
          ui.toast(ev.msg, 'warn', 3600);
        } else if (ev.type === 'fold') audio.play('thud');
        else if (ev.type === 'folded') refreshFoldButtons();
        else if (ev.type === 'allFolded') {
          audio.play('good');
          lockPackaging();
          ctx.timeout(() => fold && fold.pack(), 450);
        } else if (ev.type === 'packed') {
          audio.play('fanfare');
          ui.enableAction('next', true);
          ui.toast('📦 ¡Lista para entregar!', 'good', 2400);
        }
      };
      panelFold();
      world.setShowcase(false);
      const kit = world.props.labelKit?.group;
      const kp = kit ? kit.position.clone() : new THREE.Vector3(-0.85, 0, 1.3);
      kp.y = 0.78;
      const v = frame(kp, 0.9, 0.7, [0.05, 0.75, 0.7], 1);
      await ctx.flyTo(v, 1.2);
      if (!ctx.alive || phase !== 'doblado') return;
      shirt.group.visible = false;
      app.appendChild(fold.el);
      requestAnimationFrame(() => fold.el.classList.add('show'));
      ui.hint(null);
    }

    // ---------- teclado ----------
    const keys = new Set();
    ctx.listen(window, 'keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (document.querySelector('.modal-wrap')) return;
      if (phase === 'hilos' && !busy) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          keys.add(e.key);
          turntable.setKeySpin((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0));
        } else if (e.code === 'Space' || e.key === ' ') {
          // aunque haya un botón con foco (p. ej. "Pista"): Espacio da vuelta la remera
          e.preventDefault();
          e.target?.closest?.('button')?.blur();
          if (!e.repeat) flipShirt();
        } else if ((e.key === 'h' || e.key === 'H') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) useHint();
      }
    });
    ctx.listen(window, 'keyup', (e) => {
      if (phase === 'hilos' && (e.code === 'Space' || e.key === ' ') && e.target?.closest?.('button')) e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        keys.delete(e.key);
        turntable.setKeySpin((keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0));
      }
    });
    ctx.listen(window, 'blur', () => {
      keys.clear();
      turntable.setKeySpin(0);
    });

    // ---------- bucle ----------
    const tmpV = new THREE.Vector3();
    ctx.onUpdate((dt) => {
      turntable.update(dt);
      hunt.update(dt);
      if (phase === 'hilos' && !huntDone) renderHud();
      // etiqueta 3D en vivo (re-rasterizada con un poco de retardo)
      if (neckLabel && labelDirty) {
        labelT += dt;
        if (labelT > 0.12) {
          labelT = 0;
          labelDirty = false;
          neckLabel.setSVG(labelSVG(labelData(), { id: 'tl3', bare: label.material === 'estampada' }));
        }
      }
      // cinta métrica
      if (tapeAnim && tape) {
        tapeAnim.t += dt;
        const k = clamp(tapeAnim.t / tapeAnim.dur);
        const e = 1 - Math.pow(1 - k, 2.2);
        tape.progress = e;
        shirt.group.updateMatrixWorld(true);
        tmpV.copy(tape.tipLocal()).applyMatrix4(shirt.group.matrixWorld);
        const sp = engine.worldToScreen(tmpV);
        readingTag.style.display = sp.behind ? 'none' : '';
        readingTag.style.left = `${sp.x}px`;
        readingTag.style.top = `${sp.y - 8}px`;
        const v = tapeAnim.it.value * e;
        readingTag.textContent = `${v.toFixed(1).replace('.', ',')} cm`;
        if (k >= 1) {
          const d = tapeAnim.done;
          tapeAnim = null;
          d?.();
        }
      } else if (tape && readingTag.style.display !== 'none') {
        shirt.group.updateMatrixWorld(true);
        tmpV.copy(tape.tipLocal()).applyMatrix4(shirt.group.matrixWorld);
        const sp = engine.worldToScreen(tmpV);
        readingTag.style.left = `${sp.x}px`;
        readingTag.style.top = `${sp.y - 8}px`;
      }
      if (fold) fold.update(dt);
    });

    // ---------- modo automático ----------
    // Completa SOLO lo que falta: lo que ya hiciste a mano se respeta y las partes que hace el
    // taller quedan con nota tope AUTO_CAP (y así lo dicen las notas).
    const AUTO_CAP = 70;
    const autoQcIds = new Set();
    async function runAuto() {
      if (busy || finished) return;
      busy = true;
      autoUsed = true;
      ui.enableAction('auto', false);
      ui.enableAction('next', false);
      ui.hint(null);
      if (!results.threads) {
        const alive = hunt.recs.filter((r) => r.alive);
        const leave = alive.length >= 8 ? 1 : 0;
        for (let i = 0; i < alive.length - leave; i++) {
          hunt.cut(alive[i], { silent: i % 2 === 1 });
          renderHud();
          renderZones();
          await sleep(70);
          if (!ctx.alive) return;
        }
        const cut = total - hunt.remaining();
        const autoCut = alive.length - leave;
        const sc = R.scoreThreads({ total, cut, autoCut, time: hunt.time, hints: hintsUsed, slips, auto: true });
        // los hilos que corta el taller valen 70 % (R.AUTO_THREAD_VALUE): con todo en automático, ≤ 70
        results.threads = { ...sc, cut, total, auto: autoCut > 0 };
        huntDone = true;
        hunt.active = false;
        ui.hud(null);
        turntable.disable();
      }
      if (!results.label) {
        // completa lo que falte con la etiqueta "del montón" del taller
        const a = R.autoLabel(fabric, state);
        const filled = [];
        if (!label.material) {
          label.material = a.material;
          label.color = a.color;
          filled.push('material');
        }
        for (const k of Object.keys(R.CARE)) {
          if (label.care[k] == null) {
            label.care[k] = a.care[k];
            filled.push(k);
          }
        }
        finishLabelScore();
        if (filled.length) {
          results.label.auto = true;
          results.label.filled = filled;
          results.label.score = Math.min(results.label.score, AUTO_CAP);
        }
        ensureNeckLabel();
      }
      if (!results.qc) {
        if (!items.length) items = R.qcItems({ state, catalog, pattern, shirt, threadsLeft: hunt.remaining(), seed: (state.startedAt || 7) % 100000 });
        for (const it of items) {
          if (!judged[it.id]) {
            judged[it.id] = it.pass ? 'ok' : 'obs';
            autoQcIds.add(it.id);
          }
        }
        verdict = R.qcVerdict(items);
        const sc = R.scoreQC(items, judged, { autoIds: autoQcIds });
        const right = items.filter((i) => (judged[i.id] === 'ok') === i.pass).length;
        results.qc = { ...sc, score: autoQcIds.size ? Math.min(sc.score, AUTO_CAP) : sc.score, verdict, mine: null, items: items.length, right, auto: autoQcIds.size > 0 };
      }
      if (!results.fold) {
        if (fold) {
          fold.finishInstant();
          // que el panel de atrás de la tarjeta quede coherente (todo doblado y embolsado)
          if (phase === 'doblado') {
            refreshFoldButtons();
            lockPackaging();
          }
        }
        const errs = fold ? fold.errors : 0;
        results.fold = { score: Math.min(AUTO_CAP, R.scoreFold(errs)), errors: errs, notes: [`${R.MID} La dobló y embolsó el taller en automático${errs ? ` (antes te habías equivocado ${errs} vez${errs === 1 ? '' : 'es'} en el orden)` : ''}.`], auto: true };
      }
      await sleep(250);
      if (!ctx.alive) return;
      finish(true);
    }

    // ---------- cierre ----------
    let finished = false;
    async function finish(viaAuto = false) {
      if (finished || !ctx.alive) return;
      if (!viaAuto && (!fold || !fold.packed)) return;
      finished = true;
      busy = true;
      ui.enableAction('next', false);
      ui.enableAction('auto', false);
      ui.hint(null);
      if (!results.fold) {
        const errs = fold ? fold.errors : 0;
        const fs = R.scoreFold(errs);
        const notes = [];
        const look = printSide === 'frente' ? 'Queda plana y con la estampa a la vista.' : printSide === 'espalda' ? 'Queda plana, con la estampa de la espalda protegida abajo.' : 'Queda plana y prolija, lista para la vidriera.';
        if (errs === 0) notes.push(`${R.OK} Doblado de tienda en el orden justo: ${hasSleeves ? 'mangas, costados y mitad' : 'costados y mitad'}. ${look}`);
        else notes.push(`${R.MID} Te equivocaste ${errs} vez${errs === 1 ? '' : 'es'} en el orden del doblado (−${100 - fs} en esa parte). El orden es: ${foldOrder}.`);
        results.fold = { score: fs, errors: errs, notes };
      }
      const T = results.threads || { score: 70, notes: [], cut: 0, total };
      const Lb = results.label || { score: 70, notes: [] };
      const Q = results.qc || { score: 70, notes: [] };
      const F = results.fold;
      let score = T.score * WEIGHTS.threads + Lb.score * WEIGHTS.label + Q.score * WEIGHTS.qc + F.score * WEIGHTS.fold;
      const notes = [];
      const autoParts = [
        T.auto && 'los hilos',
        Lb.auto && (Lb.filled?.length >= 5 ? 'la etiqueta' : 'parte de la etiqueta'),
        Q.auto && (autoQcIds.size >= items.length ? 'el control de calidad' : 'parte del control'),
        F.auto && 'el doblado',
      ].filter(Boolean);
      if (autoParts.length === 4) score = clamp(score, 65, 72);
      if (autoParts.length) {
        const list = autoParts.length > 1 ? `${autoParts.slice(0, -1).join(', ')} y ${autoParts[autoParts.length - 1]}` : autoParts[0];
        const deList = /^el /.test(list) ? `del <b>${list.slice(3)}</b>` : `de <b>${list}</b>`;
        notes.push(`${R.MID} En automático, el taller se encargó ${deList} a las apuradas (esas partes valen hasta ${AUTO_CAP}). Hacelo vos para sumar más puntos.`);
      }
      notes.push(...T.notes.filter((n) => !/^Tip:/.test(n)).slice(0, 3));
      if (Lb.auto) {
        const names = { material: 'material', wash: 'lavado', bleach: 'lavandina', dry: 'secado', iron: 'plancha' };
        notes.push(Lb.filled.length >= 5 ? `${R.MID} El taller puso su etiqueta genérica (algodón negro y símbolos "por las dudas"):` : `${R.MID} El taller completó lo que faltaba de la etiqueta (${Lb.filled.map((k) => names[k]).join(', ')}):`);
      }
      notes.push(...Lb.notes);
      notes.push(...(Q.notes.length ? Q.notes.slice(0, 3) : []));
      if (results.qc?.verdict) {
        const v = results.qc.verdict;
        const mine = results.qc.mine;
        const mark = (cls) => (cls === 'ok' ? R.OK : cls === 'warn' ? R.MID : R.NO);
        if (mine && mine.id !== v.id) notes.push(`${R.NO} Tu dictamen fue <b>${mine.name.toLowerCase()}</b>, pero correspondía <b>${v.name.toLowerCase()}</b>.`);
        else if (mine) notes.push(v.cls === 'ok' ? `${R.OK} Dictamen del control: <b>${v.name}</b>.` : `${R.MID} Dictamen del control: <b>${v.name}</b>. Bien visto: lo frenaste antes de que llegue al cliente.`);
        else notes.push(`${mark(v.cls)} Dictamen del control (lo hizo el taller): <b>${v.name}</b>.`);
      }
      notes.push(...F.notes);
      // estado y costos
      const lab = { brand: label.brand, size: state.pattern?.size, composition: fabric.composition, material: label.material || 'algodon', color: label.color, care: { ...label.care }, correct: Lb.correct ?? 0, score: Math.round(Lb.score) };
      state.finishing = {
        threadsCut: T.cut ?? total - hunt.remaining(),
        threadsTotal: total,
        label: lab,
        hangtag,
        folded: true,
        packaging: pack,
        qc: { verdict: results.qc?.verdict?.id || 'aprobada', playerVerdict: results.qc?.mine?.id || null, items: results.qc?.items || 0, right: results.qc?.right || 0, judged: { ...judged }, auto: !!results.qc?.auto },
        auto: autoParts.length ? autoParts : null,
        scores: { threads: Math.round(T.score), label: Math.round(Lb.score), qc: Math.round(Q.score), fold: Math.round(F.score) },
      };
      ctx.addCost('Etiqueta', R.labelCost(catalog, lab.material));
      for (const p of R.PACKAGING) ctx.removeCost(`Packaging: ${p.name.toLowerCase()}`);
      const pk = R.PACKAGING.find((p) => p.id === pack) || R.PACKAGING[0];
      ctx.addCost(`Packaging: ${pk.name.toLowerCase()}`, R.packagingCost(catalog, pack));
      if (hangtag) ctx.addCost('Tag colgante', catalog.COSTS.hangtag);
      else ctx.removeCost('Tag colgante');
      // tarjeta: resumen por parte + la etiqueta
      const bar = (name, w, s) => h('div', { class: 'term-res-row' }, h('span', {}, name, h('small', {}, ` ${Math.round(w * 100)} %`)), h('span', { class: 'term-res-bar' }, h('i', { style: { width: `${clamp(s / 100) * 100}%` } })), h('b', {}, String(Math.round(s))));
      const extra = h(
        'div',
        { class: 'term-result' },
        h('div', { class: 'term-res-label', html: labelSVG(labelData(), { id: 'tr' }) }),
        h('div', { class: 'term-res-bars' }, bar('✂️ Hilos', WEIGHTS.threads, T.score), bar('🏷️ Etiqueta', WEIGHTS.label, Lb.score), bar('🔍 Control', WEIGHTS.qc, Q.score), bar('👕 Doblado', WEIGHTS.fold, F.score)),
      );
      await sleep(viaAuto ? 150 : 500);
      if (!ctx.alive) return;
      await ctx.complete({ score, notes, extra });
    }

    // ---------- pruebas automáticas ----------
    this._test = {
      get phase() {
        return phase;
      },
      hunt,
      turntable,
      results,
      label,
      get items() {
        return items;
      },
      get fold() {
        return fold;
      },
      threadScreens: () => hunt.recs.filter((r) => r.alive).map((r) => ({ side: r.side, zone: r.zone, ...hunt.screenOf(r) })),
      cutVisible: () => {
        const r = hunt.recs.find((x) => x.alive && hunt.screenOf(x).visible);
        return r ? hunt.cut(r) : false;
      },
      get slips() {
        return slips;
      },
      hints: () => ({ hintsUsed, slips }),
      // oclusión por grilla vs raycaster de three en varios giros
      occCompare: () => {
        const y0 = shirt.group.rotation.y;
        const out = [];
        for (const yaw of [0, 0.45, 1.0, 1.57, 2.3, 3.14, -0.7, -1.57, -2.4]) {
          shirt.group.rotation.y = yaw;
          shirt.group.updateMatrixWorld(true);
          out.push({ yaw, ...hunt._occCheck() });
        }
        shirt.group.rotation.y = y0;
        shirt.group.updateMatrixWorld(true);
        return out;
      },
      finishThreads: () => finishThreads(),
      confirmLabel: () => confirmLabel(),
      startFold: () => startFold(),
      judge: (v) => {
        const it = items[qcCur];
        if (it) judge(it, v);
      },
    };
    ctx.track(() => {
      this._test = null;
    });

    await startThreads();
  },
};
