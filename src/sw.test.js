// public/sw.js 的行為測試：在 Node 的 vm 沙箱裡載入 service worker，換掉 fetch 與 Cache API。
// （用 .js 寫，避免為了 node:vm 把 Node 型別引入整個前端專案）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SRC = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://app.test/';

function makeCaches() {
  const stores = new Map();
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const key = (r) => (typeof r === 'string' ? r : r.url);
    return {
      match: async (r, opts) => {
        let hit = m.get(key(r));
        if (!hit && opts && opts.ignoreSearch) {
          const base = key(r).split('?')[0];
          for (const [k, v] of m) if (k.split('?')[0] === base) hit = v;
        }
        return hit ? hit.clone() : undefined;
      },
      put: async (r, res) => void m.set(key(r), res),
      keys: async () => [...m.keys()].map((u) => ({ url: u })),
      delete: async (r) => m.delete(key(r)),
    };
  };
  return { stores, api: { open, keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) } };
}

function loadSw(fetchImpl) {
  const listeners = {};
  const { stores, api } = makeCaches();
  const self = {
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting() {},
    clients: { claim: async () => {} },
    registration: { scope: SCOPE },
    location: new URL(SCOPE + 'sw.js'),
  };
  const context = vm.createContext({ self, caches: api, fetch: fetchImpl, URL, Response, Promise, setTimeout, String });
  vm.runInContext(SRC, context);
  return { listeners, stores, cacheApi: api };
}

async function dispatchFetch(listeners, request) {
  const waits = [];
  let responded;
  listeners.fetch({ request, respondWith: (p) => (responded = p), waitUntil: (p) => waits.push(p) });
  return { response: responded ? await responded : undefined, waits };
}

const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
const nav = (url) => ({ url, method: 'GET', mode: 'navigate' });

afterEach(() => vi.useRealTimers());

describe('service worker precache', () => {
  it('downloads immutable assets only once; HTML is refreshed every time', async () => {
    const calls = [];
    const fetchImpl = async (u) => {
      const url = typeof u === 'string' ? u : u.href ?? u.url;
      calls.push(String(url));
      if (String(url).endsWith('precache.json')) return new Response(JSON.stringify({ files: ['index.html', 'assets/app-abc.js', 'assets/style-def.css'] }));
      return new Response('x', { status: 200 });
    };
    const sw = loadSw(fetchImpl);
    const precache = async () => {
      const replies = [];
      const waits = [];
      sw.listeners.message({ data: { type: 'PRECACHE' }, source: { postMessage: (m) => replies.push(m) }, waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      return replies[0];
    };

    const first = await precache();
    expect(first).toMatchObject({ type: 'PRECACHED', count: 4, fetched: 4 });
    calls.length = 0;
    const second = await precache();
    expect(second).toMatchObject({ type: 'PRECACHED', count: 4, fetched: 2 });
    expect(calls.some((u) => u.includes('/assets/'))).toBe(false);
    expect(calls.filter((u) => u.endsWith('index.html') || u === SCOPE)).toHaveLength(2);
  });

  it('drops files from an old build', async () => {
    let files = ['index.html', 'assets/old-1.js'];
    const fetchImpl = async (u) =>
      String(u.href ?? u).endsWith('precache.json') ? new Response(JSON.stringify({ files })) : new Response('x');
    const sw = loadSw(fetchImpl);
    const run = async () => {
      const waits = [];
      sw.listeners.message({ data: { type: 'PRECACHE' }, source: { postMessage() {} }, waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    };
    await run();
    files = ['index.html', 'assets/new-2.js'];
    await run();
    const keys = [...sw.stores.get('gip-app').keys()];
    expect(keys).toContain(SCOPE + 'assets/new-2.js');
    expect(keys).not.toContain(SCOPE + 'assets/old-1.js');
  });
});

describe('service worker navigation', () => {
  it('serves the cached page after 3 s when the network hangs, and saves the late network reply', async () => {
    vi.useFakeTimers();
    let resolveNetwork;
    const sw = loadSw(() => new Promise((r) => (resolveNetwork = r)));
    const appCache = await sw.cacheApi.open('gip-app');
    await appCache.put(SCOPE, html('cached'));

    const pending = dispatchFetch(sw.listeners, nav(SCOPE));
    await vi.advanceTimersByTimeAsync(3000);
    const { response, waits } = await pending;
    expect(await response.text()).toBe('cached');

    resolveNetwork(html('fresh'));
    await Promise.all(waits);
    expect(await (await appCache.match(SCOPE)).text()).toBe('fresh');
  });

  it('uses the network when it answers in time', async () => {
    const sw = loadSw(async () => html('fresh'));
    await (await sw.cacheApi.open('gip-app')).put(SCOPE, html('cached'));
    const { response } = await dispatchFetch(sw.listeners, nav(SCOPE));
    expect(await response.text()).toBe('fresh');
  });

  it('falls back to the cached home page when offline', async () => {
    const sw = loadSw(async () => {
      throw new TypeError('Failed to fetch');
    });
    await (await sw.cacheApi.open('gip-app')).put(SCOPE, html('home'));
    const { response } = await dispatchFetch(sw.listeners, nav(SCOPE + 'pitch-lab.html'));
    expect(await response.text()).toBe('home');
  });

  it('serves hashed assets and samples from cache without touching the network', async () => {
    const fetchImpl = vi.fn(async () => new Response('net'));
    const sw = loadSw(fetchImpl);
    await (await sw.cacheApi.open('gip-app')).put(SCOPE + 'assets/a.js', new Response('cached-js'));
    await (await sw.cacheApi.open('gip-samples-v1')).put(SCOPE + 'samples/s.js', new Response('cached-sample'));
    const a = await dispatchFetch(sw.listeners, { url: SCOPE + 'assets/a.js', method: 'GET', mode: 'cors' });
    const s = await dispatchFetch(sw.listeners, { url: SCOPE + 'samples/s.js', method: 'GET', mode: 'cors' });
    expect(await a.response.text()).toBe('cached-js');
    expect(await s.response.text()).toBe('cached-sample');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ignores other origins, non-GET requests and the worker script itself', async () => {
    const sw = loadSw(async () => new Response('net'));
    for (const req of [
      { url: 'https://fonts.example/x.css', method: 'GET', mode: 'cors' },
      { url: SCOPE + 'api', method: 'POST', mode: 'cors' },
      { url: SCOPE + 'sw.js', method: 'GET', mode: 'same-origin' },
    ]) {
      expect((await dispatchFetch(sw.listeners, req)).response).toBeUndefined();
    }
  });
});
