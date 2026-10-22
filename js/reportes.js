// Ganancias = lo vendido − lo gastado. Cierre del día, gastos, cuánto preparar y lo más vendido.
import { h, llenar, dinero, fechaCorta, toast, formulario, confirmar, avisarCambio, compartirTexto } from './util.js';
import * as db from './db.js';
import { calcularResumen, cerrarDia, cierresRecientes, filaCierre } from './cierre.js';
import { sugerencia } from './preparar.js';
import { resumenSemana, textoResumen, graficaSemana } from './semana.js';

const PERIODOS = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  semana: '7 días',
  mes: 'Este mes',
};
const GASTOS_COMUNES = ['Pollo', 'Tortillas', 'Gas', 'Desechables', 'Verdura', 'Harina'];
let periodo = 'hoy';
let cuantasVentas = 30;

// Lista de ventas del periodo para revisar o cancelar una que se cobró por error.
function seccionVentas(todas, el) {
  const hora = ms => new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const fila = v => h('div', { class: 'item venta' + (v.cancelada ? ' cancelada' : '') },
    h('div', { class: 'info' },
      h('b', {}, v.items.map(i => `${i.cant}× ${i.nombre}`).join(', ')),
      h('small', {}, [
        periodo === 'hoy' ? hora(v.fecha) : fechaCorta(v.fecha),
        v.turno && `#${v.turno}`,
        v.pago === 'cuenta' ? `fiado a ${v.clienteNombre || '?'}` : 'efectivo',
        v.cancelada && 'CANCELADA',
      ].filter(Boolean).join(' · '))),
    h('div', { class: 'der' }, dinero(v.total)),
    !v.cancelada && h('button', { class: 'btn', 'aria-label': 'Cancelar venta', onclick: async () => {
      const extra = v.pago === 'cuenta' ? ` Se le quitará de la cuenta a ${v.clienteNombre}.` : '';
      if (!await confirmar(`¿Cancelar la venta de ${dinero(v.total)}?${extra}`, 'Cancelar venta')) return;
      await db.cancelarVenta(v.id);
      toast('Venta cancelada');
      avisarCambio();
    } }, '✕'));
  return [
    h('h2', {}, `🧾 Ventas (${todas.filter(v => !v.cancelada).length})`),
    todas.length
      ? h('div', { class: 'lista' }, todas.slice(0, cuantasVentas).map(fila))
      : h('p', { class: 'etiqueta' }, 'Sin ventas en este periodo'),
    todas.length > cuantasVentas && h('button', { class: 'btn grande', style: 'margin-top:8px', onclick: () => { cuantasVentas += 50; render(el); } }, 'Ver más ventas'),
  ];
}

function rango(p) {
  const inicioHoy = new Date(); inicioHoy.setHours(0, 0, 0, 0);
  const t = inicioHoy.getTime();
  if (p === 'ayer') return [t - 864e5, t];
  if (p === 'semana') return [t - 6 * 864e5, Infinity];
  if (p === 'mes') return [new Date(inicioHoy.getFullYear(), inicioHoy.getMonth(), 1).getTime(), Infinity];
  return [t, Infinity];
}

async function anotarGasto(valores = {}) {
  const v = await formulario('🧾 Anotar gasto', [
    { name: 'concepto', label: '¿En qué gastaste?', required: true, placeholder: 'Ej. pollo, tortillas, gas, desechables' },
    { name: 'monto', label: '¿Cuánto? ($)', type: 'number', min: 1, required: true },
    { name: 'deCaja', label: 'Lo pagué con dinero de la caja de hoy', type: 'checkbox' },
  ], valores);
  if (!v || v.monto <= 0) return;
  await db.put('gastos', { ...v, fecha: Date.now() });
  toast('Gasto anotado');
  avisarCambio();
}

