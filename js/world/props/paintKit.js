// Kit de pintura textil: frascos de colores, paleta con manchas de pintura, pinceles en un
// vaso de agua. `brush` = pincel suelto (origen en la punta de las cerdas, mango hacia +Y).

import { THREE, Batch, std, phys, mesh, lathe, place, vc } from './common.js';
import { drawTexture } from './textures.js';

export const PAINT_COLORS = ['#c42b2b', '#e5732b', '#f1cc4e', '#3f9a6c', '#2f5cb6', '#6b4b9b', '#f3f1ea', '#1e1e21'];

function paletteTexture() {
  return drawTexture(
    256,
    192,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      PAINT_COLORS.slice(0, 7).forEach((c, i) => {
        const a = (i / 7) * Math.PI * 1.4 + Math.PI * 0.8;
        const x = w / 2 + Math.cos(a) * 84;
        const y = h / 2 + Math.sin(a) * 60;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(x, y, 16 + (i % 3) * 3, 11 + (i % 2) * 3, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(x - 4, y - 3, 5, 3, a, 0, Math.PI * 2);
        ctx.fill();
      });
      // mezcla en el centro
      ctx.fillStyle = '#d07a5a';
      ctx.beginPath();
      ctx.ellipse(w / 2 + 6, h / 2 + 10, 26, 14, 0.4, 0, Math.PI * 2);
      ctx.fill();
    },
    { key: 'paleta-manchas' },
  );
}

// Pincel: punta en el origen, mango hacia +Y.
export function createBrush({ color = '#2f5cb6', size = 1 } = {}) {
  const g = new THREE.Group();
  g.name = 'pincel';
  const bristle = lathe([[0, 0], [0.0025 * size, 0.004], [0.0042 * size, 0.012], [0.0045 * size, 0.02], [0, 0.02]], 12);
  g.add(mesh(bristle, std('cerdas', { color: '#c9a77a', roughness: 0.9 }), { cast: true }));
  const tip = lathe([[0, 0], [0.0022 * size, 0.004], [0.0032 * size, 0.009], [0, 0.009]], 10);
  g.add(mesh(tip, phys(`pintura-${color}`, { color, roughness: 0.3, clearcoat: 0.5 })));
  g.add(mesh(new THREE.CylinderGeometry(0.0048 * size, 0.0045 * size, 0.022, 14), std('virola', { color: '#c8ccd0', roughness: 0.25, metalness: 1 }), { p: [0, 0.03, 0] }));
  const handle = lathe([[0.0045, 0], [0.0055, 0.04], [0.0042, 0.13], [0.002, 0.15], [0, 0.152]], 14);
  g.add(mesh(handle, phys('mango-pincel', { color: '#8a3b2a', roughness: 0.3, clearcoat: 0.8 }), { p: [0, 0.041, 0], cast: true }));
  return g;
}

export function createPaintKit({ position, topY, ry = 0 }) {
  const group = new THREE.Group();
  group.name = 'kit-pintura';
  group.position.set(position[0], topY, position[1]);
  group.rotation.y = ry;
  const b = new Batch();
  const glass = phys('frasco-vidrio', { color: '#ffffff', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
  // frascos de pintura (dos filas)
  PAINT_COLORS.forEach((c, i) => {
    const x = -0.12 + (i % 4) * 0.045;
    const z = -0.03 + Math.floor(i / 4) * 0.05;
    const paint = lathe([[0, 0], [0.017, 0], [0.018, 0.035], [0, 0.035]], 16);
    b.add(paint, vc('brillante'), { color: c, p: [x, 0.001, z], uv: 'keep' });
    paint.dispose();
    const jar = lathe([[0.0, 0], [0.019, 0], [0.02, 0.04], [0.016, 0.043], [0.016, 0.048]], 16);
    b.add(jar, glass, { p: [x, 0, z], uv: 'keep' });
    jar.dispose();
    b.cyl(0.0175, 0.0175, 0.012, vc('plastico'), { color: c, p: [x + (i === 2 ? 0.03 : 0), i === 2 ? 0.006 : 0.054, z + (i === 2 ? 0.045 : 0)], seg: 16 });
  });
  // paleta de cerámica con manchas
  const pal = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 32);
  pal.scale(1.25, 1, 1);
  b.add(pal, std('paleta-ceramica', { color: '#f4f1ea', roughness: 0.25 }), { p: [0.1, 0.004, 0.0], uv: 'keep', cast: true });
  pal.dispose();
  const palDecal = new THREE.PlaneGeometry(0.18, 0.135);
  b.add(palDecal, std('paleta-manchas', { map: paletteTexture(), transparent: true, roughness: 0.3 }), { p: [0.1, 0.0085, 0.0], r: [-Math.PI / 2, 0, 0], uv: 'keep' });
  palDecal.dispose();
  // vaso de agua con pinceles
  const cup = lathe([[0, 0], [0.026, 0], [0.03, 0.1], [0.029, 0.1]], 20);
  b.add(cup, glass, { p: [0.05, 0, 0.075], uv: 'keep' });
  cup.dispose();
  const water = lathe([[0, 0.002], [0.026, 0.002], [0.028, 0.06], [0, 0.06]], 20);
  b.add(water, phys('agua-turbia', { color: '#a7b9c9', roughness: 0.1, transparent: true, opacity: 0.45, depthWrite: false }), { p: [0.05, 0, 0.075], uv: 'keep' });
  water.dispose();
  b.flush(group, 'kit-pintura');
  // pinceles decorativos en el vaso
  ['#c42b2b', '#f1cc4e'].forEach((c, i) => {
    const br = createBrush({ color: c, size: 0.8 + i * 0.3 });
    place(br, [0.05 + (i - 0.5) * 0.012, 0.006, 0.075], [0.18 * (i ? 1 : -1), 0, 0.15 * (i ? -1 : 1)]);
    group.add(br);
  });
  return { group };
}
