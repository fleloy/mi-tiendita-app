// Cuentas de fiado de alumnos y maestros. Los papás pagan a la salida o el viernes.
// Saldo negativo = debe. Cada cuenta puede tener un límite y productos que no se le venden.
import { h, llenar, dinero, fechaCorta, toast, modal, formulario, confirmar, vacio, avisarCambio, compartirTexto } from './util.js';
import * as db from './db.js';
import { pedirPin } from './pin.js';

async function campos() {
  const productos = (await db.getAll('productos')).map(p => [p.id, `${p.emoji || ''} ${p.nombre}`]);
  return [
    { name: 'nombre', label: 'Nombre', required: true, placeholder: 'Ej. Sofía López' },
    { name: 'grupo', label: 'Grupo o "Maestro"', placeholder: 'Ej. 3°B' },
    { name: 'limite', label: 'Puede fiar hasta ($) — 0 = sin límite', type: 'number', min: 0 },
    { name: 'tutor', label: 'Nombre de mamá o papá', placeholder: 'Opcional' },
    { name: 'telefono', label: 'WhatsApp de mamá o papá', type: 'tel', placeholder: 'Opcional, 10 dígitos' },
    { name: 'noVender', label: '🚫 Sus papás pidieron no venderle', type: 'multi', opciones: productos },
  ];
}

const claseSaldo = s => (s < 0 ? 'debe' : s > 0 ? 'afavor' : '');
const textoSaldo = s => (s < 0 ? `Debe ${dinero(-s)}` : s > 0 ? `A favor ${dinero(s)}` : 'No debe');
const esMaestro = c => c.grupo?.toLowerCase().startsWith('maestr');

