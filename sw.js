// Red primero (para recibir siempre la última versión) y caché como respaldo sin conexión.
const CACHE = 'guion-v20';
const ASSETS = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/matcher.js', 'js/voice.js', 'js/camera.js', 'js/xlsx.js', 'js/audio.js', 'js/cloud.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita guardar copias viejas que el navegador tenga en su caché HTTP.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: siempre se consulta al servidor (si no cambió, responde 304 y es rápido).
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.status === 200 && !req.headers.has('range')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
