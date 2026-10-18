// Stale-while-revalidate for the app's own files, so the app opens offline after one visit.
// Map data has its own caches (Overpass responses in Cache Storage), so other origins are left alone.
const CACHE = 'audio-map-shell-v1';

// Built files carry a content hash (assets/index-AbC123xy.js); once a new one is stored, earlier builds of it are dead weight.
const HASHED = /^(.*\/assets\/.+)-[A-Za-z0-9_-]{8}\.(\w+)$/;
async function dropOldBuilds(cache, req) {
  const m = new URL(req.url).pathname.match(HASHED);
  if (!m) return;
  for (const k of await cache.keys()) {
    const n = new URL(k.url).pathname.match(HASHED);
    if (n && n[1] === m[1] && n[2] === m[2] && k.url !== req.url) await cache.delete(k);
  }
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('audio-map-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const cached = caches.open(CACHE).then(async (cache) => ({ cache, hit: await cache.match(req, { ignoreSearch: true }) }));
  const update = cached
    .then(({ cache }) =>
      fetch(req).then(async (res) => {
        if (res.ok) {
          await cache.put(req, res.clone());
          await dropOldBuilds(cache, req);
        }
        return res;
      }),
    )
    .catch(() => null);
  // waitUntil keeps the worker alive until the refresh is stored, even when the cached copy was served
  e.waitUntil(update);
  e.respondWith(cached.then(async ({ hit }) => hit ?? (await update) ?? Response.error()));
});
