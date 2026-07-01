/* Service worker — Grand Ouest Américain (mode hors-ligne)
   v2 : réseau d'abord pour le HTML (mises à jour immédiates),
        cache des tuiles de carte (consultation hors-ligne dans les parcs) */
const CACHE = 'grand-ouest-v2';
const TILE_CACHE = 'grand-ouest-tiles-v1';
const TILE_CACHE_MAX = 1200; // plafond de tuiles conservées (≈ 30-40 Mo)

const ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// Domaines de tuiles de carte à mettre en cache pour le hors-ligne
const TILE_HOSTS = [
  'server.arcgisonline.com',
  'basemaps.cartocdn.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
  'd.basemaps.cartocdn.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Installation : pré-cache des assets statiques
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activation : purge des anciens caches (dont grand-ouest-v1 → force la maj)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Limite la taille du cache de tuiles (supprime les plus anciennes)
async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > TILE_CACHE_MAX) {
    const excess = keys.length - TILE_CACHE_MAX;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ── 1) Navigation / HTML : RÉSEAU D'ABORD, cache en secours ──
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req).then((c) => c || caches.match('./index.html'))
      )
    );
    return;
  }

  // ── 2) Tuiles de carte + lib Leaflet : cache d'abord, réseau + mise en cache sinon ──
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(TILE_CACHE).then((cache) => {
              cache.put(req, copy);
              trimTileCache();
            });
          }
          return res;
        });
      })
    );
    return;
  }

  // ── 3) Autres assets same-origin : cache d'abord, réseau en secours ──
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
