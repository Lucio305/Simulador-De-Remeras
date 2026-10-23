// Capa SVG sobre el canvas 3D: marco de la estampa (sigue la curvatura de la remera),
// manijas para agrandar y rotar, contorno del área estampable y anillo del pincel.
// Todo se proyecta cada frame desde coordenadas de prenda → mundo → pantalla.

const NS = 'http://www.w3.org/2000/svg';
const DEG = Math.PI / 180;

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function createOverlay({ THREE, engine, shirt, host, touch = false }) {
  const svg = el('svg', { class: 'dis-overlay', 'aria-hidden': 'true' });
  // Sin esto el navegador se queda con el gesto táctil que empieza en una manija (manda
  // pointercancel en vez de pointerup). touch-action no se aplica a los elementos internos del
  // SVG, así que va en el <svg> (y en CSS).
  svg.style.touchAction = 'none';
  const area = el('path', { class: 'dis-ov-area' });
  const ghost = el('path', { class: 'dis-ov-ghost' });
  const frameSh = el('path', { class: 'dis-ov-frame-sh' });
  const frame = el('path', { class: 'dis-ov-frame' });
  const stem = el('line', { class: 'dis-ov-stem' });
  const R = touch ? 13 : 8.5;
  const hScale = el('circle', { class: 'dis-ov-h dis-ov-scale', r: R });
  const hRot = el('circle', { class: 'dis-ov-h dis-ov-rot', r: R });
  // zona de agarre más grande que el círculo dibujado (sobre todo para el dedo)
  const grab = touch ? 24 : 14;
  const hScaleHit = el('circle', { class: 'dis-ov-hit scale', r: grab });
  const hRotHit = el('circle', { class: 'dis-ov-hit rot', r: grab });
  const rotIcon = el('path', { class: 'dis-ov-icon', d: '' });
  const scaleIcon = el('path', { class: 'dis-ov-icon', d: '' });
  const brush = el('circle', { class: 'dis-ov-brush', r: 10 });
  const brushDot = el('circle', { class: 'dis-ov-brush-dot', r: 1.6 });
  svg.append(area, ghost, frameSh, frame, stem, hRotHit, hScaleHit, hRot, hScale, rotIcon, scaleIcon, brush, brushDot);
  const tip = document.createElement('div');
  tip.className = 'dis-ov-tip';
  // cartelito del lugar marcado (HTML: se lee mejor y puede ser más ancho que el recuadro)
  const ghostLabel = document.createElement('div');
  ghostLabel.className = 'dis-ov-ghost-label';
  const ghostT1 = document.createElement('b');
  const ghostT2 = document.createElement('span');
  ghostLabel.append(ghostT1, ghostT2);
  host.append(svg, ghostLabel, tip);

  const tmp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  let frameData = null; // { pts:[V3 local], center, normal, scale, top, rot }
  let areaData = null; // { pts:[V3 local], normal }
  let ghostData = null; // { pts:[V3 local], center, normal }
  const vis = { frame: false, strong: false, handles: false, area: false, tip: '', ghost: false, ghostLabel: ['', ''] };
  const screen = { center: null, scale: null, rot: null, facing: false, handlesShown: false };

  // ¿El puntero está sobre una manija? (los círculos tapan al canvas: el canvas recibe
  // pointerleave y el motor deja de "ver" el puntero, así que se sigue acá).
  const over = { scale: false, rot: false };
  for (const [k, els] of [
    ['scale', [hScale, hScaleHit]],
    ['rot', [hRot, hRotHit]],
  ]) {
    for (const e of els) {
      e.addEventListener('pointerenter', () => (over[k] = true));
      e.addEventListener('pointerleave', () => (over[k] = false));
    }
  }

  const sample = (side, vx, y, off = 0.0025) => {
    const gx = side === 'espalda' ? -vx : vx;
    return shirt.garmentToLocal(side, gx, y, off);
  };

  function rectPoints(side, cx, cy, w, hgt, rotDeg, perEdge = 10) {
    const r = (rotDeg || 0) * DEG;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const corners = [
      [-w / 2, -hgt / 2],
      [w / 2, -hgt / 2],
      [w / 2, hgt / 2],
      [-w / 2, hgt / 2],
    ];
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      for (let k = 0; k < perEdge; k++) {
        const t = k / perEdge;
        const lx = ax + (bx - ax) * t;
        const ly = ay + (by - ay) * t;
        pts.push(sample(side, cx + lx * c - ly * s, cy + lx * s + ly * c).position);
      }
    }
    return pts;
  }

  const segDist = (px, py, ax, ay, bx, by) => {
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2));
    return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
  };

  return {
    svg,
    handles: { scale: hScale, rot: hRot, scaleHit: hScaleHit, rotHit: hRotHit },
    screen,
    get overHandle() {
      return over.scale || over.rot;
    },
    get overWhich() {
      return over.scale ? 'scale' : over.rot ? 'rot' : null;
    },
    // ¿(x, y) en px del canvas está sobre/cerca de las manijas o del palito de la de rotación?
    nearHandles(x, y, pad = 10) {
      if (!screen.handlesShown || !screen.center) return false;
      const r = grab + pad;
      if (Math.hypot(x - screen.scale[0], y - screen.scale[1]) < r) return true;
      if (Math.hypot(x - screen.rot[0], y - screen.rot[1]) < r) return true;
      return segDist(x, y, screen.top[0], screen.top[1], screen.rot[0], screen.rot[1]) < pad + 8;
    },
    // Lugar marcado cuando todavía no hay imagen (centro vista, ancho/alto del contenido, m).
    setGhost(side, cx, cy, w, hgt) {
      if (!side) {
        ghostData = null;
        return;
      }
      const center = sample(side, cx, cy, 0.003);
      ghostData = { pts: rectPoints(side, cx, cy, w, hgt, 0, 12), center: center.position, normal: center.normal };
    },
    // Marco de la estampa: centro (vista), tamaño del contenido (m) y rotación (grados).
    setFrame(side, cx, cy, w, hgt, rotDeg) {
      const m = 0.006;
      const W = w + m * 2;
      const H = hgt + m * 2;
      const r = (rotDeg || 0) * DEG;
      const c = Math.cos(r);
      const s = Math.sin(r);
      const at = (lx, ly, off) => sample(side, cx + lx * c - ly * s, cy + lx * s + ly * c, off);
      const center = sample(side, cx, cy, 0.003);
      frameData = {
        pts: rectPoints(side, cx, cy, W, H, rotDeg),
        center: center.position,
        normal: center.normal,
        scale: at(W / 2, -H / 2, 0.004).position,
        top: at(0, H / 2, 0.004).position,
        rot: at(0, H / 2 + 0.03, 0.004).position,
      };
    },
    clearFrame() {
      frameData = null;
    },
    setArea(side, a) {
      if (!a) {
        areaData = null;
        return;
      }
      const cx = (a.minX + a.maxX) / 2;
      const cy = (a.minY + a.maxY) / 2;
      const center = sample(side, cx, cy, 0.003);
      areaData = { pts: rectPoints(side, cx, cy, a.maxX - a.minX, a.maxY - a.minY, 0, 16), normal: center.normal, center: center.position };
    },
    show({ frame, strong, handles, area: ar, tip: tp, ghost: gh, ghostLabel } = {}) {
      if (frame !== undefined) vis.frame = frame;
      if (strong !== undefined) vis.strong = strong;
      if (handles !== undefined) vis.handles = handles;
      if (ar !== undefined) vis.area = ar;
      if (tp !== undefined) vis.tip = tp;
      if (gh !== undefined) vis.ghost = gh;
      if (ghostLabel !== undefined) vis.ghostLabel = ghostLabel;
    },
    // Anillo del pincel en pantalla (px) con radio en px; null lo oculta.
    setBrush(x, y, r, color) {
      if (x == null) {
        brush.style.display = 'none';
        brushDot.style.display = 'none';
        return;
      }
      brush.style.display = '';
      brushDot.style.display = '';
      brush.setAttribute('cx', x);
      brush.setAttribute('cy', y);
      brush.setAttribute('r', Math.max(2, r));
      brushDot.setAttribute('cx', x);
      brushDot.setAttribute('cy', y);
      if (color) brush.style.setProperty('--c', color);
    },
    update() {
      const cam = engine.camera;
      cam.getWorldPosition(camPos);
      const W = engine.canvas.clientWidth || window.innerWidth;
      const H = engine.canvas.clientHeight || window.innerHeight;
      shirt.group.updateMatrixWorld();
      const mw = shirt.group.matrixWorld;
      const proj = (p) => {
        tmp.copy(p).applyMatrix4(mw).project(cam);
        return [(tmp.x * 0.5 + 0.5) * W, (-tmp.y * 0.5 + 0.5) * H, tmp.z > 1];
      };
      const facing = (d) => {
        if (!d) return false;
        tmpN.copy(d.normal).transformDirection(mw);
        tmp.copy(d.center).applyMatrix4(mw);
        return tmpN.dot(toCam.copy(camPos).sub(tmp)) > 0.02;
      };
      const pathOf = (pts) => {
        let s = '';
        for (let i = 0; i < pts.length; i++) {
          const [x, y] = proj(pts[i]);
          s += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        return s + 'Z';
      };
      // área estampable
      if (vis.area && areaData && facing(areaData)) {
        area.setAttribute('d', pathOf(areaData.pts));
        area.style.display = '';
      } else area.style.display = 'none';
      // lugar marcado (sin imagen todavía)
      if (vis.ghost && ghostData && facing(ghostData)) {
        ghost.setAttribute('d', pathOf(ghostData.pts));
        const [gx, gy] = proj(ghostData.center);
        ghostLabel.style.left = `${gx.toFixed(1)}px`;
        ghostLabel.style.top = `${gy.toFixed(1)}px`;
        if (ghostT1.textContent !== vis.ghostLabel[0]) ghostT1.textContent = vis.ghostLabel[0] || '';
        if (ghostT2.dataset.src !== (vis.ghostLabel[1] || '')) {
          ghostT2.dataset.src = vis.ghostLabel[1] || '';
          ghostT2.innerHTML = ghostT2.dataset.src;
        }
        ghost.style.display = '';
        ghostLabel.style.display = 'block';
      } else {
        ghost.style.display = 'none';
        ghostLabel.style.display = 'none';
      }
      // marco
      screen.facing = !!(frameData && facing(frameData));
      const showF = vis.frame && screen.facing;
      if (showF) {
        const d = pathOf(frameData.pts);
        frame.setAttribute('d', d);
        frameSh.setAttribute('d', d);
        frame.classList.toggle('strong', !!vis.strong);
        frame.style.display = frameSh.style.display = '';
      } else frame.style.display = frameSh.style.display = 'none';
      if (frameData) {
        const [cx, cy] = proj(frameData.center);
        const [sx, sy] = proj(frameData.scale);
        const [tx, ty] = proj(frameData.top);
        let [rx, ry] = proj(frameData.rot);
        // con estampas chicas (o vistas de lejos) la manija de rotación quedaría encima de la de
        // escala: se la aleja en pantalla siguiendo la dirección "arriba" de la estampa
        {
          let ux = tx - cx;
          let uy = ty - cy;
          const ul = Math.hypot(ux, uy);
          if (ul > 0.5) {
            ux /= ul;
            uy /= ul;
          } else {
            ux = 0;
            uy = -1;
          }
          const k = Math.max(Math.hypot(rx - tx, ry - ty), R * 2.6 + 6);
          rx = tx + ux * k;
          ry = ty + uy * k;
        }
        screen.center = [cx, cy];
        screen.scale = [sx, sy];
        screen.rot = [rx, ry];
        screen.top = [tx, ty];
        const showH = showF && vis.handles;
        screen.handlesShown = showH;
        for (const e of [hScale, hRot, hScaleHit, hRotHit, stem, rotIcon, scaleIcon]) e.style.display = showH ? '' : 'none';
        if (!showH) over.scale = over.rot = false;
        if (showH) {
          hScale.setAttribute('cx', sx);
          hScale.setAttribute('cy', sy);
          hRot.setAttribute('cx', rx);
          hRot.setAttribute('cy', ry);
          hScaleHit.setAttribute('cx', sx);
          hScaleHit.setAttribute('cy', sy);
          hRotHit.setAttribute('cx', rx);
          hRotHit.setAttribute('cy', ry);
          stem.setAttribute('x1', tx);
          stem.setAttribute('y1', ty);
          stem.setAttribute('x2', rx);
          stem.setAttribute('y2', ry);
          const k = R * 0.5;
          // íconos: flecha diagonal (agrandar) y arco con punta (rotar)
          scaleIcon.setAttribute('d', `M${sx - k} ${sy - k}L${sx + k} ${sy + k}M${sx + k} ${sy + k * 0.1}L${sx + k} ${sy + k}L${sx + k * 0.1} ${sy + k}M${sx - k} ${sy - k * 0.1}L${sx - k} ${sy - k}L${sx - k * 0.1} ${sy - k}`);
          rotIcon.setAttribute('d', `M${rx - k} ${ry + k * 0.2}A${k} ${k} 0 1 1 ${rx + k * 0.2} ${ry + k}M${rx + k * 0.2} ${ry + k}L${rx + k * 0.75} ${ry + k * 0.55}M${rx + k * 0.2} ${ry + k}L${rx + k * 0.15} ${ry + k * 0.3}`);
        }
        if (vis.tip && showF) {
          tip.textContent = vis.tip;
          tip.style.display = 'block';
          // junto a la manija apuntada, o arriba del marco
          let px = tx;
          let py = ty - (vis.handles ? 38 : 12);
          if (over.scale && showH) {
            px = sx;
            py = sy + R + 34;
          } else if (over.rot && showH) {
            px = rx;
            py = ry - R - 8;
          }
          tip.style.left = `${Math.min(Math.max(px, 90), W - 90)}px`;
          tip.style.top = `${Math.max(py, 30)}px`;
        } else tip.style.display = 'none';
      } else {
        screen.center = screen.scale = screen.rot = null;
        screen.handlesShown = false;
        over.scale = over.rot = false;
        for (const e of [hScale, hRot, hScaleHit, hRotHit, stem, rotIcon, scaleIcon]) e.style.display = 'none';
        tip.style.display = 'none';
      }
    },
    dispose() {
      svg.remove();
      tip.remove();
      ghostLabel.remove();
    },
  };
}
