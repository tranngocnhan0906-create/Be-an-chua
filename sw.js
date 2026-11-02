// Service worker: chạy offline cơ bản + nhận thông báo đẩy
const VERSION = '2.1.0';
const SHELL = `bac-shell-${VERSION}`;
const RUNTIME = 'bac-runtime';
const SHELL_FILES = [
  './',
  './index.html',
  './css/app.css?v=2.1.0',
  './js/app.js?v=2.1.0',
  './js/api.js',
  './js/config.js',
  './js/util.js',
  './js/media.js',
  './js/art.js',
  './js/sound.js',
  './sounds/meow.mp3',
  './sounds/meow2.mp3',
  './js/vendor/supabase.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
  './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bac-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Không bao giờ cache dữ liệu/ảnh từ Supabase ở đây (trình duyệt tự cache ảnh)
  if (/\.supabase\.(co|in)$/.test(url.hostname)) return;

  if (url.origin === self.location.origin) {
    // Ưu tiên mạng để luôn có bản mới nhất, mất mạng thì dùng bản đã lưu
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))),
    );
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : '' };
  }
  const title = d.title || 'Bé ăn chưa? 🐱';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '#/' },
      vibrate: String(d.tag || '').startsWith('buzz') ? [220, 90, 220, 90, 420] : [80, 40, 80],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = String(event.notification.data?.url || '#/');
  const safeHash = hash.startsWith('#') ? hash : '#/';
  const target = self.registration.scope + safeHash;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: 'open', url: safeHash });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
