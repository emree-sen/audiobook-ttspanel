// audiobook-ttspanel service worker — elle yazılmış (workbox yok).
// VERSION, istemcideki lib/ui/player/offline.ts AUDIO_CACHE sabitiyle eşleşmeli (wnt-v1-audio).
const VERSION = 'wnt-v1';
const AUDIO = `${VERSION}-audio`;
const STATIC = `${VERSION}-static`;
const SHELL = `${VERSION}-shell`;
const META = `${VERSION}-meta`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Cache'teki TAM yanıttan Range dilimi üret (206) — yoksa offline seek ve iOS çalma kırılır.
async function rangedResponse(req, res) {
  const range = req.headers.get('range');
  if (!range || res.status !== 200) return res;
  const m = /bytes=(\d+)-(\d+)?/.exec(range);
  if (!m) return res;
  const buf = await res.arrayBuffer();
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  if (start >= buf.byteLength) return new Response(null, { status: 416 });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  // İndirilen sesler: cache-first (Range destekli); yoksa ağ.
  if (url.pathname.startsWith('/api/audio/')) {
    e.respondWith((async () => {
      const hit = await (await caches.open(AUDIO)).match(url.pathname, { ignoreSearch: true, ignoreVary: true });
      if (hit) return rangedResponse(e.request, hit.clone());
      return fetch(e.request);
    })());
    return;
  }

  // Kütüphane verisi: network-first, offline'da son başarılı yanıt.
  if (url.pathname === '/api/library') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) (await caches.open(META)).put('/api/library', res.clone());
        return res;
      } catch {
        const hit = await caches.match('/api/library');
        return hit ?? Response.json({ error: 'Çevrimdışı — kütüphane önbelleği yok' }, { status: 503 });
      }
    })());
    return;
  }

  // Hash'li statikler: cache-first (güvenle bayatlamaz).
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })());
    return;
  }

  // Navigasyon: network-first; offline'da /library kabuğu.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok && url.pathname === '/library') (await caches.open(SHELL)).put('/library', res.clone());
        return res;
      } catch {
        const hit = await caches.match('/library');
        return hit ?? new Response('Çevrimdışı — kütüphane önbelleği yok', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
  }
});
