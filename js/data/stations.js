// Distribución del taller (unidades = metros, Y hacia arriba).
// El piso está en y = 0, la pared del fondo en z = -3.2 y la cámara
// mira normalmente hacia -z. Cada estación define dónde está su mueble
// principal (`anchor`) y una vista de cámara por defecto.

export const ROOM = {
  minX: -7,
  maxX: 7,
  backZ: -3.2,
  frontZ: 4.5,
  height: 3.2,
};

export const STATIONS = {
  entrada: {
    name: 'Taller',
    anchor: [0, 0, -1],
    view: { position: [0, 2.7, 7.2], target: [0, 1.0, -1.0] },
  },
  materiales: {
    name: 'Depósito de materiales',
    // estantería con rollos de tela contra la pared del fondo
    anchor: [-5.4, 0, -2.85],
    // maniquí de prueba donde se ve la remera con la tela elegida
    preview: [-4.15, 0, -2.0],
    view: { position: [-4.75, 1.55, 0.6], target: [-4.75, 1.2, -2.3] },
  },
  prelavado: {
    name: 'Lavadero',
    // lavarropas de carga frontal
    anchor: [-3.0, 0, -2.75],
    view: { position: [-2.9, 1.45, -0.95], target: [-3.0, 0.6, -2.7] },
  },
  corte: {
    name: 'Mesa de corte',
    // centro de la tapa de la mesa (tapa a 0.9 m), tapa de 2.0 (x) por 1.3 (z).
    // La tela (1.2 m de ancho, hilo/orillo paralelo al eje X) se extiende sobre ella.
    anchor: [-1.0, 0.9, -1.65],
    size: [2.0, 1.3],
    fabricWidth: 1.2,
    view: { position: [-1.0, 2.95, -0.7], target: [-1.0, 0.9, -1.6] },
  },
  costura: {
    name: 'Máquina de coser',
    // centro de la tapa de la mesa de costura (tapa a 0.76 m)
    anchor: [1.35, 0.76, -2.45],
    size: [1.3, 0.65],
    view: { position: [1.35, 1.5, -1.45], target: [1.35, 0.86, -2.45] },
  },
  planchado: {
    name: 'Tabla de planchar',
    // centro de la superficie de la tabla (a 0.88 m); eje largo en X
    anchor: [3.55, 0.88, -1.95],
    size: [1.25, 0.42],
    view: { position: [3.55, 2.05, -0.85], target: [3.55, 0.88, -1.95] },
  },
  estampado: {
    name: 'Estación de estampado',
    // centro de la tapa de la mesa de estampado (tapa a 0.9 m)
    anchor: [5.55, 0.9, -2.2],
    size: [1.7, 0.85],
    view: { position: [5.45, 1.9, -0.75], target: [5.5, 1.0, -2.2] },
  },
  exhibicion: {
    name: 'Exhibición',
    // base del soporte de exhibición; la remera cuelga con el cuello a ~1.48 m
    anchor: [0.2, 0, 1.0],
    shirtNeck: [0.2, 1.48, 1.0],
    view: { position: [0.2, 1.3, 3.1], target: [0.2, 1.12, 1.0] },
  },
};

export function v3(arr, THREE) {
  return new THREE.Vector3(arr[0], arr[1], arr[2]);
}
