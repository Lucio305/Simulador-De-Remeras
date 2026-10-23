// Mini-juego de hilos sueltos: una "lupa con luz" que sigue al puntero revela los hilitos
// (que son finísimos y del color del hilo) dibujándolos con un halo en una capa 2D;
// clic / toque cerca de uno lo corta con la tijerita de hilos. Detecta si el hilo está
// de cara a la cámara y si no lo tapa otra parte de la remera.

import * as THREE from 'three';
import { clamp, distToSegment } from '../../core/utils.js';
import { threadZone } from './rules.js';
import { createOccluder } from './occlusion.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function createThreadHunt(ctx, { pattern, fabricColor, isMobile, onCut, onSlip, canTap = () => true, startActive = true }) {
  const { engine, shirt, audio, catalog } = ctx;
  const cam = engine.camera;
  const canvas3d = engine.canvas;
  const app = document.getElementById('app');

  // ---------- capa 2D ----------
  const ov = document.createElement('canvas');
  ov.className = 'term-lupa-layer';
  if (!startActive) ov.style.display = 'none';
  app.appendChild(ov);
  const g = ov.getContext('2d');
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas3d.clientWidth || window.innerWidth;
    const h = canvas3d.clientHeight || window.innerHeight;
    ov.width = Math.round(w * dpr);
    ov.height = Math.round(h * dpr);
    ov.style.width = `${w}px`;
    ov.style.height = `${h}px`;
  };
  resize();
  ctx.listen(window, 'resize', resize);

  const lumFab = catalog.luminance(fabricColor || '#ffffff');
  const glow = lumFab > 0.55 ? '#e0452c' : '#ffd23f';
  const glowSoft = lumFab > 0.55 ? 'rgba(224,69,44,' : 'rgba(255,210,63,';

  // ---------- registros de hilos ----------
  const recs = shirt.looseThreads.map((mesh, i) => {
    const path = mesh.geometry?.parameters?.path;
    const local = path ? path.getPoints(6) : [new THREE.Vector3(), new THREE.Vector3(0, 0, -0.02)];
    const ud = mesh.userData || {};
    return {
      i,
      mesh,
      local,
      side: ud.side || 'frente',
      zone: threadZone(pattern, ud.x ?? 0, ud.y ?? -0.3),
      // lado en coords de prenda (x < 0 = izquierda de quien mira el frente)
      lr: (ud.x ?? 0) < 0 ? -1 : 1,
      world: local.map(() => new THREE.Vector3()),
      scr: local.map(() => ({ x: 0, y: 0 })),
      on: false,
      facing: false,
      occ: false,
      occKey: '',
      reveal: 0,
      alive: true,
    };
  });
  const total = recs.length;
  let active = startActive;
  let time = 0;
  const fx = []; // efectos 2D
  const falling = []; // hilos cortados cayendo (3D)
  let ping = null; // pista
  const R = () => (isMobile() ? 92 : 78); // radio de la lupa
  const CUT = () => (isMobile() ? 44 : 30); // tolerancia del corte
  const TOUCH_HOLD = 3.2; // s que la lupa queda prendida después de un toque
  let lupa = { x: -999, y: -999, a: 0, show: false, touchT: 0 };
  let target = null;
  // modo mouse (la lupa sigue al cursor) o táctil (la lupa se prende donde tocás): según el
  // último puntero usado, no según el ancho de la pantalla
  let lastPointer = matchMedia('(hover: hover)').matches ? 'mouse' : 'touch';

  // ---------- proyección y visibilidad ----------
  const W = () => canvas3d.clientWidth || window.innerWidth;
  const H = () => canvas3d.clientHeight || window.innerHeight;
  function project(rec) {
    const w = W();
    const h = H();
    rec.on = false;
    for (let k = 0; k < rec.local.length; k++) {
      const p = rec.world[k].copy(rec.local[k]).applyMatrix4(rec.mesh.matrixWorld);
      _v.copy(p).project(cam);
      rec.scr[k].x = (_v.x * 0.5 + 0.5) * w;
      rec.scr[k].y = (-_v.y * 0.5 + 0.5) * h;
      if (_v.z < 1 && _v.z > -1) rec.on = true;
    }
    // normal = eje Y local del hilo (apoyado sobre la superficie)
    _m.extractRotation(rec.mesh.matrixWorld);
    _n.set(0, 1, 0).applyMatrix4(_m).normalize();
    _c.copy(cam.position).sub(rec.world[1]).normalize();
    // los hilos están sobre las costuras (bordes de la silueta): se los ve aun de canto,
    // así que esto solo descarta los que quedan claramente del otro lado (el resto lo decide el rayo)
    rec.facing = _n.dot(_c) > -0.55;
  }
  const panelList = () => {
    const pm = shirt.getPanelMeshes();
    return [pm.frente, pm.espalda].filter(Boolean);
  };
  const occluder = createOccluder(panelList);
  shirt.group.updateMatrixWorld(true);
  const warmMs = occluder.warm();
  ctx.track(() => occluder.dispose());
  // la oclusión solo cambia si se mueve la cámara o gira la remera: se cachea por "pose"
  let poseKey = '';
  const updatePose = () => {
    const p = cam.position;
    poseKey = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)},${Math.round(shirt.group.rotation.y * 2000)}`;
  };
  // tapado = ningún tramo del hilo se ve directo desde la cámara (rayos a varios puntos).
  // margen: el rayo que roza la tela donde se apoya el hilo (costura de canto) no cuenta;
  // un hilo del otro lado queda tapado por el panel cercano, a más de 2,5 cm
  function occluded(rec) {
    if (rec.occKey === poseKey) return rec.occ;
    rec.occKey = poseKey;
    let occ = true;
    for (const k of [3, 5, 6, 1]) {
      const p = rec.world[k];
      if (!p) continue;
      if (!occluder.blocked(cam.position, p, 0.025)) {
        occ = false;
        break;
      }
    }
    rec.occ = occ;
    return occ;
  }
  function distTo(rec, x, y) {
    let d = Infinity;
    for (let k = 1; k < rec.scr.length; k++) {
      const a = rec.scr[k - 1];
      const b = rec.scr[k];
      d = Math.min(d, distToSegment(x, y, a.x, a.y, b.x, b.y));
    }
    return d;
  }
  function visible(rec) {
    return rec.alive && rec.on && rec.facing && rec.mesh.visible && !occluded(rec);
  }
  function nearest(x, y, maxD, { revealed = false } = {}) {
    let best = null;
    let bd = maxD;
    for (const r of recs) {
      if (!r.alive || !r.on || !r.facing) continue;
      if (revealed && r.reveal < 0.2 && !(ping && ping.rec === r)) continue;
      const d = distTo(r, x, y);
      if (d < bd && !occluded(r)) {
        bd = d;
        best = r;
      }
    }
    return best;
  }
  function refresh() {
    cam.updateMatrixWorld();
    shirt.group.updateMatrixWorld(true);
    updatePose();
    for (const r of recs) if (r.alive) project(r);
  }

  // ---------- corte ----------
  function cut(rec, { silent = false, x = null, y = null } = {}) {
    if (!rec || !rec.alive) return false;
    rec.alive = false;
    const m = rec.mesh;
    m.updateMatrixWorld(true);
    // copia que cae revoloteando
    const geo = m.geometry.clone();
    const clone = new THREE.Mesh(geo, m.material);
    m.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    clone.castShadow = false;
    ctx.scene.add(clone);
    falling.push({ mesh: clone, t: 0, vx: (Math.random() - 0.5) * 0.12, vz: 0.05 + Math.random() * 0.08, spin: (Math.random() - 0.5) * 7, ph: Math.random() * 6 });
    const sp = rec.scr[2] || rec.scr[0];
    shirt.removeLooseThread(m);
    if (!silent) {
      audio.play('snip');
      fx.push({ kind: 'snip', x: x ?? sp.x, y: y ?? sp.y, t: 0 });
      fx.push({ kind: 'plus', x: (x ?? sp.x) + 10, y: (y ?? sp.y) - 18, t: 0 });
    } else fx.push({ kind: 'snip', x: sp.x, y: sp.y, t: 0, small: true });
    if (ping && ping.rec === rec) ping = null;
    onCut?.(rec, { silent });
    return true;
  }

  function tryCutAt(x, y) {
    refresh();
    const r = nearest(x, y, CUT());
    if (r) return cut(r, { x, y });
    // ¿tijeretazo sobre la tela?
    const ndc = new THREE.Vector2((x / W()) * 2 - 1, -(y / H()) * 2 + 1);
    const hits = engine.raycast(panelList(), ndc, false);
    if (hits.length) {
      fx.push({ kind: 'slip', x, y, t: 0 });
      audio.play('tick');
      onSlip?.();
    }
    return false;
  }

  // ---------- puntero ----------
  const downs = new Map();
  ctx.onPointer('down', (e, p) => {
    lastPointer = e.pointerType || 'mouse';
    if (!active) return;
    downs.set(e.pointerId, { x: p.x, y: p.y, t: performance.now(), touch: e.pointerType === 'touch' || e.pointerType === 'pen', multi: downs.size > 0 });
    if (downs.size > 1) for (const d of downs.values()) d.multi = true;
  });
  ctx.onPointer('up', (e, p) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    // un gesto cancelado por el navegador (pointercancel) no es un toque
    if (!active || !d || d.multi || e.type === 'pointercancel') return;
    if (e.target !== canvas3d && !(e.target && e.target.classList?.contains('term-lupa-layer'))) return;
    const moved = Math.hypot(p.x - d.x, p.y - d.y);
    const dur = performance.now() - d.t;
    if (moved > (d.touch ? 14 : 7) || dur > 700) return;
    if (!canTap()) return;
    if (d.touch) {
      // en táctil el dedo tapa lo que toca: el primer toque prende la lupa ahí y "enciende" los
      // hilos cercanos; solo se corta un hilo que ya brilla en la lupa (explorar no se castiga)
      refresh();
      const r = nearest(p.x, p.y, CUT(), { revealed: true });
      lupa.x = p.x;
      lupa.y = p.y;
      lupa.touchT = TOUCH_HOLD;
      if (r) cut(r, { x: p.x, y: p.y });
      return;
    }
    tryCutAt(p.x, p.y);
  });
  // arrastrar con el dedo gira la remera: la lupa se apaga mientras tanto
  ctx.onPointer('move', (e, p) => {
    if (e.pointerType) lastPointer = e.pointerType;
    const d = downs.get(e.pointerId);
    if (e.pointerType !== 'mouse' && d && Math.hypot(p.x - d.x, p.y - d.y) > 14) lupa.touchT = 0;
  });
  ctx.track(() => (canvas3d.style.cursor = ''));

  // ---------- pista ----------
  function hint() {
    const alive = recs.filter((r) => r.alive);
    if (!alive.length) return null;
    refresh();
    const vis = alive.filter((r) => visible(r));
    const rec = vis.length ? vis[Math.floor(Math.random() * vis.length)] : alive[Math.floor(Math.random() * alive.length)];
    ping = { rec, t: 0, dur: 3.2 };
    return { rec, visible: vis.includes(rec), side: rec.side };
  }
  function pingRec(rec) {
    if (rec && rec.alive) ping = { rec, t: 0, dur: 3.2 };
  }

  // ---------- dibujo ----------
  function drawPolyline(pts, width, color, alpha, blur = 0) {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (blur) {
      g.shadowColor = color;
      g.shadowBlur = blur;
    }
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x, pts[k].y);
    g.stroke();
    g.restore();
  }

  function drawScissors(x, y, s, open, rot, color = '#2b2420') {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s, s);
    const a = 0.12 + open * 0.42;
    for (const sg of [-1, 1]) {
      g.save();
      g.rotate(sg * a);
      // hoja
      g.fillStyle = '#e9edf1';
      g.strokeStyle = color;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(-2, sg * 1.2);
      g.lineTo(22, sg * 0.4);
      g.lineTo(22, 0);
      g.lineTo(-2, -sg * 0.9);
      g.closePath();
      g.fill();
      g.stroke();
      // ojo del mango
      g.fillStyle = '#d2553f';
      g.beginPath();
      g.ellipse(-9, sg * 4.2, 5.4, 3.6, sg * 0.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.ellipse(-9, sg * 4.2, 2.6, 1.6, sg * 0.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = color;
    g.beginPath();
    g.arc(0, 0, 1.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function draw(dt) {
    const w = W();
    const h = H();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const p = engine.pointer;
    const mouseMode = lastPointer === 'mouse';
    let show = false;
    if (active) {
      if (mouseMode && p.inside && !p.down) {
        lupa.x = p.x;
        lupa.y = p.y;
        show = true;
      } else if (lupa.touchT > 0) show = true;
    }
    lupa.touchT = Math.max(0, lupa.touchT - dt);
    lupa.a += ((show ? 1 : 0) - lupa.a) * clamp(dt * 12, 0, 1);
    const rad = R();
    // hilos revelados
    target = null;
    let bestD = CUT();
    for (const r of recs) {
      if (!r.alive) {
        r.reveal = 0;
        continue;
      }
      let want = 0;
      if (lupa.a > 0.02 && r.on && r.facing) {
        const d = distTo(r, lupa.x, lupa.y);
        if (d < rad + 6 && !occluded(r)) {
          want = clamp(1.25 - d / rad, 0, 1) * lupa.a;
          if (d < bestD) {
            bestD = d;
            target = r;
          }
        }
      }
      r.reveal += (want - r.reveal) * clamp(dt * 14, 0, 1);
      if (r.reveal > 0.02) {
        // con el dedo, el hilo encendido se dibuja más grueso (es lo que hay que tocar)
        const k = mouseMode ? 1 : 1.6;
        drawPolyline(r.scr, 6 * k, glow, 0.22 * r.reveal, 10 * k);
        drawPolyline(r.scr, 2.6 * k, glow, 0.9 * r.reveal, 6);
        drawPolyline(r.scr, 1 * k, '#ffffff', 0.85 * r.reveal);
      }
    }
    if (target && mouseMode) drawPolyline(target.scr, 4.2, glow, 1, 12);
    // pista: anillo que late sobre un hilo
    if (ping) {
      ping.t += dt;
      const r = ping.rec;
      if (!r.alive || ping.t > ping.dur) ping = null;
      else if (r.on && r.facing) {
        const c = r.scr[3] || r.scr[0];
        for (let k = 0; k < 2; k++) {
          const ph = (ping.t * 1.4 + k * 0.5) % 1;
          g.save();
          g.globalAlpha = (1 - ph) * 0.9;
          g.strokeStyle = glow;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(c.x, c.y, 10 + ph * 46, 0, Math.PI * 2);
          g.stroke();
          g.restore();
        }
        drawPolyline(r.scr, 3, glow, 0.9, 8);
      }
    }
    // lupa
    if (lupa.a > 0.02) {
      const x = lupa.x;
      const y = lupa.y;
      g.save();
      g.globalAlpha = lupa.a;
      const grd = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
      grd.addColorStop(0, 'rgba(255,250,235,0.10)');
      grd.addColorStop(1, 'rgba(255,250,235,0.02)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
      // aro
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(43,36,32,0.55)';
      g.beginPath();
      g.arc(x, y, rad + 1.5, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 2.5;
      g.strokeStyle = target ? glow : 'rgba(255,248,236,0.95)';
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.stroke();
      // mango
      const a = Math.PI * 0.25;
      g.lineCap = 'round';
      g.lineWidth = 9;
      g.strokeStyle = 'rgba(43,36,32,0.8)';
      g.beginPath();
      g.moveTo(x + Math.cos(a) * (rad + 4), y + Math.sin(a) * (rad + 4));
      g.lineTo(x + Math.cos(a) * (rad + 30), y + Math.sin(a) * (rad + 30));
      g.stroke();
      g.lineWidth = 5;
      g.strokeStyle = '#2f6f6a';
      g.beginPath();
      g.moveTo(x + Math.cos(a) * (rad + 8), y + Math.sin(a) * (rad + 8));
      g.lineTo(x + Math.cos(a) * (rad + 29), y + Math.sin(a) * (rad + 29));
      g.stroke();
      // mira central / tijerita
      if (mouseMode) {
        if (target) drawScissors(x + 2, y - 2, 0.85, 0.55 + 0.25 * Math.sin(time * 9), -0.6);
        else {
          g.strokeStyle = 'rgba(255,248,236,0.9)';
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(x - 7, y);
          g.lineTo(x - 2.5, y);
          g.moveTo(x + 2.5, y);
          g.lineTo(x + 7, y);
          g.moveTo(x, y - 7);
          g.lineTo(x, y - 2.5);
          g.moveTo(x, y + 2.5);
          g.lineTo(x, y + 7);
          g.stroke();
        }
      }
      g.restore();
    }
    // efectos
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      if (f.kind === 'snip') {
        const k = clamp(f.t / 0.32);
        if (k >= 1) {
          fx.splice(i, 1);
          continue;
        }
        g.save();
        g.globalAlpha = 1 - k * k;
        drawScissors(f.x, f.y, f.small ? 0.6 : 1.05, 1 - Math.min(1, k * 2.4), -0.6);
        // chispas de corte
        g.strokeStyle = glow;
        g.lineWidth = 2;
        for (let s = 0; s < 6; s++) {
          const an = (s / 6) * Math.PI * 2 + 0.3;
          const r0 = 8 + k * 16;
          const r1 = r0 + 6 * (1 - k);
          g.beginPath();
          g.moveTo(f.x + Math.cos(an) * r0, f.y + Math.sin(an) * r0);
          g.lineTo(f.x + Math.cos(an) * r1, f.y + Math.sin(an) * r1);
          g.stroke();
        }
        g.restore();
      } else if (f.kind === 'plus') {
        const k = clamp(f.t / 0.9);
        if (k >= 1) {
          fx.splice(i, 1);
          continue;
        }
        g.save();
        g.globalAlpha = 1 - k;
        g.font = '800 18px ui-rounded, system-ui, sans-serif';
        g.fillStyle = '#3c8a4f';
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.lineWidth = 4;
        g.strokeText('+1', f.x, f.y - k * 28);
        g.fillText('+1', f.x, f.y - k * 28);
        g.restore();
      } else if (f.kind === 'slip') {
        const k = clamp(f.t / 0.5);
        if (k >= 1) {
          fx.splice(i, 1);
          continue;
        }
        g.save();
        g.globalAlpha = 1 - k;
        g.strokeStyle = '#c0392b';
        g.lineWidth = 3;
        const s = 7 + k * 4;
        g.beginPath();
        g.moveTo(f.x - s, f.y - s);
        g.lineTo(f.x + s, f.y + s);
        g.moveTo(f.x + s, f.y - s);
        g.lineTo(f.x - s, f.y + s);
        g.stroke();
        g.restore();
      }
    }
    canvas3d.style.cursor = active && mouseMode && p.inside ? (p.down ? 'grabbing' : 'none') : '';
  }

  // apaga la capa: oculta el lienzo y lo resetea entero (un clearRect suelto a veces no
  // llegaba a la pantalla y la lupa quedaba congelada encima de la escena)
  let cleared = !startActive;
  function clearLayer() {
    cleared = true;
    ov.style.display = 'none';
    ov.width = ov.width;
    canvas3d.style.cursor = '';
  }
  function update(dt) {
    if (active) {
      time += dt;
      cleared = false;
      refresh();
      draw(dt);
    } else if (!cleared) clearLayer();
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      f.t += dt;
      const m = f.mesh;
      m.position.y -= (0.18 + f.t * 0.5) * dt;
      m.position.x += (f.vx + Math.sin(f.t * 6 + f.ph) * 0.08) * dt;
      m.position.z += f.vz * dt;
      m.rotateZ(f.spin * dt);
      m.rotateX(f.spin * 0.6 * dt);
      if (f.t > 1.3) {
        ctx.scene.remove(m);
        m.geometry.dispose();
        falling.splice(i, 1);
      }
    }
  }

  function dispose() {
    active = false;
    ov.remove();
    for (const f of falling) {
      ctx.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
    }
    falling.length = 0;
    canvas3d.style.cursor = '';
  }
  ctx.track(dispose);

  return {
    recs,
    total,
    update,
    cut,
    hint,
    pingRec,
    dispose,
    tryCutAt,
    get time() {
      return time;
    },
    set active(v) {
      active = !!v;
      if (!active) {
        lupa.a = 0;
        lupa.touchT = 0;
        ping = null;
        target = null;
        fx.length = 0;
        for (const r of recs) r.reveal = 0;
        clearLayer();
      } else {
        ov.style.display = '';
        cleared = false;
      }
    },
    get active() {
      return active;
    },
    // ¿el último puntero fue táctil? (para los textos de ayuda)
    get touchMode() {
      return lastPointer !== 'mouse';
    },
    get busyFx() {
      return falling.length > 0;
    },
    remaining() {
      return recs.filter((r) => r.alive).length;
    },
    counts() {
      const side = { frente: 0, espalda: 0 };
      const zone = { cuello: 0, axilas: 0, punos: 0, ruedo: 0 };
      for (const r of recs) {
        if (!r.alive) continue;
        side[r.side] = (side[r.side] || 0) + 1;
        zone[r.zone] = (zone[r.zone] || 0) + 1;
      }
      return { side, zone };
    },
    // posición en pantalla de un hilo (para pruebas automáticas)
    screenOf(rec) {
      refresh();
      const s = rec.scr[3] || rec.scr[0];
      return { x: s.x, y: s.y, visible: visible(rec) };
    },
    // pruebas: compara la oclusión por grilla con el raycaster de three (mismo criterio)
    _occCheck() {
      refresh();
      const list = panelList();
      let same = 0;
      let diff = 0;
      let tGrid = 0;
      let tThree = 0;
      for (const r of recs) {
        if (!r.alive) continue;
        for (const k of [3, 5, 6, 1]) {
          const p = r.world[k];
          let t0 = performance.now();
          const a = occluder.blocked(cam.position, p, 0.025);
          tGrid += performance.now() - t0;
          t0 = performance.now();
          const dir = _v.copy(p).sub(cam.position);
          const dist = dir.length();
          dir.normalize();
          engine.raycaster.set(cam.position, dir);
          engine.raycaster.far = dist + 0.01;
          const hits = engine.raycaster.intersectObjects(list, false);
          engine.raycaster.far = Infinity;
          const b = !!(hits.length && hits[0].distance < dist - 0.025);
          tThree += performance.now() - t0;
          if (a === b) same++;
          else diff++;
        }
      }
      return { same, diff, tGrid: +tGrid.toFixed(2), tThree: +tThree.toFixed(2) };
    },
    get warmMs() {
      return warmMs;
    },
    // ¿la capa de la lupa está visible? (pruebas)
    get layerShown() {
      return ov.style.display !== 'none';
    },
  };
}
