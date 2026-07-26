# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 這是什麼

一座「前端效能病理標本館」。每個標本頁展示一個效能反模式，可即時切換病變版 / 治療版，
旁邊面板顯示實測指標。**它是一份實驗，不是一個應用程式** —— 產出物是「其他變因全部凍結時，
翻動這一個變因，產生這個差距」這種可重現的量測結論。

完整設計在 `perf-pathology-museum-spec.md`（86K，含 Phase 規劃、量測方法論、陷阱清單）。
動手前先看 `docs/HANDOFF.md` 的現況（可能落後於 git log，以 commit message 為準）。

## 指令

```bash
npm run measure     # build + preview。量測一律走這個
npm run dev         # 開發用。面板會有紅色 banner，此時的數字不算數
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + vite build
```

**量測前必須 `npm run measure`，不要在 dev server 上量。** dev server 不 minify、不打包、
帶 HMR 開銷，數字跟產物完全兩回事。需要 Chromium 系瀏覽器（`interactionId` 與 LoAF 都是 Chromium-only）。

### 驗收與量測（先讓 preview 在另一個終端機跑起來）

```bash
node tools/acceptance.mjs                    # spec §5.6 的 13 條驗收，全綠才算過
node tools/reproducibility.mjs               # 全部標本，每個 mode 三輪
node tools/reproducibility.mjs 03 05         # 只跑 id 含 03 / 05 的標本（等同「跑單一測試」）
node tools/analyze-repro.mjs docs/measurements/*.json   # 判定離散度與比值
```

沒有 vitest / jest。**`tools/acceptance.mjs` 就是這個 repo 的測試套件**，
而且它是實跑瀏覽器跑出來的，不是讀程式碼讀出來的。

⚠️ 兩個工具各自寫死了不同的瀏覽器路徑（`acceptance.mjs` 是 `/usr/bin/brave-browser`，
`reproducibility.mjs` 是 `/opt/brave.com/brave/brave`），換機器兩處都要改。

⚠️ 驗收**必須派送真實輸入**：`element.click()` 的合成事件沒有 `interactionId`，
Event Timing 一筆都不回報。所以走 CDP 的 `Input.dispatchMouseEvent`。

⚠️ 機器負載會讓驗收掉分。load < 2 時 13/13；load 3.7~5.8 下會掉到 8~11，
失敗項在 #2 / #5 / #10 之間游移 —— 那是負載，不是回歸。判斷前先看 `uptime`。

## 架構

**MPA，不是 SPA。** 外殼（`src/shell/`）用 iframe 載入標本頁（`specimens/*.html`），
每個標本是獨立的 entry。`vite.config.ts` 掃 `specimens/*.html` 自動產生 entry ——
**新增標本不必動 config**。

三層職責，界線是刻意畫的（spec §3.3）：

| 層 | 位置 | 職責 |
|---|---|---|
| 凍結契約 | `src/protocol.ts` | 外殼與標本共用的型別與常數。**只准加欄位，不准改語意** |
| 量測 | `src/measure/` | Event Timing 分組、LCP / CLS、droppedFrames、`RunStats`、標本端 runtime |
| 外殼 | `src/shell/` | UI、LoAF 觀測與歸因、面板 |
| 標本 | `specimens/` | 病變與治療的實作，自報 custom 欄位 |

`src/specimens.ts` 是**所有標本的 metadata 註冊表**（`class`、`switchKind`、`primaryMetric`、
`culprit`、`modes`、`protocol`）。它被四個以上的標本共用 —— 平行改動時這是最容易撞車的檔案。

`specimens/00-calibration` **不是六個標本之一**，是驗收工具。它的每個負載都有解析解可以反推
（忙迴圈 300ms → `processing` 應為 300.x），所以它能證明量測層本身沒說謊。

### A 類 / B 類的差別會影響整條路徑

