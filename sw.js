/* Ismaili Guide service worker — the app and its knowledge base live on the
   phone, so it answers questions with no signal at all. */
/* BUILD is rewritten by deploy.sh. It has to change or the browser sees an
   identical service worker, keeps the old one, and the update never lands. */
const BUILD = '20260923-210530';
const CACHE = 'ismaili-guide-' + BUILD;
const SHELL = [
  './', './index.html', './styles.css', './engine.js', './app.js', './kb.json',
  './episodes.json', './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
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
    caches.match(req, { ignoreSearch: true }).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || caches.match('./index.html'));
      return hit || fresh;
    })
  );
});
