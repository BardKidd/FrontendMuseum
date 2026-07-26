# 外殼成本基線（改動前）

量測日期：2026-07-25
條件：CPU throttle 4x · 60Hz · viewport 800×600 · 標本 00-calibration · mode busy-300
buildId：0.1.0-ms09spxa

## 手動 4x（判準用這個）

| 輪 | 外殼 script |
|---|---|
| 1 | 0.00ms |
| 2 | 0.00ms |
| 3 | 0.00ms |

**median：0.00ms**

## 自動化 1x（旁證，不是判準）

`npm run acceptance` 第 5 條的 `shellScript=`：

| 次 | shellScript |
|---|---|
| 1 | 0.0ms |
| 2 | 0.0ms |
| 3 | 0.0ms |

**median：0.0ms**

閘門（spec §11.2）：改動後同樣程序三輪，**手動 4x 的 median** 上升 > 2ms 就不算過，退回 spec §11.3 的 C 案。

---

## 備註（六個讀數皆為 0.00ms，非缺漏）

外殼目前零 CSS、面板是純文字 `<pre>`，狀態提交走 250ms 節流閘門（App.tsx）——
`00-calibration busy-300` 那一輪最嚴重的 LoAF 幀幾乎整段時間都是標本自己的忙迴圈
（specimenScriptDuration ≈ 300ms），外殼那一幀裡確實沒有可歸類的 script 執行，
六次量測（4x 三輪 + 1x 三輪）在同一份 build 上一致回報 0.00ms/0.0ms，不是量測失敗。
這正是後面 11 個任務要動的東西：一旦外殼有了真的 CSS 與版面，這個數字預期會從 0 開始上升，
2ms 的閘門就是套在「從這個 0 起跳」的漲幅上。

節流生效的獨立驗證（不依賴 00-calibration 的忙迴圈，那個迴圈用 wall-clock 自我校準，
對 CPU throttle 不敏感——見 `specimens/00-calibration.ts` 的 `calibrationBusyLoop` 註解）：
同一個 headless session 內，跑一個固定迭代次數（6×10⁷ 次 `Math.sqrt`）的純運算迴圈，
1x 量得 63.9ms，套用 `Emulation.setCPUThrottlingRate({ rate: 4 })` 後量得 269.3ms，
放大比 4.21x——確認本次量測環境的 CPU 節流真的生效，不是宣告值沒接上。

量測腳本：`.superpowers/sdd/2026-07-25-shell-visual-design/measure-shell-cost.mjs`
（git-ignored scratch，Task 12 原樣重跑取得「之後」的數字）。

---

# 改動後（2026-07-26）

面板從零樣式的 `<pre>` 純文字改成 DOM + `src/shell/panel.css`
（`Panel.tsx` 443 → 950 行、`panel.css` 526 行、樣式全部掛在 `.rep` 底下，零全域選擇器）。

量測程序與上面完全相同（手動 4x · 60Hz · 800×600 · `00-calibration` / `busy-300` · 十拍不連打 · 三輪取 median）。

| 輪 | 外殼 script |
|---|---|
| 1 | 0.00ms |
| 2 | 0.00ms |
| 3 | 0.00ms |

**median：0.00ms。漲幅 0.00ms，閘門是 > 2ms —— 通過。**

`refreshHz` 三輪皆 60（與基線相同）、buildId 一致（`0.1.0-ms1f2yjq`）。
節流獨立診斷：純運算迴圈 1x = 66.8ms、4x = 271.7ms，比 4.07x。

`npm run acceptance` **13 / 13**。

## 為什麼加了 CSS 之後成本沒有上升

不是「幅度小到量不出來」，是**兩邊互相抵銷、而且往下的那一邊可能更大**：

- 往上：面板從 2 個文字節點變成約 200 個 DOM 元素；多一份樣式表
  （`measure-*.css` 建置產物 9.0K）。每個報告區塊有 `contain: content`，
  style recalc / layout 的失效範圍被框住。
- **往下**：原始檢體那個兩千行 JSON 的 `<pre>` 以前是**永遠攤開、每次 commit 都完整排版**，
  現在收在 `<details>` 裡（收合時瀏覽器不排版內容）。那幾乎確定是舊外殼最大的單一版面成本。
  另外舊的 `buildText()` / `cols()` 那套逐字元掃全形字寬做對齊的迴圈整個沒了，
  它以前每 250ms 跑一次。

沒變的：`JSON.stringify(snapshot, null, 2)` 仍然每次 commit 執行（收合不影響字串建構），
那是面板剩下最大的 JS 成本。

