/* 指板靈感本 service worker：讓網站與吉他取樣在沒有網路時也能開啟與播放。
 *
 * 快取分兩個：
 *  - gip-app      網頁本體。建置時產生的 precache.json 列出所有檔案，頁面載入後傳 PRECACHE 訊息來更新。
 *  - gip-samples-v1  吉他取樣（大檔、很少變），取得一次就一直用。
 *
 * 策略：取樣與 /assets/（檔名含雜湊，內容不會變）→ 先看快取；
 *       頁面與其他檔案 → 先連網路，連不上才用快取（所以有網路時永遠是最新版）。
 */
const APP = 'gip-app';
const SAMPLES = 'gip-samples-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('gip-') && key !== APP && key !== SAMPLES) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// ignoreVary：伺服器回應常帶 "Vary: Origin"，而頁面載入 <script crossorigin> 的請求有 Origin、
// 預快取時的請求沒有，不忽略的話明明在快取裡卻比對不到，離線時整頁載入失敗。
const MATCH = { ignoreVary: true };

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.status === 200) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(request, MATCH)) || (await cache.match(request, { ...MATCH, ignoreSearch: true }));
    if (hit) return hit;
    // 導覽請求連不上也沒快取：退回已快取的首頁
    if (request.mode === 'navigate') {
      const home = await cache.match(self.registration.scope, MATCH);
      if (home) return home;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;

  if (url.pathname.includes('/samples/')) {
    event.respondWith(cacheFirst(request, SAMPLES));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request, APP));
  } else {
    event.respondWith(networkFirst(request, APP));
  }
});

async function precache() {
  const res = await fetch(new URL('precache.json', self.registration.scope), { cache: 'no-store' });
  if (!res.ok) throw new Error('precache.json ' + res.status);
  const { files } = await res.json();
  const scope = self.registration.scope;
  const urls = new Set([scope, ...files.map((f) => new URL(f, scope).href)]);
  const cache = await caches.open(APP);
  await Promise.all(
    [...urls].map(async (u) => {
      const r = await fetch(u, { cache: 'reload' });
      if (r.ok && r.status === 200) await cache.put(u, r);
    }),
  );
  // 清掉上一版留下、這一版已不存在的檔案
  for (const req of await cache.keys()) {
    if (!urls.has(req.url)) await cache.delete(req);
  }
  return urls.size;
}

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'PRECACHE') return;
  const reply = (msg) => event.source && event.source.postMessage(msg);
  event.waitUntil(
    precache().then(
      (count) => reply({ type: 'PRECACHED', count }),
      (err) => reply({ type: 'PRECACHE_FAILED', message: String(err && err.message ? err.message : err) }),
    ),
  );
});
