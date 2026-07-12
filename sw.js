// Service worker: network-first per l'HTML, cache-first per gli asset statici.
// Così l'app (singolo index.html) prende sempre l'ultima versione quando sei
// online, e funziona offline grazie alla copia in cache. Niente più versioni
// "incastrate": basta riaprire l'app da connessi.
const CACHE = 'respiro-pacer-v62-guida-onda-ectopici';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const req = e.request;
  // L'HTML (navigazioni e index.html) va preso dalla rete quando possibile,
  // così gli aggiornamenti compaiono subito. Offline → copia in cache.
  const isHTML = req.mode === 'navigate' || /\/$|index\.html$/.test(new URL(req.url).pathname);
  if (isHTML) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }
  // Asset statici (icone, manifest): cache-first.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
