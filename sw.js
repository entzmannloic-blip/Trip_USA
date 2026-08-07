/* build 2026-07 sprint5 */
/* Service worker — Grand Ouest Américain (mode hors-ligne)
   v2 : réseau d'abord pour le HTML (mises à jour immédiates),
        cache des tuiles de carte (consultation hors-ligne dans les parcs) */
const CACHE = 'grand-ouest-v4';
const TILE_CACHE = 'grand-ouest-tiles-v2';
const TILE_CACHE_MAX = 1200; // plafond de tuiles conservées (≈ 30-40 Mo)

const ASSETS = [
  './',
  './index.html',
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
  'fonts.gstatic.com',
  'commons.wikimedia.org',
  'upload.wikimedia.org'
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
      }).catch(async () => {
        // Hors-ligne : on tente plusieurs clés, sans jamais renvoyer null
        // (une réponse nulle provoque « FetchEvent.respondWith received an error »)
        const tries = [
          () => caches.match(req),
          () => caches.match(req, { ignoreSearch: true }),
          () => caches.match('./index.html'),
          () => caches.match('./index.html', { ignoreSearch: true }),
          () => caches.match('./'),
          () => caches.match(new URL('./index.html', self.registration.scope).href)
        ];
        for (const t of tries) {
          try {
            const hit = await t();
            if (hit) return hit;
          } catch (e) { /* on continue */ }
        }
        // Dernier recours : page lisible plutôt qu'une erreur brute
        return new Response(
          '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Hors ligne</title><style>body{margin:0;min-height:100vh;display:flex;' +
          'align-items:center;justify-content:center;background:#17120e;color:#f7f3ee;' +
          'font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:24px}' +
          'h1{font-size:20px;margin:0 0 10px}p{opacity:.7;font-size:14px;line-height:1.5;margin:0}' +
          '</style></head><body><div><h1>Mode hors ligne</h1>' +
          '<p>Cette page n\'a pas encore été enregistrée.<br>' +
          'Reconnecte-toi une fois pour la mettre en cache.</p></div></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
        );
      })
    );
    return;
  }

  // ── 2) Tuiles de carte + lib Leaflet : cache d'abord, réseau + mise en cache sinon ──
  if (TILE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        // Ignorer les entrées opaques héritées : elles sont rejetées par
        // les requêtes CORS (tuile noire). On refetch proprement.
        if (cached && cached.type !== 'opaque') return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(TILE_CACHE).then((cache) => {
              cache.put(req, copy);
              trimTileCache();
            });
          }
          return res;
        }).catch(() => new Response('', { status: 504, statusText: 'Hors ligne' }));
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
      }).catch(async () => {
        const hit = await caches.match('./index.html');
        return hit || new Response('', { status: 504, statusText: 'Hors ligne' });
      });
    })
  );
});
