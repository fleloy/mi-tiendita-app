// Resumen de la semana (lunes a domingo): ventas por día, totales y comparación con la semana anterior.
import { h, dinero, r2 } from './util.js';
import * as db from './db.js';
import { calcularResumen } from './cierre.js';

export function lunesDe(fecha = new Date()) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export async function resumenSemana(lunes = lunesDe()) {
  const inicio = lunes.getTime();
  const r = await calcularResumen(inicio, inicio + 7 * 864e5);
  const anterior = await calcularResumen(inicio - 7 * 864e5, inicio);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  const dias = [0, 1, 2, 3, 4].map(i => {
    const d0 = inicio + i * 864e5;
    const delDia = r.ventas.filter(v => v.fecha >= d0 && v.fecha < d0 + 864e5);
    return {
      nombre: new Date(d0).toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', ''),
      vendido: r2(delDia.reduce((s, v) => s + v.total, 0)),
      esHoy: d0 === hoy.getTime(),
      futuro: d0 > hoy.getTime(),
    };
  });

  const porProducto = new Map();
  for (const v of r.ventas) for (const i of v.items) porProducto.set(i.nombre, (porProducto.get(i.nombre) || 0) + i.cant);
  const top = [...porProducto].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const teDeben = r2((await db.getAll('clientes')).reduce((s, c) => s + Math.max(-(c.saldo || 0), 0), 0));
  const cambio = anterior.vendido > 0 ? Math.round(((r.vendido - anterior.vendido) / anterior.vendido) * 100) : null;

  return { inicio, dias, top, teDeben, cambio, vendido: r.vendido, gastado: r.gastado, ganancia: r.ganancia, ventas: r.ventas.length };
}

export function textoResumen(s) {
  const fecha = new Date(s.inicio).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
  const comp = s.cambio === null ? '' : ` (${s.cambio >= 0 ? '+' : ''}${s.cambio}% que la semana pasada)`;
  return [
    `📊 Tiendita — semana del ${fecha}`,
    `💵 Vendiste: ${dinero(s.vendido)}${comp}`,
    `🧾 Gastaste: ${dinero(s.gastado)}`,
    `💰 Ganaste: ${dinero(s.ganancia)}`,
    s.teDeben > 0 && `📒 Te deben: ${dinero(s.teDeben)}`,
    s.top.length > 0 && `🏆 Lo que más se vendió: ${s.top.map(([n, c]) => `${n} (${c})`).join(', ')}`,
  ].filter(Boolean).join('\n');
}

// Barras de lo vendido por día. Una sola serie: el título la nombra y cada barra lleva su monto.
export function graficaSemana(s) {
  const max = Math.max(...s.dias.map(d => d.vendido), 1);
  return h('div', { class: 'semana', role: 'table', 'aria-label': 'Vendido por día esta semana' },
    s.dias.map(d => h('div', {
      class: 'semana-dia' + (d.esHoy ? ' hoy' : '') + (d.futuro ? ' futuro' : ''),
      role: 'row',
      title: `${d.nombre}: ${dinero(d.vendido)}`,
    },
      h('span', { class: 'semana-monto', role: 'cell' }, d.futuro ? '' : dinero(d.vendido)),
      h('div', { class: 'semana-barra' }, h('i', { style: `height:${(d.vendido / max) * 100}%` })),
      h('span', { class: 'semana-nombre', role: 'rowheader' }, d.esHoy ? 'Hoy' : d.nombre))));
}