// Los conceptos que más anota, con el último monto que usó; si aún no hay, unos comunes.
async function gastosRapidos() {
  const frec = new Map();
  for (const g of (await db.getAll('gastos')).sort((a, b) => a.fecha - b.fecha)) {
    const clave = g.concepto.trim().toLowerCase();
    const x = frec.get(clave) || { concepto: g.concepto.trim(), n: 0 };
    x.n++;
    x.monto = g.monto;
    x.deCaja = g.deCaja;
    frec.set(clave, x);
  }
  const lista = [...frec.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  for (const c of GASTOS_COMUNES) {
    if (lista.length >= 6) break;
    if (!frec.has(c.toLowerCase())) lista.push({ concepto: c });
  }
  return lista;
}

export async function render(el) {
  const [desde, hasta] = rango(periodo);
  const r = await calcularResumen(desde, hasta);
  const rapidos = await gastosRapidos();
  const prep = await sugerencia();
  const semana = await resumenSemana();
  const cierres = await cierresRecientes();
  const todas = (await db.getRango('ventas', desde, hasta)).sort((a, b) => b.fecha - a.fecha);

  const porProducto = new Map();
  for (const v of r.ventas) {
    for (const it of v.items) {
      const x = porProducto.get(it.productoId) || { nombre: it.nombre, cant: 0, importe: 0 };
      x.cant += it.cant;
      x.importe += it.precio * it.cant;
      porProducto.set(it.productoId, x);
    }
  }
  const top = [...porProducto.values()].sort((a, b) => b.cant - a.cant).slice(0, 5);
  const max = top[0]?.cant || 1;

  const tarjeta = (titulo, valor, clase = '') => h('div', { class: 'tarjeta ' + clase }, h('small', {}, titulo), h('strong', {}, valor));

  llenar(el,
    h('div', { class: 'periodos' }, Object.entries(PERIODOS).map(([k, txt]) =>
      h('button', { class: 'btn' + (k === periodo ? ' sel' : ''), onclick: () => { periodo = k; cuantasVentas = 30; render(el); } }, txt))),
    h('div', { class: 'tarjetas' },
      tarjeta('💰 Ganaste (vendido − gastado)', dinero(r.ganancia), 'ancha' + (r.ganancia < 0 ? ' perdida' : '')),
      tarjeta('Vendiste', dinero(r.vendido)),
      tarjeta('🧾 Gastaste', dinero(r.gastado)),
      tarjeta('💵 Debe haber en caja', dinero(r.caja)),
      tarjeta('📒 Se fió', dinero(r.fiado)),
      tarjeta('Ventas', r.ventas.length),
      r.cobrado > 0 && tarjeta('Te pagaron fiado', dinero(r.cobrado))),
    !r.gastos.length && r.vendido > 0 && h('p', { class: 'alerta', style: 'margin-top:10px' },
      'Anota lo que gastaste (ingredientes, gas…) para saber cuánto ganaste de verdad.'),
    h('p', { class: 'etiqueta', style: 'margin-top:8px;font-size:.85rem' },
      '"Debe haber en caja" = ventas en efectivo + fiado que te pagaron − gastos pagados con la caja. Sin contar tu fondo.'),
    periodo === 'hoy' && h('button', { class: 'btn verde grande', style: 'margin-top:12px', onclick: cerrarDia }, '🔒 Cerrar el día'),

    h('h2', {}, '📊 Esta semana'),
    h('div', { class: 'tarjeta semana-tarjeta' },
      h('small', {}, 'Vendido por día'),
      graficaSemana(semana),
      h('div', { class: 'semana-totales' },
        h('span', {}, 'Vendiste ', h('b', {}, dinero(semana.vendido))),
        h('span', {}, 'Ganaste ', h('b', {}, dinero(semana.ganancia))),
        semana.cambio !== null && h('span', { class: semana.cambio >= 0 ? 'afavor' : 'debe' },
          `${semana.cambio >= 0 ? '▲' : '▼'} ${Math.abs(semana.cambio)}% vs. semana pasada`))),
    h('button', { class: 'btn grande', style: 'margin-top:10px', onclick: () => compartirTexto(textoResumen(semana)) }, '📤 Mandarme el resumen por WhatsApp'),

    h('h2', {}, '🧾 Gastos'),
    h('div', { class: 'periodos' }, rapidos.map(g =>
      h('button', { class: 'btn', onclick: () => anotarGasto({ concepto: g.concepto, monto: g.monto ?? '', deCaja: g.deCaja }) },
        g.monto ? `${g.concepto} ${dinero(g.monto)}` : g.concepto))),
    h('button', { class: 'btn primario grande', onclick: () => anotarGasto() }, '+ Otro gasto'),
    r.gastos.length > 0 && h('div', { class: 'lista', style: 'margin-top:10px' }, r.gastos.map(g => h('div', { class: 'item' },
      h('div', { class: 'info' }, h('b', {}, g.concepto), h('small', {}, fechaCorta(g.fecha) + (g.deCaja ? ' · de la caja' : ''))),
      h('div', { class: 'der' }, dinero(g.monto)),
      h('button', { class: 'btn', 'aria-label': 'Borrar gasto', onclick: async () => {
        if (await confirmar(`¿Borrar el gasto "${g.concepto}" de ${dinero(g.monto)}?`, 'Borrar')) { await db.del('gastos', g.id); avisarCambio(); }
      } }, '🗑️')))),

    h('h2', {}, `🍳 Para el ${prep.nombreDia} prepara unos…`),
    prep.lista.length
      ? [
        h('div', { class: 'lista' }, prep.lista.map(x => h('div', { class: 'item' },
          h('div', { class: 'info' }, h('b', {}, x.nombre)), h('div', { class: 'der' }, x.cant)))),
        h('p', { class: 'etiqueta', style: 'font-size:.85rem' }, `Promedio de los últimos ${prep.dias} ${prep.nombreDia}.`),
        h('button', { class: 'btn grande', onclick: () => compartirTexto(
          `🍳 Para el ${prep.nombreDia} preparar:\n` + prep.lista.map(x => `• ${x.cant} ${x.nombre}`).join('\n')) }, '📤 Mandar a la cocina'),
      ]
      : h('p', { class: 'etiqueta' }, `Necesito ventas de al menos 2 ${prep.nombreDia} para sugerirte (unas 2 semanas usando la app).`),

    seccionVentas(todas, el),

    h('h2', {}, '🏆 Lo que más se vende'),
    top.length
      ? h('div', { class: 'ranking' }, top.map(x => h('div', { class: 'rank' },
        h('span', {}, x.nombre), h('b', {}, `${x.cant} · ${dinero(x.importe)}`),
        h('div', { class: 'barra' }, h('i', { style: `width:${(x.cant / max) * 100}%` })))))
      : h('p', { class: 'etiqueta' }, 'Sin ventas en este periodo'),

    cierres.length > 0 && [h('h2', {}, '🔒 Cierres anteriores'), h('div', { class: 'lista' }, cierres.map(filaCierre))]);
}
