// Materiales de tela procedurales: jersey, piqué, lino, mesh, modal y ribb.
// Las texturas (normal, rugosidad y variación de albedo) se generan una sola vez
// por tejido (weaves.js + textures.js), son TILEABLES y se repiten con las uv en
// METROS (texture.repeat = 1 / tamaño del tile). El "sheen" de
// MeshPhysicalMaterial es lo que le da el brillo aterciopelado de tela.

import * as THREE from 'three';
import { FABRICS, fabricById, threadById } from '../data/catalog.js';
import { clamp } from '../core/utils.js';
import { WEAVE_DEFS } from './weaves.js';
import { renderSwatch, swatchBaseJob, swatchInternalSize } from './swatch.js';
import { normalizeHex, hexToLinear, heatherTones, heatherPixel, sheenColorFor, encodeSrgb } from './color.js';
import { getWeaveState, getHeatherTexture, getMacroTexture, shareTexture, texturesReady, whenWeaveFull, enqueue, MACRO_SIZE } from './textures.js';

export const WEAVES = ['jersey', 'jersey_fino', 'pique', 'lino', 'mesh', 'modal'];
export { normalizeHex, heatherTones };

const materials = new Map(); // clave → material
const swatches = new Map(); // clave → dataURL
const normalClones = new Map(); // tejido → clon del normal map (getWeaveNormalTexture)

// ---------------------------------------------------------------------------
// Tejidos
// ---------------------------------------------------------------------------

// Acepta id de tela del catálogo o id de tejido.
export function weaveOf(fabricOrWeave) {
  if (WEAVE_DEFS[fabricOrWeave]) return fabricOrWeave;
  const f = fabricById(fabricOrWeave);
  return f ? f.weave : 'jersey';
}

// Metros que ocupa una repetición del normal map del tejido.
export function tileSizeOf(weave) {
  const def = WEAVE_DEFS[weaveOf(weave)];
  return def ? def.tile : 0.012;
}

// Normal map del tejido (tileable, repeat ya seteado para uv en metros). Es un clon
// que comparte la imagen: se le puede cambiar repeat/offset (o clonarlo) sin
// afectar a las telas. Se entrega siempre en calidad final (si el tejido todavía
// se estaba generando en segundo plano, se termina en el momento).
export function getWeaveNormalTexture(weave) {
  const w = weaveOf(weave);
  const st = getWeaveState(w, { sync: true });
  let t = normalClones.get(w);
  if (!t) {
    t = shareTexture(st.tex.normal);
    normalClones.set(w, t);
  }
  return t;
}

function resolveFabric(fabricId) {
  const f = fabricById(fabricId);
  if (f) return f;
  if (WEAVE_DEFS[fabricId]) {
    // se pidió un tejido directo: uso la primera tela del catálogo con ese tejido
    return FABRICS.find((x) => x.weave === fabricId) || { ...FABRICS[0], weave: fabricId };
  }
  return FABRICS[0];
}

// ---------------------------------------------------------------------------
// Parámetros de brillo
// ---------------------------------------------------------------------------

// Sheen: el catálogo trae `sheen` 0..1 (algodón bajo, modal/poliéster alto); lo
// llevo a un rango donde el brillo rasante se note.
function sheenParams(fab, weave, hex) {
  const s = clamp(fab.sheen ?? 0.4, 0, 1);
  return {
    sheen: 0.45 + 0.55 * s,
    sheenColor: sheenColorFor(hex, 0.3 + 0.3 * s),
    sheenRoughness: WEAVE_DEFS[weave].sheenRoughness,
  };
}

// Especular por tejido: el algodón casi no tiene reflejo (todo es sheen); el
// poliéster y el modal sí.
const SPECULAR = { jersey: 0.35, jersey_fino: 0.4, pique: 0.3, lino: 0.3, mesh: 0.75, modal: 0.65, rib: 0.35 };

// Intensidad de cada canal de la capa macro por tejido: [nubes, barré, vetas].
const MACRO_AMP = {
  jersey: [0.075, 0.04, 0],
  jersey_fino: [0.07, 0.04, 0],
  pique: [0.07, 0.03, 0],
  lino: [0.08, 0, 0.07],
  mesh: [0.05, 0.02, 0],
  modal: [0.06, 0.03, 0],
  rib: [0.06, 0.03, 0],
};