⚠️ 這三個 0.00ms 與基線的三個 0.00ms 一樣，**是「這一幀裡沒有可歸類的外殼 script 執行」**，
不是「量測失敗」。`00-calibration busy-300` 那一輪最嚴重的 LoAF 幀幾乎整段都是標本自己的忙迴圈
（`specimenScriptDuration` ≈ 301~303ms），驗收第 6 條（反向歸因）另外證明了
「外殼真的忙起來時抓得到」—— 本輪它仍然通過。

## 順帶修掉的兩個既有缺陷（不是視覺工作，是誠實原則）

1. **B 類標本的載入期指標從來沒有在面板上顯示過。**
   舊 `Panel.tsx` 的 `loadMetricLines()` 在 `:191` 被呼叫，而那一行位在 `inpLines()` 內部，
   該函式在 `:151`「沒有 INP representative」時就提前 return。
   捲動（#2 #4）與靜置（#5 #6）依規格不產生 `interactionId` ⇒
   **標本 #2 是 LCP 標本，它的面板一次都沒印出過 LCP**，只印「尚無有效互動樣本」；
   #5 的 CLS、四支標本的 custom 護欄計數器與交叉驗證同樣從未顯示。
   現在載入期指標是獨立區塊，不掛在 INP 的分支底下。
2. **「← 主打指標」永遠指著 INP**，不管該標本的 `primaryMetric` 是什麼。現依 `primaryMetric` 標在對的區塊。

## 驗收第 4 條跟著改了選擇器（不是改判定）

面板拆成 DOM 之後，整份 document 只剩最後那個原始檢體 JSON 的 `<pre>`，
`tools/acceptance.mjs` 舊的 `panelText()` 讀 `pre[0]` 會抓到 JSON。改成讀 `.rep` 的 `innerText`。

**刻意不改成讀 snapshot 的 `inp.isMaxNotP98` 欄位** —— 那會過，但那是把
「UI 有沒有告訴讀者」偷換成「資料裡有沒有這個欄位」，而這條驗收存在的理由正是
誠實原則：限制寫在 UI 上，不寫在心裡。

---

# 改動後之二：外殼雙欄 + shell.css（2026-07-26）

`src/shell/App.tsx` 的 JSX 重構 + 新增 `src/shell/shell.css`（555 行）。
雙欄 `grid-template-columns: 800px minmax(0, 1fr)` —— **左欄硬值 800px，無 % / vw / scale**，
因為 viewport 凍結在 800×600 是已登記的量測條件，用相對單位等於偷偷改掉一個凍結變因。

| 輪 | 外殼 script |
|---|---|
| 1 | 0.00ms |
| 2 | 0.00ms |
| 3 | 0.00ms |

**median：0.00ms。漲幅 0.00ms —— 通過。** refreshHz 三輪皆 60、buildId 一致。
節流獨立診斷：純運算迴圈 1x = 66.9ms、4x = 264.8ms，比 3.96x。
`npm run acceptance` **13 / 13**。

## ⚠️ 這一輪先量出兩個假數字，兩個都是同一個缺陷

第一次跑驗收是 **12 / 13**（#16 失敗），第一次跑這支基線腳本則在第 2 輪擲錯
「snapshot.loafWorst 是空的」。兩者都不是量測層壞掉 —— **是點擊沒有發生**。

`ptShell()` 找外殼按鈕時會 `scrollIntoView({ block: 'center' })`。
而 iframe 內元素的座標是用 `getBoundingClientRect()` 算的，**只在當下的捲動位置有效**。
`tools/acceptance.mjs` 與這支腳本都把 `busyBtn` 在開場算好一次然後重用：

```
起始            scrollY=0    iframeTop=724   目標點 y=746   在視窗內
按「重跑」之後  scrollY=840  iframeTop=-116  目標點 y=-94   在視窗外
                                                           elementFromPoint = null
```

於是第 2、3 輪的十次點擊全部打在空白處，那兩輪零互動、不進歷史。

**舊版面之所以沒事，是因為捲動幅度小到打歪了還在按鈕上 —— 巧合，不是契約。**

三處都修了：座標每次現算；`ptIn()` 先把 iframe 捲進視窗；
且 `ptIn()` 現在會在 `elementFromPoint` 落空時**擲錯**而不是回傳一個打不到東西的座標。

最後一項是重點。驗收第 3b 條斷言「暖機期的點擊不入帳」，期望值是 **0** ——
**而點擊完全落空也會得到 0**。在加上擲錯之前，那條檢查分不出
「暖機正確排除了它」與「那一下根本沒點到」，**它會對一個壞掉的儀器打勾**。

⚠️ 這支腳本是 git-ignored 的 scratch，而它是這道閘門唯一的儀器。
閘門的儀器不進版本控制，本身就是個問題。
