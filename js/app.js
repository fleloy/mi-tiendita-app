import * as instalacion from './instalar.js'; // primero, para no perder el aviso de "se puede instalar"
import * as vender from './vender.js';
import * as pedidos from './pedidos.js';
import * as inventario from './inventario.js';
import * as clientes from './clientes.js';
import * as reportes from './reportes.js';
import * as respaldo from './respaldo.js';
import { h, llenar, leerLocal, guardarLocal, toast, dinero, hoyISO } from './util.js';
import * as db from './db.js';
import { abrirGuia, guiaVista } from './guia.js';
import { pedirPin } from './pin.js';
import { cerrarDia, nombreDia } from './cierre.js';

const PANTALLAS = {
  vender: { mod: vender, titulo: 'Vender' },
  pedidos: { mod: pedidos, titulo: 'Por entregar' },
  inventario: { mod: inventario, titulo: 'Productos' },
  clientes: { mod: clientes, titulo: 'Cuentas y fiado' },
  reportes: { mod: reportes, titulo: 'Ganancias' },
  respaldo: { mod: respaldo, titulo: 'Más opciones' },
};
let actual = 'vender';
const contenido = document.getElementById('contenido');

async function pintar() {
  const p = PANTALLAS[actual];
  document.getElementById('titulo').textContent = p.titulo;
  document.querySelectorAll('.pestanas button').forEach(b => b.classList.toggle('activa', b.dataset.tab === actual));
  try {
    await p.mod.render(contenido);
  } catch (e) {
    console.error(e);
    llenar(contenido, h('div', { class: 'vacio' },
      h('div', { class: 'icono' }, '😕'),
      h('p', {}, 'No se pudieron leer tus datos.'),
      h('small', {}, String(e?.message || e)),
      h('button', { class: 'btn primario grande', onclick: () => location.reload() }, 'Intentar otra vez')));
    return;
  }
  revisarRespaldo();
  contarPedidos();
}

async function contarPedidos() {
  const boton = document.querySelector('[data-tab=pedidos]');
  boton.hidden = !pedidos.activo();
  const n = boton.hidden ? 0 : (await pedidos.pendientes()).length;
  const badge = boton.querySelector('.badge');
  badge.textContent = n;
  badge.hidden = n === 0;
}

// Mantener al día el "hace X min" mientras se ve la lista de pedidos.
setInterval(() => { if (actual === 'pedidos' && !document.querySelector('dialog')) pintar(); }, 30000);

export async function ir(tab) {
  if (tab === 'reportes' && actual !== 'reportes' && !await pedirPin('Escribe tu PIN para ver Ganancias')) return;
  actual = tab;
  window.scrollTo(0, 0);
  pintar();
}

async function revisarRespaldo() {
  const aviso = document.getElementById('aviso');
  if (instalacion.puedeInstalar()) {
    aviso.replaceChildren(h('button', { class: 'aviso-respaldo aviso-instalar', onclick: instalacion.instalar },
      '📲 Instala la app en tu celular para usarla sin internet. Toca aquí.'));
    return;
  }
  if (db.modoPractica()) { aviso.replaceChildren(); return; }
  // Los viernes los papás pagan: recordar cuánto le deben (una vez al día, hasta que lo toque).
  if (new Date().getDay() === 5 && leerLocal('viernesVisto') !== hoyISO() && actual !== 'clientes') {
    const deben = (await db.getAll('clientes')).filter(c => c.saldo < 0);
    if (deben.length) {
      const total = deben.reduce((s, c) => s - c.saldo, 0);
      aviso.replaceChildren(h('button', { class: 'aviso-respaldo aviso-instalar', onclick: async () => {
        guardarLocal('viernesVisto', hoyISO());
        await ir('clientes');
        clientes.abrirCobroViernes();
      } }, `📅 Hoy es viernes: te deben ${dinero(total)} entre ${deben.length} persona(s). Toca para cobrar.`));
      return;
    }
  }
  // El último día con ventas se quedó sin cerrar: recordarlo hasta que lo cierre o diga "Ahora no".
  const pendiente = await diaSinCerrar();
  if (pendiente) {
    aviso.replaceChildren(h('div', { class: 'aviso-doble' },
      h('button', { class: 'aviso-respaldo aviso-instalar', onclick: async () => {
        await ir('reportes');
        if (actual === 'reportes') await cerrarDia(pendiente);
      } }, `🔒 No cerraste el ${nombreDia(pendiente)}. Toca para hacerlo.`),
      h('button', { class: 'aviso-omitir', onclick: () => {
        guardarLocal('cierreOmitido', hoyISO(pendiente));
        revisarRespaldo();
      } }, 'Ahora no')));
    return;
  }
  // Si nunca ha respaldado, contar desde su primera venta (no molestar el primer día).
  const ultimo = Number(leerLocal('ultimoRespaldo') || 0) || (await db.primero('ventas'))?.fecha;
  const dias = ultimo ? Math.floor((Date.now() - ultimo) / 864e5) : 0;
  aviso.replaceChildren(dias >= 3 && actual !== 'respaldo'
    ? h('button', { class: 'aviso-respaldo', onclick: () => ir('respaldo') }, `💾 Hace ${dias} días que no guardas un respaldo. Toca aquí.`)
    : '');
}

