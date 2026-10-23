// Paso 10 · Estampar: se aplica de verdad el diseño elegido en el paso anterior. Según la
// técnica (`technique.process`) hay cuatro mini-juegos:
//   press       → prensa térmica (vinilo, DTF, sublimación, glitter, foil): programar, prensar a
//                 tiempo y despegar en caliente o en frío.
//   screen      → serigrafía / puff: una pasada de racleta por tinta, flash entre tintas y curado.
//   embroidery  → bordadora: estabilizador, enmarcar en el bastidor, bordar color por color.
//   paint       → pintura a mano: secado al aire y fijado con plancha.
// Al final la estampa se procesa con la calidad lograda (y sus defectos) y queda en la remera.

import { processPrint } from '../print/printEngine.js';
import { designInfo, printOptions, clampDefects, emptyDefects, qualityScore, resultThumb, surfacePoint, savePose, restorePose, nextFrame, fmt, trackFocusSource } from './estampar/common.js';
import { runPress } from './estampar/press.js';
import { runScreen } from './estampar/screen.js';
import { runEmbroidery } from './estampar/embroidery.js';
import { runPaint } from './estampar/paint.js';

const RUNNERS = { press: runPress, screen: runScreen, embroidery: runEmbroidery, paint: runPaint };

export default {
  id: 'estampar',
  title: 'Estampar',
  short: 'Estampado',
  icon: '🖨️',
  scored: true,
  help: `<p>Ahora el diseño pasa a la remera de verdad. El mini-juego depende de la técnica que elegiste:</p>
<ul>
<li><b>Prensa térmica</b> (vinilo, DTF, sublimación, glitter, foil): programá temperatura, tiempo y presión según la ficha del material, bajá la prensa (arrastrando la manija, tocándola o con <span class="kbd">Espacio</span>), abrila cuando suene la alarma y despegá el film arrastrando la esquina: <b>en caliente</b> (apenas abrís, tenés unos segundos) o <b>en frío</b> (esperá a que la barra del transfer llegue a la zona fría), según la ficha.</li>
<li><b>Serigrafía y puff</b>: una pasada por tinta. Arrastrá la racleta hacia vos sobre el shablón con velocidad pareja (con teclado: <span class="kbd">↓</span> la empuja y acelera, soltala con la aguja en verde y <span class="kbd">↑</span> frena); flasheá entre tintas soltando en la zona verde y curá con la temperatura y el tiempo de la tinta.</li>
<li><b>Bordado</b>: elegí el estabilizador, centrá el bastidor sobre la cruz de tiza (arrastrando, <span class="kbd">←</span><span class="kbd">→</span><span class="kbd">↑</span><span class="kbd">↓</span>, rotá con <span class="kbd">Q</span>/<span class="kbd">E</span>), ajustá el tornillo (mantener) y cambiá el hilo cuando la bordadora lo pida.</li>
<li><b>Pintura a mano</b>: dejá secar (mantené <span class="kbd">Espacio</span> para adelantar el reloj) y fijá con la plancha por encima de un papel protector, pasándola por todo el dibujo.</li>
</ul>`,

  // Estampa con calidad 0.8 (y la deja en la remera, para que los pasos siguientes la muestren).
  defaults(state, ctx) {
    const catalog = ctx.catalog;
    const info = designInfo(state, catalog);
    state.print = {
      technique: info.tech.id,
      quality: 0.8,
      params: {},
      defects: emptyDefects(),
      cured: true,
      process: info.tech.process,
      side: info.side,
      placement: { ...info.placement },
      auto: true,
    };
    if (!info.d?.source || !ctx.shirt?.setPrint) return;
    try {
      const res = processPrint(info.d.source, info.tech.id, printOptions(info, { quality: 0.8, resolution: 512 }));
      ctx.shirt.setPrint(info.side, res, info.placement);
      if (ctx.shirt.hasPrint?.(info.other)) ctx.shirt.setPrint(info.other, null);
      state.print.params = { ...res.params };
      state.print.palette = [...(res.palette || [])];
      state.print.coverage = res.coverage;
    } catch (e) {
      console.warn('estampar: no se pudo procesar la estampa por defecto', e);
    }
  },

  async enter(ctx) {
    const { ui, h, state, catalog, world, engine, THREE, audio } = ctx;
    const step = this;
    const info = designInfo(state, catalog);
    const shirt = ctx.shirt;
    const isMobile = () => window.matchMedia('(max-width: 820px)').matches;
    const app = document.getElementById('app');
    app.classList.add('est-on');
    ctx.track(() => app.classList.remove('est-on'));
    ui.panelEl?.classList.add('est-step');
    // los atajos de teclado siguen andando aunque haya quedado el foco en un botón tocado con el mouse
    trackFocusSource(ctx);
    ctx.track(() => ui.panelEl?.classList.remove('est-step'));
    ctx.track(() => {
      engine.canvas.style.cursor = '';
      // algunas vistas del paso usan un fov más cerrado: el siguiente paso arranca con el normal
      if (engine.camera.fov !== 45) {
        engine.camera.fov = 45;
        engine.camera.updateProjectionMatrix();
      }
    });

    // la remera llega lisa del paso Diseño; preparada con tela/hilo/molde actuales
    ctx.updateShirt();
    shirt.setPrint('frente', null);
    shirt.setPrint('espalda', null);

    // ---------- sin diseño (no debería pasar): se sigue sin estampa ----------
    if (!info.d || !info.d.source) {
      ctx.placeShirt('exhibicion');
      ctx.flyTo(ctx.stations.estampado.view);
      ui.panel({
        kicker: 'Paso 10 · Estación de estampado',
        title: 'Estampar',
        subtitle: 'No hay un diseño para estampar.',
        body: ui.note('Volvé al paso Diseño para elegir una imagen. Por ahora la remera sigue lisa.', 'warn'),
        actions: [{ id: 'next', label: 'Continuar sin estampa →', kind: 'primary', onClick: () => ctx.complete({ score: 60, notes: ['La remera quedó lisa: no había diseño para estampar.'] }) }],
      });
      return;
    }

    // ---------- kit compartido por los mini-juegos ----------
    const poses = [];
    const kit = {
      ctx,
      info,
      ui,
      h,
      audio,
      THREE,
      world,
      shirt,
      engine,
      state,
      catalog,
      step,
      isMobile,
      test: {},
      kicker: 'Paso 10 · Estación de estampado',
      timeScale: 1,
      // guarda la pose de una prop y la restaura al salir del paso
      keepPose(obj) {
        if (!obj || poses.some((p) => p.obj === obj)) return;
        const p = savePose(obj);
        poses.push(p);
        ctx.track(() => restorePose(p));
      },
      wait(ms) {
        return new Promise((r) => ctx.timeout(r, ms));
      },
      // Barra de etapas del mini-juego (1 · 2 · 3…)
      stepsBar(labels) {
        const items = labels.map((l, i) => h('li', { class: 'est-stage' }, h('span', { class: 'est-stage-n' }, String(i + 1)), h('span', { class: 'est-stage-l' }, l)));
        const el = h('ol', { class: 'est-stages' }, ...items);
        el.set = (cur) => {
          items.forEach((it, i) => {
            it.classList.toggle('done', i < cur);
            it.classList.toggle('current', i === cur);
          });
        };
        el.set(0);
        return el;
      },
      // Punto del mundo en el centro de la estampa (y su normal)
      printPoint(offset = 0, at = null) {
        const c = at || info.placement;
        return surfacePoint(shirt, info.side, c.x, c.y, offset);
      },
      // Vista de cerca de la estampa para el final
      closeView(dist = 0.5, at = null) {
        const { p, n } = kit.printPoint(0, at);
        const toward = kit.closeDir ? kit.closeDir.clone() : new THREE.Vector3(0, 0, 1);
        // con relieve alto (puff, bordado) una luz/vista más rasante lo muestra mejor
        const low = (info.tech.relief || 0) >= 1;
        const pos = p.clone().addScaledVector(n, dist * (low ? 0.58 : 0.78)).addScaledVector(toward, dist * (low ? 0.84 : 0.62));
        if (isMobile()) pos.addScaledVector(n, dist * 0.6).addScaledVector(toward, dist * 0.3);
        return { position: pos.toArray(), target: p.toArray(), fov: 45 };
      },
      // Guarda el resultado, acerca la cámara y muestra la tarjeta.
      async finish({ quality, defects, notes, result, settings = {}, placement = null, tags = [] }) {
        const score = qualityScore(quality);
        const pl = placement || info.placement;
        state.print = {
          technique: info.tech.id,
          quality: Math.round(quality * 1000) / 1000,
          params: { ...(result?.params || {}) },
          defects: clampDefects(defects || {}),
          cured: true,
          process: info.tech.process,
          side: info.side,
          placement: { ...pl },
          palette: [...(result?.palette || [])],
          coverage: result?.coverage ?? null,
          settings,
        };
        ui.hint(null);
        ui.hud(null);
        ui.setActions([]);
        engine.setOrbit({ enabled: false });
        await ctx.flyTo(kit.closeView(Math.max(0.55, (pl.width || 0.26) * 2.5), pl), 1.1);
        if (!ctx.alive) return;
        await kit.wait(500);
        if (!ctx.alive) return;
        const extra = h(
          'div',
          { class: 'est-res' },
          result ? resultThumb(result, info.fabricHex) : null,
          h(
            'div',
            { class: 'est-res-meta' },
            h('b', {}, `${info.tech.icon} ${info.tech.name}`),
            h('span', {}, `${info.d.sourceName || 'Diseño'} · ${info.side}`),
            tags.length ? h('div', { class: 'est-res-tags' }, ...tags.map((t) => h('span', { class: 'est-tag' }, t))) : null,
          ),
        );
        await ctx.complete({ score, notes, extra });
      },
      async process(quality, defects, extra = {}) {
        ui.hint('✨ Revelando la estampa…');
        await nextFrame();
        await nextFrame();
        try {
          return processPrint(info.d.source, info.tech.id, printOptions(info, { quality, defects: clampDefects(defects), ...extra }));
        } finally {
          ui.hint(null);
        }
      },
      fmt,
    };
    step._test = kit.test;
    ctx.track(() => {
      if (step._test === kit.test) delete step._test;
    });

    const run = RUNNERS[info.tech.process] || runScreen;
    try {
      await run(kit);
    } catch (e) {
      console.error(e);
      if (ctx.alive) {
        ui.toast('Algo falló en la máquina: el taller lo terminó por vos.', 'bad', 4000);
        ctx.complete({ score: 70, notes: ['El estampado se terminó en automático por un problema técnico.'] });
      }
    }
  },

  exit() {
    delete this._test;
  },
};
