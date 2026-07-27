# 交接紀錄 — 2026-07-26（下午更新）

> 給下一個 session。讀完這份 + `CLAUDE.md` 就能接手。
> ⚠️ 這份檔案上午的版本已被下面的「下午這一輪」整段補寫。
> 底下「本輪（2026-07-26）做完的事」以下講的是**上午那一輪**，仍然有效，但不是最新狀態。

## 一句話現況

**Phase 3 完成（2026-07-27）。站已上線：<https://frontendmuseum.pages.dev>。**
六份病理報告、三篇文章、判準定案並首次全過、儀器修正、部署驗收全綠、OG image —— 全數收尾。
掛帳不擋事的只剩：人手複驗、自訂網域（可選）、chrony 治本（見部署一節）。

`npm run acceptance` **13 / 13**。外殼成本 4x median **0.00ms**（閘門是漲幅 > 2ms）。
**現行正典原始資料：`docs/measurements/2026-07-26-reproducibility-4x-6.json`**
（66 筆完整掃描，晚間，首份帶 `loadAvg1m` 負載問責欄；比值判準四條在它身上首次生效，
四條全過＋一條方向性判準落空照實記 —— 見 `phase2` 檔尾「儀器修正後的完整掃描」）。
前一份 `-4x-5.json` 仍有效但注意：**#5 的絕對值兩份不可互比**（scrollbar 凍結落在兩掃描之間），
六份病理報告引用的是 `-5.json` 並已各自標明 session。

## 下午這一輪做完的事（八個 commit）

| 工作 | 結果 |
|---|---|
| **B 類前導污染** | 根因：iframe 與外殼共用 renderer 主執行緒，前一份 document 的殘留落在新 document 的時鐘內。修法是外殼加 deep-link `?specimen=&mode=&cpu=`，每筆樣本全新導覽 + 一次丟棄的暖身。回歸測試 `tools/b-class-isolation.mjs` |
| **完整重量** | #2 三臂全部可重現（先前判 unstable）。虛擬滾動 **2.0× → 23.3×** |
| **判準** | `analyze-repro.mjs` 加「三輪一致的兇手 vs 登記值」，六種狀態分開 |
| **第二篇文章** | `docs/articles/02-eight-verdicts-six-overturned.md` |
| **面板視覺** | `Panel.tsx` 443 → 950 行 + `panel.css`。順帶修掉「B 類標本的載入期指標從來沒顯示過」 |
| **外殼視覺** | `App.tsx` 雙欄 + `shell.css` 555 行 |
| **未裁決清單** | `docs/open-questions.md` 29 條，逐條處置狀態 |
| **首頁** | 六列數字全換到 `-5.json`，來源宣告同步 |

## ⚠️ 接手前必須知道的（下午這一輪新增）

1. **量測工具的座標不准快取。** `ptShell()` 會 `scrollIntoView`，而 iframe 內元素的座標
   只在當下的捲動位置有效。外殼改雙欄後，按「重跑」會把 iframe 捲出視窗，
   之後的點擊全部打空 —— 該輪零互動、不進歷史，**畫面上完全看不出異常**。
   三處已修（`acceptance.mjs`、基線腳本 ×2），且 `ptIn()` 現在打不到東西時會擲錯。
   **加任何新的量測腳本時，座標一律現算。**
2. **驗收第 3b 條曾經會對壞掉的儀器打勾。** 它斷言「暖機期的點擊不入帳」，期望值是 0，
   而點擊完全落空也是 0。現在靠 `ptIn()` 擲錯擋住。
   **寫「期望值是零」的檢查時，先問「量不到也會是零嗎」。**
3. ~~**比值判準刻意沒有裁決**（#4 / #5 / #6 共四條）。~~
   **（2026-07-26 晚已定案）** 四條的數字與完整推導在 `phase2-expected-results.md`
   追記「比值判準四條定案」：#4 ≥2×、#6 廢除法改雙絕對錨 240/150、
   #5 受詞 fixed-banner、#6 renderRatio 改方向性。生效於**下一輪量測起**，
   對既有兩份 JSON 不回溯 —— 引用現行資料時仍只報方向與絕對值。
4. **標本 #2 的 LCP 標的是「請不要動」那段操作說明**，不是那 5000 列清單。
   那段文字是量測器材自己的文案，改一個字就改變主指標的標的 ——
   **它是一個從未登記的凍結變因。**
