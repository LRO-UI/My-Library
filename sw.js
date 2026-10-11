const CACHE_NAME = 'my-library-v8';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './seed.js',
  './importers.js',
  './player.js',
  './backup.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/htm@3.1.1/preact/standalone.module.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Share target: files shared to the app from Android's share menu arrive here as a
// POST. They are parked in IndexedDB (same database and store as db.js) and the
// app is opened with ?shared, which picks them up and imports them.
function savePendingShare(files) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('my-library', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const d = req.result;
      const t = d.transaction('files', 'readwrite');
      const store = t.objectStore('files');
      const get = store.get('share:pending');
      get.onsuccess = () => store.put([...(get.result || []), ...files], 'share:pending');
      // Close right away: an open connection here would block future database upgrades.
      t.oncomplete = () => { d.close(); resolve(); };
      t.onerror = t.onabort = () => { d.close(); reject(t.error); };
    };
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const files = form.getAll('files').filter((f) => f instanceof File);
      if (files.length) await savePendingShare(files);
    } catch (e) { /* fall through to opening the app */ }
    return Response.redirect(self.registration.scope + '?shared=1', 303);
  })());
});

// Network-first: always try to fetch the latest version first.
// Only fall back to the cached copy if the network request fails (offline).
// Audio is played from blob: URLs, so it never passes through here.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok || response.type === 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
