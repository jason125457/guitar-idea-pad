# 指板靈感本：Claude Code 工作規則

給不熟樂理的吉他創作者用的和弦與旋律工具。React ＋ TypeScript ＋ Vite，純靜態，部署在 Cloudflare。結構與資料格式見 `README.md`。

## 改完要跑

```bash
npm test          # Vitest：理論引擎、service worker、畫面（jsdom）
npm run build     # 含型別檢查；CI 跑的就是這兩個
```

畫面或聲音的改動，另外用 `npm run dev`（5173）實際操作一次；麥克風與音訊在測試裡只有合成訊號。

## 不能違反

- `src/core/` 是純 TypeScript 理論引擎：不碰 DOM、不依賴 React，新邏輯都要能用合成資料測試。
- 只存原始輸入（指法、旋律、速度）；和弦名稱、調性、級數一律即時重算，不寫進儲存。
- 改儲存格式要保留舊資料與舊備份可讀（選填欄位加預設值，必要時寫遷移）。
- 網站不載入任何第三方資源（字型自架）；要新增外部來源必須同步改 `public/_headers` 的 CSP，並先問使用者。
- 連結一律用 `import.meta.env.BASE_URL`，不寫死 `/`。
- 靈感內容只留在瀏覽器，不加任何上傳或遙測。

## 流程

- 推到 GitHub 只跑 CI，不會部署。上線是 `npm run deploy`，由使用者執行或先取得同意。
- 這個 repo 是公開的：提交用 GitHub noreply 信箱，不放個人資訊。
- commit：英文一句話、祈使句、不加前綴，寫使用者看得到的變化，例如 `Add starter progressions and plain-word chord roles`。
- 介面文字用白話，不用樂理術語當主要說法（目標使用者不熟樂理）。
