import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 建置時產生 precache.json：列出這次輸出的所有檔案（HTML、JS、CSS、worklet…）。
 * service worker 靠它知道要快取哪些檔案，檔名含雜湊，所以改版後清單自然跟著變。
 */
function precacheManifest(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
        this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ files }) });
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
  build: {
    // 兩個頁面：主程式與哼唱音高偵測實驗室（路徑相對於專案根目錄）
    rollupOptions: { input: { main: 'index.html', pitchLab: 'pitch-lab.html' } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
