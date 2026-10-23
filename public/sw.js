// Минимальный service worker: нужен, чтобы браузер предложил установить приложение на экран телефона.
// Данные не кэшируются — расчёты всегда свежие.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response('Нет соединения с интернетом. Попробуйте позже.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
});
