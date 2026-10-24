// Base de datos local (IndexedDB). Todo vive en el celular, sin internet.
// Saldo de cliente: positivo = tiene dinero a favor, negativo = debe (fiado).

import { leerLocal } from './util.js';

export const STORES = ['productos', 'ventas', 'clientes', 'movimientos', 'entradas', 'gastos', 'cierres'];
const CON_FECHA = ['ventas', 'movimientos', 'gastos']; // stores con índice por fecha
let dbp;

// En modo práctica se usa otra base de datos para no tocar las cuentas reales.
export const modoPractica = () => leerLocal('modo') === 'practica';

export function abrir() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('Este navegador no permite guardar datos')); return; }
      // window.__dbNombre lo usa la página de pruebas para trabajar en su propia base.
      const nombre = window.__dbNombre || (modoPractica() ? 'tiendita-practica' : 'tiendita');
      const r = indexedDB.open(nombre, 4);
      r.onupgradeneeded = () => {
        for (const s of STORES) {
          if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        }
        for (const s of CON_FECHA) {
          const st = r.transaction.objectStore(s);
          if (!st.indexNames.contains('fecha')) st.createIndex('fecha', 'fecha');
        }
      };
      r.onsuccess = () => {
        // Si otra pestaña abre una versión nueva de la base, soltar esta.
        r.result.onversionchange = () => r.result.close();
        res(r.result);
      };
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Cierra las otras ventanas de la tiendita y vuelve a abrir'));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}

// Corre fn(stores) dentro de una sola transacción y resuelve con lo que fn deje en `resultado.valor`.
async function transaccion(nombres, fn) {
  const d = await abrir();
  return new Promise((res, rej) => {
    const t = d.transaction(nombres, 'readwrite');
    const stores = Object.fromEntries(nombres.map(n => [n, t.objectStore(n)]));
    const resultado = {};
    fn(stores, resultado);
    t.oncomplete = () => res(resultado.valor);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

async function simple(store, modo, fn) {
  const d = await abrir();
  return new Promise((res, rej) => {
    const t = d.transaction(store, modo);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
  });
}

export const getAll = s => simple(s, 'readonly', st => st.getAll());
// Registros con fecha en [desde, hasta). Usa el índice para no leer todo el historial.
export const getRango = (s, desde, hasta = Infinity) => simple(s, 'readonly', st =>
  st.index('fecha').getAll(hasta === Infinity ? IDBKeyRange.lowerBound(desde) : IDBKeyRange.bound(desde, hasta, false, true)));
// El registro con la fecha más antigua (o undefined si no hay).
export const primero = async s => (await simple(s, 'readonly', st => st.index('fecha').getAll(null, 1)))[0];
// Varios registros por id en una sola lectura; devuelve un Map id -> registro.
export async function getVarios(s, ids) {
  const d = await abrir();
  return new Promise((res, rej) => {
    const t = d.transaction(s);
    const st = t.objectStore(s);
    const out = new Map();
    for (const id of new Set(ids)) st.get(id).onsuccess = e => { if (e.target.result) out.set(id, e.target.result); };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}
export const get = (s, id) => simple(s, 'readonly', st => st.get(id));
export const put = (s, obj) => simple(s, 'readwrite', st => st.put(obj));
export const del = (s, id) => simple(s, 'readwrite', st => st.delete(id));

function cambiarSaldo(clientes, movimientos, clienteId, monto, mov) {
  clientes.get(clienteId).onsuccess = e => {
    const c = e.target.result;
    if (!c) return;
    c.saldo = Math.round(((c.saldo || 0) + monto) * 100) / 100;
    clientes.put(c);
    movimientos.add({ clienteId, fecha: Date.now(), monto, ...mov });
  };
}

export function registrarVenta(venta) {
  return transaccion(['ventas', 'productos', 'clientes', 'movimientos'], (s, r) => {
    s.ventas.add(venta).onsuccess = e => {
      r.valor = e.target.result;
      if (venta.clienteId != null) {
        cambiarSaldo(s.clientes, s.movimientos, venta.clienteId, -venta.total, { tipo: 'compra', ventaId: r.valor });
      }
    };
    for (const it of venta.items) {
      s.productos.get(it.productoId).onsuccess = e => {
        const p = e.target.result;
        if (p && p.conteo !== false) { p.existencias = (p.existencias || 0) - it.cant; s.productos.put(p); }
      };
    }
  });
}

export function cancelarVenta(id) {
  return transaccion(['ventas', 'productos', 'clientes', 'movimientos'], s => {
    s.ventas.get(id).onsuccess = e => {
      const v = e.target.result;
      if (!v || v.cancelada) return;
      v.cancelada = true;
      s.ventas.put(v);
      for (const it of v.items) {
        s.productos.get(it.productoId).onsuccess = ev => {
          const p = ev.target.result;
          if (p && p.conteo !== false) { p.existencias += it.cant; s.productos.put(p); }
        };
      }
      if (v.clienteId != null) {
        cambiarSaldo(s.clientes, s.movimientos, v.clienteId, v.total, { tipo: 'cancelación', ventaId: id });
      }
    };
  });
}

// tipo: 'abono' (dejó/pagó dinero, entra a la caja) o 'fiado' (deuda anotada a mano).
export function movimientoCliente(clienteId, monto, tipo, nota = '') {
  return transaccion(['clientes', 'movimientos'], s => {
    cambiarSaldo(s.clientes, s.movimientos, clienteId, monto, { tipo, nota });
  });
}

export function registrarEntrada(productoId, cant, costoUnitario) {
  return transaccion(['productos', 'entradas'], s => {
    s.productos.get(productoId).onsuccess = e => {
      const p = e.target.result;
      if (!p) return;
      p.existencias = (p.existencias || 0) + cant;
      if (costoUnitario > 0) p.costo = costoUnitario;
      s.productos.put(p);
      s.entradas.add({ productoId, nombre: p.nombre, fecha: Date.now(), cant, costo: p.costo || 0, total: cant * (p.costo || 0) });
    };
  });
}

export async function exportarTodo() {
  const datos = {};
  for (const s of STORES) datos[s] = await getAll(s);
  return { app: 'tiendita', version: 1, fecha: Date.now(), datos };
}

export function reemplazarTodo(datos) {
  return transaccion(STORES, s => {
    for (const n of STORES) {
      s[n].clear();
      for (const fila of datos[n] || []) s[n].put(fila);
    }
  });
}

// Menú de la tiendita según la entrevista (precios a confirmar con la señora).
export function cargarEjemplo() {
  const p = (emoji, nombre, precio, categoria) =>
    ({ emoji, nombre, precio, categoria, conteo: false, existencias: 0, minimo: 0, activo: true });
  return transaccion(['productos'], s => {
    [
      p('🥞', 'Hot cakes', 15, 'comida'),
      p('🍗', 'Nuggets', 30, 'comida'),
      p('🍛', 'Milanesa con arroz', 25, 'comida'),
      p('🌽', 'Elote', 10, 'comida'),
      p('🌮', 'Taco de guiso', 15, 'comida'),
      p('🌮', 'Taco de frijoles', 10, 'comida'),
      p('🥪', 'Torta', 15, 'comida'),
      p('🥪', 'Sándwich', 20, 'comida'),
      p('🍮', 'Postre', 10, 'postres'),
      p('🥛', 'Agua de horchata', 10, 'bebidas'),
      p('🧃', 'Jugo', 10, 'bebidas'),
      p('💧', 'Agua natural', 10, 'bebidas'),
    ].forEach(x => s.productos.add(x));
  });
}
