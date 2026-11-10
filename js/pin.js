// PIN de 4 números para lo delicado (Ganancias, borrar, recuperar respaldo).
// Se guarda solo una huella con sal (PBKDF2); con el PIN correcto queda desbloqueado unos minutos.
// Tras 5 intentos fallidos la app espera cada vez más. "Olvidé mi PIN" solo sirve después de 24 horas.
import { h, modal, confirmar, toast, leerLocal, guardarLocal } from './util.js';
import { modoPractica } from './db.js';
import { huellaClave, huellaAntigua, nuevaSalTexto } from './seguridad.js';

const DESBLOQUEO = 5 * 60e3;
const ESPERA_OLVIDO = 24 * 3600e3;
let desbloqueadoHasta = 0;

export const tienePin = () => !!leerLocal('pinHash');

// Pone la huella nueva (versión 2) y limpia los intentos fallidos.
async function guardarPin(pin) {
  const sal = nuevaSalTexto();
  guardarLocal('pinSal', sal);
  guardarLocal('pinHash', await huellaClave(pin, sal));
  guardarLocal('pinVer', '2');
  guardarLocal('pinFallos', '0');
  guardarLocal('pinBloqueo', '0');
  guardarLocal('pinOlvido', '');
}

// Revisa el PIN. Si es un PIN de la versión anterior y está bien, lo pasa a la versión nueva.
async function esCorrecto(pin) {
  const sal = leerLocal('pinSal') || '';
  const guardado = leerLocal('pinHash');
  if (leerLocal('pinVer') === '2') return (await huellaClave(pin, sal)) === guardado;
  const bien = (await huellaAntigua(pin, sal)) === guardado;
  if (bien) await guardarPin(pin);
  return bien;
}

const fallos = () => Number(leerLocal('pinFallos') || 0);
const bloqueoHasta = () => Number(leerLocal('pinBloqueo') || 0);

function anotarFallo() {
  const n = fallos() + 1;
  guardarLocal('pinFallos', String(n));
  if (n >= 5) guardarLocal('pinBloqueo', String(Date.now() + Math.min(3600e3, 60e3 * 2 ** (n - 5))));
}

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
  guardarLocal('pinVer', '');
  guardarLocal('pinFallos', '0');
  guardarLocal('pinBloqueo', '0');
  guardarLocal('pinOlvido', '');
}

// Quitar un PIN olvidado: primero hay que esperar 24 horas. Así no sirve para saltarlo en el momento.
async function olvidePin() {
  const desde = Number(leerLocal('pinOlvido') || 0);
  if (!desde) {
    guardarLocal('pinOlvido', String(Date.now()));
    await confirmar('Para quitar un PIN que olvidaste hay que esperar 24 horas. Empieza la espera ahora. Si mañana sigues sin acordarte, vuelve a tocar "Olvidé mi PIN".', 'Entendido');
    return false;
  }
  const falta = desde + ESPERA_OLVIDO - Date.now();
  if (falta > 0) {
    toast(`Todavía faltan ${Math.ceil(falta / 3600e3)} hora(s) para poder quitarlo`);
    return false;
  }
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
    if (pin === 'olvide') {
      if (await olvidePin()) return true;
      texto = motivo;
      continue;
    }
    const espera = bloqueoHasta() - Date.now();
    if (espera > 0) {
      texto = `⏳ Muchos intentos. Espera ${Math.ceil(espera / 1000)} segundos y vuelve a intentar.`;
      continue;
    }
    if (await esCorrecto(pin)) {
      guardarLocal('pinFallos', '0');
      guardarLocal('pinBloqueo', '0');
      desbloqueadoHasta = Date.now() + DESBLOQUEO;
      return true;
    }
    anotarFallo();
    navigator.vibrate?.([60, 40, 60]);
    texto = '❌ PIN incorrecto. Intenta otra vez.';
  }
}

export async function ponerPin() {
  const a = await teclado('🔐 Nuevo PIN', 'Escribe 4 números que vayas a recordar');
  if (!a || a === 'olvide') return;
  const b = await teclado('🔐 Nuevo PIN', 'Escríbelo otra vez');
  if (!b || b === 'olvide') return;
  if (a !== b) { toast('Los PIN no coinciden. Intenta otra vez.'); return; }
  await guardarPin(a);
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
