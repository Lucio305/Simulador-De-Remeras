// Lista fija de los pasos de fabricación (para la bienvenida y el informe final).
// Se hardcodea a propósito: importar ./index.js desde un paso arma un import circular.
// Los nombres cortos son los mismos que usa la barra de pasos (`short` de cada paso).

export const PROCESS = [
  { id: 'tela', icon: '🧶', short: 'Tela', title: 'Elegir la tela', tip: 'Tipo, color y jaspeado' },
  { id: 'hilo', icon: '🧵', short: 'Hilo', title: 'Hilo y aguja', tip: 'El hilo y la aguja justos para tu tela' },
  { id: 'molde', icon: '📐', short: 'Molde', title: 'Talle y molde', tip: 'Talle, calce, mangas y cuello' },
  { id: 'prelavado', icon: '🫧', short: 'Prelavado', title: 'Prelavado de la tela', tip: 'Que encoja antes de cortar, no después' },
  { id: 'tizado', icon: '🖍️', short: 'Tizado', title: 'Tizado de moldes', tip: 'Acomodar moldes respetando el hilo' },
  { id: 'corte', icon: '✂️', short: 'Corte', title: 'Cortar la tela', tip: 'Tijera o cúter, siguiendo la tiza' },
  { id: 'costura', icon: '🪡', short: 'Costura', title: 'Coser a máquina', tip: 'Hombros, cuello, mangas, costados y ruedos' },
  { id: 'planchado', icon: '♨️', short: 'Planchado', title: 'Planchado', tip: 'Temperatura justa y vapor, sin quemar' },
  { id: 'diseno', icon: '🎨', short: 'Diseño', title: 'Diseño del estampado', tip: 'Técnica, imagen y ubicación' },
  { id: 'estampar', icon: '🖨️', short: 'Estampado', title: 'Estampar', tip: 'Prensa, serigrafía, bordado o pintura' },
  { id: 'terminaciones', icon: '🔍', short: 'Terminaciones', title: 'Terminaciones y control de calidad', tip: 'Hilos sueltos, etiqueta y doblado' },
];

export const processById = (id) => PROCESS.find((p) => p.id === id) || null;
