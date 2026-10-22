// Pantalla "Más": guía, opciones, modo práctica y respaldo de datos (exportar / importar).
import { h, llenar, toast, confirmar, fechaCorta, leerLocal, guardarLocal, avisarCambio, hoyISO } from './util.js';
import * as db from './db.js';
import { abrirGuia } from './guia.js';

export const VERSION = '3';

export async function render(el) {
  const ultimo = Number(leerLocal('ultimoRespaldo') || 0);
  const archivo = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: importar });
  const protegidos = await navigator.storage?.persisted?.();
  const practica = db.modoPractica();

  llenar(el,
    h('button', { class: 'btn primario grande', onclick: abrirGuia }, '📖 Cómo se usa'),

    h('h2', {}, '🎓 Modo práctica'),
    h('p', {}, practica
      ? 'Estás practicando. Nada de lo que hagas aquí cuenta en tus ventas ni cuentas reales.'
      : 'Practica a cobrar, fiar y cerrar el día sin tocar tus datos reales.'),
    h('button', { class: 'btn grande', onclick: () => cambiarModo(!practica) }, practica ? '↩️ Salir del modo práctica' : '🎓 Entrar a modo práctica'),

    h('h2', {}, '⚙️ Opciones'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: leerLocal('pedidos') !== 'no', onchange: e => {
        guardarLocal('pedidos', e.target.checked ? 'si' : 'no');
        avisarCambio();
      } }),
      'Usar lista de pedidos por entregar (le da un número a cada pedido)'),

    h('h2', {}, '💾 Respaldo'),
    h('p', { class: 'estado-datos' }, protegidos
      ? '🛡️ Tus datos están protegidos en este celular.'
      : '⚠️ Instala la app en la pantalla de inicio para que el celular no borre tus datos al liberar espacio.'),
    h('p', {}, 'Tus datos se guardan solo en este celular. Guarda un respaldo al cerrar el día y mándatelo por WhatsApp, por si se pierde o cambia el teléfono.'),
    h('p', { class: 'etiqueta' }, ultimo ? `Último respaldo: ${fechaCorta(ultimo)}` : 'Todavía no has hecho ningún respaldo'),
    h('div', { class: 'lista', style: 'margin-top:10px' },
      h('button', { class: 'btn primario grande', onclick: exportar }, '📤 Guardar / compartir respaldo'),
      h('button', { class: 'btn grande', onclick: () => archivo.click() }, '📥 Recuperar un respaldo'),
      archivo),

    h('h2', {}, '🧰 Otros'),
    h('div', { class: 'lista' },
      h('button', { class: 'btn grande', onclick: async () => { await db.cargarEjemplo(); toast('Menú agregado'); avisarCambio(); } }, 'Cargar el menú de la tiendita'),
      h('button', { class: 'btn peligro grande', onclick: borrarTodo }, 'Borrar todos los datos')),
    h('p', { class: 'etiqueta', style: 'margin-top:24px' }, `Mi Tiendita · versión ${VERSION}${practica ? ' · modo práctica' : ''}`));
}

export async function cambiarModo(practica) {
  guardarLocal('modo', practica ? 'practica' : 'real');
  location.reload();
}

function descargar(archivo) {
  const a = h('a', { href: URL.createObjectURL(archivo), download: archivo.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function archivoRespaldo(prefijo = 'tiendita-respaldo') {
  const datos = await db.exportarTodo();
  const nombre = `${prefijo}${db.modoPractica() ? '-PRACTICA' : ''}-${hoyISO()}.json`;
  return new File([JSON.stringify(datos)], nombre, { type: 'application/json' });
}

export async function exportar() {
  const archivo = await archivoRespaldo();
  let compartido = false;
  if (navigator.canShare?.({ files: [archivo] })) {
    try { await navigator.share({ files: [archivo], title: 'Respaldo Tiendita' }); compartido = true; } catch { /* cancelado */ }
  }
  if (!compartido) descargar(archivo);
  if (!db.modoPractica()) guardarLocal('ultimoRespaldo', String(Date.now()));
  toast('Respaldo listo');
  avisarCambio();
}

// Antes de reemplazar o borrar, guardar lo que hay por si fue un error.
async function respaldoDeSeguridad() {
  descargar(await archivoRespaldo('tiendita-antes-de-cambiar'));
}

async function importar(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let json;
  try { json = JSON.parse(await f.text()); } catch { toast('Ese archivo no es un respaldo'); return; }
  if (json?.app !== 'tiendita' || !Array.isArray(json.datos?.productos)) { toast('Ese archivo no es un respaldo de la tiendita'); return; }
  const resumen = `${json.datos.productos.length} productos y ${(json.datos.ventas || []).length} ventas`;
  if (!await confirmar(`Esto reemplaza TODO lo de este celular con el respaldo del ${fechaCorta(json.fecha)} (${resumen}). Antes se guardará una copia de lo que tienes ahora.`, 'Recuperar')) return;
  await respaldoDeSeguridad();
  await db.reemplazarTodo(json.datos);
  toast('Respaldo recuperado');
  avisarCambio();
}

async function borrarTodo() {
  if (!await confirmar('Se borrarán productos, ventas y cuentas. Antes se guardará una copia por si acaso.', 'Borrar todo')) return;
  await respaldoDeSeguridad();
  await db.reemplazarTodo({});
  toast('Datos borrados');
  avisarCambio();
}
