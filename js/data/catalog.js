// Catálogo de materiales, técnicas y parámetros del taller.
// Todo lo que define "qué es correcto" en cada paso del juego vive acá,
// así los pasos puntúan contra los mismos datos.

export const FABRICS = [
  {
    id: 'algodon_jersey',
    name: 'Algodón jersey 24/1',
    short: 'Algodón jersey',
    composition: '100% algodón',
    gsm: 165,
    weave: 'jersey',           // tipo de tejido para la textura procedural
    knit: true,                // tejido de punto (estira) vs plano
    stretch: 0.5,              // 0..1
    wrinkle: 1.0,              // tendencia a arrugarse (multiplicador)
    shrink: 0.05,              // encogimiento sin prelavado
    washTemp: 40,              // °C ideal de prelavado
    ironLevel: 3,              // 1..4 puntos de la plancha
    ironSteam: true,           // se recomienda vapor
    sublimation: 0.15,         // 0..1 qué tan bien toma la sublimación
    roughness: 0.92,
    sheen: 0.35,
    pricePerMeter: 4200,
    desc: 'El clásico de las remeras: suave, fresco y fácil de estampar.',
  },
  {
    id: 'algodon_peinado',
    name: 'Algodón peinado 30/1',
    short: 'Algodón peinado',
    composition: '100% algodón peinado',
    gsm: 150,
    weave: 'jersey_fino',
    knit: true,
    stretch: 0.55,
    wrinkle: 0.9,
    shrink: 0.03,
    washTemp: 30,
    ironLevel: 3,
    ironSteam: true,
    sublimation: 0.15,
    roughness: 0.88,
    sheen: 0.45,
    pricePerMeter: 5600,
    desc: 'Fibra más larga y pareja: tacto premium y superficie lisa ideal para estampas finas.',
  },
  {
    id: 'pique',
    name: 'Piqué de algodón',
    short: 'Piqué',
    composition: '100% algodón',
    gsm: 200,
    weave: 'pique',
    knit: true,
    stretch: 0.3,
    wrinkle: 0.7,
    shrink: 0.04,
    washTemp: 40,
    ironLevel: 3,
    ironSteam: true,
    sublimation: 0.1,
    roughness: 0.95,
    sheen: 0.25,
    pricePerMeter: 6100,
    desc: 'Tejido con relieve de panal, típico de chombas. Firme y respirable.',
  },
  {
    id: 'lino',
    name: 'Lino natural',
    short: 'Lino',
    composition: '100% lino',
    gsm: 185,
    weave: 'lino',
    knit: false,
    stretch: 0.05,
    wrinkle: 1.7,
    shrink: 0.06,
    washTemp: 40,
    ironLevel: 4,
    ironSteam: true,
    sublimation: 0.05,
    roughness: 0.97,
    sheen: 0.15,
    pricePerMeter: 9800,
    desc: 'Tejido plano, muy fresco y con textura irregular. Se arruga muchísimo.',
  },
  {
    id: 'poliester',
    name: 'Poliéster dry-fit',
    short: 'Dry-fit',
    composition: '100% poliéster',
    gsm: 140,
    weave: 'mesh',
    knit: true,
    stretch: 0.6,
    wrinkle: 0.35,
    shrink: 0.01,
    washTemp: 30,
    ironLevel: 1,
    ironSteam: false,
    sublimation: 1.0,
    roughness: 0.62,
    sheen: 0.8,
    pricePerMeter: 3900,
    desc: 'Deportivo, liviano y de secado rápido. El rey de la sublimación. ¡Ojo con la plancha!',
  },
  {
    id: 'modal',
    name: 'Modal de bambú',
    short: 'Modal',
    composition: '95% viscosa de bambú, 5% elastano',
    gsm: 170,
    weave: 'modal',
    knit: true,
    stretch: 0.8,
    wrinkle: 0.6,
    shrink: 0.04,
    washTemp: 30,
    ironLevel: 2,
    ironSteam: false,
    sublimation: 0.2,
    roughness: 0.7,
    sheen: 0.9,
    pricePerMeter: 7400,
    desc: 'Caída fluida, brillo sedoso y muy elástico. Delicado con el calor.',
  },
  {
    id: 'mezcla',
    name: 'Jaspeado 50/50',
    short: 'Jaspeado 50/50',
    composition: '50% algodón, 50% poliéster',
    gsm: 160,
    weave: 'jersey',
    heather: true,             // efecto melange por defecto
    knit: true,
    stretch: 0.5,
    wrinkle: 0.6,
    shrink: 0.025,
    washTemp: 30,
    ironLevel: 2,
    ironSteam: true,
    sublimation: 0.55,
    roughness: 0.86,
    sheen: 0.45,
    pricePerMeter: 4600,
    desc: 'Mezcla con aspecto melange. Estable, no se deforma y acepta sublimación vintage.',
  },
];

