// Pantalla de cobro: tocar productos, cobrar y calcular el cambio.
import { h, llenar, dinero, r2, toast, modal, confirmar, vacio, avisarCambio, leerLocal, guardarLocal, hoyISO, CATEGORIAS } from './util.js';
import * as db from './db.js';
import { elegirCliente } from './clientes.js';
import * as pedidos from './pedidos.js';

let ticket = []; // [{ p, cant }]
let productos = [];
let categoria = 'todo';
let cont;

const total = () => r2(ticket.reduce((s, t) => s + t.p.precio * t.cant, 0));
const ir = tab => window.dispatchEvent(new CustomEvent('ir', { detail: tab }));

export async function render(el) {
  cont = el;
  productos = await ordenar((await db.getAll('productos')).filter(p => p.activo !== false));
  // Si un producto cambió de precio mientras estaba en el ticket, usar el dato nuevo.
  ticket = ticket
    .map(t => ({ ...t, p: productos.find(p => p.id === t.p.id) }))
    .filter(t => t.p);
  pintar();
}

// Lo más vendido en las últimas 4 semanas va primero. El orden se calcula una vez
// al día para que los botones no se muevan mientras se cobra.
async function ordenar(lista) {
  const dia = hoyISO();
  let orden = null;
  try { orden = JSON.parse(leerLocal('orden') || 'null'); } catch { /* orden dañado */ }
  if (orden?.dia !== dia) {
    const desde = Date.now() - 28 * 864e5;
    const vendidos = new Map();
    for (const v of await db.getRango('ventas', desde)) {
      if (v.cancelada) continue;
      for (const i of v.items) vendidos.set(i.productoId, (vendidos.get(i.productoId) || 0) + i.cant);
    }
    const ids = [...lista].sort((a, b) => (vendidos.get(b.id) || 0) - (vendidos.get(a.id) || 0) || a.id - b.id).map(p => p.id);
    orden = { dia, ids };
    guardarLocal('orden', JSON.stringify(orden));
  }
  const pos = new Map(orden.ids.map((id, i) => [id, i]));
  return [...lista].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || a.id - b.id);
}

const agotado = p => p.agotadoDia === hoyISO();

async function marcarAgotado(p, valor) {
  p.agotadoDia = valor ? hoyISO() : null;
  await db.put('productos', p);
  navigator.vibrate?.(40);
  avisarCambio();
  if (valor) toast(`${p.nombre}: se acabó por hoy`, { texto: 'Deshacer', fn: () => marcarAgotado(p, false) });
}

function pintar() {
  if (!productos.length) {
    llenar(cont, vacio('🛒', 'Todavía no tienes productos.',
      h('button', { class: 'btn primario grande', onclick: async () => { await db.cargarEjemplo(); avisarCambio(); } }, 'Cargar el menú de la tiendita'),
      h('button', { class: 'btn grande', onclick: () => ir('inventario') }, 'Agregar mis productos')));
    return;
  }
  const usadas = CATEGORIAS.filter(([k]) => productos.some(p => p.categoria === k));
  const visibles = categoria === 'todo' ? productos : productos.filter(p => p.categoria === categoria);
  llenar(cont,
    usadas.length > 1 && h('div', { class: 'periodos categorias' },
      [['todo', 'Todo'], ...usadas].map(([k, txt]) =>
        h('button', { class: 'btn' + (k === categoria ? ' sel' : ''), onclick: () => { categoria = k; pintar(); } }, txt))),
    h('div', { class: 'grid' }, visibles.map(botonProducto)),
    h('p', { class: 'pista' }, 'Mantén presionado un producto si se acabó'),
    barraTicket());
}

function botonProducto(p) {
  const enTicket = ticket.find(t => t.p.id === p.id);
  const conteo = p.conteo !== false;
  const sinHoy = agotado(p);
  const bajo = conteo && p.existencias <= (p.minimo || 0);
  // Mantener presionado ~½ segundo marca o quita "se acabó".
  let timer, largo = false;
  const soltar = () => clearTimeout(timer);
  return h('button', {
    class: 'prod' + (sinHoy ? ' agotado' : bajo ? ' bajo' : ''),
    onpointerdown: () => { largo = false; timer = setTimeout(() => { largo = true; marcarAgotado(p, !sinHoy); }, 500); },
    onpointerup: soltar, onpointerleave: soltar, onpointercancel: soltar,
    oncontextmenu: e => e.preventDefault(),
    onclick: async () => {
      if (largo) return;
      if (!sinHoy) { agregar(p); return; }
      if (await confirmar(`¿Ya hay ${p.nombre} otra vez?`, 'Sí, ya hay')) marcarAgotado(p, false);
    },
  },
    enTicket && h('span', { class: 'cuantos' }, enTicket.cant),
    sinHoy ? h('span', { class: 'stock' }, 'Se acabó')
      : conteo && h('span', { class: 'stock' }, p.existencias <= 0 ? 'Agotado' : `Quedan ${p.existencias}`),
    h('span', { class: 'emoji' }, p.emoji || '🛒'),
    h('span', { class: 'nom' }, p.nombre),
    h('span', { class: 'precio' }, dinero(p.precio)));
}

