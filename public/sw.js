// Stale-while-revalidate for the app's own files, so the app opens offline after one visit.
// Map data has its own caches (Overpass responses in Cache Storage), so other origins are left alone.
const CACHE = 'audio-map-shell-v1';

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
        if (res.ok) await cache.put(req, res.clone());
        return res;
      }),
    )
    .catch(() => null);
  // waitUntil keeps the worker alive until the refresh is stored, even when the cached copy was served
  e.waitUntil(update);
  e.respondWith(cached.then(async ({ hit }) => hit ?? (await update) ?? Response.error()));
});
