// PIN de 4 números para lo delicado (Ganancias, borrar, recuperar respaldo).
// Se guarda solo el hash con sal; con el PIN correcto queda desbloqueado unos minutos.
import { h, modal, confirmar, toast, leerLocal, guardarLocal } from './util.js';
import { modoPractica } from './db.js';

const DESBLOQUEO = 5 * 60e3;
let desbloqueadoHasta = 0;

export const tienePin = () => !!leerLocal('pinHash');

async function hashPin(pin, sal) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sal}:${pin}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const esCorrecto = async pin => (await hashPin(pin, leerLocal('pinSal') || '')) === leerLocal('pinHash');

// Teclado de 4 dígitos. Resuelve con el PIN escrito, 'olvide' o null si se cierra.
function teclado(titulo, texto, { olvide = false } = {}) {
  return new Promise(res => {
    let pin = '';
    let listo = false;
    const puntos = h('div', { class: 'pin-puntos' });
    const pintar = () => puntos.replaceChildren(...[0, 1, 2, 3].map(i => h('i', { class: i < pin.length ? 'lleno' : '' })));
    const terminar = valor => { listo = true; m.cerrar(); res(valor); };
    const tecla = d => {
      pin = d === '⌫' ? pin.slice(0, -1) : (pin + d).slice(0, 4);
      pintar();
      if (pin.length === 4) setTimeout(() => terminar(pin), 120);
    };
    const m = modal(titulo, [
      h('p', { class: 'etiqueta pin-msg' }, texto),
      puntos,
      h('div', { class: 'pin-teclado' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(d => d
        ? h('button', { class: 'btn', type: 'button', 'aria-label': d === '⌫' ? 'Borrar' : d, onclick: () => tecla(d) }, d)
        : h('span'))),
      olvide && h('button', { class: 'btn grande pin-olvide', type: 'button', onclick: () => terminar('olvide') }, 'Olvidé mi PIN'),
    ], { onClose: () => { if (!listo) res(null); } });
    pintar();
  });
}

function borrarPin() {
  guardarLocal('pinHash', '');
  guardarLocal('pinSal', '');
}

async function olvidePin() {
  if (!await confirmar('¿Quitar el PIN? Tus datos no se borran, pero cualquiera podrá entrar a Ganancias.', 'Quitar PIN')) return false;
  if (!await confirmar('¿Segura? Después puedes poner uno nuevo en "Más".', 'Sí, quitarlo')) return false;
  borrarPin();
  toast('PIN quitado');
  return true;
}

// true si se puede continuar: no hay PIN, es modo práctica, ya estaba desbloqueado o lo escribió bien.
export async function pedirPin(motivo = 'Escribe tu PIN') {
  if (!tienePin() || modoPractica() || Date.now() < desbloqueadoHasta) return true;
  let texto = motivo;
  for (;;) {
    const pin = await teclado('🔐 PIN', texto, { olvide: true });
    if (pin === null) return false;
    if (pin === 'olvide') return olvidePin();
    if (await esCorrecto(pin)) {
      desbloqueadoHasta = Date.now() + DESBLOQUEO;
      return true;
    }
    navigator.vibrate?.([60, 40, 60]);
    texto = '❌ PIN incorrecto. Intenta otra vez.';
  }
}

export async function ponerPin() {
  const a = await teclado('🔐 Nuevo PIN', 'Escribe 4 números que vayas a recordar');
  if (!a) return;
  const b = await teclado('🔐 Nuevo PIN', 'Escríbelo otra vez');
  if (!b) return;
  if (a !== b) { toast('Los PIN no coinciden. Intenta otra vez.'); return; }
  const sal = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  guardarLocal('pinSal', sal);
  guardarLocal('pinHash', await hashPin(a, sal));
  desbloqueadoHasta = Date.now() + DESBLOQUEO;
  toast('PIN guardado ✅');
}

// Cambiar o quitar siempre piden el PIN actual, aunque esté desbloqueado.
export async function cambiarPin() {
  desbloqueadoHasta = 0;
  if (await pedirPin('Escribe tu PIN actual') && tienePin()) await ponerPin();
}

export async function quitarPin() {
  desbloqueadoHasta = 0;
  if (await pedirPin('Escribe tu PIN actual para quitarlo') && tienePin()) { borrarPin(); toast('PIN quitado'); }
}
