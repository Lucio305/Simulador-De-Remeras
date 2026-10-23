// Pintura a mano sobre la remera: un lienzo 2D por lado que cubre el área estampable
// (coordenadas "vista desde ese lado") + pinceladas 3D instantáneas (discos instanciados
// pegados a la superficie) mientras se pinta. Al soltar, el paso procesa el lienzo con la
// técnica de pintura textil y reemplaza las pinceladas provisorias por la estampa real.

const PX_PER_M = 1500; // 1,5 px por mm
const MAX_UNDO = 14;

export function createPainter({ THREE, shirt, pattern, maxDabs = 7000 }) {
  const sides = {};
  for (const side of ['frente', 'espalda']) {
    const a = pattern.printArea[side];
    const w = Math.max(8, Math.round((a.maxX - a.minX) * PX_PER_M));
    const h = Math.max(8, Math.round((a.maxY - a.minY) * PX_PER_M));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    sides[side] = { area: a, canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }), undo: [], dirty: false, empty: true, version: 0 };
  }

  // ---- pinceladas 3D provisorias ----
  const geo = new THREE.CircleGeometry(1, 18);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 });
  const dabs = new THREE.InstancedMesh(geo, mat, maxDabs);
  dabs.name = 'pinceladas';
  dabs.count = 0;
  dabs.frustumCulled = false;
  dabs.renderOrder = 3;
  dabs.castShadow = false;
  dabs.receiveShadow = true;
  dabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dabs.setColorAt(0, new THREE.Color('#ffffff'));
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _z = new THREE.Vector3(0, 0, 1);
  const _c = new THREE.Color();
  const _tw = new THREE.Quaternion();

  let stroke = null; // { side, color, rM, erase, fabricHex, last: {vx, y}, spin }

  const toPx = (S, vx, y) => [(vx - S.area.minX) * PX_PER_M, (S.area.maxY - y) * PX_PER_M];
  const inArea = (S, vx, y, m = 0) => vx >= S.area.minX - m && vx <= S.area.maxX + m && y >= S.area.minY - m && y <= S.area.maxY + m;

  function addDab(side, vx, y, rM, hex, spin) {
    if (dabs.count >= maxDabs) return;
    const S = sides[side];
    if (!inArea(S, vx, y, rM * 0.6)) return;
    const gx = side === 'espalda' ? -vx : vx;
    const { position, normal } = shirt.garmentToLocal(side, gx, y, 0.0011 + rM * 0.015);
    _q.setFromUnitVectors(_z, normal);
    // un poco de irregularidad: discos apenas ovalados y girados (aspecto de pincel)
    _q.multiply(_tw.setFromAxisAngle(_z, spin));
    _s.set(rM * 1.08, rM * 0.92, 1);
    _m.compose(position, _q, _s);
    dabs.setMatrixAt(dabs.count, _m);
    dabs.setColorAt(dabs.count, _c.set(hex));
    dabs.count++;
    dabs.instanceMatrix.needsUpdate = true;
    if (dabs.instanceColor) dabs.instanceColor.needsUpdate = true;
  }

  function drawSeg(S, ax, ay, bx, by) {
    const ctx = S.ctx;
    ctx.save();
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.erase ? '#000' : stroke.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.rM * 2 * PX_PER_M;
    const [x0, y0] = toPx(S, ax, ay);
    const [x1, y1] = toPx(S, bx, by);
    ctx.beginPath();
    if (Math.hypot(x1 - x0, y1 - y0) < 0.5) {
      ctx.arc(x0, y0, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
    S.dirty = true;
  }

  function dabLine(side, ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay);
    const step = Math.max(0.0012, stroke.rM * 0.45);
    const n = Math.max(1, Math.ceil(len / step));
    const hex = stroke.erase ? stroke.fabricHex : stroke.color;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      stroke.spin += 0.7;
      addDab(side, ax + (bx - ax) * t, ay + (by - ay) * t, stroke.rM, hex, stroke.spin);
    }
  }

  function snapshot(S) {
    S.undo.push(S.ctx.getImageData(0, 0, S.canvas.width, S.canvas.height));
    if (S.undo.length > MAX_UNDO) S.undo.shift();
  }

  return {
    dabs,
    pxPerM: PX_PER_M,
    sides,
    get painting() {
      return !!stroke;
    },
    get strokeSide() {
      return stroke?.side || null;
    },
    // Empieza una pincelada en (vx, y) (coords vista desde ese lado).
    begin(side, vx, y, { color = '#c42b2b', sizeMm = 10, erase = false, fabricHex = '#ffffff' } = {}) {
      const S = sides[side];
      if (!S) return;
      snapshot(S);
      stroke = { side, color, rM: Math.max(0.0008, sizeMm / 2000), erase, fabricHex, last: { vx, y }, spin: Math.random() * 6 };
      drawSeg(S, vx, y, vx, y);
      addDab(side, vx, y, stroke.rM, erase ? fabricHex : color, stroke.spin);
    },
    to(vx, y) {
      if (!stroke) return;
      const S = sides[stroke.side];
      const l = stroke.last;
      if (Math.hypot(vx - l.vx, y - l.y) < stroke.rM * 0.12) return;
      drawSeg(S, l.vx, l.y, vx, y);
      dabLine(stroke.side, l.vx, l.y, vx, y);
      stroke.last = { vx, y };
    },
    // Termina la pincelada. Devuelve true si cambió el lienzo.
    end() {
      if (!stroke) return false;
      const S = sides[stroke.side];
      stroke = null;
      if (!S.dirty) return false;
      S.dirty = false;
      S.version++;
      S.empty = isEmpty(S);
      return true;
    },
    clearDabs() {
      dabs.count = 0;
      dabs.instanceMatrix.needsUpdate = true;
    },
    canUndo(side) {
      return sides[side].undo.length > 0;
    },
    undo(side) {
      const S = sides[side];
      const img = S.undo.pop();
      if (!img) return false;
      S.ctx.putImageData(img, 0, 0);
      S.version++;
      S.empty = isEmpty(S);
      return true;
    },
    clear(side) {
      const S = sides[side];
      if (S.empty) return false;
      snapshot(S);
      S.ctx.clearRect(0, 0, S.canvas.width, S.canvas.height);
      S.version++;
      S.empty = true;
      return true;
    },
    isEmpty(side) {
      return sides[side].empty;
    },
    version(side) {
      return sides[side].version;
    },
    // Pega un canvas ya pintado (p. ej. al volver al paso) centrado en (vx, y) con ancho cw (m).
    importCanvas(side, src, vx, y, cw) {
      const S = sides[side];
      if (!src || !src.width) return;
      const k = PX_PER_M;
      const w = cw * k;
      const hgt = (w * src.height) / src.width;
      const [cx, cy] = toPx(S, vx, y);
      S.ctx.drawImage(src, cx - w / 2, cy - hgt / 2, w, hgt);
      S.version++;
      S.empty = isEmpty(S);
    },
    // Recorta lo pintado: { canvas, vx, y, cw, ch } (centro en coords vista, ancho/alto del contenido en m).
    extract(side) {
      const S = sides[side];
      if (S.empty) return null;
      const { canvas } = S;
      const w = canvas.width;
      const h = canvas.height;
      const d = S.ctx.getImageData(0, 0, w, h).data;
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      for (let yy = 0; yy < h; yy++) {
        const row = yy * w * 4;
        for (let xx = 0; xx < w; xx++) {
          if (d[row + xx * 4 + 3] > 8) {
            if (xx < x0) x0 = xx;
            if (xx > x1) x1 = xx;
            if (yy < y0) y0 = yy;
            y1 = yy;
          }
        }
      }
      if (x1 < 0) {
        S.empty = true;
        return null;
      }
      const cw = x1 - x0 + 1;
      const ch = y1 - y0 + 1;
      const out = document.createElement('canvas');
      out.width = cw;
      out.height = ch;
      out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
      return {
        canvas: out,
        vx: S.area.minX + (x0 + cw / 2) / PX_PER_M,
        y: S.area.maxY - (y0 + ch / 2) / PX_PER_M,
        cw: cw / PX_PER_M,
        ch: ch / PX_PER_M,
      };
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      dabs.dispose?.();
      for (const s of Object.values(sides)) {
        s.undo.length = 0;
        s.canvas.width = s.canvas.height = 1;
      }
    },
  };

  function isEmpty(S) {
    const { canvas } = S;
    // muestreo rápido: una grilla gruesa alcanza para saber si quedó algo pintado
    const d = S.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < d.length; i += 4 * 3) if (d[i] > 8) return false;
    return true;
  }
}
