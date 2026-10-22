// Utilidades compartidas: creación de elementos, dinero, avisos y ventanas.

export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

export const r2 = n => Math.round(n * 100) / 100;

export function dinero(n) {
  n = r2(n || 0);
  const abs = Math.abs(n).toLocaleString('es-MX', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return (n < 0 ? '-$' : '$') + abs;
}

export function fechaCorta(ms) {
  return new Date(ms).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Avisa a la app que cambiaron los datos para que repinte la pantalla actual.
export const avisarCambio = () => window.dispatchEvent(new Event('datos'));

let toastTimer;
export function toast(msg, accion, duracion) {
  const t = document.getElementById('toast');
  t.replaceChildren(h('span', {}, msg));
  if (accion) {
    t.append(h('button', { onclick: () => { t.classList.remove('visible'); accion.fn(); } }, accion.texto));
  }
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), duracion || (accion ? 6000 : 2500));
}

export function modal(titulo, cuerpo, { onClose } = {}) {
  const d = h('dialog', { class: 'modal' },
    h('header', {},
      h('h2', {}, titulo),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Cerrar', onclick: () => cerrar() }, '✕')),
    h('div', { class: 'cuerpo' }, cuerpo));
  document.body.append(d);
  // Se limpia al cerrar con el botón (al instante) o con "atrás"/Esc (evento close).
  let cerrado = false;
  const limpiar = () => { if (cerrado) return; cerrado = true; d.remove(); onClose?.(); };
  d.addEventListener('close', limpiar);
  d.showModal();
  function cerrar() { if (d.open) d.close(); limpiar(); }
  return { cerrar, el: d };
}

export function confirmar(msg, textoSi = 'Sí') {
  return new Promise(res => {
    let r = false;
    const m = modal('¿Seguro?', [
      h('p', { class: 'grande-txt' }, msg),
      h('div', { class: 'fila' },
        h('button', { class: 'btn', onclick: () => m.cerrar() }, 'No'),
        h('button', { class: 'btn peligro', onclick: () => { r = true; m.cerrar(); } }, textoSi)),
    ], { onClose: () => res(r) });
  });
}

const EMOJIS = ['🥞', '🍗', '🍛', '🌽', '🌮', '🥪', '🌭', '🍔', '🍕', '🥗', '🍉', '🍎', '🍮', '🍪', '🧁', '🍰', '🍩', '🍦', '💧', '🥛', '🧃', '🥤', '🍿', '🛒'];

function campo(c, valor) {
  if (c.type === 'checkbox') {
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: c.name, checked: !!valor }), c.label);
  }
  if (c.type === 'select') {
    return h('label', { class: 'campo' }, h('span', {}, c.label),
      h('select', { name: c.name }, c.opciones.map(([v, t]) => h('option', { value: v, selected: v === valor }, t))));
  }
  if (c.type === 'multi') {
    const sel = new Set(valor || []);
    return h('fieldset', { class: 'campo multi' }, h('legend', {}, c.label),
      c.opciones.length ? c.opciones.map(([v, t]) =>
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: c.name, value: v, checked: sel.has(v) }), t))
        : h('small', {}, 'No hay productos todavía'));
  }
  const input = h('input', {
    name: c.name,
    type: c.type === 'emoji' ? 'text' : (c.type || 'text'),
    inputmode: c.type === 'number' ? 'numeric' : c.type === 'tel' ? 'tel' : null,
    step: c.type === 'number' ? (c.step || '1') : null,
    min: c.min,
    required: !!c.required,
    placeholder: c.placeholder,
    value: valor ?? '',
    autocomplete: 'off',
  });
  const partes = [h('span', {}, c.label), input];
  if (c.type === 'emoji') {
    input.maxLength = 4;
    input.classList.add('emoji-input');
    partes.push(h('div', { class: 'emojis' }, EMOJIS.map(e =>
      h('button', { type: 'button', onclick: () => { input.value = e; } }, e))));
  }
  return h('label', { class: 'campo' }, partes);
}

// Formulario en ventana. Resuelve con los valores o null si se cancela.
export function formulario(titulo, campos, valores = {}, { textoBoton = 'Guardar', extra } = {}) {
  return new Promise(res => {
    let hecho = false;
    const f = h('form', { class: 'form' },
      campos.map(c => campo(c, valores[c.name])),
      // `extra` puede ser una función que recibe cómo cerrar el formulario.
      typeof extra === 'function' ? extra(() => m.cerrar()) : extra,
      h('button', { class: 'btn primario grande', type: 'submit' }, textoBoton));
    f.onsubmit = e => {
      e.preventDefault();
      const out = {};
      for (const c of campos) {
        if (c.type === 'multi') {
          out[c.name] = [...f.querySelectorAll(`input[name="${c.name}"]:checked`)].map(i => Number(i.value));
          continue;
        }
        const i = f.elements[c.name];
        out[c.name] = c.type === 'checkbox' ? i.checked
          : c.type === 'number' ? (i.value === '' ? 0 : Number(i.value))
          : i.value.trim();
      }
      hecho = true;
      m.cerrar();
      res(out);
    };
    const m = modal(titulo, f, { onClose: () => { if (!hecho) res(null); } });
  });
}

export function vacio(icono, texto, ...botones) {
  return h('div', { class: 'vacio' }, h('div', { class: 'icono' }, icono), h('p', {}, texto), botones);
}

export function leerLocal(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
export function guardarLocal(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento */ }
}

// Como replaceChildren pero ignora null/false y aplana listas.
export function llenar(el, ...hijos) {
  el.replaceChildren(...hijos.flat(Infinity).filter(c => c != null && c !== false));
}

export const CATEGORIAS = [['comida', '🍽️ Comida'], ['postres', '🍮 Postres'], ['bebidas', '🥤 Bebidas']];

// Manda un texto por WhatsApp (a un número si se da) o con el menú de compartir del celular.
export async function compartirTexto(texto, telefono) {
  let tel = String(telefono || '').replace(/\D/g, '');
  if (tel.length === 10) tel = '52' + tel;
  if (!tel && navigator.share) {
    try { await navigator.share({ text: texto }); return; } catch { /* cancelado */ }
  }
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank');
}

// Fecha local de hoy como 'AAAA-MM-DD'.
export function hoyISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
