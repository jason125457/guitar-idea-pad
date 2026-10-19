import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // 兩個頁面：主程式與哼唱音高偵測實驗室（路徑相對於專案根目錄）
    rollupOptions: { input: { main: 'index.html', pitchLab: 'pitch-lab.html' } },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