- **A 類**（`switchKind: 'live'`）：互動期指標（INP、forced layout、droppedFrames），原地切 mode
- **B 類**（`switchKind: 'reload'`）：載入期指標（LCP、CLS）。**LCP 在第一次互動後定案且是 per-document 的**，
  所以切 mode 必須重載整份 document，不能原地切

## 這個 repo 的規矩（違反就是錯的，不是風格問題）

1. **修變因，不修結論。** 量到不符預期，改的是實驗設計，不是把結論改成符合實測。
2. **動工前先登記預期**（`docs/phase*-expected-results.md`），**登記完不准回頭改去迎合實測**。
   要改就在檔尾「修正紀錄」追加，寫明改了什麼、為什麼、作廢哪些數字。
3. **一段治療只准翻一個變因。** 順手多改一件事，殘差就歸因不到那個變因，那段治療的數字作廢。
   這是本專案反覆踩到的頭號病根（標本 #4 的 `fixed-passive` 就是這樣壞掉的）。
4. **註解與程式碼必須一致。** 「註解說 A、程式做 B」在這裡是缺陷等級，不是整潔度問題 ——
   讀者是靠註解判斷數字可不可信的。
5. **已發出的文章不回頭改數字。** `docs/articles/` 是有日期、附原始資料連結的快照。
   後續發現問題就寫下一篇，不是改上一篇。
6. **誠實原則**：限制寫在 UI 上，不寫在心裡。解析度下限、未觀測到的指標、宣告而非偵測的
   CPU throttle，全部印在面板上。

## 一改就得全部重跑的設定

1. **viewport 凍結在 800×600**（`src/specimens.ts`）。CLS 與 LCP 都是 viewport 相對量。
2. **build 保留函式名**（`vite.config.ts`）。少了它 LoAF 的 `sourceFunctionName` 變成 `n`，
   標本 #3 的核心證據直接報廢。Vite 8 換 rolldown/oxc 後開關是 `output.keepNames` +
   `output.minify.mangle.keepNames`，**worker 是獨立的 config 介面，要另外設一份**。
3. **CPU throttle 無法從 JS 偵測，必須在下拉選單裡宣告。** 沒宣告的截圖等同作廢。

## 已知的坑

- **`position: fixed` 會毀掉校準錨點 B。** 曾把校準件做成 fixed 覆蓋層，按鈕 B 的 200 次強制版面
  從 64.8ms 變成 1967ms（30 倍）。在校準頁加任何 out-of-flow 元素前，先重量一次按鈕 B。
- **錨點 B 機器相依性極高** —— 同一份程式在不同 headless 設定下差過 30 倍。
  **換機器要先重跑按鈕 B 重新校準單位成本**，再看既有預期還成不成立。
- **spec 登記的負載規模普遍撐不起病變**，多個標本實測後都往上校準過（#4 的 N 從 2000 到 8000、
  #6 從 200 台到 1000 台）。照 spec 的數字寫完，第一件事是量它有沒有進作用區間。
- **`src/types/perf.d.ts` 已部分腐化**，靠 `tsconfig` 的 `skipLibCheck: true` 蓋住，
  關掉會出 14 個錯（`web-vitals@6` 重複宣告四個型別）。真正需要補的只有 LoAF 那組。
- **`已記錄 n / 10` 的門檻來源是 `protocol.repetitions`，不是 `MEASURE_CONFIG.minInteractions`**
  （`src/shell/App.tsx`）。兩者目前同為 10 但沒有程式強制耦合 ——
  新標本的 `repetitions < 10` 時，這行會在有效樣本不足時顯示「已達標」。

## 平行工作時的檔案所有權

派多個 agent 同時改標本時，先講清楚誰擁有哪些檔案。共用而容易撞車的是：
`src/specimens.ts`、`src/protocol.ts`、`src/measure/*`、`tools/reproducibility.mjs`、
`docs/phase*-expected-results.md`。這些應該由主執行緒統一改，agent 只回報需要的改動。
