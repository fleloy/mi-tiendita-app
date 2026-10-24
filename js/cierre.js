// Cerrar el día: contar la caja, comparar con lo esperado, guardar el corte y respaldar.
import { h, dinero, r2, modal, formulario, avisarCambio, leerLocal, guardarLocal, hoyISO, fechaCorta } from './util.js';
import * as db from './db.js';
import { exportar } from './respaldo.js';

// Totales de un periodo. "Caja" = efectivo de ventas + pagos de fiado − gastos pagados con la caja.
export async function calcularResumen(desde, hasta) {
  const ventas = (await db.getRango('ventas', desde, hasta)).filter(v => !v.cancelada);
  const abonos = (await db.getRango('movimientos', desde, hasta)).filter(m => m.tipo === 'abono');
  const gastos = (await db.getRango('gastos', desde, hasta)).sort((a, b) => b.fecha - a.fecha);
  const suma = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));
  const vendido = suma(ventas, v => v.total);
  const efectivo = suma(ventas.filter(v => v.pago === 'efectivo'), v => v.total);
  const cobrado = suma(abonos, m => m.monto);
  const gastado = suma(gastos, g => g.monto);
  const gastadoCaja = suma(gastos.filter(g => g.deCaja), g => g.monto);
  return {
    ventas, gastos, vendido, efectivo, cobrado, gastado, gastadoCaja,
    fiado: r2(vendido - efectivo),
    ganancia: r2(vendido - gastado),
    caja: r2(efectivo + cobrado - gastadoCaja),
  };
}

export async function cierresRecientes() {
  return (await db.getAll('cierres')).sort((a, b) => b.fecha - a.fecha).slice(0, 7);
}

const inicioDe = fecha => { const d = new Date(fecha); d.setHours(0, 0, 0, 0); return d; };
export const nombreDia = fecha => new Date(fecha).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric' });

// Guarda (o reemplaza) el cierre de un día. Separado de la ventana para poder probarlo.
export async function guardarCierre(fecha, fondo, contado) {
  const inicio = inicioDe(fecha);
  const r = await calcularResumen(inicio.getTime(), inicio.getTime() + 864e5);
  const esperado = r2(fondo + r.caja);
  const dia = hoyISO(inicio);
  const anterior = (await db.getAll('cierres')).find(c => c.dia === dia);
  const cierre = {
    ...(anterior && { id: anterior.id }),
    dia, fecha: Date.now(), fondo, contado, esperado, diferencia: r2(contado - esperado),
    vendido: r.vendido, gastado: r.gastado, ganancia: r.ganancia, fiado: r.fiado, ventas: r.ventas.length,
  };
  await db.put('cierres', cierre);
  return cierre;
}

// Cierra hoy o un día anterior que se quedó sin cerrar.
export async function cerrarDia(fecha = new Date()) {
  fecha = new Date(fecha);
  const esHoy = hoyISO(fecha) === hoyISO();
  const v = await formulario(esHoy ? '🔒 Cerrar el día' : `🔒 Cerrar el ${nombreDia(fecha)}`, [
    { name: 'fondo', label: '¿Con cuánto cambio empezaste en la caja? ($)', type: 'number', min: 0 },
    { name: 'contado', label: esHoy ? '¿Cuánto dinero hay ahorita en la caja? (cuéntalo) ($)' : '¿Cuánto dinero había en la caja al terminar ese día? ($)', type: 'number', min: 0, required: true },
  ], { fondo: leerLocal('fondo') ?? '' }, { textoBoton: 'Ver resultado' });
  if (!v) return;
  guardarLocal('fondo', String(v.fondo));
  const c = await guardarCierre(fecha, v.fondo, v.contado);
  const r = { vendido: c.vendido, gastado: c.gastado, ganancia: c.ganancia, fiado: c.fiado, ventas: { length: c.ventas } };
  const { esperado, diferencia } = c;
  avisarCambio();

  const fila = (txt, valor) => h('div', { class: 'resumen-fila' }, h('span', {}, txt), h('b', {}, valor));
  const m = modal(esHoy ? 'Cierre de hoy' : `Cierre del ${nombreDia(fecha)}`, [
    h('div', { class: 'cambio' + (diferencia < 0 ? ' falta' : '') },
      diferencia === 0 ? h('span', {}, 'La caja', h('strong', {}, '✅ Cuadra'))
        : h('span', {}, diferencia > 0 ? 'Sobran' : 'Faltan', h('strong', {}, dinero(Math.abs(diferencia))))),
    h('div', { class: 'resumen' },
      fila('Debía haber en caja', dinero(esperado)),
      fila('Contaste', dinero(v.contado)),
      fila('Vendiste', dinero(r.vendido)),
      fila('Gastaste', dinero(r.gastado)),
      fila('💰 Ganaste', dinero(r.ganancia)),
      fila('Se fió', dinero(r.fiado)),
      fila('Ventas', r.ventas.length)),
    h('p', { class: 'etiqueta' }, 'Guarda el respaldo para no perder nada si le pasa algo al celular.'),
    h('div', { class: 'lista' },
      h('button', { class: 'btn primario grande', onclick: async () => { await exportar(); m.cerrar(); } }, '📤 Guardar respaldo'),
      h('button', { class: 'btn grande', onclick: () => m.cerrar() }, 'Listo')),
  ]);
}

export function filaCierre(c) {
  return h('div', { class: 'item' },
    h('div', { class: 'info' },
      h('b', {}, new Date(`${c.dia}T12:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })),
      h('small', {}, `Ganó ${dinero(c.ganancia)} · vendió ${dinero(c.vendido)} · ${fechaCorta(c.fecha)}`)),
    h('div', { class: 'der ' + (c.diferencia < 0 ? 'debe' : 'afavor') },
      c.diferencia === 0 ? '✅ Cuadró' : `${c.diferencia > 0 ? 'Sobró' : 'Faltó'} ${dinero(Math.abs(c.diferencia))}`));
}
