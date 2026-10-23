// Paso: Bienvenida. Pantalla de título sobre el taller 3D (la cámara lo recorre despacio),
// nombre de la marca, elección de modo (taller libre o pedido de un cliente), la lista de
// pasos del proceso y la colección de remeras terminadas.

import { clamp, lerp, money, easeInOutCubic } from '../core/utils.js';
import { processPrint, renderPreset } from '../print/printEngine.js';
import { PROCESS } from './final/process.js';
import { loadCollection, removeShirt, showCollectionItem } from './final/collection.js';
import { tapeSVG, stitchSVG, buttonSVG, stringSVG } from './inicio/decor.js';

const LS_BRAND = 'taller:marca';
const LS_LAST = 'taller:ultimoCliente';
const LS_MODE = 'taller:modo';
const lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch (e) {
    /* sin storage */
  }
};

// Remeras "de muestra" que se lucen en el soporte mientras está la pantalla de título.
const TEASERS = [
  { color: '#1f2a46', preset: 'ola', colors: 3 },
  { color: '#8fd0b8', preset: 'monstera', colors: 3 },
  { color: '#cf9a2c', preset: 'tijera', colors: 2 },
  { color: '#2f5cb6', preset: 'sol_montanas', colors: 4 },
  { color: '#6a1f2c', preset: 'calavera', colors: 4 },
  { color: '#e5732b', preset: 'retro', colors: 4 },
  { color: '#4d5426', preset: 'mate', colors: 3 },
];

const SCORE_COL = (s) => (s >= 85 ? '#3c8a4f' : s >= 70 ? '#2f6f6a' : s >= 55 ? '#d9a43b' : s >= 40 ? '#e08a3c' : '#c0392b');

