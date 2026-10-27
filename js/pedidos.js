// Pedidos por entregar: cada venta cobrada recibe un número del día y queda
// pendiente hasta que quien sirve la entrega. Los apartados ya pagados no llevan
// número y siguen pendientes los días siguientes hasta que el niño los recoja.
import { h, llenar, toast, vacio, avisarCambio, leerLocal, sonar } from './util.js';
import * as db from './db.js';

export const activo = () => leerLocal('pedidos') !== 'no';

function inicioHoy() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function ventasDeHoy() {
  return db.getRango('ventas', inicioHoy());
}

export async function siguienteTurno() {
  return Math.max(0, ...(await ventasDeHoy()).map(v => v.turno || 0)) + 1;
}

// Apartados pagados de la última semana que el niño todavía no recoge.
export async function apartadosPendientes() {
  return (await db.getRango('ventas', inicioHoy() - 7 * 864e5))
    .filter(v => v.apartado && !v.entregado && !v.cancelada)
    .sort((a, b) => a.fecha - b.fecha);
}

// Todo lo que falta entregar: apartados primero, luego los pedidos del recreo de hoy.
export async function pendientes() {
  const recreo = (await ventasDeHoy())
    .filter(v => !v.apartado && !v.cancelada && v.entregado === false)
    .sort((a, b) => a.fecha - b.fecha);
  return [...await apartadosPendientes(), ...recreo];
}

function haceCuanto(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  return min < 1 ? 'ahorita' : `hace ${min} min`;
}

// "de ayer", "del martes 20"… para apartados que pasaron de un día a otro.
function deCuando(ms) {
  const dias = Math.round((inicioHoy() - new Date(ms).setHours(0, 0, 0, 0)) / 864e5);
  if (dias <= 0) return 'de hoy';
  if (dias === 1) return 'de ayer';
  return 'del ' + new Date(ms).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric' });
}

const etiqueta = v => (v.apartado ? `🎒 ${v.nombre}` : `#${v.turno}${v.nombre ? ' · ' + v.nombre : ''}`);

async function marcar(v, entregado) {
  v.entregado = entregado;
  v.entregadoEn = entregado ? Date.now() : null;
  await db.put('ventas', v);
  avisarCambio();
  if (entregado) {
    sonar('entregado');
    toast(`${v.apartado ? 'Apartado de ' + v.nombre : 'Pedido #' + v.turno} entregado`, { texto: 'Deshacer', fn: () => marcar(v, false) });
  }
}

function tarjeta(v) {
  return h('div', { class: 'pedido' + (v.apartado ? ' apartado' : '') },
    h('div', { class: 'turno' }, v.apartado ? '🎒' : `#${v.turno}`),
    h('div', { class: 'info' },
      v.nombre && h('b', {}, v.nombre),
      v.apartado && h('span', { class: 'etq ok' }, 'Ya pagó'),
      h('ul', {}, v.items.map(i => h('li', {}, `${i.cant} × ${i.nombre}`))),
      h('small', {}, v.apartado ? `Apartado ${deCuando(v.fecha)}` : haceCuanto(v.fecha) + (v.pago === 'cuenta' ? ' · fiado' : ''))),
    h('button', { class: 'btn verde', onclick: () => marcar(v, true) }, '✔ Entregado'));
}

export async function render(el) {
  const pend = await pendientes();
  const apartados = pend.filter(v => v.apartado);
  const recreo = pend.filter(v => !v.apartado);
  const desde = inicioHoy();
  const entregados = (await db.getRango('ventas', desde - 7 * 864e5))
    .filter(v => !v.cancelada && v.entregado === true && (v.entregadoEn || v.fecha) >= desde)
    .sort((a, b) => (b.entregadoEn || b.fecha) - (a.entregadoEn || a.fecha))
    .slice(0, 10);

  llenar(el,
    apartados.length > 0 && [
      h('h2', { style: 'margin-top:4px' }, `🎒 Apartados (ya pagados): ${apartados.length}`),
      h('div', { class: 'lista' }, apartados.map(tarjeta)),
      h('h2', {}, '🍽️ Pedidos del recreo'),
    ],
    recreo.length
      ? h('div', { class: 'lista' }, recreo.map(tarjeta))
      : vacio('🍽️', 'No hay pedidos por entregar. Aquí aparecen en cuanto se cobran.'),
    entregados.length > 0 && [
      h('h2', {}, '✔ Entregados hace poco'),
      h('div', { class: 'lista' }, entregados.map(v => h('div', { class: 'item' },
        h('div', { class: 'info' },
          h('b', {}, etiqueta(v)),
          h('small', {}, v.items.map(i => `${i.cant}× ${i.nombre}`).join(', '))),
        h('button', { class: 'btn', onclick: () => marcar(v, false), 'aria-label': 'Regresar a pendientes' }, '↩️')))),
    ]);
}
