// "¿Cuánto preparo mañana?": promedio de lo vendido en los últimos días iguales
// (ej. los últimos 4 viernes con ventas).
import * as db from './db.js';

function siguienteDiaDeEscuela() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

export async function sugerencia() {
  const manana = siguienteDiaDeEscuela();
  const nombreDia = manana.toLocaleDateString('es-MX', { weekday: 'long' });
  const porDia = new Map(); // 'AAAA-M-D' -> Map(productoId -> { nombre, cant })
  for (const v of await db.getRango('ventas', Date.now() - 8 * 7 * 864e5)) {
    const f = new Date(v.fecha);
    if (v.cancelada || f.getDay() !== manana.getDay()) continue;
    const clave = `${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`;
    if (!porDia.has(clave)) porDia.set(clave, { fecha: v.fecha, productos: new Map() });
    const dia = porDia.get(clave).productos;
    for (const i of v.items) {
      const x = dia.get(i.productoId) || { nombre: i.nombre, cant: 0 };
      x.cant += i.cant;
      dia.set(i.productoId, x);
    }
  }
  const dias = [...porDia.values()].sort((a, b) => b.fecha - a.fecha).slice(0, 4);
  if (dias.length < 2) return { nombreDia, dias: dias.length, lista: [] };

  const totales = new Map();
  for (const d of dias) {
    for (const [id, x] of d.productos) {
      const t = totales.get(id) || { nombre: x.nombre, cant: 0 };
      t.cant += x.cant;
      totales.set(id, t);
    }
  }
  const lista = [...totales.values()]
    .map(t => ({ nombre: t.nombre, cant: Math.ceil(t.cant / dias.length) }))
    .sort((a, b) => b.cant - a.cant);
  return { nombreDia, dias: dias.length, lista };
}
