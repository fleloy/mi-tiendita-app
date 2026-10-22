// Guía de bienvenida en 4 pasos. Sale sola la primera vez y se abre desde "Más".
import { h, llenar, modal, leerLocal, guardarLocal } from './util.js';

const PASOS = [
  {
    icono: '📦',
    titulo: '1. Revisa tu menú',
    texto: [
      'En "Productos" están tus platillos con su precio. Toca ✏️ para cambiar un precio o el dibujito.',
      'Agrega uno por uno lo que vendes con "+ Nuevo producto": dibujito, nombre, precio y tipo (Comida, Postres o Bebidas).',
    ],
  },
  {
    icono: '🛒',
    titulo: '2. Cobra en el recreo',
    texto: [
      'En "Vender" toca lo que pide el niño. Si te equivocas, toca el producto en la barra de abajo para quitarlo.',
      'Si el siguiente niño pide lo mismo, toca "🔁 Repetir".',
      'Toca "Cobrar", elige con cuánto te pagó y la app te dice el cambio.',
      'Cada pedido recibe un número. En "Entregar" ves qué servir y lo marcas como entregado.',
    ],
  },
  {
    icono: '📒',
    titulo: '3. Fiado y "se acabó"',
    texto: [
      'Para fiar toca "Fiado / a cuenta" al cobrar y elige al niño o maestro. Te avisa si se pasa de su límite.',
      'El viernes, en "Cuentas", manda la cuenta a los papás por WhatsApp.',
      'Si se acabó un platillo, déjalo presionado en "Vender". Mañana vuelve solo.',
    ],
  },
  {
    icono: '🔒',
    titulo: '4. Cierra el día',
    texto: [
      'En "Ganancias" anota lo que gastaste y toca "Cerrar el día". Cuenta tu caja y la app te dice si cuadra.',
      'Guarda el respaldo y mándatelo por WhatsApp: así nunca pierdes tus datos.',
      'En "Más" puedes poner un PIN para que nadie más vea tus ganancias ni borre cosas.',
      'Para practicar sin miedo, en "Más" activa el Modo práctica.',
    ],
  },
];

export const guiaVista = () => leerLocal('guiaVista') === '1';

export function abrirGuia() {
  let paso = 0;
  const cont = h('div', { class: 'guia' });
  const pintar = () => {
    const p = PASOS[paso];
    const ultimo = paso === PASOS.length - 1;
    llenar(cont,
      h('div', { class: 'guia-icono' }, p.icono),
      h('h3', {}, p.titulo),
      p.texto.map(t => h('p', {}, t)),
      h('div', { class: 'puntos' }, PASOS.map((_, i) => h('i', { class: i === paso ? 'sel' : '' }))),
      h('div', { class: 'fila' },
        paso > 0 && h('button', { class: 'btn', onclick: () => { paso--; pintar(); } }, '← Atrás'),
        h('button', { class: 'btn primario', onclick: () => { if (ultimo) m.cerrar(); else { paso++; pintar(); } } },
          ultimo ? '¡Listo!' : 'Siguiente →')));
  };
  const m = modal('Cómo se usa', cont, { onClose: () => guardarLocal('guiaVista', '1') });
  pintar();
}
