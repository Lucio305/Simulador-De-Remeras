// Paso final: la remera terminada en el soporte de exhibición, con el informe completo,
// foto descargable, prueba de lavado, colección y reacción del cliente (modo pedido).

import { clamp, lerp, money, easeInOutCubic, downloadDataURL } from '../core/utils.js';
import { processPrint } from '../print/printEngine.js';
import { loadCollection, upsertShirt, updateShirtEntry, removeShirt, showCollectionItem } from './final/collection.js';
import { globalScore, tierFor, scoreColor, stepRows, costBreakdown, orderChecklist, clientVerdict, computeWash } from './final/report.js';
import { captureShirt, thumbnailDataURL, polaroidCanvas, projectGarmentPoint, markLine } from './final/photo.js';
import { createWashFx } from './final/washFx.js';

const VIEW = { position: [0.2, 1.33, 3.22], target: [0.2, 1.1, 1.0] };
const TAU = Math.PI * 2;

const signed = (n) => (n < 0 ? `−${money(-n)}` : money(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function rosetteSVG(score, color) {
  const n = 22;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - Math.PI / 2;
    const r = i % 2 ? 41 : 47;
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`);
  }
  return `<svg class="fin-rosette-svg" viewBox="-60 -54 120 146" aria-hidden="true">
    <g class="fin-rosette-ribbons">
      <path d="M-24 18 L-38 86 L-25 78 L-15 90 L-2 26Z" fill="${color}" opacity=".78"/>
      <path d="M24 18 L38 86 L25 78 L15 90 L2 26Z" fill="${color}" opacity=".9"/>
    </g>
    <polygon points="${pts.join(' ')}" fill="${color}"/>
    <circle r="34" fill="#fffaf2"/>
    <circle r="29" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3"/>
    <text class="fin-rosette-num" y="7" text-anchor="middle">${Math.round(score)}</text>
    <text class="fin-rosette-of" y="21" text-anchor="middle">de 100</text>
  </svg>`;
}

export default {
  id: 'final',
  title: 'Tu remera terminada',
  short: 'Final',
  icon: '🏆',
  scored: false,
  help:
    '<p>¡Terminaste! Mirá tu remera desde todos los ángulos: <b>arrastrá</b> sobre la escena para girar la cámara y usá la <b>rueda</b> (o pellizcá) para acercarte. ' +
    'Con <span class="kbd">F</span> / <span class="kbd">E</span> la ves de frente o de espalda y con <span class="kbd">G</span> la ponés a girar.</p>' +
    '<p>En el informe tocá cada paso para leer qué salió bien y qué mejorar. Descargá una foto, hacé la <b>prueba de lavado</b> (10 lavados simulados: ¿encoge?, ¿se gasta la estampa?) y empezá una remera nueva cuando quieras: queda guardada en tu colección.</p>',
  defaults() {},

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, shirt, audio } = ctx;
    const app = document.getElementById('app');
    const fabric = catalog.fabricById(state.fabric?.id) || catalog.FABRICS[0];
    const thread = catalog.threadById(state.thread?.id);
    const techId = state.print?.technique || state.design?.technique || null;
    const tech = techId ? catalog.techniqueById(techId) : null;
    const colorName = catalog.colorById(state.fabric?.colorId)?.name || (state.fabric?.color ? 'Personalizado' : '—');
    const pattern = ctx.getPattern();
    const runId = state.startedAt || Date.now();

    const grade = globalScore(state, catalog);
    const tier = tierFor(grade);
    const costs = costBreakdown(state, catalog, grade);
    const verdict = clientVerdict(state, catalog, grade, costs.price, costs.total);

    // ---------- Escena ----------
    // La remera tiene que coincidir con el estado (tela, hilo, molde) aunque se entre directo.
    try {
      ctx.updateShirt();
    } catch (e) {
      console.warn(e);
    }
    ctx.placeShirt('exhibicion');
    ensurePrint(ctx);
    world.setShowcase(true);
    ctx.track(() => world.setShowcase(false));
    const neck = world.props.displayStand?.neckAnchor || new ctx.THREE.Vector3(...ctx.stations.exhibicion.shirtNeck);
    const baseY = shirt.group.position.y;
    // Si ya se lavó en esta partida (volviendo al paso), mantiene el encogimiento y el desgaste.
    if (state.wash?.done && state.wash.sx) shirt.setShrink(state.wash.sx, state.wash.sy);

    let ready = false;
    let spinOn = true;
    let rotTween = null;
    let washAnim = null;
    let busy = false;

    ctx.onUpdate((dt) => {
      if (washAnim) return washAnim.step(dt);
      if (rotTween) {
        rotTween.t = Math.min(1, rotTween.t + dt / rotTween.dur);
        shirt.group.rotation.y = lerp(rotTween.from, rotTween.to, easeInOutCubic(rotTween.t));
        if (rotTween.t >= 1) {
          const done = rotTween.done;
          rotTween = null;
          done?.();
        }
        return;
      }
      if (ready && spinOn) shirt.group.rotation.y += dt * 0.32;
    });

    const turnTo = (side, dur = 0.9) =>
      new Promise((resolve) => {
        const th = shirt.group.rotation.y;
        const to = side === 'espalda' ? Math.round((th - Math.PI) / TAU) * TAU + Math.PI : Math.round(th / TAU) * TAU;
        const prev = rotTween;
        rotTween = null;
        prev?.done?.();
        if (Math.abs(to - th) < 1e-3) return resolve();
        rotTween = { from: th, to, t: 0, dur, done: resolve };
      });

    // ---------- Barra de vista (sobre la escena) ----------
    const vb = {};
    const setSpin = (on) => {
      spinOn = on;
      vb.spin?.classList.toggle('on', on);
      if (vb.spin) vb.spin.textContent = on ? '⏸️ Pausar giro' : '🔄 Girar';
    };
    const viewbar = h(
      'div',
      { class: 'fin-viewbar' },
      (vb.front = h('button', { class: 'fin-vb-btn', title: 'Ver de frente (F)', onClick: () => showSide('frente') }, 'Frente')),
      (vb.back = h('button', { class: 'fin-vb-btn', title: 'Ver la espalda (E)', onClick: () => showSide('espalda') }, 'Espalda')),
      (vb.spin = h('button', { class: 'fin-vb-btn on', title: 'Girar la remera (G)', onClick: () => (audio.play('click'), setSpin(!spinOn)) }, '⏸️ Pausar giro')),
      h('span', { class: 'fin-vb-tip' }, 'Arrastrá para mirar · rueda para acercar'),
    );
    app.appendChild(viewbar);
    ctx.track(() => viewbar.remove());
    function showSide(side) {
      if (washAnim) return;
      audio.play('select');
      setSpin(false);
      vb.front.classList.toggle('sel', side === 'frente');
      vb.back.classList.toggle('sel', side === 'espalda');
      turnTo(side);
    }
    ctx.listen(window, 'keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (document.querySelector('.modal-wrap')) return;
      const k = e.key.toLowerCase();
      if (k === 'f') showSide('frente');
      else if (k === 'e' || k === 'b') showSide('espalda');
      else if (k === 'g') setSpin(!spinOn);
    });
    ctx.listen(engine.controls, 'start', () => {
      if (spinOn) setSpin(false);
    });
    ctx.track(() => app.classList.remove('fin-snap'));

    // ---------- Panel ----------
    const expanded = new Set();
    const buildBody = () => {
      const body = h('div', { class: 'fin' });
      // Nota global
      const col = scoreColor(grade);
      body.appendChild(
        h(
          'section',
          { class: 'fin-hero' },
          h('div', { class: 'fin-rosette', html: rosetteSVG(grade, col) }),
          h(
            'div',
            { class: 'fin-hero-text' },
            h('div', { class: 'fin-hero-kicker' }, `${tier.emoji} Veredicto del taller`),
            h('div', { class: 'fin-tier' }, tier.title),
            h('div', { class: 'fin-hero-stars', html: ui.starsHTML(grade) }),
            h('p', { class: 'fin-hero-line' }, tier.line),
          ),
        ),
      );
      // Pedido del cliente
      if (verdict) body.appendChild(clientSection());
      // Paso a paso
      const rows = stepRows(state);
      if (rows.length) {
        const list = h('div', { class: 'fin-steps' });
        for (const r of rows) {
          const notes = h('div', { class: 'fin-step-notes' }, r.notes.length ? h('ul', {}, ...r.notes.map((n) => h('li', { html: n }))) : h('p', {}, 'Sin observaciones.'));
          const open = expanded.has(r.id);
          notes.hidden = !open;
          const btn = h(
            'button',
            {
              class: `fin-step${open ? ' open' : ''}`,
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => {
                const o = notes.hidden;
                notes.hidden = !o;
                btn.classList.toggle('open', o);
                btn.setAttribute('aria-expanded', o ? 'true' : 'false');
                if (o) expanded.add(r.id);
                else expanded.delete(r.id);
                audio.play('click');
              },
            },
            h('span', { class: 'fin-step-icon' }, r.icon),
            h('span', { class: 'fin-step-name' }, r.name),
            h('span', { class: 'fin-step-bar' }, h('i', { style: { width: `${clamp(r.score / 100) * 100}%`, background: scoreColor(r.score) } })),
            h('span', { class: 'fin-step-score' }, Math.round(r.score)),
            h('span', { class: 'fin-step-chev' }, '›'),
          );
          list.appendChild(h('div', { class: 'fin-step-wrap' }, btn, notes));
        }
        body.appendChild(ui.section('Paso a paso · tocá para ver las notas', list));
      }
      body.appendChild(ui.section('Ficha técnica', specTable()));
      body.appendChild(ui.section('Costos y precio', costSection()));
      body.appendChild(ui.section('Prueba de lavado', washSection()));
      const colSec = collectionSection();
      if (colSec) body.appendChild(ui.section('Tu colección', colSec));
      return body;
    };

    function swatch(hex) {
      return h('span', { class: 'fin-sw', style: { background: hex } });
    }

    function specTable() {
      const p = state.pattern || {};
      const rows = [];
      rows.push(['Marca', state.brand || '—']);
      rows.push(['Tela', `${fabric.name} · ${fabric.gsm} g/m²`]);
      rows.push(['Composición', fabric.composition]);
      rows.push(['Color', h('span', { class: 'fin-sw-row' }, swatch(state.fabric?.color || '#fff'), `${colorName}${state.fabric?.heather ? ' jaspeado' : ''}`)]);
      if (thread) rows.push(['Hilo', h('span', { class: 'fin-sw-row' }, swatch(state.thread?.color || '#fff'), `${thread.name}${state.thread?.match === false ? ' (contraste)' : ''}`)]);
      const needle = catalog.NEEDLES.find((n) => n.id === state.thread?.needle);
      const thick = catalog.THREAD_THICKNESS.find((n) => n.id === state.thread?.thickness);
      if (needle || thick) rows.push(['Aguja y grosor', [needle?.name, thick?.name].filter(Boolean).join(' · ')]);
      rows.push(['Talle', p.size || '—']);
      rows.push(['Calce', catalog.fitById(p.fit)?.name || '—']);
      rows.push(['Mangas', catalog.sleeveById(p.sleeve)?.name || '—']);
      rows.push(['Cuello', catalog.neckById(p.neck)?.name || '—']);
      const m = pattern?.measurements;
      if (m) rows.push(['Medidas', `pecho ${Math.round(m.chest)} cm · largo ${Math.round(m.length)} cm`]);
      const pre = state.prewash || {};
      rows.push(['Prelavado', pre.skipped ? 'Salteado ⚠️' : pre.done ? `Sí, ${pre.temp ? pre.temp + ' °C' : 'en frío'}${pre.spin ? ` · ${pre.spin} rpm` : ''}` : '—']);
      if (tech) {
        const d = state.design || {};
        const where = d.side === 'espalda' ? 'espalda' : 'frente';
        const w = d.placement?.width ? ` · ${Math.round(d.placement.width * 100)} cm` : '';
        rows.push(['Estampa', `${tech.icon} ${tech.name}`]);
        rows.push(['Ubicación', `${where}${w}`]);
        const pal = state.print?.palette || state.print?.params?.palette || null;
        const nCol = d.options?.colors || (Array.isArray(pal) ? pal.length : null);
        const tint = d.options?.tint;
        if (Array.isArray(pal) && pal.length) rows.push(['Colores', h('span', { class: 'fin-sw-row' }, ...pal.slice(0, 8).map(swatch), pal.length > 8 ? `+${pal.length - 8}` : '')]);
        else if (tint) rows.push(['Tono', h('span', { class: 'fin-sw-row' }, swatch(tint), tint)]);
        else if (nCol) rows.push(['Colores', `${nCol} ${tech.id === 'bordado' ? 'hilos' : 'tintas'}`]);
        else if (!tech.maxColors) rows.push(['Colores', 'A todo color']);
      } else rows.push(['Estampa', 'Lisa, sin estampa']);
      return ui.propTable(rows);
    }

    function costSection() {
      const wrap = h('div', { class: 'fin-costs' });
      const line = (label, amount, cls = '') => h('div', { class: `fin-cost ${cls}` }, h('span', {}, label), h('b', {}, money(amount)));
      for (const c of costs.materials) wrap.appendChild(line(c.label, c.amount));
      for (const c of costs.estimated) wrap.appendChild(line(c.label, c.amount, 'est'));
      wrap.appendChild(line('Materiales', costs.materialsTotal, 'sub'));
      wrap.appendChild(line(costs.labor.label.replace(/× (\d+)/, (m, n) => `× ${money(+n)}`), costs.labor.amount));
      for (const c of costs.finishing) wrap.appendChild(line(c.label, c.amount));
      wrap.appendChild(line('Costo total', costs.total, 'total'));
      const price = h(
        'div',
        { class: 'fin-price' },
        h('div', {}, h('span', { class: 'fin-price-label' }, 'Precio de venta sugerido'), h('small', {}, `costo × ${costs.markup} × ${costs.factor.toFixed(2)} (según la nota)`)),
        h('b', { class: 'fin-price-num' }, money(costs.price)),
      );
      const out = h('div', {}, wrap, price);
      const profit = costs.price - costs.total;
      if (!verdict) out.appendChild(h('div', { class: `fin-profit ${profit >= 0 ? 'good' : 'bad'}` }, `Ganancia por remera: ${signed(profit)} (${Math.round((profit / Math.max(1, costs.price)) * 100)}% del precio)`));
      return out;
    }

    function clientSection() {
      const o = state.order;
      const sec = h('section', { class: `fin-client mood-${verdict.mood}` });
      sec.appendChild(
        h(
          'div',
          { class: 'fin-client-head' },
          h('span', { class: 'fin-client-avatar' }, o.avatar || '🙂'),
          h('div', { class: 'fin-client-who' }, h('span', { class: 'fin-client-kicker' }, 'Entrega del pedido'), h('b', {}, o.name)),
          h('span', { class: 'fin-client-mood' }, `${verdict.face} ${verdict.mood[0].toUpperCase() + verdict.mood.slice(1)}`),
        ),
      );
      sec.appendChild(h('blockquote', { class: 'fin-client-quote' }, `“${verdict.lines.join(' ')}”`));
      const ul = h('ul', { class: 'fin-check' });
      for (const c of verdict.checks) {
        ul.appendChild(h('li', { class: c.ok ? 'ok' : 'no' }, h('span', { class: 'fin-check-mark' }, c.ok ? '✓' : '✗'), h('span', {}, `${c.icon} ${c.label}`), !c.ok ? h('small', {}, `entregaste: ${c.got}`) : null));
      }
      if (!verdict.checks.length) ul.appendChild(h('li', { class: 'ok' }, h('span', { class: 'fin-check-mark' }, '✓'), h('span', {}, 'Todo a criterio del taller')));
      sec.appendChild(ul);
      if (verdict.budget) {
        const rentable = verdict.profit >= 0;
        sec.appendChild(
          h(
            'div',
            { class: `fin-budget ${rentable ? 'ok' : 'no'}` },
            h('div', {}, h('small', {}, 'Presupuesto'), h('b', {}, money(verdict.budget))),
            h('div', {}, h('small', {}, 'Tu costo'), h('b', {}, money(costs.total))),
            h('div', {}, h('small', {}, 'Vale'), h('b', {}, money(costs.price))),
          ),
        );
      }
      sec.appendChild(h('div', { class: `fin-pay ${verdict.profit >= 0 ? 'good' : 'bad'}` }, h('span', {}, verdict.how), h('b', {}, `Cobrás ${money(verdict.pays)} · ganancia ${signed(verdict.profit)}`)));
      for (const a of verdict.advice) sec.appendChild(h('p', { class: 'fin-advice' }, `💡 ${a}`));
      return sec;
    }

    function washSection() {
      const w = state.wash;
      if (!w?.done) {
        return h(
          'div',
          { class: 'fin-wash-cta' },
          h('p', {}, 'Simulá 10 lavados a máquina para ver si la remera encoge, si la estampa se gasta y si las costuras aguantan.'),
          h('button', { class: 'btn btn-secondary btn-sm', onClick: () => runWash() }, '🧺 Hacer la prueba de lavado'),
        );
      }
      return washSummary(w, false);
    }

    function washSummary(w, big) {
      const shrinkCls = w.shrink < 0.012 ? 'good' : w.shrink < 0.03 ? 'warn' : 'bad';
      const printCls = !w.technique ? 'good' : w.fade < 0.12 && w.crack < 0.12 ? 'good' : w.crack < 0.3 ? 'warn' : 'bad';
      const seamCls = w.seamRisk < 0.15 ? 'good' : w.seamRisk < 0.45 ? 'warn' : 'bad';
      const items = [
        {
          cls: shrinkCls,
          icon: '📏',
          title: 'Encogimiento',
          value: w.shrink < 0.004 ? 'Casi nada' : `−${w.lengthLoss.toFixed(1)} cm de largo · −${(w.chestLoss * 2).toFixed(1)} cm de contorno`,
          note: w.shrinkNote + (w.sizeDown ? ` Ahora calza como talle ${w.sizeDown}.` : ''),
        },
        {
          cls: printCls,
          icon: '🎨',
          title: 'Estampa',
          value: w.technique ? `Conserva ${Math.round(w.colorKept * 100)}% del color${w.crack > 0.05 ? ` · grietas ${w.crack > 0.3 ? 'marcadas' : 'leves'}` : ''}` : 'Sin estampa',
          note: w.printNote,
        },
        { cls: seamCls, icon: '🧵', title: 'Costuras', value: w.seamRisk < 0.15 ? 'Firmes' : w.seamRisk < 0.45 ? 'Alguna cedió' : 'Se abrieron', note: w.seamNote },
      ];
      const ul = h('ul', { class: `fin-wash-list${big ? ' big' : ''}` });
      for (const it of items) ul.appendChild(h('li', { class: it.cls }, h('span', { class: 'fin-wash-icon' }, it.icon), h('div', {}, h('b', {}, it.title), h('span', { class: 'fin-wash-val' }, it.value), h('small', {}, it.note))));
      const head = h('div', { class: `fin-wash-head ${w.score >= 68 ? 'good' : w.score >= 50 ? 'warn' : 'bad'}` }, h('span', {}, `🧺 ${w.verdict}`), h('b', {}, `${w.score}/100`));
      return h('div', { class: 'fin-wash-sum' }, head, ul, big ? h('div', { class: 'fin-wash-tips' }, ...w.tips.map((t) => h('p', { html: `💡 ${t}` }))) : null);
    }

    function collectionSection() {
      const list = loadCollection();
      if (!list.length) return null;
      const row = h('div', { class: 'col-strip' });
      for (const it of list.slice(0, 12)) {
        const cur = it.id === runId;
        row.appendChild(
          h(
            'button',
            {
              class: `col-thumb${cur ? ' current' : ''}`,
              title: `${it.tier || ''} · ${Math.round(it.score)}/100`,
              onClick: () => {
                audio.play('click');
                showCollectionItem(ui, h, it, {
                  onRemove: cur
                    ? null
                    : (x) => {
                        removeShirt(x.id);
                        refresh();
                      },
                });
              },
            },
            it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('span', { class: 'col-thumb-empty' }, '👕'),
            h('span', { class: 'col-thumb-score', style: { background: scoreColor(it.score) } }, Math.round(it.score)),
            cur ? h('span', { class: 'col-thumb-new' }, 'Nueva') : null,
          ),
        );
      }
      return h('div', {}, row, h('p', { class: 'col-caption' }, `${list.length} ${list.length === 1 ? 'remera guardada' : 'remeras guardadas'} en este navegador (máx. 12).`));
    }

    const refresh = () => {
      if (!ctx.alive) return;
      const bodyEl = document.getElementById('panel-body');
      const top = bodyEl?.scrollTop || 0;
      ui.setBody(buildBody());
      if (bodyEl) bodyEl.scrollTop = top;
    };

    const washed = () => !!state.wash?.done;
    ui.panel({
      kicker: 'Final · Exhibición',
      title: this.title,
      subtitle: `<b>${esc(state.brand || 'Tu marca')}</b> · ${esc(fabric.short)} ${esc(colorName.toLowerCase())}${tech ? ' · ' + esc(tech.name) : ''}`,
      wide: true,
      body: buildBody(),
      actions: [
        { id: 'photo', label: '📸 Descargar foto', kind: 'secondary', onClick: () => takePhoto() },
        { id: 'wash', label: washed() ? '🧺 Lavada ✓' : '🧺 Prueba de lavado', kind: 'secondary', disabled: washed(), onClick: () => runWash() },
        { id: 'new', label: '🔁 Nueva remera', kind: 'primary', onClick: () => ctx.restart() },
      ],
    });
    ui.action('new')?.classList.add('fin-btn-wide');
    for (const id of ['photo', 'wash', 'new']) ui.action(id)?.classList.add('fin-btn');

    // ---------- Foto ----------
    const sleep = (ms) => new Promise((r) => ctx.timeout(r, ms));
    async function takePhoto() {
      if (busy || !ctx.alive) return;
      busy = true;
      app.classList.add('fin-snap');
      await sleep(320);
      audio.play('camera');
      let ok = true;
      try {
        const c = polaroidCanvas(engine, shirt, {
          title: state.brand || 'Mi Taller',
          line1: `${tier.title} · ${'★'.repeat(Math.round((grade / 100) * 5))}${'☆'.repeat(5 - Math.round((grade / 100) * 5))}`,
          line2: `${fabric.short} ${colorName.toLowerCase()} · talle ${state.pattern?.size || 'M'}${tech ? ' · ' + tech.name : ''}`,
          stamp: `${new Date().toLocaleDateString('es-AR')} · Taller de Remeras 3D`,
          score: grade,
        });
        const url = c.toDataURL('image/jpeg', 0.92);
        const slug = (state.brand || 'remera').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'remera';
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        downloadDataURL(url, `remera-${slug}-${stamp}.jpg`);
        window.__tallerLastPhoto = { width: c.width, height: c.height, bytes: url.length };
      } catch (e) {
        ok = false;
        console.error(e);
      }
      const flash = h('div', { class: 'fin-flash' });
      app.appendChild(flash);
      ctx.track(() => flash.remove());
      ctx.timeout(() => flash.remove(), 900);
      await sleep(520);
      app.classList.remove('fin-snap');
      busy = false;
      ui.toast(ok ? '📸 ¡Foto descargada! Buscala en tus descargas.' : 'No se pudo generar la foto.', ok ? 'good' : 'bad', 3200);
    }

    // ---------- Prueba de lavado ----------
    let rumble = null;
    const stopRumble = () => {
      if (rumble) {
        rumble.stop();
        rumble = null;
      }
    };
    ctx.track(stopRumble);

    async function runWash() {
      if (busy || washed() || !ctx.alive) return;
      busy = true;
      ui.enableAction('wash', false);
      ui.enableAction('photo', false);
      ui.enableAction('new', false);
      for (const b of document.querySelectorAll('.fin-wash-cta button')) b.disabled = true;
      setSpin(false);
      vb.front.classList.remove('sel');
      vb.back.classList.remove('sel');
      const res = computeWash(state, catalog, pattern);
      // encuadre fijo para el antes / después
      engine.setOrbit({ enabled: false });
      view = viewFor();
      await Promise.all([ctx.flyTo(view, 0.8), turnTo('frente', 0.8)]);
      if (!ctx.alive) return;
      const rect = {};
      let before = null;
      let hemPx = null;
      try {
        before = captureShirt(engine, shirt, { aspect: 4 / 5, margin: 0.14, maxSide: 360, rectOut: rect });
        const hemG = Math.min(...(pattern?.silhouette?.front?.outline || [{ y: -0.72 }]).map((p) => p.y));
        hemPx = projectGarmentPoint(engine, shirt, 0, hemG, 0.1).y;
      } catch (e) {
        console.warn(e);
      }

      viewbar.classList.add('off');
      ctx.track(() => viewbar.classList.remove('off'));
      const water = h('div', { class: 'fin-water' });
      app.appendChild(water);
      ctx.track(() => water.remove());
      requestAnimationFrame(() => water.classList.add('show'));
      const hud = ui.hud(
        h(
          'div',
          { class: 'fin-wash-hud' },
          h('div', { class: 'hud-title' }, '🧺 Prueba de lavado'),
          h('div', { class: 'hud-big fin-wash-count' }, 'Lavado 1/10'),
          h('div', { class: 'fin-wash-phase' }, `Lavado · ${res.temp} °C`),
        ),
      );
      const countEl = hud.querySelector('.fin-wash-count');
      const phaseEl = hud.querySelector('.fin-wash-phase');
      const meter = ui.meter({ value: 0, text: '' });
      hud.querySelector('.fin-wash-hud').appendChild(meter);

      const fx = createWashFx({ center: new ctx.THREE.Vector3(neck.x, 0, neck.z) });
      ctx.add(fx.group);
      ctx.track(() => fx.dispose());
      audio.play('splash');
      rumble = audio.loop('rumble');

      const th0 = shirt.group.rotation.y;
      const turns = 4;
      const T = { lift: 0.7, spin0: 0.45, spin1: 4.1, down0: 4.35, down1: 5.25, end: 5.9 };
      const length = (pattern?.measurements?.length || 72) / 100;
      let lastCount = 0;
      let popped = 0;
      await new Promise((resolve) => {
        let t = 0;
        washAnim = {
          step(dt) {
            t += dt;
            const lift = easeInOutCubic(clamp(t / T.lift)) * (1 - easeInOutCubic(clamp((t - T.down0) / (T.down1 - T.down0))));
            shirt.group.position.y = baseY + 0.1 * lift;
            const u = clamp((t - T.spin0) / (T.spin1 - T.spin0));
            const th = th0 + turns * TAU * easeInOutCubic(u);
            const prevTh = shirt.group.rotation.y;
            shirt.group.rotation.y = th;
            const omega = dt > 0 ? (th - prevTh) / dt : 0;
            const inten = Math.sin(Math.PI * u);
            shirt.group.rotation.z = 0.05 * Math.sin(t * 8.5) * inten;
            shirt.group.rotation.x = 0.035 * Math.sin(t * 6.1 + 1) * inten;
            const sk = easeInOutCubic(clamp((t - 1.0) / 2.8));
            shirt.setShrink(lerp(1, res.sx, sk), lerp(1, res.sy, sk));
            const pop = clamp((t - T.spin1) / 1.3);
            fx.update(dt, engine.camera, {
              bubbles: clamp(t / 0.6),
              swirl: omega,
              pop,
              drip: t > T.spin1 - 0.2 && t < T.end - 0.3 ? 1 : 0,
              hemY: shirt.group.position.y - length * res.sy + 0.02,
              floorY: 0.14,
            });
            const nPop = Math.floor(pop * 6);
            if (nPop > popped) {
              popped = nPop;
              audio.play('pop');
            }
            rumble?.set(0.25 + 0.6 * inten, 260 + 500 * inten);
            const n = 1 + Math.min(9, Math.floor(clamp((t - 0.4) / 3.9) * 10));
            if (n !== lastCount) {
              lastCount = n;
              countEl.textContent = `Lavado ${n}/10`;
            }
            phaseEl.textContent =
              t < 1.7 ? `Lavado · ${res.temp} °C` : t < 2.7 ? 'Enjuague' : t < T.spin1 ? 'Centrifugado · 800 rpm' : 'Escurrido y secado a la sombra';
            meter.set(clamp(t / T.end), '');
            if (t >= T.end) {
              shirt.group.position.y = baseY;
              shirt.group.rotation.set(0, Math.round(shirt.group.rotation.y / TAU) * TAU, 0);
              washAnim = null;
              resolve();
            }
          },
        };
      });
      if (!ctx.alive) return;
      stopRumble();
      ctx.scene.remove(fx.group);
      water.classList.remove('show');
      viewbar.classList.remove('off');
      ctx.timeout(() => water.remove(), 700);
      ui.hud(null);
      shirt.setShrink(res.sx, res.sy);
      if (res.technique && (res.fade > 0 || res.crack > 0)) shirt.setPrintWear({ fade: res.fade, crack: res.crack });
      state.wash = res;
      let after = null;
      try {
        after = captureShirt(engine, shirt, { aspect: 4 / 5, maxSide: 360, rect });
        if (hemPx != null && res.shrink > 0.008) markLine(after, ((hemPx - rect.sy) * after.height) / rect.ch, 'ruedo original');
      } catch (e) {
        console.warn(e);
      }
      updateShirtEntry(runId, { wash: `${res.verdict} (${res.score}/100)` });
      audio.play(res.score >= 60 ? 'good' : 'bad');
      ui.updateAction('wash', { label: '🧺 Lavada ✓', disabled: true });
      ui.enableAction('photo', true);
      ui.enableAction('new', true);
      refresh();
      engine.setOrbit(orbitOpts());
      busy = false;
      const ba =
        before && after
          ? h(
              'div',
              { class: 'fin-ba' },
              h('figure', {}, h('img', { src: before.toDataURL('image/jpeg', 0.88), alt: 'Antes' }), h('figcaption', {}, 'Recién hecha')),
              h('span', { class: 'fin-ba-arrow' }, '→'),
              h('figure', {}, h('img', { src: after.toDataURL('image/jpeg', 0.88), alt: 'Después' }), h('figcaption', {}, 'Después de 10 lavados')),
            )
          : null;
      await ui.modal({ title: 'Resultado de la prueba de lavado', wide: true, body: h('div', { class: 'fin-wash-modal' }, ba, washSummary(res, true)), actions: [{ id: 'ok', label: 'Ver la remera', kind: 'primary' }] });
    }

    // ---------- Cámara y llegada ----------
    // Distancia según el tamaño de la remera y el área libre de pantalla (el panel tapa una parte):
    // en un celular vertical hace falta alejarse bastante más que en una pantalla ancha.
    const viewFor = () => {
      const sil = pattern?.silhouette?.front?.outline || [];
      const xs = sil.map((p) => p.x);
      const ys = sil.map((p) => p.y);
      const sw = xs.length ? Math.max(...xs) - Math.min(...xs) : 0.8;
      const sh = ys.length ? Math.max(...ys) - Math.min(...ys) + 0.08 : 0.8;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const panel = document.getElementById('panel');
      const mobile = window.matchMedia('(max-width: 820px)').matches;
      const freeW = mobile ? W : W - ((panel?.offsetWidth || 440) + 24);
      const freeH = mobile ? H - Math.min(panel?.offsetHeight || H * 0.48, H * 0.48) : H;
      const tv = Math.tan(((engine.camera.fov || 45) * Math.PI) / 360) * 2;
      const dH = sh / ((mobile ? 0.68 : 0.46) * tv * (freeH / H));
      const dW = sw / (0.7 * tv * (freeW / H));
      const d = clamp(Math.max(dH, dW), 1.7, 4.2);
      const t = VIEW.target;
      const dir = [VIEW.position[0] - t[0], VIEW.position[1] - t[1], VIEW.position[2] - t[2]];
      const len = Math.hypot(...dir);
      return { position: dir.map((v, i) => t[i] + (v / len) * d), target: t, distance: d };
    };
    let view = viewFor();
    const orbitOpts = () => ({
      enabled: true,
      target: VIEW.target,
      minDistance: 0.85,
      maxDistance: Math.max(3.4, view.distance + 0.9),
      minPolarAngle: Math.PI * 0.28,
      maxPolarAngle: Math.PI * 0.6,
      minAzimuthAngle: -1.25,
      maxAzimuthAngle: 1.25,
      enablePan: false,
      enableZoom: true,
    });
    await ctx.flyTo(view, 1.6);
    if (!ctx.alive) return;
    engine.setOrbit(orbitOpts());
    // miniatura para la colección (de frente, apenas llega la cámara)
    await sleep(120);
    if (!ctx.alive) return;
    try {
      const thumb = thumbnailDataURL(engine, shirt, 256);
      upsertShirt({
        id: runId,
        date: Date.now(),
        thumb,
        score: Math.round(grade),
        tier: tier.title,
        brand: state.brand || '',
        fabric: fabric.short,
        colorHex: state.fabric?.color,
        colorName,
        technique: tech ? tech.name : null,
        pattern: `${state.pattern?.size || 'M'} · ${catalog.fitById(state.pattern?.fit)?.name || ''} · ${catalog.sleeveById(state.pattern?.sleeve)?.name || ''}`,
        mode: state.mode,
        client: state.order?.name || null,
        clientAvatar: state.order?.avatar || null,
        wash: state.wash?.done ? `${state.wash.verdict} (${state.wash.score}/100)` : null,
      });
      refresh();
    } catch (e) {
      console.warn('colección', e);
    }
    ready = true;
    if (grade >= 80) {
      audio.play('fanfare');
      confetti(ctx, app, h);
    } else audio.play(grade >= 55 ? 'good' : 'bad');
    if (verdict) ui.toast(`${state.order.avatar || ''} ${state.order.name}: ${verdict.face} ${verdict.lines[0]}`, verdict.level === 2 ? 'good' : verdict.level === 1 ? 'warn' : 'bad', 4200);
  },
};

// Si el estado tiene un diseño pero la remera no muestra la estampa (p. ej. entrando directo
// con ?step=final), la procesa y la aplica.
function ensurePrint(ctx) {
  const { state, shirt, catalog } = ctx;
  const d = state.design;
  if (!d || !d.source || !shirt.setPrint) return;
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
    console.warn('No se pudo aplicar la estampa', e);
  }
}

function confetti(ctx, app, h) {
  const colors = ['#d2553f', '#2f6f6a', '#d9a43b', '#3c8a4f', '#f0a9c4', '#93c6e6', '#fff8ef'];
  const box = h('div', { class: 'fin-confetti', 'aria-hidden': 'true' });
  for (let i = 0; i < 110; i++) {
    const kind = i % 9 === 0 ? 'button' : i % 4 === 0 ? 'round' : 'rect';
    const p = h('i', { class: `fin-cf ${kind}` });
    const dur = 2.8 + Math.random() * 2.6;
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = kind === 'button' ? '' : colors[i % colors.length];
    p.style.setProperty('--c', colors[(i * 3) % colors.length]);
    p.style.animationDuration = `${dur}s, ${0.8 + Math.random() * 1.4}s`;
    p.style.animationDelay = `${Math.random() * 1.2}s, 0s`;
    p.style.setProperty('--x', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--r', `${(Math.random() - 0.5) * 1080}deg`);
    box.appendChild(p);
  }
  app.appendChild(box);
  ctx.track(() => box.remove());
  ctx.timeout(() => box.remove(), 7500);
}
