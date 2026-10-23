// Paso: Bienvenida. Pantalla de título sobre el taller 3D (la cámara lo recorre despacio),
// nombre de la marca, elección de modo (taller libre o pedido de un cliente), la lista de
// pasos del proceso y la colección de remeras terminadas.

import { clamp, lerp, money, easeInOutCubic } from '../core/utils.js';
import { processPrint, renderPreset } from '../print/printEngine.js';
import { PROCESS } from './final/process.js';
import { loadCollection, removeShirt, showCollectionItem } from './final/collection.js';
import { tapeSVG, stitchSVG, buttonSVG, stringSVG } from './inicio/decor.js';
import { findShirtSlot, unionRect } from './inicio/framing.js';

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
    const selectMode = (id) => {
      if (mode !== id) audio.play('select');
      mode = id;
      lsSet(LS_MODE, id);
      renderMode();
    };
    const modeCard = (id, icon, title, text, tag) =>
      (modeCards[id] = h(
        'button',
        {
          class: 'ini-mode',
          role: 'radio',
          onClick: () => selectMode(id),
          onDblclick: () => start(),
          onKeydown: (e) => {
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            e.preventDefault();
            const other = id === 'libre' ? 'pedido' : 'libre';
            selectMode(other);
            modeCards[other].focus();
          },
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
    let acceptBtn = null;
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
          (acceptBtn = h('button', { class: 'ini-cta', onClick: () => acceptOrder() }, h('span', {}, '✓ Aceptar pedido'), h('b', {}, '→'))),
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
      // y el foco pasa a la cara visible (si no, se seguiría tipeando en el campo oculto)
      const focusIn = front.contains(document.activeElement) || back.contains(document.activeElement);
      if (on) {
        document.activeElement?.blur?.();
        acceptBtn.focus({ preventScroll: true });
      } else if (focusIn) cta.focus({ preventScroll: true });
      ctx.timeout(measure, 60);
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
      else if (e.key === 'Enter' && !e.repeat) {
        // Enter sobre una tarjeta de modo la elige y arranca (Espacio solo la marca)
        const card = e.target?.closest?.('.ini-mode');
        if (card && !flipped) {
          e.preventDefault();
          const id = Object.keys(modeCards).find((k) => modeCards[k] === card);
          if (id) selectMode(id);
          start();
        } else if (e.target === document.body || e.target === root) {
          e.preventDefault();
          if (flipped) acceptOrder();
          else start();
        }
      }
    });

    // ---------- Encuadre: la remera de muestra va al hueco libre de la pantalla ----------
    // Se miden los textos de la izquierda y la etiqueta (posiciones de layout, sin las
    // animaciones de entrada) y se busca dónde entra la remera más grande sin que nada la
    // tape: al lado de los textos en pantallas anchas, debajo de la lista en las más chicas.
    const sil = shirt.pattern?.silhouette?.front?.outline || [];
    let gx0 = -0.45;
    let gx1 = 0.45;
    let gy0 = -0.74;
    let gy1 = 0;
    if (sil.length) {
      gx0 = Math.min(...sil.map((q) => q.x));
      gx1 = Math.max(...sil.map((q) => q.x));
      gy0 = Math.min(...sil.map((q) => q.y));
      gy1 = Math.max(...sil.map((q) => q.y));
    }
    gy1 += 0.07; // el cuello del soporte asoma arriba
    const shirtW = gx1 - gx0;
    const shirtH = gy1 - gy0;
    const S = new THREE.Vector3(neck.x + (gx0 + gx1) / 2, neck.y + (gy0 + gy1) / 2, neck.z);

    // velos de papel detrás de los textos (título y lista de pasos), solo en escritorio
    const veils = [h('div', { class: 'ini-veil' }), h('div', { class: 'ini-veil' })];
    for (const v of veils.slice().reverse()) root.insertBefore(v, root.firstChild.nextSibling);
    const layoutRect = (el) => {
      if (!el || !el.isConnected || el.hidden || !el.offsetWidth) return null;
      let x = 0;
      let y = 0;
      let e = el;
      while (e && e !== root) {
        x += e.offsetLeft;
        y += e.offsetTop;
        e = e.offsetParent;
      }
      if (e !== root) return null;
      return { x0: x, y0: y, x1: x + el.offsetWidth, y1: y + el.offsetHeight };
    };
    const rects = (sel) => [...root.querySelectorAll(sel)].map(layoutRect);
    const tgt = { nx: 0, ny: 0, d: 2.85, ok: false };
    const cur = { nx: 0, ny: 0, d: 2.85 };
    const measure = () => {
      if (!ctx.alive || !root.isConnected) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (!W || !H) return;
      const mobile = W <= 820;
      const head = unionRect([...rects('.ini-kicker, .ini-title-small, .ini-title-big, .ini-title-btn, .ini-stitch, .ini-lead')]);
      const lower = unionRect([...rects('.ini-process .ini-h3, .ini-steps li, .ini-collection:not([hidden]) .ini-h3, .ini-polaroid, .ini-col-more')]);
      const all = unionRect([head, lower]);
      const tagR = layoutRect(tag);
      const obstacles = [head, lower, tagR, layoutRect(muteBtn), layoutRect(root.querySelector('.ini-tape'))];
      const slot = findShirtSlot({
        W,
        H,
        obstacles,
        aspect: shirtW / shirtH,
        sPref: mobile ? clamp(H * 0.3, 150, 300) : clamp(H * 0.32, 170, 380),
        prefX: !mobile && all && tagR ? (all.x1 + tagR.x0) / 2 : W / 2,
        margin: mobile ? 8 : 14,
      });
      const cam = engine.camera;
      const tanV = Math.tan((cam.fov * Math.PI) / 360);
      tgt.nx = clamp((slot.cx / W) * 2 - 1, -0.85, 0.85);
      tgt.ny = clamp(1 - (slot.cy / H) * 2, -0.85, 0.85);
      // la remera se ve algo más grande que su silueta plana: tiene volumen (el frente queda
      // más cerca) y lejos del centro la perspectiva la estira
      const grow = 1.12 * (1 + (tgt.ny * tanV) ** 2);
      tgt.d = clamp((shirtH * grow * H) / (slot.s * 2 * tanV), 1.9, 5.2);
      if (!tgt.ok || tt < 0.2) Object.assign(cur, { nx: tgt.nx, ny: tgt.ny, d: tgt.d });
      tgt.ok = true;
      // velo de papel detrás de los textos (solo escritorio: en el celular lo hace el fondo)
      root.style.setProperty('--ini-slot-y0', `${Math.round(slot.cy - slot.s / 2)}px`);
      root.style.setProperty('--ini-slot-y1', `${Math.round(slot.cy + slot.s / 2)}px`);
      [head, lower].forEach((b, i) => {
        const v = veils[i];
        v.hidden = mobile || !b;
        if (v.hidden) return;
        const pad = 26;
        Object.assign(v.style, { left: `${b.x0 - pad}px`, top: `${b.y0 - pad}px`, width: `${b.x1 - b.x0 + pad * 2}px`, height: `${b.y1 - b.y0 + pad * 2}px` });
      });
      window.__tallerInicioSlot = { ...slot, d: tgt.d, W, H, obstacles };
    };
    ctx.listen(window, 'resize', measure);
    ctx.track(() => delete window.__tallerInicioSlot);
    requestAnimationFrame(measure);
    ctx.timeout(measure, 700);
    ctx.timeout(measure, 2200);

    // Recorrido lento alrededor de la exhibición; una cámara "virtual" calcula hacia dónde
    // mirar para que la remera caiga justo en el hueco (se corrige cuadro a cuadro).
    const P0 = engine.camera.position.clone();
    const T0 = engine.controls.target.clone();
    const P = new THREE.Vector3();
    const Tl = new THREE.Vector3();
    const T = new THREE.Vector3();
    const F = new THREE.Vector3();
    const Rv = new THREE.Vector3();
    const q = new THREE.Vector3();
    const UP = THREE.Object3D.DEFAULT_UP;
    const vcam = new THREE.PerspectiveCamera();
    const aim = { x: 0, y: 0 };
    let tt = 0;
    ctx.onUpdate((dt) => {
      if (engine.flying) return;
      tt += dt;
      const cam = engine.camera;
      const kS = 1 - Math.exp(-dt * 2.2);
      cur.nx = lerp(cur.nx, tgt.nx, kS);
      cur.ny = lerp(cur.ny, tgt.ny, kS);
      cur.d = lerp(cur.d, tgt.d, kS);
      const t = tt + 4;
      const az = 0.16 + 0.42 * Math.sin(t * 0.07);
      const r = cur.d * (1 + 0.05 * Math.sin(t * 0.051 + 1.2));
      const el = 0.17 + 0.05 * Math.sin(t * 0.043 + 0.5);
      P.set(S.x + Math.sin(az) * Math.cos(el) * r, S.y + Math.sin(el) * r, S.z + Math.cos(az) * Math.cos(el) * r);
      // vista desde P corrida para que S se proyecte en (cur.nx, cur.ny)
      if (vcam.fov !== cam.fov || vcam.aspect !== cam.aspect) {
        vcam.fov = cam.fov;
        vcam.aspect = cam.aspect;
        vcam.updateProjectionMatrix();
      }
      const tanV = Math.tan((cam.fov * Math.PI) / 360);
      F.subVectors(S, P);
      const dist = F.length();
      F.normalize();
      Rv.crossVectors(F, UP).normalize();
      F.applyAxisAngle(Rv, -Math.atan(aim.y * tanV)).applyAxisAngle(UP, Math.atan(aim.x * tanV * cam.aspect));
      Tl.copy(P).addScaledVector(F, dist);
      vcam.position.copy(P);
      vcam.lookAt(Tl);
      vcam.updateMatrixWorld();
      q.copy(S).project(vcam);
      aim.x = clamp(aim.x + (cur.nx - q.x) * 0.85, -0.95, 0.95);
      aim.y = clamp(aim.y + (cur.ny - q.y) * 0.85, -0.95, 0.95);
      // al entrar, transición suave desde donde estaba la cámara
      const k = easeInOutCubic(clamp(tt / 3.2));
      cam.position.lerpVectors(P0, P, k);
      T.lerpVectors(T0, Tl, k);
      engine.controls.target.copy(T);
      cam.lookAt(T);
      if (teaserOn) shirt.group.rotation.y += dt * 0.28;
    });
    // ayudas para las pruebas automáticas (el render por software va a 1 fps)
    this._test = {
      measure,
      slot: () => window.__tallerInicioSlot,
      settle: () => ((tt = Math.max(tt, 3.3)), Object.assign(cur, { nx: tgt.nx, ny: tgt.ny, d: tgt.d })),
      shirtBox: () => {
        const b = new THREE.Box3().setFromObject(shirt.group);
        const W = window.innerWidth;
        const H = window.innerHeight;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const v = new THREE.Vector3(x, y, z).project(engine.camera);
          x0 = Math.min(x0, ((v.x + 1) / 2) * W); x1 = Math.max(x1, ((v.x + 1) / 2) * W);
          y0 = Math.min(y0, ((1 - v.y) / 2) * H); y1 = Math.max(y1, ((1 - v.y) / 2) * H);
        }
        const c = S.clone().project(engine.camera);
        return { x0: Math.round(x0), x1: Math.round(x1), y0: Math.round(y0), y1: Math.round(y1), S: [Math.round(((c.x + 1) / 2) * W), Math.round(((1 - c.y) / 2) * H)], aim, cur, bbox: [b.min.toArray().map((v) => +v.toFixed(2)), b.max.toArray().map((v) => +v.toFixed(2))] };
      },
    };
  },

  exit() {
    document.getElementById('app')?.classList.remove('ini-on');
  },
};