export const FABRIC_COLORS = [
  { id: 'blanco', name: 'Blanco', hex: '#f3f1ea' },
  { id: 'crudo', name: 'Crudo', hex: '#e7dcc4' },
  { id: 'gris', name: 'Gris topo', hex: '#9b9a97' },
  { id: 'negro', name: 'Negro', hex: '#1e1e21' },
  { id: 'marino', name: 'Azul marino', hex: '#1f2a46' },
  { id: 'francia', name: 'Azul francia', hex: '#2f5cb6' },
  { id: 'celeste', name: 'Celeste', hex: '#93c6e6' },
  { id: 'verde_agua', name: 'Verde agua', hex: '#8fd0b8' },
  { id: 'militar', name: 'Verde militar', hex: '#4d5426' },
  { id: 'mostaza', name: 'Mostaza', hex: '#cf9a2c' },
  { id: 'amarillo', name: 'Amarillo', hex: '#f1cc4e' },
  { id: 'naranja', name: 'Naranja', hex: '#e5732b' },
  { id: 'rojo', name: 'Rojo', hex: '#b42b2b' },
  { id: 'bordo', name: 'Bordó', hex: '#6a1f2c' },
  { id: 'rosa', name: 'Rosa', hex: '#f0a9c4' },
  { id: 'violeta', name: 'Violeta', hex: '#6b4b9b' },
];

export const THREADS = [
  {
    id: 'poliester',
    name: 'Poliéster 120',
    desc: 'Resistente y con un poco de elasticidad. Sirve para casi todo.',
    strength: 0.9,
    elastic: 0.5,
    sheen: 0.4,
    price: 900,
    goodFor: ['algodon_jersey', 'algodon_peinado', 'pique', 'lino', 'poliester', 'modal', 'mezcla'],
  },
  {
    id: 'algodon',
    name: 'Algodón mercerizado',
    desc: 'Natural y mate. Ideal para tejidos planos; en telas que estiran se puede cortar.',
    strength: 0.6,
    elastic: 0.1,
    sheen: 0.2,
    price: 1100,
    goodFor: ['lino', 'pique'],
  },
  {
    id: 'nylon',
    name: 'Nylon texturizado',
    desc: 'Suave y muy elástico, el preferido para overlock y recubridora en tejidos de punto.',
    strength: 0.75,
    elastic: 1.0,
    sheen: 0.5,
    price: 1300,
    goodFor: ['algodon_jersey', 'algodon_peinado', 'poliester', 'modal', 'mezcla'],
  },
  {
    id: 'rayon',
    name: 'Rayón para bordar',
    desc: 'Brillante y hermoso para bordados… pero poco resistente para armar costuras.',
    strength: 0.3,
    elastic: 0.2,
    sheen: 1.0,
    price: 1500,
    goodFor: [],
  },
];

