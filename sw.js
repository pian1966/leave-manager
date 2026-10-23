/* Leave Manager – offline support.
   Always tries the network first so staff get the newest version; falls back to the last copy when offline.
   Leave data itself always comes live from the Google script and is never cached here. */
var CACHE = 'leave-manager-v3';
var SHELL = ['./', 'index.html', 'assets/app.css', 'assets/app.js', 'assets/core.js', 'assets/config.js', 'assets/icons/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Videos and guides: let the browser handle them (videos need range requests to play and skip).
  if (req.headers.has('range') || /\/docs\//.test(url.pathname) || /\.(mp4|webm|jpg)$/i.test(url.pathname)) return;
  // cache: 'no-cache' = always ask GitHub whether the file changed (quick), so updates show up straight away.
  e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
  }));
});
