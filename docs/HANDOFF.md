# 交接紀錄 — 2026-07-25

> 給下一個 session。讀完這份就能接手，不需要重跑前面的稽核。

## 一句話現況（2026-07-25 第二輪更新）

**Phase 2 的量測層與四個標本全部做完了。** 六個核心標本 #1~#6 齊備，
量測層補上 LCP / CLS / droppedFrames、校準 C / D、B 類 reload 切換、web-vitals 對帳開關。
`npm run acceptance` **13 / 13**。四個新標本都煙霧測過，數字記在
`docs/phase2-expected-results.md` 的修正紀錄。

**下一步仍然是 Phase 1 的尾巴**：照 protocol 手動跑三輪可重現 → 病理報告文字模板 → 第一篇文章。

### 這一輪新增的檔案

```
src/measure/frames.ts          droppedFrames（rAF 幀計數，門檻依實測 refreshHz）
src/measure/vitals.ts          LcpCollector + ClsCollector（session window 照抄 web-vitals）
specimens/02-long-list.*       標本 #2（B 類）
specimens/04-unthrottled-events.*  標本 #4
specimens/05-layout-shift.*    標本 #5（B 類）
specimens/06-rerender-storm.*  標本 #6
public/specimen-05-figure.svg  標本 #5 的自架圖片（不能用 CDN，會被快取）
docs/phase2-expected-results.md  四個標本的動工前登記 + 修正紀錄
```

### 三件會咬人的事，接手前先知道

1. **校準件的 `position: fixed` 會毀掉錨點 B。** 第一版把 C／D 做成 fixed 覆蓋層，
   按鈕 B 的 200 次強制版面從 64.8ms 變成 1967ms（30 倍）。已改成 in-flow。
   **以後在校準頁上加任何 out-of-flow 元素之前，先重量一次按鈕 B。**
2. **spec 的兩個負載規模都撐不起病變**：標本 #6 的「200 台」實測每次重建只要 0.7ms（1x），
   已校準到 1000 台；標本 #4 登記的 N=2000 每次事件只要 1.8ms，已校準到 8000。
   兩者都記在修正紀錄。
3. **標本 #4／#6 沒有 INP 樣本**（捲動與 wheel 不產生 `interactionId`），
   跨輪比較改看 `RunResult.customFinal` 裡的 `droppedFramesPeak`。
   `finalizeRun()` 的入帳條件因此改成「依主指標分派」，不再是「有沒有互動樣本」。

## 一句話現況（第一輪）

Phase 0 已完整交付並實跑驗證（13/13）。已裁決**回 Phase 1 做標本 #3**，
Phase 1 前兩項（動工前登記預期 + 標本 #3 實作）**都已完成**，
**下一步是跑三輪可重現量測**（`spec:1246`）。

## 已完成：標本 #3（2026-07-25）

檔案：`specimens/03-layout-thrashing.ts` + `.html`，`src/specimens.ts` 的 `LAYOUT_THRASHING_META`。
`vite.config.ts` **不用改** —— 它掃 `specimens/*.html` 自動產生 entry。

`npm run build` ✅、`npm run acceptance` 仍 **13/13**（加標本不影響 Phase 0 驗收）。

校準探針（1x、四次點擊、**不是三輪正式量測**）：

| | 量到 |
|---|---|
| `broken` forced layout | 159.5 / 170.4 / 187.4 / 187.4 ms（登記預期 200~500，低 6.5%，在 30% 帶內 → **不調 N**）|
| `broken` 兇手 | `processing` 193.6ms vs `inputDelay` 0.5ms ✅ 與標本 #1 的對照成立 |
| `fixed-batched` | **一幀 LoAF 都沒有**（登記的風險 #2 成真：不是數字小，是沒有數字）|
| `layoutChecksum` | 兩臂皆 54168 → 讀寫分離沒偷工，最終 DOM 相同 |
| `sourceFunctionName` | `interleavedReadWrite`（keepNames 生效，證據自己指出兇手）|

補登在 `docs/phase1-expected-results.md` 修正紀錄的三個新參數：
`intervalMs = 2500`（4x 上限 2000ms，不留餘裕兇手會翻成 inputDelay）、
`repetitions = 10`（避開下面那個 App.tsx 門檻 bug）、行高凍結 24px（寬度不重複的證明要用）。

**下一步就是照 protocol 跑三輪**：每個 mode 十次點擊、間隔 2500ms、宣告 4x，
看三輪 median 離散度 ≤ 30% 且兇手段三輪一致。

---

## ⚠️ 先處理：分支狀態異常

`git reflog` 顯示本次 session 中途發生過：

```
0014c92 HEAD@{2026-07-25 20:55:53}: Branch: renamed refs/heads/shell-visual to refs/heads/main
0014c92 HEAD@{2026-07-25 19:08:34}: checkout: moving from main to shell-visual
0014c92 HEAD@{2026-07-25 19:08:34}: Branch: renamed refs/heads/master to refs/heads/main
0014c92 HEAD@{2026-07-25 19:08:34}: commit (initial): chore: baseline — Phase 0 完成
```