export const THREAD_THICKNESS = [
  { id: 'fino', name: 'Fino (Tex 18)', maxGsm: 160, minGsm: 0 },
  { id: 'medio', name: 'Medio (Tex 27)', maxGsm: 220, minGsm: 130 },
  { id: 'grueso', name: 'Grueso (Tex 40)', maxGsm: 999, minGsm: 210 },
];

export const NEEDLES = [
  { id: 'punta_bola', name: 'Punta bola (jersey)', desc: 'Separa las fibras sin cortarlas: para tejidos de punto.', forKnit: true },
  { id: 'universal', name: 'Universal', desc: 'Punta levemente redondeada: sirve para planos y algunos punto.', forKnit: null },
  { id: 'microtex', name: 'Microtex (afilada)', desc: 'Muy afilada, para tejidos planos y finos como el lino.', forKnit: false },
];

// Medidas de la prenda terminada en centímetros.
// chest = ancho de pecho (de costado a costado, prenda plana), length = largo total desde el hombro.
export const SIZES = [
  { id: 'XS', chest: 46, length: 66, shoulder: 40 },
  { id: 'S', chest: 49, length: 69, shoulder: 43 },
  { id: 'M', chest: 52, length: 72, shoulder: 46 },
  { id: 'L', chest: 55, length: 74, shoulder: 49 },
  { id: 'XL', chest: 58, length: 76, shoulder: 52 },
  { id: 'XXL', chest: 61, length: 78, shoulder: 55 },
];

export const FITS = [
  { id: 'slim', name: 'Entallada', desc: 'Más ajustada al cuerpo.', chestAdd: -2, lengthAdd: 0, dropShoulder: 0 },
  { id: 'regular', name: 'Clásica', desc: 'El corte de siempre.', chestAdd: 0, lengthAdd: 0, dropShoulder: 0 },
  { id: 'oversize', name: 'Oversize', desc: 'Holgada, hombro caído y mangas anchas.', chestAdd: 6, lengthAdd: 2, dropShoulder: 6 },
];

export const SLEEVES = [
  { id: 'corta', name: 'Manga corta', length: 20 },
  { id: 'larga', name: 'Manga larga', length: 60 },
  { id: 'sin', name: 'Sin mangas', length: 0 },
];

export const NECKS = [
  { id: 'redondo', name: 'Cuello redondo' },
  { id: 'v', name: 'Escote en V' },
];

export const PREWASH = {
  // temperaturas del lavarropas disponibles
  temps: [0, 30, 40, 60, 90], // 0 = frío
  spin: [400, 800, 1200],
  idealSpin: 800,
};

// Plancha: niveles del dial (puntos de la etiqueta de cuidado)
export const IRON_LEVELS = [
  { level: 1, name: '• Baja', temp: 110, label: 'Sintéticos' },
  { level: 2, name: '•• Media', temp: 150, label: 'Lana · Modal · Mezclas' },
  { level: 3, name: '••• Alta', temp: 200, label: 'Algodón' },
  { level: 4, name: '•••• Máxima', temp: 230, label: 'Lino' },
];

// Puntadas disponibles en la mesa de costura.
export const STITCHES = [
  { id: 'recta', name: 'Recta', desc: 'Pespunte clásico. Firme, pero no estira.', elastic: 0.1 },
  { id: 'zigzag', name: 'Zigzag', desc: 'Acompaña el estiramiento del tejido de punto.', elastic: 0.7 },
  { id: 'overlock', name: 'Overlock 4 hilos', desc: 'Une y remata el borde a la vez. Ideal para tejido de punto.', elastic: 0.9 },
  { id: 'recubridora', name: 'Recubridora', desc: 'Doble pespunte elástico para dobladillos profesionales.', elastic: 0.85 },
];

