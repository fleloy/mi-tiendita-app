// Guarda la app en el celular para que funcione sin internet.
// Al cambiar cualquier archivo, sube el número de versión para que se actualice.
const CACHE = 'tiendita-v15';
const FUENTES = 'tiendita-fuentes';
const ARCHIVOS = [
  './', './index.html', './manifest.json', './css/app.css',
  './js/app.js', './js/util.js', './js/db.js', './js/vender.js', './js/pedidos.js',
  './js/inventario.js', './js/clientes.js', './js/reportes.js', './js/respaldo.js', './js/cierre.js', './js/preparar.js', './js/guia.js', './js/instalar.js',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' evita guardar copias viejas que el navegador tenga en su caché HTTP.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(a => new Request(a, { cache: 'reload' })))));
});

// La versión nueva espera a que la señora toque "Actualizar" (así no se mezclan archivos viejos y nuevos).
self.addEventListener('message', e => {
  if (e.data === 'activar') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== FUENTES).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // La letra de Google Fonts se guarda la primera vez que se descarga.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(new URL(e.request.url).hostname)) {
    e.respondWith(caches.open(FUENTES).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
