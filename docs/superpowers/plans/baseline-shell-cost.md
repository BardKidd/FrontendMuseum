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
