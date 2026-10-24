// Reporte del mes: cada día con lo vendido, gastado, ganado y fiado. Se puede guardar como PDF.
import { h, llenar, dinero, r2, modal } from './util.js';
import * as db from './db.js';

export async function datosMes(anio, mes) {
  const inicio = new Date(anio, mes, 1).getTime();
  const fin = new Date(anio, mes + 1, 1).getTime();
  const ventas = (await db.getRango('ventas', inicio, fin)).filter(v => !v.cancelada);
  const gastos = await db.getRango('gastos', inicio, fin);

  const dias = new Map();
  const fila = fecha => {
    const d = new Date(fecha).getDate();
    if (!dias.has(d)) dias.set(d, { dia: d, vendido: 0, gastado: 0, fiado: 0 });
    return dias.get(d);
  };
  const productos = new Map();
  for (const v of ventas) {
    const x = fila(v.fecha);
    x.vendido += v.total;
    if (v.pago === 'cuenta') x.fiado += v.total;
    for (const i of v.items) productos.set(i.nombre, (productos.get(i.nombre) || 0) + i.cant);
  }
  for (const g of gastos) fila(g.fecha).gastado += g.monto;

  const lista = [...dias.values()].sort((a, b) => a.dia - b.dia).map(x => ({
    ...x, vendido: r2(x.vendido), gastado: r2(x.gastado), fiado: r2(x.fiado), ganado: r2(x.vendido - x.gastado),
  }));
  const suma = k => r2(lista.reduce((s, x) => s + x[k], 0));
  return {
    anio, mes, lista,
    total: { vendido: suma('vendido'), gastado: suma('gastado'), ganado: suma('ganado'), fiado: suma('fiado') },
    mejor: lista.reduce((m, x) => (!m || x.vendido > m.vendido ? x : m), null),
    top: [...productos].sort((a, b) => b[1] - a[1]).slice(0, 3),
  };
}

const mayuscula = t => t.charAt(0).toUpperCase() + t.slice(1);
const nombreMes = (anio, mes) => mayuscula(new Date(anio, mes, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }));
const nombreDia = (anio, mes, d) => new Date(anio, mes, d).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });

function tabla(r) {
  const celda = (v, clase = '') => h('td', { class: clase }, dinero(v));
  return h('div', { class: 'reporte-mes' },
    h('h3', {}, `Mi Tiendita — ${nombreMes(r.anio, r.mes)}`),
    r.lista.length
      ? h('table', {},
        h('thead', {}, h('tr', {}, ['Día', 'Vendido', 'Gastado', 'Ganado', 'Fiado'].map(t => h('th', {}, t)))),
        h('tbody', {}, r.lista.map(x => h('tr', {},
          h('td', {}, nombreDia(r.anio, r.mes, x.dia)),
          celda(x.vendido), celda(x.gastado), celda(x.ganado, x.ganado < 0 ? 'debe' : ''), celda(x.fiado)))),
        h('tfoot', {}, h('tr', {},
          h('th', {}, 'Total'),
          celda(r.total.vendido), celda(r.total.gastado), celda(r.total.ganado, r.total.ganado < 0 ? 'debe' : ''), celda(r.total.fiado))))
      : h('p', { class: 'etiqueta' }, 'No hubo ventas ni gastos este mes.'),
    r.mejor && h('p', {}, `🏆 Mejor día: ${nombreDia(r.anio, r.mes, r.mejor.dia)} con ${dinero(r.mejor.vendido)}`),
    r.top.length > 0 && h('p', {}, `Lo que más se vendió: ${r.top.map(([n, c]) => `${n} (${c})`).join(', ')}`));
}

// Imprime solo el reporte: lo copia a un contenedor que el CSS de impresión deja visible.
function imprimir(nodo) {
  const zona = h('div', { id: 'impresion' }, nodo.cloneNode(true));
  document.body.append(zona);
  document.body.classList.add('imprimiendo');
  const limpiar = () => { zona.remove(); document.body.classList.remove('imprimiendo'); };
  window.addEventListener('afterprint', limpiar, { once: true });
  window.print();
  setTimeout(limpiar, 1000); // por si el navegador no avisa "afterprint"
}

export function abrirReporteMes() {
  const hoy = new Date();
  let anio = hoy.getFullYear();
  let mes = hoy.getMonth();
  const cont = h('div');
  const pintar = async () => {
    const r = await datosMes(anio, mes);
    const esteMes = anio === hoy.getFullYear() && mes === hoy.getMonth();
    const reporte = tabla(r);
    llenar(cont,
      h('div', { class: 'fila mes-nav' },
        h('button', { class: 'btn', 'aria-label': 'Mes anterior', onclick: () => { mes--; if (mes < 0) { mes = 11; anio--; } pintar(); } }, '←'),
        h('b', {}, nombreMes(anio, mes)),
        h('button', { class: 'btn', 'aria-label': 'Mes siguiente', disabled: esteMes, onclick: () => { mes++; if (mes > 11) { mes = 0; anio++; } pintar(); } }, '→')),
      reporte,
      r.lista.length > 0 && h('button', { class: 'btn primario grande', style: 'margin-top:12px', onclick: () => imprimir(reporte) }, '🖨️ Guardar como PDF'));
  };
  modal('📅 Reporte del mes', cont);
  pintar();
}