**`shell-visual` 分支被改名成 `main`，原本的 `main` 因此被覆蓋。**
這不是使用者或主執行緒下的指令，最可能是 Phase 0 稽核那批 subagent 之一做的。

**沒有工作遺失** —— 兩個分支當時都指在同一個 commit `0014c92`，零分歧。
`git fsck` 另外找到 10 個 unreachable commit，全是被丟棄的 stash（只動 shell-visual 的 plan 檔）。

現在只剩一個本地分支 `main`（追蹤 `origin/main`）。
接手前先決定要不要把 shell-visual 的工作線重新開一個分支出來。

## 目前 git 狀態

```
HEAD: 0014c92 chore: baseline — Phase 0 完成（量測底座 + 校準標本 + 標本 #1）
分支: main（唯一本地分支，追蹤 origin/main）
remote: git@github.com:BardKidd/FrontendMuseum.git

 M docs/superpowers/plans/2026-07-25-shell-visual-design.md   ← shell-visual 工作線
 M tools/acceptance.mjs                                        ← Phase 0 修正
?? docs/phase1-expected-results.md                             ← Phase 1 工作線（本次產出）
?? docs/superpowers/plans/baseline-shell-cost.md               ← shell-visual 工作線
?? docs/HANDOFF.md                                             ← 本檔
```

**三份未提交的改動橫跨兩條不同的工作線，混在同一個分支上。**
使用者尚未裁決要怎麼拆。全程沒有下過任何 commit / push（使用者未要求）。

---

## 已完成：Phase 0 稽核（結論：零缺口）

用 13 個 subagent 逐條稽核 spec 的 Phase 0 要求（13 項必做 + §5.6 十六條驗收 + §5.3 延後表）。

**實跑驗證**（不是讀 README）：

- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run acceptance` **13 / 13 通過**，exit 0

README:66-83 的數字逐條對得上：#2 `300.6ms`、#3 `totalInteractions=10`、
#5 `specimenScript=300.5ms / shellScript=0.0ms`、#7 `sourceFunctionName=calibrationForcedLayout`
（`keepNames` 仍生效）、#9 5 秒約 7.3 次、#16 三輪 median 全 304 → 離散度 0.0%。

**七個被指認的缺口全部反向驗證後推翻。** 最值得記的三個誤判：

1. 「`specimen:error` 沒有紅字」→ 稽核者漏 grep `src/measure/`。
   `runtime.ts:109-127` 的 `fail()` 真的建 `<pre>` + `box.style.color='red'`
2. 「CLS session window 決議不存在」→ 決議就在 spec 裡（六處），稽核者把 spec 排除在搜尋外
   再宣告它不存在。且 `protocol.ts:25-26` 的 `1000`/`5000` 正是 web-vitals
   `LayoutShiftManager.ts:38-39` 的常數
3. 「iframe 載入失敗無偵測」→ 屬 §5.3 明文延後；且處方本身錯了 ——
   `<iframe onError>` 對 HTTP 404 不觸發，瀏覽器把錯誤頁當成功導航

### 稽核順帶修掉的真缺陷（已改）

`tools/acceptance.mjs:178` 引用從未宣告的變數 `beforeShell`（全檔僅此一處）。
**第 6 條一旦真的失敗，會丟 ReferenceError 讓整份驗收中止**，而不是印 FAIL 再跑完後面五條 ——
也就是說第 6 條先前只有「通過」路徑能用。已改成從作用域內的 `s6` 取診斷數字，
空陣列路徑會給 `0.0ms` 不是 `-Infinity`，改完重跑仍 13/13。

### 三個非阻斷發現（未處理，使用者已知）

1. **`src/types/perf.d.ts` 有真腐化**：`:3` 宣稱「lib.dom 沒有 `scheduler.yield()`」對
   TS 7.0.2 已過期，且簽名不相容（lib.dom 必填 / 這裡宣告成 optional）。
   加上 `web-vitals@6` 重複宣告 `PerformanceScriptTiming` 等四型別。
   目前靠 `skipLibCheck: true` 蓋住，**關掉會出 14 個錯**。
   真正需要補、也補對了的只有 LoAF 那組
2. **驗收腳本只涵蓋 13 條**：#8（web-vitals 對帳）沒進腳本 ——
   `?validate=1` 的機制在 `runtime.ts:374-403` 實作了，只是沒自動化。
   #13 由 typecheck 覆蓋、#14 是 dev banner、#11 明文延後
3. **`已記錄 n / 10` 的門檻來源是 `protocol.repetitions` 不是 `MEASURE_CONFIG.minInteractions`**
   （`App.tsx:437`）。今天兩者同為 10 但沒有程式強制耦合。
   ⚠️ **Phase 1 加標本 #3 時，若它的 `repetitions < 10`，這行會在有效樣本不足 10 時顯示「已達標」**
   —— 這是唯一一個會隨 Phase 1 進展變成真 bug 的東西

---

## 已完成：Phase 1 第一項 — 動工前登記預期

產出 `docs/phase1-expected-results.md`（依 `spec:1243` + 陷阱 #19 `spec:1351-1360`）。

**這份文件寫完之後不准回頭改去迎合實測。** 要改就在檔尾「修正紀錄」追加並寫明理由。

預期值釘在 Phase 0 留下的兩個實測錨點上，不是猜的：

- **錨點 A**：忙迴圈 300ms → `processing = 300.6ms`（誤差 0.2%）
- **錨點 B**：按鈕 B M=200、600 子元素、寫 `width`，三次獨立實測 66.9 / 76.4 / 62.2ms
  → **每次強制同步版面約 0.31~0.38ms**。標本 #3 的規模由此反推

⚠️ 錨點 B 機器相依性極高（`00-calibration.ts:31`：「同一份程式在不同 headless 設定下差了 30 倍」）。
**換機器要先重跑按鈕 B 重新校準單位成本**，再看標本 #3 的預期還成不成立。

### 標本 #3 的登記設計參數（動工時照這個做）

| 參數 | 值 |
|---|---|
| 列表元素數 N | **800** |
| 每個元素內容 | 一行文字 + 一個 badge |
| 讀取屬性 | `offsetHeight` |
| 寫入屬性 | **`width`** 而非 `height`（逼文字重新斷行） |
| 資料 | 固定種子 |

預期：病變 `forcedStyleAndLayout` **200~500ms**（1x），治療 **< 10ms**，比值 **> 20×**（照抄 `spec:1353`）。
兇手段預期 **`processing`** —— 與標本 #1 的 `inputDelay` 形成對照，這個對照就是文章骨架。

### 登記在案的方法論風險

**標本 #1 的 `intervalMs = null`（連打）不是真正凍結的變因。**
其他變因都凍住了，但「盡快連續點十次」取決於手速，而且畫面凍結時操作者會下意識放慢。
input delay 大小直接由「點擊間隔 vs `sortMs`」比例決定。

**預測標本 #1 三輪離散度會是全站最高，很可能卡在 30% 那條線上。**
處置順序（修變因不修結論）：① 查其他分頁/背景下載/throttle
② 改用 `tools/acceptance.mjs` 的 CDP 程式化點擊（時序機器控制，人手變異消失）
③ **最後**才動 `protocol`（那會讓已有數字作廢）

---

## 下一步

**動手寫標本 #3（強制同步版面重排 / Layout Thrashing）。**

`spec:1067` 給它最高權重：「**這是整套最值得寫的一個**」「**也是全站數字最可信的標本**，
因為 `forcedStyleAndLayoutDuration` 是逐 script 的，外殼貢獻可以乾淨濾掉」。

要建的檔案（比照標本 #1 的形狀）：

- `specimens/03-layout-thrashing.ts` + `.html`
- `src/specimens.ts` 註冊 metadata（`class: 'A'`、`switchKind: 'live'`、
  `primaryMetric: 'loaf.forcedStyleAndLayout'`、`culprit: 'processing'`）
- `vite.config.ts` 加 entry（MPA 每個標本一個 entry）

**動工前使用者還有機會改上面那組登記參數**（N=800 等）；動工後要改就得寫進「修正紀錄」。

之後依 `spec:1246-1248` 依序：三輪可重現 → 病理報告文字模板定案 → **第一篇文章發出去**。
`spec:1250`：「做到這裡就有可傳播的內容了。」

## 被擱置的另一條工作線

`shell-visual`（外殼視覺設計，提前執行的 Phase 3 工作）：
12 個 task **只做完 Task 1**（基線量測，`docs/superpowers/plans/baseline-shell-cost.md`，
手動 4x median = 0.00ms）。Task 2–12 全未開始 —— `src/shell/` 仍只有
`App.tsx / Panel.tsx / loaf.ts / main.tsx`，無 `shell.css`、無 `panel/`、`package.json` 無 vitest。

若日後回來接 Task 2，前提已驗過可照抄：`computeRunStats([412,398,431]).median` 確實是 `412`
（`metrics.ts:296-299`），`spread` 是 `(max-min)/median` 無單位（`metrics.ts:310`），
`MEASURE_CONFIG.runsForReproducibility = 3`。**零 blocker**，但有兩個警告：

1. `Panel.tsx:243` 在丟進 `computeRunStats` 前先 `Math.round`，計畫的 `modeMedian` 沒有。
   `acceptance.mjs:210-214` 也沒 round —— **計畫才跟驗收對齊，`Panel.tsx` 是離群的那一個**。
   在 0.15 邊界附近會翻轉可重現徽章
2. 計畫的 `assessReproducibility` 在 reason 字串裡把 `15%` 又硬編一次（plan:496），
   等於把它宣稱要消滅的雙份定義搬進新檔案

⚠️ 該計畫的 Global Constraints 已失真：它寫「這個目錄不是 git repo」「這輪不提交」「所有 task
沒有 commit 步驟」。實際上是 repo、有 remote、已 push。

## 尚未有裁決的問題

1. 分支要怎麼整理（`shell-visual` 已被改名掉，兩條工作線的改動混在 `main` 上）
2. 三份未提交的改動要不要 commit、怎麼拆
3. 標本 #3 的登記設計參數要不要調整
