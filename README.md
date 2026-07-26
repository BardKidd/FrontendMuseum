# 前端效能病理標本館

> **量測前一定要 `npm run measure`。不要在 dev server 上量。**
> Vite dev server 不 minify、不打包、帶 HMR 開銷，量到的數字跟產物完全是兩回事。
> 開著 `npm run dev` 時面板頂端會有紅色 banner 提醒你這件事。

一頁一個效能反模式，每頁都能切換「病變版本 / 治療後」，旁邊即時顯示實測指標。
完整設計見 [`perf-pathology-museum-spec.md`](./perf-pathology-museum-spec.md)。

## 跑起來

```bash
npm install
npm run measure     # build + preview，量測一律走這個
```

開 http://localhost:4173 是**首頁／標本索引**；量測台在 http://localhost:4173/measure.html 。
**需要 Chromium 系瀏覽器**（Event Timing 的 `interactionId` 與
Long Animation Frames 都是 Chromium-only），這是明文宣告的限制，不做跨瀏覽器降級。

其他指令：

```bash
npm run dev         # 開發用。面板會顯示紅色 banner，此時的數字不算數
npm run typecheck   # tsc --noEmit
npm run build
```

## 這個專案在主張什麼

> 其他條件全部凍結時，翻動這一個變因，產生這個差距。

追求的是**可重現**，不是絕對精確。判準只有一條：**這個誤差會不會翻轉結論？**
會就修，不會就標註然後繼續。三個已知的解析度下限直接寫在面板上，不藏在心裡。

環境變因（網路、CPU、螢幕更新率）不是要「解決」的問題，是要**凍結並宣告**的問題。
面板上的 `viewport 800×600 · 60Hz · CPU throttle` 就是那份宣告 ——
**CPU throttling 無法從 JS 偵測，必須自己在下拉選單裡宣告**，沒宣告的截圖等同作廢。

## 目前進度：Phase 0 完成

量測底座 + 校準標本 + 標本 #1。

| | |
|---|---|
| `src/protocol.ts` | 凍結契約。外殼與標本共用同一份型別，**只准加欄位，不准改語意** |
| `src/measure/` | Event Timing 收集（`interactionId` 分組）、`RunStats`、`refreshHz` |
| `src/shell/` | 外殼 UI、LoAF 觀測與歸因、面板（Phase 0 零 CSS，全部是 `<pre>`） |
| `specimens/00-calibration` | 驗收工具，不是六個標本之一。每個負載都有解析解可以反推 |
| `specimens/01-main-thread-block` | 標本 #1：同步排序五萬筆訂單 vs `scheduler.yield` vs Web Worker |

LCP / CLS **在 Phase 0 完全不實作**，欄位先存在、一律回 `null`。
之後補 observer 只動 `metrics.ts`，不動協定、不動任何標本，先前數字不作廢。

## 驗收（spec §5.6）

```bash
npm run measure       # 先讓 preview 跑起來（另一個終端機）
npm run acceptance    # 跑 tools/acceptance.mjs
```

驗收是實跑出來的，不是讀程式碼讀出來的 —— 而且**必須派送真實輸入**：
`element.click()` 產生的合成事件沒有 `interactionId`，Event Timing 一筆都不會回報。
所以 `tools/acceptance.mjs` 走 CDP 的 `Input.dispatchMouseEvent`，不用 `el.click()`。
腳本裡的瀏覽器路徑（`CHROME`）依你的環境調整。

最近一次全綠的結果（Brave 150 headless、未開 throttling、60Hz）：

| # | 條件 | 實測 |
|---|---|---|
| 2 | 忙迴圈設 300ms，點 10 次 → `processing` 落在 270~330 | **300.8ms** |
| 3 | 分組正確 → `totalInteractions === 10`（不分組會是 20~30） | **10** |
| 3b | 切 mode 後立刻點一下，那筆不得入帳 | **0** |
| 4 | 面板標「max（樣本不足 50，非 p98）」 | ✅ |
| 5 | LoAF 歸因 specimen，`specimenScriptDuration ≈ 300` | **300.7ms**，外殼 0.0ms |
| 6 | 反向歸因：外殼自己跑 200ms，不得算在標本頭上 | **shell 200.2 / specimen 0.0** |
| 7 | forced layout > 50ms 且 `sourceFunctionName` 可讀 | **66.9ms · `calibrationForcedLayout`** |
| 9 | flush 節流，5 秒內 `seq` 遞增 ≤ 25 | **約 7.3 次** |
| 10 | live 切換，舊 mode 樣本不混入 | 新 mode INP **40ms**（混入會是 300 級） |
| 12 | 換標本靜置 5 秒，無新的 specimen LoAF | **0 幀** |
| 15 | CPU throttle 宣告寫進 snapshot | ✅ |
| 16 | 連跑三輪，median 相對離散度 ≤ 15% | **304/304/304 → 0.0%** |

第 16 條那三個 `304` 剛好就是 8ms 量化的現形：`304 = 38 × 8`。

## 兩個一改就得全部重跑的設定

1. **`viewport` 凍結在 800×600**（`src/specimens.ts`）。CLS 與 LCP 都是 viewport 相對量。
2. **build 保留函式名**（`vite.config.ts`）。少了它，LoAF 的 `sourceFunctionName` 會變成 `n`，
   標本 #3 的核心證據直接報廢。Vite 8 換成 rolldown/oxc 之後開關是
   `output.keepNames` + `output.minify.mangle.keepNames`，**worker 是獨立的 config 介面，
   要另外設一份**。