// El día más reciente (de la última semana, sin contar hoy) con ventas y sin cierre, o null.
async function diaSinCerrar() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ventas = (await db.getRango('ventas', hoy.getTime() - 7 * 864e5, hoy.getTime())).filter(v => !v.cancelada);
  if (!ventas.length) return null;
  const ultima = new Date(Math.max(...ventas.map(v => v.fecha)));
  const dia = hoyISO(ultima);
  if (leerLocal('cierreOmitido') === dia) return null;
  return (await db.getAll('cierres')).some(c => c.dia === dia) ? null : ultima;
}

// Franja visible mientras se practica, para no confundirse con los datos reales.
function franjaPractica() {
  if (!db.modoPractica()) return;
  document.querySelector('.barra-sup').prepend(h('div', { class: 'franja-practica' },
    h('span', {}, '🎓 MODO PRÁCTICA — no cuenta'),
    h('button', { onclick: () => respaldo.cambiarModo(false) }, 'Salir')));
}

// Ningún error debe pasar en silencio: avisar y dejar el detalle en la consola.
let ultimoError = 0;
function avisarError(e) {
  console.error(e);
  if (Date.now() - ultimoError < 3000) return;
  ultimoError = Date.now();
  toast('😕 Algo salió mal. Intenta otra vez.');
}
window.addEventListener('error', e => avisarError(e.error || e.message));
window.addEventListener('unhandledrejection', e => avisarError(e.reason));

// Actualizaciones: la versión nueva se activa cuando la señora toca "Actualizar".
function vigilarActualizaciones(reg) {
  const ofrecer = sw => toast('✨ Hay una versión nueva de la app', {
    texto: 'Actualizar', fn: () => sw.postMessage('activar'),
  }, 60000);
  if (reg.waiting && navigator.serviceWorker.controller) ofrecer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed' && navigator.serviceWorker.controller) ofrecer(sw);
    });
  });
  // La primera instalación también cambia el "controlador"; solo hay que recargar si ya había una versión.
  let habiaVersion = !!navigator.serviceWorker.controller;
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!habiaVersion) { habiaVersion = true; return; }
    if (recargando) return;
    recargando = true;
    location.reload();
  });
}

document.querySelectorAll('.pestanas button').forEach(b => b.addEventListener('click', () => ir(b.dataset.tab)));
window.addEventListener('datos', pintar);
window.addEventListener('ir', e => ir(e.detail));

navigator.storage?.persist?.();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(vigilarActualizaciones).catch(console.error);
}

async function iniciar() {
  franjaPractica();
  try {
    // En modo práctica, empezar con el menú cargado.
    if (db.modoPractica() && !(await db.getAll('productos')).length) await db.cargarEjemplo();
  } catch (e) { console.error(e); }
  await pintar();
  if (!guiaVista()) abrirGuia();
}
iniciar();