// Costuras del armado. `needs` = pieza requerida; `best` = puntadas ideales
// para tejido de punto (knit) y para tejido plano (woven).
export const SEAMS = [
  { id: 'hombros', name: 'Unir hombros', desc: 'Frente con espalda en los hombros.', pairs: 2, path: 'recta', best: { knit: ['overlock'], woven: ['recta'] } },
  { id: 'cuello', name: 'Pegar el cuello', desc: 'Coser la tira de ribb alrededor del escote.', pairs: 1, path: 'curva', best: { knit: ['overlock', 'zigzag'], woven: ['recta'] } },
  { id: 'mangas', name: 'Pegar mangas', desc: 'Unir las mangas a las sisas.', pairs: 2, path: 'curva', requires: 'mangas', best: { knit: ['overlock'], woven: ['recta'] } },
  { id: 'sisas', name: 'Ribetear sisas', desc: 'Terminar el borde de las sisas con una tira.', pairs: 2, path: 'curva', requires: 'sinMangas', best: { knit: ['recubridora', 'zigzag'], woven: ['recta'] } },
  { id: 'costados', name: 'Cerrar costados', desc: 'Desde el puño hasta el ruedo, de un tirón.', pairs: 2, path: 'larga', best: { knit: ['overlock'], woven: ['recta'] } },
  { id: 'punos', name: 'Ruedo de mangas', desc: 'Dobladillo en la boca de cada manga.', pairs: 2, path: 'recta', requires: 'mangas', best: { knit: ['recubridora', 'zigzag'], woven: ['recta'] } },
  { id: 'ruedo', name: 'Ruedo inferior', desc: 'Dobladillo de la parte de abajo.', pairs: 1, path: 'recta', best: { knit: ['recubridora', 'zigzag'], woven: ['recta'] } },
];

export const MACHINE = {
  stitchLength: { min: 1, max: 5, step: 0.5, ideal: [2.5, 3.5] },  // mm
  tension: { min: 0, max: 9, step: 1, ideal: [3, 5] },
};

// Técnicas de estampado.
// relief = alto de relieve en milímetros (visual), maxColors = 0 sin límite.
// press = parámetros ideales de prensa térmica (si aplica).
export const TECHNIQUES = [
  {
    id: 'serigrafia',
    name: 'Serigrafía (plastisol)',
    icon: '🖌️',
    desc: 'Tinta espesa pasada con racleta a través de un shablón. Colores planos y un relieve suave.',
    relief: 0.35,
    maxColors: 4,
    darkOk: true,
    process: 'screen',
    cure: { temp: 160, time: 60 },
    durability: 0.95,
    cost: 3500,
  },
  {
    id: 'vinilo',
    name: 'Vinilo textil',
    icon: '✂️',
    desc: 'Lámina termotransferible cortada a plotter. Bordes nítidos y terminación satinada.',
    relief: 0.25,
    maxColors: 3,
    darkOk: true,
    process: 'press',
    press: { temp: 150, time: 12, pressure: 2, peel: 'caliente' },
    durability: 0.85,
    cost: 2500,
  },
  {
    id: 'dtf',
    name: 'DTF (film directo)',
    icon: '🖨️',
    desc: 'Impresión a todo color sobre film, transferida con calor. Fina y con colores vivos.',
    relief: 0.1,
    maxColors: 0,
    darkOk: true,
    process: 'press',
    press: { temp: 160, time: 15, pressure: 3, peel: 'frio' },
    durability: 0.85,
    cost: 3000,
  },
  {
    id: 'sublimacion',
    name: 'Sublimación',
    icon: '🌈',
    desc: 'La tinta se vuelve gas y tiñe la fibra: cero relieve. Solo en poliéster y telas claras.',
    relief: 0,
    maxColors: 0,
    darkOk: false,
    process: 'press',
    press: { temp: 200, time: 50, pressure: 2, peel: 'caliente' },
    needsPolyester: true,
    durability: 1.0,
    cost: 1800,
  },
  {
    id: 'bordado',
    name: 'Bordado',
    icon: '🪡',
    desc: 'Puntadas de hilo brillante que forman el diseño. El relieve más artesanal.',
    relief: 1.1,
    maxColors: 6,
    darkOk: true,
    process: 'embroidery',
    durability: 1.0,
    cost: 5200,
  },
  {
    id: 'puff',
    name: 'Tinta puff (inflable)',
    icon: '☁️',
    desc: 'Tinta que se infla con el calor y queda acolchada. Relieve alto y mate.',
    relief: 2.0,
    maxColors: 2,
    darkOk: true,
    process: 'screen',
    cure: { temp: 150, time: 45 },
    durability: 0.8,
    cost: 4200,
  },
  {
    id: 'glitter',
    name: 'Vinilo glitter',
    icon: '✨',
    desc: 'Vinilo con purpurina: brilla con cada movimiento de la luz.',
    relief: 0.35,
    maxColors: 1,
    darkOk: true,
    process: 'press',
    press: { temp: 160, time: 15, pressure: 2, peel: 'caliente' },
    tintable: true,
    durability: 0.8,
    cost: 3200,
  },
  {
    id: 'foil',
    name: 'Foil metalizado',
    icon: '🥇',
    desc: 'Lámina metálica espejada: dorado, plateado o cobre. Muy llamativo.',
    relief: 0.12,
    maxColors: 1,
    darkOk: true,
    process: 'press',
    press: { temp: 150, time: 10, pressure: 3, peel: 'frio' },
    tintable: true,
    durability: 0.65,
    cost: 3600,
  },
  {
    id: 'pintura',
    name: 'Pintura textil a mano',
    icon: '🎨',
    desc: 'Pintás directamente sobre la remera con pincel. Cada pieza es única.',
    relief: 0.2,
    maxColors: 0,
    darkOk: true,
    process: 'paint',
    cure: { temp: 150, time: 180 },
    durability: 0.85,
    cost: 1500,
  },
];

