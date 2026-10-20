/** 離線快取：註冊 service worker、查詢快取狀態、下載／清除取樣。 */
import { SAMPLE_TIMBRES, sampleUrl, type SampleTimbre } from './sound';

/** 必須與 public/sw.js 裡的名稱一致 */
export const APP_CACHE = 'gip-app';
export const SAMPLE_CACHE = 'gip-samples-v1';

const BASE = import.meta.env.BASE_URL;

export const swSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined' && window.isSecureContext;

export type RegisterResult = 'registered' | 'dev' | 'unsupported' | 'failed';

/** 只在正式版註冊（開發模式的未打包模組被快取會讓改檔看不到變化）。 */
export async function registerServiceWorker(): Promise<RegisterResult> {
  if (!import.meta.env.PROD) return 'dev';
  if (!swSupported()) return 'unsupported';
  try {
    await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
    const reg = await navigator.serviceWorker.ready;
    // 離線時不用更新快取（也避免 console 出現無謂的連線錯誤）
    if (navigator.onLine) reg.active?.postMessage({ type: 'PRECACHE' });
    return 'registered';
  } catch {
    return 'failed';
  }
}

export interface OfflineStatus {
  /** dev：開發模式不啟用；unsupported：瀏覽器或網址不支援（需要 HTTPS 或 localhost） */
  mode: 'ready' | 'dev' | 'unsupported';
  /** 網頁本體是否已完整快取 */
  app: boolean;
  samples: Record<SampleTimbre, boolean>;
}

export async function getOfflineStatus(): Promise<OfflineStatus> {
  const none = { steel: false, nylon: false };
  if (!import.meta.env.PROD) return { mode: 'dev', app: false, samples: none };
  if (!swSupported()) return { mode: 'unsupported', app: false, samples: none };
  const samples = { ...none };
  // caches.match 只查詢不會建立空的快取（caches.open 會）
  const q = (cacheName: string) => ({ cacheName, ignoreVary: true });
  for (const t of SAMPLE_TIMBRES) samples[t] = !!(await caches.match(sampleUrl(t), q(SAMPLE_CACHE)));
  const app = !!(await caches.match(new URL(BASE, location.href).href, q(APP_CACHE)));
  return { mode: 'ready', app, samples };
}

/**
 * 把一種取樣下載進快取（service worker 會在回應經過時存下來），回傳是否確實存進去。
 * 沒有 service worker 時仍會下載，但不會被保存。
 */
export async function downloadSample(t: SampleTimbre, onProgress?: (loaded: number, total: number) => void): Promise<boolean> {
  const res = await fetch(sampleUrl(t));
  if (!res.ok) throw new Error(`下載失敗（${res.status}）`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body?.getReader();
  if (reader) {
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
  } else {
    await res.arrayBuffer();
  }
  if (!swSupported() || !import.meta.env.PROD) return false;
  // service worker 的 cache.put 是非同步的，稍等一下再確認
  for (let i = 0; i < 10; i++) {
    if (await caches.match(sampleUrl(t), { cacheName: SAMPLE_CACHE, ignoreVary: true })) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

export async function clearOfflineCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await Promise.all([caches.delete(APP_CACHE), caches.delete(SAMPLE_CACHE)]);
}

/** 監聽 service worker 的預快取結果（成功回傳 true）。回傳取消函式。 */
export function onPrecached(cb: (ok: boolean) => void): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const handler = (e: MessageEvent) => {
    if (e.data?.type === 'PRECACHED') cb(true);
    else if (e.data?.type === 'PRECACHE_FAILED') cb(false);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
