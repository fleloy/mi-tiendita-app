// Pedidos por entregar: cada venta cobrada recibe un número del día y queda
// pendiente hasta que quien sirve la entrega.
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

export async function pendientes() {
  return (await ventasDeHoy()).filter(v => !v.cancelada && v.entregado === false).sort((a, b) => a.fecha - b.fecha);
}

function haceCuanto(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  return min < 1 ? 'ahorita' : `hace ${min} min`;
}

async function marcar(v, entregado) {
  v.entregado = entregado;
  await db.put('ventas', v);
  avisarCambio();
  if (entregado) sonar('entregado');
  if (entregado) toast(`Pedido #${v.turno} entregado`, { texto: 'Deshacer', fn: () => marcar(v, false) });
}

export async function render(el) {
  const pend = await pendientes();
  const entregados = (await ventasDeHoy())
    .filter(v => !v.cancelada && v.entregado === true)
    .sort((a, b) => b.fecha - a.fecha)
    .slice(0, 10);

  llenar(el,
    pend.length
      ? h('div', { class: 'lista' }, pend.map(v => h('div', { class: 'pedido' },
        h('div', { class: 'turno' }, `#${v.turno}`),
        h('div', { class: 'info' },
          v.nombre && h('b', {}, v.nombre),
          h('ul', {}, v.items.map(i => h('li', {}, `${i.cant} × ${i.nombre}`))),
          h('small', {}, haceCuanto(v.fecha) + (v.pago === 'cuenta' ? ' · fiado' : ''))),
        h('button', { class: 'btn verde', onclick: () => marcar(v, true) }, '✔ Entregado'))))
      : vacio('🍽️', 'No hay pedidos por entregar. Aquí aparecen en cuanto se cobran.'),
    entregados.length > 0 && [
      h('h2', {}, '✔ Entregados hace poco'),
      h('div', { class: 'lista' }, entregados.map(v => h('div', { class: 'item' },
        h('div', { class: 'info' },
          h('b', {}, `#${v.turno}${v.nombre ? ' · ' + v.nombre : ''}`),
          h('small', {}, v.items.map(i => `${i.cant}× ${i.nombre}`).join(', '))),
        h('button', { class: 'btn', onclick: () => marcar(v, false), 'aria-label': 'Regresar a pendientes' }, '↩️')))),
    ]);
}
