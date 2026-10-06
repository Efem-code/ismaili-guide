/* Ismaili Guide service worker — the app and its knowledge base live on the
   phone, so it answers questions with no signal at all. */
/* BUILD is rewritten by deploy.sh. It has to change or the browser sees an
   identical service worker, keeps the old one, and the update never lands. */
const BUILD = '20261005-205711';
const PREFIX = 'ismaili-guide-';
const CACHE = PREFIX + BUILD;
const SHELL = [
  './', './index.html', './styles.css', './engine.js', './app.js', './kb.json',
  './episodes.json', './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  /* cache: 'reload' skips the browser's HTTP cache (GitHub Pages sends
     max-age=600). Every file must come back 200: an error page from a
     half-published deploy would be cached for good, so a bad response fails
     the install and the browser retries next launch. */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => {
      if (!r.ok) throw new Error(u + ' -> ' + r.status);
      return c.put(u, r);
    }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  /* Every app lives on the same origin (efem-code.github.io), so they share
     one CacheStorage. Only clear this app's old builds, never another app's. */
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;
  if (/\.mp3$/.test(new URL(req.url).pathname)) return;   // stream episodes, don't cache 15 MB files
  /* Stale-while-revalidate: instant from cache, refreshed in the background so
     a new knowledge base shows up on the next launch. */
  e.respondWith(
    caches.match(req, { ignoreSearch: true, cacheName: CACHE }).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || caches.match('./index.html', { cacheName: CACHE }));
      return hit || fresh;
    })
  );
});
