/* eslint-disable no-restricted-globals */
// Service worker: app-shell precache, versioned media cache, web push.
// Built by scripts/vite-sw-plugin.ts, which injects the precache list and the
// list of media files of this release.

const PRECACHE = self.__PRECACHE__;
const VERSION = self.__SW_VERSION__;
const MEDIA_FILES = new Set(self.__MEDIA_FILES__);
const MEDIA_VERSION = self.__MEDIA_VERSION__;
const SHELL_CACHE = `okuma-shell-${VERSION}`;
const MEDIA_CACHE = `okuma-media-${MEDIA_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (PRECACHE.length) {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(PRECACHE);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('okuma-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k)),
      );
      await migrateMedia(keys);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/media/')) {
    // Only files of this release are cached; anything else goes to the network.
    if (MEDIA_FILES.has(url.pathname)) event.respondWith(cacheFirst(req, MEDIA_CACHE));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstShell(req));
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
  }
});

/**
 * New media version: keep cached files that are still part of the release
 * (no re-download), drop the rest, delete the old caches.
 */
async function migrateMedia(keys) {
  const old = keys.filter((k) => k.startsWith('okuma-media-') && k !== MEDIA_CACHE);
  if (!old.length) return;
  const fresh = await caches.open(MEDIA_CACHE);
  for (const name of old) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (!MEDIA_FILES.has(new URL(req.url).pathname)) continue;
      const res = await cache.match(req);
      if (res) await fresh.put(req, res);
    }
    await caches.delete(name);
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstShell(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/', res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match('/')) || Response.error();
  }
}

// Page asks us to cache the media of the next lesson: { type: 'cache-media', urls }
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'cache-media' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(MEDIA_CACHE);
      let done = 0;
      let failed = 0;
      for (const u of data.urls) {
        try {
          if (!(await cache.match(u))) {
            const res = await fetch(u);
            if (!res.ok) throw new Error(String(res.status));
            await cache.put(u, res);
          }
          done++;
        } catch {
          failed++;
        }
      }
      const reply = { type: 'cache-media-done', id: data.id, done, failed, total: data.urls.length };
      if (event.source) event.source.postMessage(reply);
    })(),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Okuma';
  // iOS requires a visible notification for every push.
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'okuma',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/', id: data.id || null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/', id = null } = event.notification.data || {};
  const target = new URL(url, self.location.origin);
  if (id) target.searchParams.set('n', id);
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.postMessage({ type: 'notification-click', id, url: target.pathname + target.search });
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