5. **跨 session 比較治療臂的比值是無效的**（比「絕對值不可比」更強一級）。
   病變臂飽和所以對機器速度不敏感、治療臂沒飽和所以敏感。
   同一天同一台機器相隔六小時，#6 細粒度臂的掉幀 85/59/84 → 14/18/18 而工作量一格沒動。
6. ~~**標本 #1 的兇手是機器速度的函數**…留待下一輪裁決。~~
   **（2026-07-26 晚已裁決）** #1 改判為**交界標本**：登記值不改，登記明文例外
   「三輪兇手一致判準對它結構性不適用」，兇手宣稱改用合成判準
   （`inputDelay + presentation` 合計壓倒 `processing`）。交界本身就是展品。
   全文在 `phase1` 修正紀錄「標本 #1 兇手改判為交界標本」。

## 下一步

- ~~**六份病理報告**~~ **（2026-07-26 晚完成）** —— `docs/reports/01~06`，六份全依模板
  八節、實測數字全部出自 `-5.json` 並逐筆附欄位路徑。撰寫時逐條對數又開出
  `open-questions.md` **第十一節**（30~39）：已修三條（#5 檔尾註解、phase2:1126 標錯、
  #6 欄位漂移補記）、五條儀器面待處置（A 類 CLS 殘留、#2 副標反向、LoAF 進臂殘留、
  `forcedPeak` 三態、JSON 缺 `protocolVersion`/viewport 欄）——**不擋發表**，報告已就地加警語。
  另有五條裁決在 `phase2` 檔尾「補充 · 報告撰寫輪帶出的五條裁決」
  （observer ≈1 錨作廢、方向性判準雜訊帶但書、#6 兩條舊絕對帶作廢等）
- **`docs/open-questions.md` 已全部結案**（2026-07-26 晚）。八.21~23：協定 `action` 加
  `'idle'`、#5 改登記 idle（程序本身沒變）、面板間隔欄與計數欄照 action 分開解釋。
  三.8~11：四條比值判準已定案（見上方「接手前必須知道的」第 3 條）——
  病理報告的兩個前置全部清掉
- ~~**部署**~~ **（2026-07-27 上線）** <https://frontendmuseum.pages.dev>，
  上線驗收全綠 —— 見文末「部署」一節（含三件接手必知與時鐘事件）
- ~~「為什麼做這個」總覽文章~~ **（已定稿）** `docs/articles/03-why-this-museum.md`，
  含對第一篇 checksum 54168 的規矩 5 更正
- ~~首頁六列數字還指著 `-5.json`~~ **（已換 `-6.json`）** 六列與來源宣告逐筆換畢
- ~~OG image~~ **（2026-07-27 完成，Phase 3 至此全部收尾）** `public/og.png`（1200×630，
  Almanac/Stat-Led，主數字 20.1× 出自正典 -6.json），母版 `docs/og-image-source.html`，
  og meta 已上線驗證。掛帳不急：人手複驗、自訂網域（可選）、chrony 治本（見部署一節）

---

（以下為上午那一輪的紀錄，仍然有效）

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

1. ~~**`02-long-list` 本輪判 unstable，不要拿本輪的 #2 數字發表。**~~
   **（2026-07-26 稍晚解除）** 查出來不是標本不穩，是 **B 類前導污染** ——
   iframe 與外殼共用同一條 renderer 主執行緒，前一份 document 的殘留工作落在
   新 document 的時鐘之內，而 LCP 以新 document 的 timeOrigin 起算。
   已修（deep-link `?specimen=&mode=&cpu=`，每筆樣本全新導覽 + 丟棄式暖身），
   回歸測試是 `tools/b-class-isolation.mjs`。修完 **#2 / #5 七臂全部可重現**，
   數字可發表，取 `docs/measurements/2026-07-26-reproducibility-4x-5.json`。
   完整診斷與作廢清單在 `docs/phase2-expected-results.md` 的
   「修正紀錄 · B 類前導污染」。
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

## 路由（2026-07-26 對調）

| URL | 內容 |
|---|---|
| `/` | **首頁／標本索引**（推廣入口，Hallmark 產的 Stat-Led + Almanac） |
| `/measure.html` | **量測台**（外殼 + iframe，仍是零 CSS 的 `<pre>` 面板） |
| `/specimens/*.html` | 標本頁，不受影響 |

