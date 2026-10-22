// Orden de los pasos del proceso de fabricación.
import inicio from './inicio.js';
import tela from './tela.js';
import hilo from './hilo.js';
import molde from './molde.js';
import prelavado from './prelavado.js';
import tizado from './tizado.js';
import corte from './corte.js';
import costura from './costura.js';
import planchado from './planchado.js';
import diseno from './diseno.js';
import estampar from './estampar.js';
import terminaciones from './terminaciones.js';
import final from './final.js';

export const STEPS = [inicio, tela, hilo, molde, prelavado, tizado, corte, costura, planchado, diseno, estampar, terminaciones, final];
