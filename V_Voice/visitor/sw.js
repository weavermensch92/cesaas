// Service Worker — Visitor PWA (V_20.01).
// 앱 셸 캐싱 + 오프라인 fallback + 큐 drain은 페이지 측에서.

const CACHE = 'hd-visitor-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 같은 origin 의 셸·정적 자산만 캐싱. API 호출은 통과.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/functions/')) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        // 성공한 GET만 캐시 갱신
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      }).catch(() => {
        // 오프라인 + 캐시도 없음 — index.html fallback
        if (request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504 });
      });
    })
  );
});