export const FOIL_TINTS = [
  { id: 'oro', name: 'Oro', hex: '#d4af37' },
  { id: 'plata', name: 'Plata', hex: '#c9ccd2' },
  { id: 'cobre', name: 'Cobre', hex: '#c27a4a' },
  { id: 'holo', name: 'Holográfico', hex: '#b9a6ff' },
];

export const GLITTER_TINTS = [
  { id: 'dorado', name: 'Dorado', hex: '#e2b64a' },
  { id: 'plateado', name: 'Plateado', hex: '#d7dbe2' },
  { id: 'rosa', name: 'Rosa', hex: '#ff6fae' },
  { id: 'azul', name: 'Azul', hex: '#3d7bff' },
  { id: 'rojo', name: 'Rojo', hex: '#e23b3b' },
  { id: 'negro', name: 'Negro', hex: '#2a2a2e' },
];

export const STABILIZERS = [
  { id: 'recortable', name: 'Recortable (cut-away)', desc: 'Queda debajo del bordado: el ideal para tejidos de punto.', forKnit: true },
  { id: 'desgarrable', name: 'Desgarrable (tear-away)', desc: 'Se arranca al terminar: para tejidos planos y firmes.', forKnit: false },
  { id: 'soluble', name: 'Hidrosoluble', desc: 'Se disuelve con agua: para telas finas o calados.', forKnit: null },
];