export default {
  id: 'inicio',
  title: 'Bienvenida',
  short: 'Inicio',
  icon: '🏠',
  scored: false,
  help:
    '<p>Escribí el nombre de tu <b>marca</b> (va a aparecer bordado en la etiqueta del cuello) y elegí cómo jugar:</p>' +
    '<ul><li><b>Taller libre</b>: hacés la remera que quieras, a tu gusto.</li>' +
    '<li><b>Pedidos de clientes</b>: un cliente te pide algo concreto (tela, color, talle, estampa) y un presupuesto. Si cumplís, ¡queda chocho!</li></ul>' +
    '<p>Después vas a recorrer el taller paso a paso: tela, hilo, molde, prelavado, tizado, corte, costura, planchado, diseño, estampa y terminaciones.</p>',

  defaults(state) {
    state.mode = 'libre';
    state.order = null;
    const b = lsGet(LS_BRAND);
    if (b && b.trim()) state.brand = b.trim();
  },

  async enter(ctx) {
    const { ui, h, state, catalog, engine, shirt, world, audio, THREE } = ctx;
    const app = document.getElementById('app');
    ui.hidePanel();
    ui.hint(null);
    ui.hud(null);
    app.classList.add('ini-on');
    ctx.track(() => app.classList.remove('ini-on'));

    // ---------- Remera de muestra en el soporte de exhibición ----------
    const teaser = TEASERS[Math.floor(Math.random() * TEASERS.length)];
    const neck = world.props.displayStand?.neckAnchor || new THREE.Vector3(...ctx.stations.exhibicion.shirtNeck);
    shirt.group.visible = false;
    let teaserOn = false;
    const restoreShirt = () => {
      if (!teaserOn) return;
      teaserOn = false;
      shirt.setPrint('frente', null);
      shirt.setPrint('espalda', null);
      ctx.updateShirt();
    };
    ctx.track(restoreShirt);
    ctx.track(() => world.props.displayStand?.setOn(false));
    ctx.timeout(() => {
      try {
        teaserOn = true;
        shirt.setFabric(catalog.fabricById('algodon_peinado'), teaser.color, false);
        shirt.setThreadColor(teaser.color);
        ctx.placeShirt('exhibicion');
        const res = processPrint(renderPreset(teaser.preset, 512), 'serigrafia', {
          fabricId: 'algodon_peinado',
          fabricColor: teaser.color,
          colors: teaser.colors,
          resolution: 384,
          widthM: 0.25,
        });
        shirt.setPrint('frente', res, { x: 0, y: -0.2, width: 0.25, rotation: 0 });
        shirt.group.rotation.y = -0.5;
        world.props.displayStand?.setOn(true);
      } catch (e) {
        console.warn('remera de muestra', e);
        restoreShirt();
        ctx.placeShirt('exhibicion');
      }
    }, 60);

    // ---------- Pantalla de título ----------
    let brand = (lsGet(LS_BRAND) || state.brand || '').trim();
    if (brand === 'Mi Taller') brand = '';
    let mode = lsGet(LS_MODE) === 'pedido' ? 'pedido' : 'libre';
    let client = null;

    const labelText = h('span', { class: 'ini-label-text' });
    const renderLabel = () => {
      const b = brand || 'Mi Taller';
      labelText.textContent = b.toUpperCase();
      labelText.classList.toggle('long', b.length > 14);
    };
    const input = h('input', {
      class: 'ini-input',
      type: 'text',
      maxlength: '24',
      placeholder: 'Mi Taller',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Nombre de tu marca',
      onInput: (e) => {
        brand = e.target.value.replace(/\s+/g, ' ').trimStart();
        state.brand = brand.trim() || 'Mi Taller';
        lsSet(LS_BRAND, brand.trim());
        renderLabel();
      },
      onKeydown: (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          start();
        }
      },
    });
    input.value = brand;
    state.brand = brand || 'Mi Taller';
    renderLabel();

    const modeCards = {};
    const cta = h('button', { class: 'ini-cta', onClick: () => start() });
    const renderMode = () => {
      for (const [id, el] of Object.entries(modeCards)) {
        el.classList.toggle('sel', id === mode);
        el.setAttribute('aria-checked', id === mode ? 'true' : 'false');
      }
      cta.innerHTML = mode === 'libre' ? '<span>Abrir el taller</span><b>→</b>' : '<span>Ver el pedido</span><b>→</b>';
    };
    const modeCard = (id, icon, title, text, tag) =>
      (modeCards[id] = h(
        'button',
        {
          class: 'ini-mode',
          role: 'radio',
          onClick: () => {
            if (mode !== id) audio.play('select');
            mode = id;
            lsSet(LS_MODE, id);
            renderMode();
          },
          onDblclick: () => start(),
        },
        h('span', { class: 'ini-mode-icon' }, icon),
        h('span', { class: 'ini-mode-text' }, h('b', {}, title), h('small', {}, text)),
        h('span', { class: 'ini-mode-tag' }, tag),
        h('span', { class: 'ini-mode-check' }, '✓'),
      ));

    const front = h(
      'div',
      { class: 'ini-face ini-front' },
      h(
        'div',
        { class: 'ini-tag-paper' },
        h('div', { class: 'ini-eyelet' }),
        h('div', { class: 'ini-tag-kicker' }, h('span', {}, 'Nº 0001'), h('span', {}, 'Hecho a mano')),
        h('label', { class: 'ini-field' }, h('span', { class: 'ini-field-label' }, 'Nombre de tu marca'), input),
        h('div', { class: 'ini-label-row' }, h('span', { class: 'ini-label-hint' }, 'Así va en la etiqueta del cuello'), h('span', { class: 'ini-label' }, h('i', { class: 'ini-label-fold l' }), labelText, h('i', { class: 'ini-label-fold r' }))),
        h('div', { class: 'ini-field-label ini-mode-title' }, '¿Cómo querés jugar?'),
        h(
          'div',
          { class: 'ini-modes', role: 'radiogroup' },
          modeCard('libre', '🧵', 'Taller libre', 'Creá la remera que quieras, a tu gusto.', 'Creativo'),
          modeCard('pedido', '📋', 'Pedidos de clientes', 'Cumplí lo que te encargan y cobrá.', 'Desafío'),
        ),
        cta,
        h('div', { class: 'ini-tag-foot' }, h('span', {}, '11 pasos'), h('span', {}, '·'), h('span', {}, '≈ 15 minutos'), h('span', {}, '·'), h('span', {}, 'tu nota al final')),
      ),
    );

    // Reverso: la orden de trabajo del cliente
    const orderBox = h('div', { class: 'ini-order' });
    const back = h(
      'div',
      { class: 'ini-face ini-back', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'ini-tag-paper' },
        h('div', { class: 'ini-eyelet' }),
        orderBox,
        h(
          'div',
          { class: 'ini-order-actions' },
          h('button', { class: 'ini-cta', onClick: () => acceptOrder() }, h('span', {}, '✓ Aceptar pedido'), h('b', {}, '→')),
          h(
            'div',
            { class: 'ini-order-row' },
            h('button', { class: 'ini-sec', onClick: () => (audio.play('pop'), showClient(true)) }, '↻ Otro cliente'),
            h('button', { class: 'ini-sec ghost', onClick: () => flip(false) }, '← Volver'),
          ),
        ),
      ),
    );
    const tag = h('div', { class: 'ini-tag' }, front, back);

    const reqList = (o) => {
      const r = o.req || {};
      const items = [];
      const sw = (id) => {
        const c = catalog.colorById(id);
        return c ? h('i', { class: 'ini-req-sw', style: { background: c.hex } }) : null;
      };
      if (r.fabrics) items.push(['🧶', `Tela: ${r.fabrics.map((id) => catalog.fabricById(id)?.short || id).join(' o ')}`]);
      if (r.color) items.push(['🎨', [sw(r.color), `Color ${catalog.colorById(r.color)?.name.toLowerCase()}`]]);
      if (r.colors) items.push(['🎨', [...r.colors.map(sw), `Color ${r.colors.map((c) => catalog.colorById(c)?.name.toLowerCase()).join(' o ')}`]]);
      if (r.size) items.push(['📏', `Talle ${r.size}`]);
      if (r.fit) items.push(['👕', `Calce ${catalog.fitById(r.fit)?.name.toLowerCase()}`]);
      if (r.sleeve) items.push(['💪', catalog.sleeveById(r.sleeve)?.name]);
      if (r.neck) items.push(['🔻', catalog.neckById(r.neck)?.name]);
      if (r.technique) {
        const t = catalog.techniqueById(r.technique);
        items.push([t?.icon || '🖨️', `Estampa: ${t?.name}`]);
      }
      return h('ul', { class: 'ini-req' }, ...items.map(([i, t]) => h('li', {}, h('span', { class: 'ini-req-i' }, i), h('span', {}, t))), h('li', { class: 'muted' }, h('span', { class: 'ini-req-i' }, '✨'), h('span', {}, 'Lo demás, a tu criterio.')));
    };

    const pickClient = () => {
      const N = catalog.CLIENTS.length;
      const last = parseInt(lsGet(LS_LAST) ?? '-1', 10);
      const cur = client ? catalog.CLIENTS.indexOf(client) : -1;
      const pool = [];
      for (let i = 0; i < N; i++) if (i !== last && i !== cur) pool.push(i);
      const idx = pool.length ? pool[Math.floor(Math.random() * pool.length)] : 0;
      lsSet(LS_LAST, String(idx));
      return catalog.CLIENTS[idx];
    };

    function showClient(next = false) {
      if (next || !client) client = pickClient();
      const o = client;
      const num = String(1000 + Math.floor(Math.random() * 8999)).padStart(4, '0');
      orderBox.innerHTML = '';
      orderBox.appendChild(
        h(
          'div',
          { class: 'ini-slip' },
          h('div', { class: 'ini-slip-staple' }),
          h('div', { class: 'ini-slip-head' }, h('span', {}, 'Orden de trabajo'), h('span', {}, `Nº ${num}`)),
          h('div', { class: 'ini-client' }, h('span', { class: 'ini-client-avatar' }, o.avatar), h('div', {}, h('small', {}, 'Cliente'), h('b', {}, o.name))),
          h('p', { class: 'ini-client-quote' }, `“${o.text}”`),
          reqList(o),
          h('div', { class: 'ini-budget' }, h('span', {}, 'Presupuesto'), h('b', {}, money(o.budget || 0))),
        ),
      );
      orderBox.classList.remove('swap');
      void orderBox.offsetWidth;
      orderBox.classList.add('swap');
    }

    let flipped = false;
    function flip(on) {
      flipped = on;
      tag.classList.toggle('flipped', on);
      front.setAttribute('aria-hidden', on ? 'true' : 'false');
      back.setAttribute('aria-hidden', on ? 'false' : 'true');
      audio.play(on ? 'pop' : 'click');
      // los botones de la cara oculta no deben recibir foco
      for (const b of front.querySelectorAll('button, input')) b.tabIndex = on ? -1 : 0;
      for (const b of back.querySelectorAll('button')) b.tabIndex = on ? 0 : -1;
    }
    for (const b of back.querySelectorAll('button')) b.tabIndex = -1;

    let leaving = false;
    function go() {
      if (leaving || !ctx.alive) return;
      leaving = true;
      state.brand = (brand || '').trim() || 'Mi Taller';
      lsSet(LS_BRAND, (brand || '').trim());
      root.classList.add('leaving');
      audio.play('good');
      ui.overlay(null);
      ctx.next();
    }
    function start() {
      if (mode === 'pedido') {
        if (!flipped) {
          showClient(false);
          flip(true);
        }
        return;
      }
      state.mode = 'libre';
      state.order = null;
      go();
    }
    function acceptOrder() {
      if (!client) return;
      state.mode = 'pedido';
      state.order = client;
      go();
    }

    // Columna izquierda: título, proceso y colección
    const proc = h(
      'ol',
      { class: 'ini-steps' },
      ...PROCESS.map((p, i) =>
        h('li', { style: { animationDelay: `${0.5 + i * 0.05}s` }, title: `${p.title}: ${p.tip}` }, h('span', { class: 'ini-step-dot' }, h('span', { class: 'ini-step-n' }, i + 1), p.icon), h('span', { class: 'ini-step-label' }, p.short)),
      ),
    );
    const left = h(
      'section',
      { class: 'ini-left' },
      h('div', { class: 'ini-kicker' }, h('span', { class: 'ini-kicker-line' }), 'Simulador artesanal en 3D'),
      h('h1', { class: 'ini-title' }, h('span', { class: 'ini-title-small' }, 'Taller de'), h('span', { class: 'ini-title-big' }, 'Remeras', h('span', { class: 'ini-title-btn', html: buttonSVG() }))),
      h('div', { class: 'ini-stitch-wrap', html: stitchSVG() }),
      h('p', { class: 'ini-lead' }, 'Diseñá, cortá, cosé y estampá tu propia remera artesanal en 3D.'),
      h('div', { class: 'ini-process' }, h('h3', { class: 'ini-h3' }, 'Así se hace una remera'), h('div', { class: 'ini-steps-scroll' }, proc)),
    );
    const colWrap = h('div', { class: 'ini-collection' });
    left.appendChild(colWrap);
    const renderCollection = () => {
      const list = loadCollection();
      colWrap.innerHTML = '';
      colWrap.hidden = !list.length;
      if (!list.length) return;
      const best = Math.max(...list.map((e) => e.score || 0));
      colWrap.appendChild(h('h3', { class: 'ini-h3' }, 'Tu colección', h('span', { class: 'ini-h3-sub' }, `${list.length} ${list.length === 1 ? 'remera' : 'remeras'} · mejor nota ${Math.round(best)}`)));
      const strip = h('div', { class: 'ini-col-strip' });
      for (const it of list.slice(0, 8)) {
        strip.appendChild(
          h(
            'button',
            {
              class: 'ini-polaroid',
              title: `${it.brand || ''} · ${it.tier || ''} · ${Math.round(it.score)}/100`,
              onClick: () => {
                audio.play('click');
                showCollectionItem(ui, h, it, {
                  onRemove: (x) => {
                    removeShirt(x.id);
                    renderCollection();
                  },
                });
              },
            },
            it.thumb ? h('img', { src: it.thumb, alt: '' }) : h('span', { class: 'ini-polaroid-empty' }, '👕'),
            h('span', { class: 'ini-polaroid-score', style: { background: SCORE_COL(it.score || 0) } }, Math.round(it.score || 0)),
            h('span', { class: 'ini-polaroid-cap' }, it.brand || it.fabric || ''),
          ),
        );
      }
      if (list.length > 8) strip.appendChild(h('span', { class: 'ini-col-more' }, `+${list.length - 8}`));
      colWrap.appendChild(strip);
    };
    renderCollection();

    const right = h('section', { class: 'ini-right' }, h('div', { class: 'ini-tagwrap' }, h('div', { class: 'ini-string-wrap', html: stringSVG() }), tag));
    const muteBtn = h('button', {
      class: 'ini-mute',
      title: 'Sonido',
      'aria-label': 'Sonido',
      onClick: () => {
        audio.setMuted(!audio.muted);
        muteBtn.textContent = audio.muted ? '🔇' : '🔊';
        const top = document.getElementById('btn-mute');
        if (top) top.textContent = audio.muted ? '🔇' : '🔊';
        audio.play('click');
      },
    });
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';

    const root = h(
      'div',
      { class: 'ini' },
      h('div', { class: 'ini-bg' }),
      h('div', { class: 'ini-tape', html: tapeSVG({ fromCm: 0, cm: 34 }) }),
      muteBtn,
      h('div', { class: 'ini-layout' }, left, right),
    );
    renderMode();
    ui.overlay(root);
    ctx.track(() => {
      if (document.getElementById('overlay')?.contains(root)) ui.overlay(null);
    });

    ctx.listen(window, 'keydown', (e) => {
      if (leaving || document.querySelector('.modal-wrap')) return;
      if (e.key === 'Escape' && flipped) flip(false);
      else if (e.key === 'Enter' && e.target === document.body) {
        e.preventDefault();
        if (flipped) acceptOrder();
        else start();
      }
    });

    // ---------- Cámara: recorrido lento alrededor de la exhibición ----------
    const S = new THREE.Vector3(neck.x, neck.y - 0.36, neck.z);
    const P0 = engine.camera.position.clone();
    const T0 = engine.controls.target.clone();
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let ndcX = 0;
    let ndcTarget = 0;
    const measure = () => {
      const W = window.innerWidth;
      const lr = left.getBoundingClientRect();
      const tr = tag.getBoundingClientRect();
      if (W > 980 && tr.left > lr.right) ndcTarget = clamp(((lr.right + tr.left) / 2 / W) * 2 - 1, -0.5, 0.5);
      else ndcTarget = 0;
    };
    ctx.listen(window, 'resize', measure);
    requestAnimationFrame(measure);
    ctx.timeout(measure, 900);
    let tt = 0;
    const path = (t) => {
      const az = 0.16 + 0.46 * Math.sin(t * 0.07);
      const r = 2.85 + 0.3 * Math.sin(t * 0.051 + 1.2);
      const y = 1.62 + 0.14 * Math.sin(t * 0.043 + 0.5);
      P.set(S.x + Math.sin(az) * r, y, S.z + Math.cos(az) * r);
      T.set(S.x + 0.12 * Math.sin(t * 0.06), S.y + 0.1, S.z - 0.2);
    };
    ctx.onUpdate((dt) => {
      if (engine.flying) return;
      tt += dt;
      path(tt + 4);
      const k = easeInOutCubic(clamp(tt / 3.2));
      P.lerpVectors(P0, P, k);
      T.lerpVectors(T0, T, k);
      // corre el encuadre para que la remera quede en el hueco entre el título y la etiqueta
      ndcX = lerp(ndcX, ndcTarget, 1 - Math.exp(-dt * 3));
      const cam = engine.camera;
      const tanH = Math.tan((cam.fov * Math.PI) / 360) * cam.aspect;
      const yaw = Math.atan(ndcX * tanH) * k;
      dir.subVectors(T, P).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      cam.position.copy(P);
      engine.controls.target.copy(P).add(dir);
      cam.lookAt(engine.controls.target);
      if (teaserOn) shirt.group.rotation.y += dt * 0.28;
    });
  },

  exit() {
    document.getElementById('app')?.classList.remove('ini-on');
  },
};
