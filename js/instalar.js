// Botón "Instalar app" propio, para no depender de encontrar la opción en el menú del navegador.
let evento = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  evento = e;
  window.dispatchEvent(new Event('datos'));
});
window.addEventListener('appinstalled', () => {
  evento = null;
  window.dispatchEvent(new Event('datos'));
});

export const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const puedeInstalar = () => !!evento && !instalada();

export async function instalar() {
  if (!evento) return false;
  evento.prompt();
  const { outcome } = await evento.userChoice;
  evento = null;
  window.dispatchEvent(new Event('datos'));
  return outcome === 'accepted';
}