async function lista() {
  return (await db.getAll('clientes')).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function render(el) {
  const clientes = await lista();
  const deben = clientes.filter(c => c.saldo < 0);
  const totalDeben = deben.reduce((s, c) => s - c.saldo, 0);
  const buscar = h('input', { class: 'buscar', type: 'search', placeholder: '🔍 Buscar nombre…' });
  const cont = h('div', { class: 'lista' });
  const pintar = () => {
    const q = buscar.value.toLowerCase();
    const vis = clientes.filter(c => (c.nombre + ' ' + (c.grupo || '')).toLowerCase().includes(q));
    cont.replaceChildren(...vis.map(c => filaCliente(c, () => detalle(c))));
  };
  buscar.oninput = pintar;
  pintar();

  llenar(el,
    deben.length > 0 && h('div', { class: 'alerta' },
      h('p', { style: 'margin:0 0 8px' }, h('b', {}, `📒 Te deben ${dinero(totalDeben)}`), ` entre ${deben.length} persona(s)`),
      h('button', { class: 'btn', onclick: () => cobroViernes(deben) }, '📋 Lista para cobrar')),
    h('button', { class: 'btn primario grande', onclick: async () => { if (await nuevo()) avisarCambio(); } }, '+ Nueva cuenta'),
    h('div', { style: 'height:12px' }),
    clientes.length ? [buscar, cont] : vacio('📒', 'Aquí anotas a quién le fías: niños y maestros.'));
}

function filaCliente(c, onclick) {
  const queda = c.limite > 0 ? c.limite + Math.min(c.saldo || 0, 0) : null;
  return h('button', { class: 'item', onclick },
    h('span', { class: 'emoji' }, esMaestro(c) ? '👩‍🏫' : '🧒'),
    h('div', { class: 'info' },
      h('b', {}, c.nombre, c.noVender?.length > 0 && h('span', { class: 'etq' }, '🚫')),
      h('small', {}, [c.grupo, queda != null && `le quedan ${dinero(Math.max(queda, 0))}`].filter(Boolean).join(' · '))),
    h('div', { class: 'der ' + claseSaldo(c.saldo) }, textoSaldo(c.saldo)));
}

async function nuevo(nombre = '') {
  const v = await formulario('Nueva cuenta', await campos(), { nombre, limite: 0 });
  if (!v) return null;
  const id = await db.put('clientes', { ...v, saldo: 0 });
  return { ...v, id, saldo: 0 };
}

// Ventana para elegir (o crear) un cliente. Resuelve con el cliente o null.
export function elegirCliente(titulo) {
  return new Promise(async res => {
    let elegido = null;
    const clientes = await lista();
    const buscar = h('input', { class: 'buscar', type: 'search', placeholder: '🔍 Buscar nombre…' });
    const cont = h('div', { class: 'lista' });
    const pintar = () => {
      const q = buscar.value.toLowerCase();
      cont.replaceChildren(...clientes
        .filter(c => (c.nombre + ' ' + (c.grupo || '')).toLowerCase().includes(q))
        .map(c => filaCliente(c, () => { elegido = c; m.cerrar(); })));
    };
    buscar.oninput = pintar;
    const m = modal(titulo, [
      buscar,
      h('button', { class: 'btn grande', style: 'margin-bottom:10px', onclick: async () => {
        const c = await nuevo(buscar.value);
        if (c) { elegido = c; m.cerrar(); }
      } }, '+ Persona nueva'),
      cont,
    ], { onClose: () => res(elegido) });
    pintar();
  });
}

// Compras que todavía no se pagan: las posteriores a la última vez que la cuenta quedó en $0 o a favor.
async function comprasPendientes(c) {
  const movs = (await db.getAll('movimientos')).filter(m => m.clienteId === c.id).sort((a, b) => a.fecha - b.fecha);
  const ventas = await db.getVarios('ventas', movs.map(m => m.ventaId).filter(Boolean));
  let saldo = 0, desde = 0;
  movs.forEach((m, i) => { saldo += m.monto; if (saldo >= 0) desde = i + 1; });
  return movs.slice(desde)
    .map(m => m.tipo === 'compra' ? ventas.get(m.ventaId) : null)
    .filter(v => v && !v.cancelada);
}

async function mandarCuenta(c) {
  const compras = await comprasPendientes(c);
  const dia = ms => new Date(ms).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
  const texto = [
    `Hola${c.tutor ? ' ' + c.tutor : ''} 👋, le comparto la cuenta de ${c.nombre} en la tiendita:`,
    ...compras.map(v => `• ${dia(v.fecha)}: ${v.items.map(i => `${i.cant} ${i.nombre}`).join(', ')} — ${dinero(v.total)}`),
    `*Total a pagar: ${dinero(-c.saldo)}*`,
    '¡Gracias!',
  ].join('\n');
  compartirTexto(texto, c.telefono);
}

// Para el aviso de los viernes: abre la lista de quienes deben.
export async function abrirCobroViernes() {
  const deben = (await db.getAll('clientes')).filter(c => c.saldo < 0);
  if (deben.length) cobroViernes(deben);
}

function cobroViernes(deben) {
  deben = [...deben].sort((a, b) => a.saldo - b.saldo);
  modal('📋 Lista para cobrar', [
    h('p', { class: 'etiqueta' }, 'Toca 📲 para mandarle la cuenta a mamá o papá por WhatsApp.'),
    h('div', { class: 'lista' }, deben.map(c => h('div', { class: 'item' },
      h('div', { class: 'info' }, h('b', {}, c.nombre), h('small', {}, c.grupo || '')),
      h('div', { class: 'der debe' }, dinero(-c.saldo)),
      h('button', { class: 'btn', onclick: () => mandarCuenta(c), 'aria-label': 'Mandar por WhatsApp' }, '📲')))),
  ]);
}

async function detalle(c) {
  const movs = (await db.getAll('movimientos')).filter(m => m.clienteId === c.id).sort((a, b) => b.fecha - a.fecha);
  const ventas = await db.getVarios('ventas', movs.map(m => m.ventaId).filter(Boolean));
  const productos = new Map((await db.getAll('productos')).map(p => [p.id, p.nombre]));
  const descripcion = mv => {
    if (mv.tipo === 'compra') {
      const v = ventas.get(mv.ventaId);
      return v ? v.items.map(i => `${i.cant}× ${i.nombre}`).join(', ') : 'Compra';
    }
    return { abono: 'Pagó', fiado: 'Fiado anotado', 'cancelación': 'Venta cancelada' }[mv.tipo] + (mv.nota ? ` – ${mv.nota}` : '');
  };

  const mover = async (tipo, signo, titulo, monto) => {
    const v = await formulario(titulo, [
      { name: 'monto', label: 'Cantidad ($)', type: 'number', min: 0, required: true },
      { name: 'nota', label: 'Nota (opcional)' },
    ], { monto });
    if (!v || v.monto <= 0) return;
    await db.movimientoCliente(c.id, signo * v.monto, tipo, v.nota);
    m.cerrar();
    toast('Listo');
    avisarCambio();
  };

  const noVender = (c.noVender || []).map(id => productos.get(id)).filter(Boolean);
  const m = modal(c.nombre, [
    h('div', { class: 'total-grande ' + claseSaldo(c.saldo) }, textoSaldo(c.saldo)),
    c.limite > 0 && h('p', { class: 'etiqueta' }, `Puede fiar hasta ${dinero(c.limite)}`),
    noVender.length > 0 && h('div', { class: 'alerta' }, '🚫 No venderle: ', noVender.join(', ')),
    h('div', { class: 'fila' },
      h('button', { class: 'btn verde', onclick: () => mover('abono', 1, '💵 Pagó', c.saldo < 0 ? -c.saldo : '') }, '💵 Pagó'),
      h('button', { class: 'btn', onclick: () => mover('fiado', -1, '📝 Anotar fiado') }, '📝 Anotar fiado')),
    c.saldo < 0 && h('button', { class: 'btn grande', style: 'margin-top:10px', onclick: () => mandarCuenta(c) }, '📲 Mandar cuenta por WhatsApp'),
    h('h2', {}, 'Historial'),
    movs.length ? h('div', { class: 'lista' }, movs.map(mv => h('div', { class: 'item' },
      h('div', { class: 'info' }, h('b', {}, descripcion(mv)), h('small', {}, fechaCorta(mv.fecha))),
      h('div', { class: 'der ' + claseSaldo(mv.monto) }, (mv.monto > 0 ? '+' : '') + dinero(mv.monto)))))
      : h('p', { class: 'etiqueta' }, 'Sin movimientos todavía'),
    h('div', { class: 'fila', style: 'margin-top:16px' },
      h('button', { class: 'btn', onclick: async () => {
        const v = await formulario('Editar cuenta', await campos(), c);
        if (v) { await db.put('clientes', { ...c, ...v }); m.cerrar(); avisarCambio(); }
      } }, '✏️ Editar'),
      h('button', { class: 'btn peligro', onclick: async () => {
        if (c.saldo !== 0) { toast('Primero deja la cuenta en $0'); return; }
        if (await pedirPin('Escribe tu PIN para borrar') && await confirmar(`¿Borrar la cuenta de ${c.nombre}?`, 'Borrar')) { await db.del('clientes', c.id); m.cerrar(); avisarCambio(); }
      } }, 'Borrar')),
  ]);
}