⚠️ 三處必須同步，不同步的話量測會開到首頁去：
`vite.config.ts` 的 `input.measure`、`tools/acceptance.mjs` 與 `tools/reproducibility.mjs` 的 `URL_SHELL`。
對調後實跑驗證：`npm run acceptance` **13 / 13**，驅動器煙霧測（校準標本三輪）錨點 A 對得上
（`busy-300` → processing 300.8~303.1ms，登記 300）。

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

## 提交狀態

本輪全部**已 commit 並 push** 到 `phase1-2/specimens-and-measure`（追蹤 `origin`）。
按工作線拆成十一個 commit：

```
b0441f8  docs(CLAUDE.md)    首頁的視覺設計系統定案
cc94a68  docs               HANDOFF 的提交狀態校正
2c5212a  refactor(routing)  首頁移到 /，量測台移到 /measure.html
78f88e5  feat(home)         首頁與標本索引（Hallmark · Stat-Led + Almanac）
6f12263  docs(shell-visual) Task 1 基線 —— 另一條工作線，刻意單獨一個
2b14dd4  docs               CLAUDE.md
f3fdb77  docs               重新登記 + 實測結果 + 作廢清單
653b15d  fix(tools)         絕對排程、檔名不再覆蓋原始資料、補充指標
fe4f795  fix(specimens)     四個設計缺陷
1a613da  feat(protocol)     machinePaced 欄位
9ecbaf8  fix(tools)         （上一輪）量測工具自身的四個缺陷
```

~~尚未合併回 `main`~~ **已於 2026-07-26 併回 `main`**（PR #2，merge commit `3760907`，
含到 `cc72e39` 為止的全部工作：面板修正、判準定案、六份病理報告）。
**之後直接在 `main` 開發、直接推**，不再開分支；`phase1-2/specimens-and-measure` 保留作歷史。

## 部署（2026-07-27 上線）

**<https://frontendmuseum.pages.dev>** —— Cloudflare Pages，連 GitHub `main`，
**push 即自動部署**（build `npm run build`、輸出 `dist`、preset None、`NODE_VERSION=22`）。

### 上線驗收（全綠，當天實跑）

- 13 條驗收原封對生產站跑：**13/13**（校準錨點 busy-300 → 304ms ×3、離散 0.0%）。
  作法：複製 `tools/acceptance.mjs`、把 `URL_SHELL` 換成生產網址跑，不回寫 repo。
- 零外部請求實抓（CDP 收集全部網路請求）：`/`、`/measure.html`、標本頁、404 頁全綠。
  `<link rel="icon" href="data:,">` 是壓 favicon 自動請求的技巧，data URI 零流量，不是違規。
- 亂打路徑回 **404**（`/this-path-must-404`）。

### ⚠️ 三件接手必知

1. **`public/404.html` 不是裝飾，是開關。** CF Pages 在輸出目錄沒有 404.html 時
   **自動啟用 SPA fallback**（未命中一律回 index、HTTP 200）—— 上線當天實測抓到，
   加了 404.html 才關掉。刪掉它 = 重新打開 catch-all rewrite。
2. **CF 會把 `.html` 正規化成無副檔名網址**（`/measure.html` → 308 → `/measure`）。
   一次性重導、瀏覽器會跟，站內寫死的 `.html` 連結照常可用；此行為無開關，接受即可。
3. **Web Analytics 永不開、`_redirects` 永不加。** 前者注入 beacon script（違反零外部請求），
   後者是 rewrite 的入口。Speed 類優化只掛在自訂網域的 zone 上，`pages.dev` 碰不到。

### ⚠️ 量測機時鐘事件（2026-07-27）

這台 QEMU VM 的時鐘曾慢 **41,901 秒（11.6 小時）**：chrony 知道偏差但開機後只肯慢滑
（4.6ppm，要滑數年），是部署驗收的 TLS 檢查（憑證被判「尚未生效」）把它揪出來的。
已用 `sudo chronyc makestep` 跳正。**影響範圍**：既有 JSON 的 `measuredAt` 與文件日期
都蓋著慢約 12 小時的章（「2026-07-26 晚」實為 07-27 早），相對量測與檔案間先後順序不受影響，
文件不回改。**VM 暫停/恢復會再漂** —— 治本是 `/etc/chrony/chrony.conf` 加一行
`makestep 1 -1`（任何時候允許跳時），尚未做。
