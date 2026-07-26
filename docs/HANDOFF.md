# 交接紀錄 — 2026-07-26

> 給下一個 session。讀完這份 + `CLAUDE.md` 就能接手。
> **舊版本（2026-07-25）已整份取代** —— 它停在「下一步是 Phase 1 的尾巴」，那些早就做完了。

## 一句話現況

**Phase 0 / 1 / 2 全部完成。** 六個標本齊備、三輪可重現量測跑過兩輪、
第一篇文章已發出、四個「留待裁決」的設計缺陷本輪全部修掉並重新量過。
**下一步是 Phase 3（內容化與上線）。**

`npm run acceptance` **13 / 13**。`npm run build` 綠。

## 本輪（2026-07-26）做完的事

四個標本的設計缺陷修復 + 重新登記 + 重跑三輪。原始資料
`docs/measurements/2026-07-26-reproducibility-4x.json`（66 筆，`problems` 空陣列）。

| 標本 | 缺陷 | 處置 | 實測結果 |
|---|---|---|---|
| **#1** | 登記的兇手 `inputDelay` **結構上不可能量到** | 改判 `presentation`；`intervalMs` null → 17ms 絕對排程 | broken 三輪一致 presentation ✅；`fixed-worker` 兇手不一致 ⚠ |
| **#4** | 治療一同時翻兩個變因；治療二的 rAF 閘門從未觸發 | 兩臂共用同一個 handler 識別字；一拍三格 | 方向性判準成立 ✅；登記的絕對值差 2.65~10 倍 ❌ |
| **#5** | 位移源二**在結構上不產生 entry** | 讓它真的推動下方內容；單一 fixed 臂拆成梯度三段 | **本輪最乾淨的一支**，三臂離散度 0.0% ✅ |
| **#6** | 背壓算式建立在低估 7.5 倍的自報值上 | 改用真實幀成本；推送 50 → 25ms；梯度改樹狀 | 補充指標讓兩個舊結論翻案 ✅ |

### 三件值得單獨記的發現

1. **標本 #1 登記的兇手從第一輪量測起就是錯的，而「三輪兇手一致」這條判準通過了** ——
   一致地是 `presentation`，不是登記的 `inputDelay`。判準只檢查三輪彼此一致，
   沒有檢查是否等於登記值。**這個漏洞還在，沒有補。**
2. **INP 看不看得見排隊，不取決於有沒有排隊，取決於排隊期間瀏覽器有沒有機會畫。**
   同一支標本內部的對照：`broken`（135ms 同步 handler，中間無 paint）兇手 presentation；
   `fixed-worker`（57ms 序列化，中間有 paint）兇手 inputDelay 427~549ms。
3. **跨 session 的絕對值不可比。** 標本 #3 本輪一個字都沒改，forced median 卻從
   745/716/678 變成 1158/1274/1376（約兩倍），而它自己三輪離散度只有 17.1%。
   同一台機器、同一天、相隔數小時。**可比較單位是同一份 JSON 內部的臂間比值。**

### 順手修掉的工具缺陷

- `tools/reproducibility.mjs` 的輸出檔名**寫死**，每跑一次就把上一輪原始資料靜默覆蓋掉；
  只跑部分標本時會把 60 筆換成 9 筆。**本輪真的發生過一次，已從 git 還原。**
  改成依日期產生 + 拒絕覆蓋 + 把 `specimensCovered` / `isFullSweep` 寫進檔案。
- 節拍改成**絕對排程**（#1 的點擊與所有間隔迴圈）。修之前 #4 的病變臂整輪 5.3~5.6 秒、
  治療臂 5.0 秒（ack 時間是被翻旗標的下游），而掉幀是 5 秒滾動窗。
- `tools/analyze-repro.mjs` 加補充指標機制（主指標飽和時用）。

## ⚠️ 接手前必須知道的四件事

1. **`02-long-list` 本輪判 unstable，而它一個字都沒改。**
   `broken` 離散度 34.0%（1872/2620/2200）、`fixed-virtual` 110.7%（932/1236/**204**）。
   204ms 那一輪疑似 B 類輪替下的 LCP 取樣問題。**不要拿本輪的 #2 數字發表。**
2. **`01` 的 `fixed-worker` 沒通過「三輪兇手一致」**（inputDelay/presentation/inputDelay）。
   那一臂本輪不得單獨發表。處置順序寫在 `docs/phase1-expected-results.md`。
3. **4x CPU 節流套不到 worker 執行緒。** `Emulation.setCPUThrottlingRate` 掛在 renderer
   主執行緒上，dedicated worker 是獨立 target。證據：同一份工作 broken 116~122ms、
   worker 28.4~29.0ms，比值 4.2 ≈ 節流率。這是**對治療臂有利**的混淆變因，
   已登記成明文例外。同口徑可相除的只有 `sortMs(broken)` 與 `workerSerializeMs`。
4. **`04` / `06` 各有一臂擦線判 unstable**（observer 60%、granular 31.0%）。
   granular 的補充指標三輪完全穩定（16.7 ×3）—— 不穩定的是主指標，不是那一臂。

## 已發出文章的狀態

`docs/articles/01-twelve-treatments-four-survive.md` **不改**。
它是有日期、附原始資料連結的第一輪快照，而且它講的正是本輪修掉的這四個缺陷。
本輪讓它的多處數字失效，逐項列在兩份 `phase*-expected-results.md` 的作廢清單裡。

**但它的標題與骨架受影響**：《十二段治療處方，站得住的有四段》與
「這篇文章講的是下面那八格」—— #5 那一格已翻案、#6 的兩個結論也翻案。
**第二篇文章的骨架就是這件事**：修完再量一次，八格裡有幾格翻案。

## 下一步：Phase 3

`spec:1258-1262`：

- [ ] 每個標本的完整病理報告（模板已定案，`docs/pathology-report-template.md`）
- [ ] 面板視覺設計（Phase 0~2 一直是 `<pre>`，這裡才動 CSS）
- [ ] 首頁：標本索引 + 專案說明 + CPU throttling 教學
- [ ] 部署（確認沒有 SPA catch-all rewrite）、OG image
- [ ] 「為什麼做這個」總覽文章當入口

**建議先寫第二篇文章**（修完再量一次），趁本輪的資料還熱。

### 被擱置的工作線

`shell-visual`（外殼視覺設計，提前執行的 Phase 3 工作）：
計畫在 `docs/superpowers/plans/2026-07-25-shell-visual-design.md`，12 個 task **只做完 Task 1**。
Phase 3 要動面板 CSS 時就是回去接它的時候。
⚠️ 該計畫的 Global Constraints 已失真（它寫「這個目錄不是 git repo」「這輪不提交」，
實際上是 repo、有 remote、已 push）。

## 未提交的改動

本輪全部**尚未 commit**（使用者未要求）。橫跨：
`specimens/01,04,05,06`、`src/{protocol,specimens}.ts`、`src/shell/App.tsx`、
`src/measure/vitals.ts`、`tools/{reproducibility,analyze-repro}.mjs`、
`docs/phase{1,2}-expected-results.md`、`docs/measurements/2026-07-26-*.json`、
新增的 `CLAUDE.md` 與本檔。

另有兩份 session 開始前就在的 `shell-visual` 工作線改動
（`docs/superpowers/plans/` 底下兩個檔），**與本輪無關，拆 commit 時要分開。**
