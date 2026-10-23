# 指板靈感本

給「有指板直覺、不熟樂理」的創作者：輸入指法 → 辨識和弦與調性 → 看懂聲部動向 → 取得下一步建議。

**線上版：https://guitar.chordy.site/**（Cloudflare，HTTPS，手機可用麥克風；資料存在各自的瀏覽器裡，不會上傳）

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 單元測試
npm run build    # 型別檢查 + 打包到 dist/
npm run preview  # 預覽正式版（可測離線快取）
```

## 部署

### Cloudflare（目前使用，網域 `guitar.chordy.site`）

```bash
npx wrangler@4 login   # 第一次，或換主機時：在瀏覽器登入並授權
npm run deploy         # 建置（含型別檢查）→ 上傳 dist/ → 綁定 wrangler.toml 裡的自訂網域
```

- 設定在 `wrangler.toml`：把 `dist/` 當純靜態資源發佈，不需要後端；`custom_domain = true` 會自動建立 DNS 紀錄與 HTTPS 憑證，
  前提是網域在同一個 Cloudflare 帳號，且該名稱還沒有其他 DNS 紀錄。
- `public/_headers` 控制快取：`sw.js`、`precache.json` 與 HTML 入口每次都向伺服器確認，檔名帶雜湊的檔案與吉他取樣長期快取。
- 授權範圍很廣（wrangler 的預設）；不再使用的主機上可執行 `npx wrangler@4 logout`，
  或到 Cloudflare 後台 Profile → Access → Authorized Applications 撤銷。

網站目前放在網域根目錄，但程式裡的連結仍一律用 `import.meta.env.BASE_URL`，不要寫死 `/`，之後搬到子路徑也不會壞。
推到 GitHub 不會自動部署；要更新網站請執行 `npm run deploy`。

**提交信箱**：公開倉庫的提交紀錄會顯示作者信箱。請在每台開發主機上用 GitHub 提供的匿名信箱，
例如 `git config user.email "<id>+<帳號>@users.noreply.github.com"`（GitHub → Settings → Emails 可查到）。

## 結構

| 路徑 | 說明 |
|---|---|
| `src/core/` | 純 TypeScript 理論引擎（無 DOM，可在 Worker / Node 執行） |
| `src/core/song.ts` | 靈感 → 段落 → 和弦進行的資料結構與純函式（含載入驗證、v1 遷移） |
| `src/store/` | IndexedDB 儲存層（`db.ts`）、自動儲存 hook（`useIdeaStore.ts`） |
| `src/core/harmonize.ts` | 旋律配和弦：調性推論、速度估計、切窗、和弦候選與 Viterbi、指法串接 |
| `src/core/melody.ts` | 音高軌跡 → 音符：過濾、中值濾波、切音、吸附半音／調內音（純函式，可用合成資料測試） |
| `src/audio/` | 試聽（`sound.ts` 取樣吉他載入與音色、`pluck.ts` 和弦播放含合成備援、`offline.ts` 離線快取）、`pitch.worklet.ts`（AudioWorklet + pitchy）、`pitchTracker.ts`（麥克風／測試訊號 → 音高幀） |
| `src/lab/` + `pitch-lab.html` | 哼唱音高偵測實驗室：即時音高、軌跡圖、參數調整、切音結果與播放 |
| `src/app/` | React UI（靈感清單、段落分頁、直式指板、進行、分析、建議卡） |

## 資料結構

```
Idea { id, title, createdAt, updatedAt, sections[] }
  Section { id, label: intro|verse|prechorus|chorus|bridge|outro,
            progression: [{ id, frets[6] }], keyLock | null, melody: "A3 B3 …" }
```

只存原始輸入；和弦名稱、調性、級數、聲部動向都由引擎即時重算。
儲存：IndexedDB（`guitar-idea-pad` / `ideas`，一個靈感一筆），編輯後 400ms 自動寫入，離開頁面時立刻送出。
第一版存在 localStorage 的和弦串會在首次載入時自動轉成一個「匯入的靈感」，寫入成功後才清除舊資料。

`src/core` 模組：`chord`（指法解析、和弦辨識、斜線和弦）、`key`（調性推論、級數、借用／副屬／三全音替代）、
`voiceLeading`（逐弦位移、平行移動、內聲部半音線）、`voicing`（指法生成）、`suggest`（三種情緒的銜接）、`structure`（副歌→主歌）。

## 已完成（Phase 0 + Phase 1 大部分）

- 文字輸入與虛擬指板雙向同步，和弦辨識含多候選
- 3～4 和弦調性推論（可手動鎖定）、級數、功能標記
- 逐弦聲部動向與半音線條偵測
- 三種情緒的銜接建議（附 Tab 與試聽），可輸入旋律落音避免半音摩擦
- 副歌音域 → 主歌設計原則，並檢查主歌旋律是否真的留出對比空間
- JSON 備份：匯出全部或單一靈感，匯入時不覆蓋既有資料（重複略過、內容不同另存為「（匯入）」複本）。
  格式 `{ format: "guitar-idea-pad-backup", version: 1, exportedAt, ideas[] }`，檔名如 `指板靈感本-備份-2026-10-19.json`；
  資料只存在瀏覽器裡，清除網站資料會消失，請定期匯出
- 哼唱錄入旋律（Phase 2）：段落內按「哼唱錄入旋律」→ 即時顯示音名 → 停止後可刪音符、試聽、選擇吸附到調內音，再寫入或接在旋律後面；
  偵測用 AudioWorklet + pitchy（McLeod），關閉瀏覽器的回音消除／降噪／自動增益
- 旋律配和弦：哼唱時一併記下每個音的時間（`Section.melodyTimed`），依速度與拍號切成小節，
  從旋律推論調性（Krumhansl-Kessler 輪廓），每小節以「旋律音契合度 + 和聲走向」做動態規劃挑和弦，並附替代候選、吉他指法與「旋律＋和弦」同步試聽；
  手動改過旋律文字後節奏資料會失效（只比音高），此時需重新哼唱
- 取樣吉他音色與離線：和弦試聽用 smplr 播放 FluidR3_GM 的鋼弦／尼龍弦吉他取樣（檔案放在 `public/samples`，與網站同源，
  授權見 `public/samples/ATTRIBUTION.md`，CC BY 3.0，介面已附標示）；取樣尚未載入或載入失敗時自動退回合成音色。
  正式版（`npm run build` + `npm run preview`）會註冊 service worker（`public/sw.js`）：建置時產生 `precache.json`，
  網頁本體與取樣都存進 Cache API，沒有網路也能開啟與播放；有網路時永遠先取最新版。
  「音色與離線」面板可切換音色、下載另一種音色、清除快取。開發模式不啟用 service worker。
- 多個靈感（新增／重新命名／複製／刪除）與段落（新增／改類型／排序／刪除），皆存在 IndexedDB

## 尚未做

- 哼唱採譜在真人聲＋真麥克風上的準確度（目前只用合成訊號與假麥克風串流驗證過整條處理鏈，
  請到 `/pitch-lab.html` 用自己的聲音實測，必要時調整 `DEFAULT_SEGMENT_OPTIONS`）
- 節奏／拍點量化（目前只記錄音高與秒數，旋律欄位只存音名）
- 匯出 MIDI / PDF
- 旋律試聽目前仍是簡單合成音（刻意與吉他和弦區隔）；手機上的取樣解碼時間與記憶體用量尚未實測
- 變調夾、非標準調弦的 UI（資料結構已支援 `capo` 與 `tuning`）