// Pedidos de clientes (modo "Pedidos"). `req` usa ids del catálogo.
// Cualquier campo ausente significa "a gusto del taller".
export const CLIENTS = [
  { name: 'Caro', avatar: '👩‍🎤', text: '¡Hola! Toco en una banda y quiero una remera negra de algodón con algo bien llamativo en serigrafía.', req: { color: 'negro', fabrics: ['algodon_jersey', 'algodon_peinado'], technique: 'serigrafia' }, budget: 32000 },
  { name: 'Don Ernesto', avatar: '👴', text: 'Para el verano necesito algo fresco: lino, color crudo, talle L, y un bordadito chiquito en el pecho.', req: { color: 'crudo', fabrics: ['lino'], size: 'L', technique: 'bordado' }, budget: 45000 },
  { name: 'Lu', avatar: '🏃‍♀️', text: 'Corro maratones. Quiero una remera deportiva blanca, sublimada a todo color. Talle S.', req: { color: 'blanco', fabrics: ['poliester'], size: 'S', technique: 'sublimacion' }, budget: 26000 },
  { name: 'Mati', avatar: '🛹', text: 'Una oversize bien canchera, el color que quieras, con estampa puff. ¡Que tenga relieve!', req: { fit: 'oversize', technique: 'puff' }, budget: 36000 },
  { name: 'Sofi', avatar: '💃', text: 'Es para un cumple temático: rosa, con glitter que brille mucho. Talle XS, manga corta.', req: { color: 'rosa', technique: 'glitter', size: 'XS', sleeve: 'corta' }, budget: 28000 },
  { name: 'Club Atlético Barrio Sur', avatar: '⚽', text: 'Necesitamos una remera de entrenamiento azul francia, dry-fit, con el escudo en vinilo. Talle M.', req: { color: 'francia', fabrics: ['poliester'], technique: 'vinilo', size: 'M' }, budget: 27000 },
  { name: 'Valen', avatar: '🎨', text: 'Quiero una pieza única pintada a mano, en algodón peinado. Manga larga, por favor.', req: { fabrics: ['algodon_peinado'], technique: 'pintura', sleeve: 'larga' }, budget: 34000 },
  { name: 'Joyería Brillo', avatar: '💍', text: 'Una remera elegante de modal, color negro o bordó, con el logo en foil dorado.', req: { colors: ['negro', 'bordo'], fabrics: ['modal'], technique: 'foil' }, budget: 40000 },
  { name: 'Tomi', avatar: '🎮', text: 'Una remera jaspeada con mi personaje favorito en DTF. Talle XL, cuello en V.', req: { fabrics: ['mezcla'], technique: 'dtf', size: 'XL', neck: 'v' }, budget: 30000 },
  { name: 'Huerta La Esperanza', avatar: '🌱', text: 'Remeras sin mangas verde militar para trabajar en la huerta. Que aguanten. Estampa a gusto.', req: { color: 'militar', sleeve: 'sin' }, budget: 25000 },
];

// Costos fijos y extras
export const COSTS = {
  fabricMetersBase: 0.9,     // metros de tela por remera talle M antes de optimizar el tizado
  laborPerStep: 600,         // mano de obra simbólica por paso
  prewash: 400,
  ribbing: 700,
  label: 350,
  hangtag: 250,
  packaging: 500,
  markup: 2.2,               // multiplicador para el precio de venta sugerido
};

// Pesos de cada paso en la nota final de calidad.
export const SCORE_WEIGHTS = {
  tela: 0.6,
  hilo: 0.8,
  molde: 0.4,
  prelavado: 0.6,
  tizado: 0.8,
  corte: 1.2,
  costura: 1.6,
  planchado: 1.0,
  diseno: 0.6,
  estampar: 1.4,
  terminaciones: 1.0,
};

export function findById(list, id) {
  return list.find((x) => x.id === id) || null;
}

export const fabricById = (id) => findById(FABRICS, id);
export const threadById = (id) => findById(THREADS, id);
export const techniqueById = (id) => findById(TECHNIQUES, id);
export const sizeById = (id) => findById(SIZES, id);
export const fitById = (id) => findById(FITS, id);
export const sleeveById = (id) => findById(SLEEVES, id);
export const neckById = (id) => findById(NECKS, id);
export const colorById = (id) => findById(FABRIC_COLORS, id);

export function ironLevelFor(fabricId) {
  const f = fabricById(fabricId);
  return f ? f.ironLevel : 3;
}

// Luminancia relativa aproximada (0 = negro, 1 = blanco) de un color hex.
export function luminance(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