function agregar(p) {
  const t = ticket.find(x => x.p.id === p.id);
  if (t) t.cant++; else ticket.push({ p, cant: 1 });
  navigator.vibrate?.(15);
  pintar();
}

function quitarUno(t) {
  t.cant--;
  if (t.cant <= 0) ticket = ticket.filter(x => x !== t);
  pintar();
}

function barraTicket() {
  if (!ticket.length) return h('div', { class: 'ticket-vacio' }, 'Toca los productos para cobrar 👆');
  return h('div', { class: 'ticket' },
    h('div', { class: 'items' }, ticket.map(t =>
      h('button', { class: 'chip', onclick: () => quitarUno(t), title: 'Quitar uno' }, `${t.cant}× ${t.p.nombre} ✕`))),
    h('div', { class: 'acciones' },
      h('button', { class: 'btn limpiar', onclick: () => { ticket = []; pintar(); }, 'aria-label': 'Borrar ticket' }, '🗑️'),
      h('button', { class: 'btn primario cobrar', onclick: cobrar }, `Cobrar ${dinero(total())}`)));
}

function cobrar() {
  const tot = total();
  let pago = null;
  const cambio = h('div', { class: 'cambio' });
  const otro = h('input', { class: 'buscar', type: 'number', inputmode: 'numeric', placeholder: 'Otra cantidad…' });
  const billetes = [tot, 20, 50, 100, 200].filter((b, i) => i === 0 || b > tot);
  const botones = billetes.map((b, i) => h('button', {
    class: 'btn', onclick: e => { otro.value = ''; elegir(b, e.currentTarget); },
  }, i === 0 ? 'Exacto' : dinero(b)));

  function elegir(monto, boton) {
    pago = monto;
    botones.forEach(b => b.classList.toggle('sel', b === boton));
    const c = r2(pago - tot);
    cambio.className = 'cambio' + (c < 0 ? ' falta' : '');
    cambio.replaceChildren(c < 0
      ? h('span', {}, 'Le faltan', h('strong', {}, dinero(-c)))
      : h('span', {}, 'Su cambio', h('strong', {}, dinero(c))));
  }
  otro.oninput = () => { if (otro.value) elegir(Number(otro.value), null); };
  const nombre = pedidos.activo()
    ? h('input', { class: 'buscar', type: 'text', placeholder: '🧒 Nombre del niño (opcional)', autocomplete: 'off' })
    : null;

  const m = modal('Cobrar', [
    h('p', { class: 'etiqueta' }, 'Total'),
    h('div', { class: 'total-grande' }, dinero(tot)),
    h('p', { class: 'etiqueta' }, '¿Con cuánto pagó?'),
    h('div', { class: 'billetes' }, botones),
    otro,
    cambio,
    nombre,
    h('div', { class: 'fila' },
      h('button', { class: 'btn', onclick: async () => {
        const c = await elegirCliente('¿A la cuenta de quién?');
        if (c && await revisarCuenta(c, tot)) { m.cerrar(); finalizar('cuenta', c, nombre?.value.trim()); }
      } }, '📒 Fiado / a cuenta'),
      h('button', { class: 'btn verde', onclick: () => {
        if (pago != null && pago < tot) { toast('Todavía le falta dinero'); return; }
        m.cerrar(); finalizar('efectivo', null, nombre?.value.trim());
      } }, '✔ Cobrado')),
  ]);
}

// Avisa si los papás pidieron no venderle algo del ticket o si se pasa de su límite.
async function revisarCuenta(c, tot) {
  const prohibidos = ticket.filter(t => (c.noVender || []).includes(t.p.id)).map(t => t.p.nombre);
  if (prohibidos.length && !await confirmar(`🚫 Sus papás pidieron no venderle: ${prohibidos.join(', ')}. ¿Venderle de todos modos?`, 'Vender')) return false;
  const deberia = r2(-(c.saldo || 0) + tot);
  if (c.limite > 0 && deberia > c.limite && !await confirmar(`⚠️ ${c.nombre} tiene límite de ${dinero(c.limite)} y quedaría debiendo ${dinero(deberia)}. ¿Fiarle de todos modos?`, 'Fiar')) return false;
  return true;
}

async function finalizar(pago, cliente, nombre) {
  const conPedido = pedidos.activo();
  const venta = {
    ...(conPedido && { turno: await pedidos.siguienteTurno(), entregado: false, nombre: nombre || cliente?.nombre || '' }),
    fecha: Date.now(),
    items: ticket.map(({ p, cant }) => ({ productoId: p.id, nombre: p.nombre, precio: p.precio, costo: p.costo || 0, cant })),
    total: total(),
    costo: r2(ticket.reduce((s, t) => s + (t.p.costo || 0) * t.cant, 0)),
    pago,
    clienteId: cliente?.id ?? null,
    clienteNombre: cliente?.nombre ?? null,
  };
  const id = await db.registrarVenta(venta);
  ticket = [];
  avisarCambio();
  const msg = (conPedido ? `Pedido #${venta.turno} · ` : '')
    + (cliente ? `Anotado a ${cliente.nombre}: ${dinero(venta.total)}` : `Venta de ${dinero(venta.total)} guardada`);
  toast(msg, { texto: 'Deshacer', fn: async () => { await db.cancelarVenta(id); avisarCambio(); toast('Venta cancelada'); } });
}