// Inyecta la capa macro (variación de tono a escala de centímetros, ver
// textures.js) en el shader, después del map. Todas las telas comparten el mismo
// programa: lo que cambia (escala, intensidad) son uniforms.
function addMacroLayer(m, weave, mapTex, heather) {
  const amp = (MACRO_AMP[weave] || MACRO_AMP.jersey).slice();
  if (heather) amp[0] *= 1.8; // el jaspeado tiene más "nubes"
  const uniforms = {
    tTelaMacro: { value: getMacroTexture() },
    telaMacroScale: { value: 1 / (mapTex.repeat.x * MACRO_SIZE) },
    telaMacroAmp: { value: new THREE.Vector3(amp[0], amp[1], amp[2]) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        '#include <map_pars_fragment>\nuniform sampler2D tTelaMacro;\nuniform float telaMacroScale;\nuniform vec3 telaMacroAmp;',
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          '#ifdef USE_MAP',
          '{',
          '  // vMapUv * escala = coordenadas de la textura macro (metros / MACRO_SIZE)',
          '  vec3 telaM = texture2D( tTelaMacro, vMapUv * telaMacroScale ).rgb - 0.5;',
          '  diffuseColor.rgb *= 1.0 + dot( telaM, telaMacroAmp ) * 2.0;',
          '}',
          '#endif',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'tela-macro-v1';
}

// ---------------------------------------------------------------------------
// Materiales
// ---------------------------------------------------------------------------

function buildFabricMaterial(fab, weave, hex, { heather, vertexColors, side, name }) {
  const st = getWeaveState(weave);
  const T = st.tex;
  const def = WEAVE_DEFS[weave];
  const ns = def.normalScale;
  const sh = sheenParams(fab, weave, hex);
  const m = new THREE.MeshPhysicalMaterial({
    name,
    color: heather ? 0xffffff : new THREE.Color(hex),
    map: heather ? getHeatherTexture(weave, hex) : T.albedo,
    normalMap: T.normal,
    normalScale: new THREE.Vector2(ns, ns),
    // el roughnessMap multiplica: compenso su promedio para respetar el catálogo
    roughness: clamp((fab.roughness ?? 0.9) / st.data.roughMean, 0.05, 1),
    roughnessMap: T.rough,
    metalness: 0,
    specularIntensity: SPECULAR[weave] ?? 0.4,
    sheen: sh.sheen,
    sheenColor: sh.sheenColor,
    sheenRoughness: sh.sheenRoughness,
    side,
    vertexColors: !!vertexColors,
  });
  addMacroLayer(m, weave, m.map, heather);
  // con la versión completa, ajusto la rugosidad al promedio real del mapa
  const baseRough = fab.roughness ?? 0.9;
  whenWeaveFull(st, (s2) => (m.roughness = clamp(baseRough / s2.data.roughMean, 0.05, 1)));
  m.userData.shared = true;
  m.userData.fabricId = fab.id;
  m.userData.weave = weave;
  m.userData.color = hex;
  m.userData.heather = !!heather;
  return m;
}

export function getFabricMaterial(fabricId, colorHex, { heather = false, vertexColors = false, side = THREE.DoubleSide } = {}) {
  const fab = resolveFabric(fabricId);
  const hex = normalizeHex(colorHex);
  const key = `tela|${fab.id}|${fab.weave}|${hex}|${!!heather}|${!!vertexColors}|${side}`;
  let m = materials.get(key);
  if (!m) {
    m = buildFabricMaterial(fab, fab.weave, hex, { heather, vertexColors, side, name: `tela-${fab.id}-${hex}${heather ? '-jaspeado' : ''}` });
    materials.set(key, m);
  }
  return m;
}

// Acanalado 1x1 para cuello y ribetes. Los canales corren a lo largo de v
// (verticales en la textura): en una tira con u a lo largo del escote quedan
// perpendiculares al borde, como en un cuello real.
export function getRibMaterial(fabricId, colorHex, { heather = false, vertexColors = false, side = THREE.DoubleSide } = {}) {
  const fab = resolveFabric(fabricId);
  const hex = normalizeHex(colorHex);
  const key = `ribb|${fab.id}|${hex}|${!!heather}|${!!vertexColors}|${side}`;
  let m = materials.get(key);
  if (!m) {
    // el ribb es siempre de punto: tomo rugosidad/sheen de la tela, con un poco más de cuerpo
    const ribFab = { ...fab, roughness: Math.min(1, (fab.roughness ?? 0.9) + 0.02) };
    m = buildFabricMaterial(ribFab, 'rib', hex, { heather, vertexColors, side, name: `ribb-${fab.id}-${hex}` });
    materials.set(key, m);
  }
  return m;
}

// Hilo para puntadas, carreteles e hilos sueltos. El brillo sale de THREADS[].sheen:
// rayón muy brillante (satinado, con reflejo estirado), algodón mate. Opciones:
// `repeat` = repeticiones del surco retorcido en uv normalizadas (por defecto
// pensado para un carretel: u alrededor, v a lo largo del eje) y `side`.
export function getThreadMaterial(colorHex, threadId = 'poliester', { repeat = [2, 40], side = THREE.FrontSide } = {}) {
  const th = threadById(threadId) || threadById('poliester');
  const hex = normalizeHex(colorHex);
  const key = `hilo|${th.id}|${hex}|${repeat.join('x')}|${side}`;
  let m = materials.get(key);
  if (!m) {
    const T = getWeaveState('thread').tex;
    const normal = shareTexture(T.normal);
    const rough = shareTexture(T.rough);
    normal.repeat.set(repeat[0], repeat[1]);
    rough.repeat.set(repeat[0], repeat[1]);
    const s = th.sheen; // 0.2 (algodón) .. 1 (rayón)
    m = new THREE.MeshPhysicalMaterial({
      name: `hilo-${th.id}-${hex}`,
      color: new THREE.Color(hex),
      normalMap: normal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: clamp(0.86 - 0.52 * s, 0.25, 1),
      roughnessMap: rough,
      metalness: 0,
      specularIntensity: 0.4 + 0.6 * s,
      sheen: 0.3 + 0.6 * s,
      sheenColor: sheenColorFor(hex, 0.3 + 0.4 * s),
      sheenRoughness: 0.7 - 0.35 * s,
      // fibras alineadas: el reflejo se estira a lo ancho del hilo (brillo de carretel)
      anisotropy: s >= 0.4 ? 0.25 + 0.55 * s : 0,
      anisotropyRotation: Math.PI / 2,
      side,
    });
    m.userData.shared = true;
    m.userData.threadId = th.id;
    m.userData.color = hex;
    materials.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Miniaturas para la UI
// ---------------------------------------------------------------------------

// dataURL de una muestra de tela iluminada de costado, con una onda suave.
// heather: si no se indica, usa el de la tela (p. ej. el 50/50 viene jaspeado).
// Opción extra: { pinked: true } recorta los bordes en zigzag (tijera dentada).
export function fabricSwatch(fabricId, colorHex, size = 96, { heather, pinked = false } = {}) {
  const fab = resolveFabric(fabricId);
  const hex = normalizeHex(colorHex);
  const hth = heather === undefined ? !!fab.heather : !!heather;
  const key = `${fab.id}|${hex}|${size}|${hth}|${pinked}`;
  let url = swatches.get(key);
  if (!url) {
    const sh = sheenParams(fab, fab.weave, hex);
    const canvas = renderSwatch({
      weave: fab.weave,
      color: hexToLinear(hex),
      tones: hth ? heatherTones(hex) : null,
      sheen: sh.sheen,
      sheenColor: sh.sheenColor.toArray(),
      roughness: fab.roughness ?? 0.9,
      specular: SPECULAR[fab.weave] ?? 0.4,
      size,
      pinked,
      encode: encodeSrgb,
      heatherPixel,
    });
    url = canvas.toDataURL('image/png');
    swatches.set(key, url);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Precarga
// ---------------------------------------------------------------------------
// Las texturas se generan solas la primera vez que se piden (versión rápida al
// instante + versión completa en segundo plano). Estas funciones sirven para
// adelantar ese trabajo, p. ej. durante la pantalla de carga.

const ALL_WEAVES = [...WEAVES, 'rib', 'thread'];

// Genera ya (sincrónico) la versión completa de los tejidos indicados.
export function preloadWeaves(weaves = ALL_WEAVES) {
  for (const w of weaves) if (WEAVE_DEFS[w]) getWeaveState(w, { sync: true });
}

// Encola en segundo plano la generación de los tejidos y de las bases de sus
// miniaturas (para `swatchSize`, 0 = no). Devuelve una promesa que se resuelve
// cuando está todo listo. Ideal para llamar apenas arranca el juego.
export function preloadWeavesIdle(weaves = ALL_WEAVES, { swatchSize = 96 } = {}) {
  for (const w of weaves) if (WEAVE_DEFS[w]) getWeaveState(w);
  if (swatchSize) {
    const S = swatchInternalSize(swatchSize);
    for (const w of new Set(FABRICS.map((f) => f.weave))) if (weaves.includes(w)) enqueue(swatchBaseJob(w, S, false));
    // y una miniatura de muestra, para que el primer pedido real ya sea rápido
    enqueue(
      (function* () {
        yield;
        fabricSwatch(FABRICS[0].id, '#ffffff', swatchSize);
      })(),
    );
  }
  return texturesReady();
}

// Promesa: todas las texturas de tela pedidas hasta ahora están en calidad final.
export function fabricTexturesReady() {
  return texturesReady();
}
