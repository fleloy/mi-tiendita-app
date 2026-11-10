// Herramientas de seguridad: cifrado del respaldo, huella del PIN y revisión del contenido de un respaldo.
// Todo corre en el celular con la API de cifrado del navegador (Web Crypto). Sin internet.
import { STORES } from './db.js';

const ITERACIONES = 200000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const aHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
function aBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
const deBase64 = txt => Uint8Array.from(atob(txt), c => c.charCodeAt(0));
const nuevaSal = (n = 16) => crypto.getRandomValues(new Uint8Array(n));

// Huella del PIN: PBKDF2 con sal aleatoria. Lenta a propósito para que probar muchos PIN tarde.
export async function huellaClave(clave, sal) {
  const base = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deBase64(sal), iterations: ITERACIONES }, base, 256);
  return aHex(bits);
}

// Huella del PIN de la versión anterior (SHA-256 simple). Solo para leer PIN viejos y pasarlos a la nueva.
export async function huellaAntigua(pin, sal) {
  return aHex(await crypto.subtle.digest('SHA-256', enc.encode(`${sal}:${pin}`)));
}

export const nuevaSalTexto = () => aBase64(nuevaSal());

async function claveAES(clave, sal) {
  const base = await crypto.subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACIONES },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Cifra un texto con una contraseña. Devuelve sal, iv y datos en base64.
export async function cifrar(texto, clave) {
  const sal = nuevaSal();
  const iv = nuevaSal(12);
  const k = await claveAES(clave, sal);
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(texto));
  return { sal: aBase64(sal), iv: aBase64(iv), datos: aBase64(new Uint8Array(buf)) };
}

// Lo abre con la contraseña. Si la contraseña está mal, lanza error.
export async function descifrar(obj, clave) {
  const k = await claveAES(clave, deBase64(obj.sal));
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deBase64(obj.iv) }, k, deBase64(obj.datos));
  return dec.decode(buf);
}

const esFila = f => f && typeof f === 'object' && !Array.isArray(f);

// Revisa que el contenido de un respaldo tenga la forma correcta antes de reemplazar los datos.
// Devuelve null si está bien, o el motivo del problema.
export function problemaEnRespaldo(datos) {
  if (!esFila(datos)) return 'no tiene datos';
  if (!Array.isArray(datos.productos)) return 'no tiene productos';
  for (const n of STORES) {
    if (datos[n] === undefined) continue;
    if (!Array.isArray(datos[n])) return `"${n}" no es una lista`;
    if (!datos[n].every(esFila)) return `"${n}" tiene datos que no son válidos`;
  }
  return null;
}
