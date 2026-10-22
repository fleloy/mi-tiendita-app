// Productos del menú. El conteo de existencias es opcional (la comida se hace al día).
import { h, llenar, dinero, toast, formulario, confirmar, vacio, avisarCambio, compartirTexto, hoyISO, CATEGORIAS } from './util.js';
import * as db from './db.js';
import { pedirPin } from './pin.js';

const CAMPOS = [
  { name: 'emoji', label: 'Dibujito', type: 'emoji' },
  { name: 'nombre', label: 'Nombre', required: true, placeholder: 'Ej. Hot cakes' },
  { name: 'precio', label: 'Precio ($)', type: 'number', required: true, min: 0 },
  { name: 'categoria', label: 'Tipo', type: 'select', opciones: CATEGORIAS },
  { name: 'conteo', label: 'Llevar conteo de cuántos quedan (para cosas compradas, como aguas)', type: 'checkbox' },
  { name: 'existencias', label: '¿Cuántos tienes ahorita?', type: 'number', mostrarSi: 'conteo' },
  { name: 'minimo', label: 'Avisarme cuando queden', type: 'number', min: 0, mostrarSi: 'conteo' },
];

const conConteo = p => p.conteo !== false;
const porComprar = p => Math.max((p.minimo || 0) * 2 - (p.existencias || 0), 1);

export async function render(el) {
  const productos = await db.getAll('productos');
  const faltan = productos.filter(p => p.activo !== false && conConteo(p) && p.existencias <= (p.minimo || 0));
  const grupos = [...CATEGORIAS, ['', 'Otros']]
    .map(([k, txt]) => [txt, productos.filter(p => (p.categoria || '') === k)])
    .filter(([, lista]) => lista.length);

  llenar(el,
    faltan.length > 0 && h('div', { class: 'alerta' },
      h('b', {}, `⚠️ Se están acabando ${faltan.length} producto(s)`),
      h('ul', {}, faltan.map(p => h('li', {}, `${p.nombre}: quedan ${p.existencias}`))),
      h('button', { class: 'btn', onclick: () => compartirTexto('🛒 Comprar para la tiendita\n' + faltan.map(p => `• ${p.nombre}: ${porComprar(p)}`).join('\n')) }, '📤 Mandar lista de compras')),
    h('button', { class: 'btn primario grande', onclick: () => editar() }, '+ Nuevo producto'),
    productos.length
      ? grupos.map(([txt, lista]) => [h('h2', {}, txt), h('div', { class: 'lista' }, lista.map(fila))])
      : vacio('📦', 'Agrega lo que vendes: hot cakes, nuggets, aguas…'));
}

function fila(p) {
  const bajo = conConteo(p) && p.existencias <= (p.minimo || 0);
  const sinHoy = p.agotadoDia === hoyISO();
  return h('div', { class: 'item' },
    h('span', { class: 'emoji' }, p.emoji || '🛒'),
    h('div', { class: 'info' },
      h('b', {}, p.nombre,
        p.activo === false && h('span', { class: 'etq' }, 'Oculto'),
        sinHoy && h('span', { class: 'etq' }, 'Se acabó hoy')),
      h('small', {}, dinero(p.precio)),
      conConteo(p) && h('small', { class: bajo ? 'debe' : '', style: 'display:block' }, `Quedan ${p.existencias}`)),
    h('div', { class: 'fila', style: 'flex-direction:column;gap:6px' },
      sinHoy && h('button', { class: 'btn verde', onclick: async () => {
        p.agotadoDia = null;
        await db.put('productos', p);
        toast(`Ya hay ${p.nombre} otra vez`);
        avisarCambio();
      } }, '✅ Ya hay'),
      conConteo(p) && h('button', { class: 'btn', onclick: () => entrada(p) }, '📥 Llegó'),
      h('button', { class: 'btn', onclick: () => editar(p) }, '✏️')));
}

// `categoria` es el tipo con el que empieza un producto nuevo (el del anterior al usar "agregar otro").
async function editar(p, categoria = 'comida') {
  const valores = p ? { ...p, conteo: conConteo(p) } : { emoji: '🛒', categoria, conteo: false, existencias: 0, minimo: 5 };
  const extra = p && (cerrar => h('div', { class: 'fila' },
    h('button', { type: 'button', class: 'btn', onclick: async () => {
      p.activo = p.activo === false;
      await db.put('productos', p);
      cerrar();
      avisarCambio();
    } }, p.activo === false ? '👁️ Mostrar en Vender' : '🙈 Ocultar de Vender'),
    h('button', { type: 'button', class: 'btn peligro', onclick: async () => {
      if (await pedirPin('Escribe tu PIN para borrar') && await confirmar(`¿Borrar "${p.nombre}"? Las ventas pasadas no se pierden.`, 'Borrar')) {
        await db.del('productos', p.id);
        cerrar();
        avisarCambio();
      }
    } }, 'Borrar')));
  const v = await formulario(p ? 'Editar producto' : 'Nuevo producto', CAMPOS, valores,
    { extra, textoOtro: p ? null : 'Guardar y agregar otro' });
  if (!v) return;
  const { otro, ...datos } = v;
  await db.put('productos', { ...p, ...datos, activo: p?.activo ?? true });
  toast(`${datos.nombre} guardado`);
  avisarCambio();
  if (otro) editar(null, datos.categoria);
}

async function entrada(p) {
  const v = await formulario(`Llegó: ${p.nombre}`, [
    { name: 'cant', label: '¿Cuántos llegaron?', type: 'number', min: 1, required: true },
  ]);
  if (!v || v.cant <= 0) return;
  await db.registrarEntrada(p.id, v.cant, 0);
  toast(`Ahora tienes ${p.existencias + v.cant} ${p.nombre}`);
  avisarCambio();
}
