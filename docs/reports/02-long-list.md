# 病理報告 · 02 長列表未虛擬化

> 依 `docs/pathology-report-template.md`（版型八節，一節不刪）。
> 實測數字**只**取自現行正典檔 `docs/measurements/2026-07-26-reproducibility-4x-5.json`
> （2026-07-26T05:52:29.671Z、CDP 機器驅動、66 筆完整掃描、`problems: []` 無異常輪、
> `isFullSweep: true`；正典地位的裁定在 `phase2:1057-1062`「才是現行的正典檔」）。
> 歷史數字一律以「已作廢」或「另一 session」身分出現並標明來源 ——
> 跨 session 絕對值不可比（`phase2:944-945`），臂間比值只在同一份 JSON 內部成立。
> 行號會漂（`phase2:1195-1199`），本報告引用行號時儘量連同內容一起引。

### 02 長列表未虛擬化

**病症一句話**：4x CPU 節流下首載，一次把 5000 列渲染成 40,021 個 DOM 節點，
把整份 document 首屏最大那塊文字的繪製（LCP）拖到 **1864ms**（三輪 median）；
`content-visibility` 一行 CSS 降到 520ms（3.6×），虛擬滾動降到 80ms（23.3×）——
而兩段治療真正的差別在節點數：**40,021 個節點還在 vs 只建 141 個**。

> ⚠️ 這句話的 LCP 標的**不是那 5000 列清單**，是頁面上「請不要動」那段操作說明
> （裸 `p`，`#specimen-root` 第 4 個子元素，769 × 48 @ (8, 129)，size 36672 ——
> `phase2:1201-1213` 追記）。本標本量的是「說明文字多久畫得出來，而清單把它擋住了」，
> 不是「清單自己成為 LCP」。這個差別寫在兇手歸因一節，讀者靠它判斷能不能複製這個實驗。

#### 凍結條件

同一組條件之間才能比較。任何一項改動，先前所有數字作廢。

| | |
|---|---|
| CPU throttle | **4x（宣告值）**，JS 偵測不到（sweep.`cpuThrottle: "4x"`、`cpuThrottlingRate: 4`；九筆 records 的 `cpuThrottle` 皆 `"4x"`）。⚠️ B 類的宣告方式與 A 類不同：節流在**導覽之前**打開，並用 deep-link 的 `cpu=4x` 參數宣告，不按外殼下拉選單（`tools/reproducibility.mjs:699-702, 714, 728-731`——「載入後補按一次選單」的 `evaluate()` 會插進正在量的載入期）。代價：外殼 React bundle 也在 4x 底下解析，那是每筆樣本相同的常數 |
| 驅動方式 | **CDP 機器驅動**（sweep.`driver`）。**每一筆樣本都從一次全新的 `measure.html` 導覽開始**（`?specimen=&mode=&cpu=`），目標 mode 就是首載的那一份 document（`tools/reproducibility.mjs:672-731`）。捲動用 `Input.dispatchMouseEvent` 的 mouseWheel 一拍一格（`realWheel`，`:166`；#2 **沒有 `wheelTicks` 欄位**，走逐格路徑，位元與舊版相同，`:520-525`） |
| viewport | **800 × 600**（`FROZEN_VIEWPORT`，`src/specimens.ts:10`；`LONG_LIST_META.viewport`，`:235`）。⚠️ 實際內部寬度是 **785**——垂直捲軸吃掉 15px（`phase2:41-42`「這批標本一律不准寫死 800」），列的行數是寬度敏感的 |
| refreshHz | **60**（九筆 records 的 `refreshHz` 皆 60；欄位定義 `src/protocol.ts:68`） |
| 操作程序 | 動作 **scroll** · 次數 **10** · 間隔 **500ms**（`src/specimens.ts:227-233`）。外加兩段靜置：`navQuietMs = 20000`（從導覽起算，蓋住外殼在 4x 底下的開機）與 `quietMs = 12000`（`tools/reproducibility.mjs:296-299`）。**整段靜置一次 CDP 呼叫都不准發**（`:733-735`——輪詢等於把觀測動作放進被觀測的視窗） |
| buildId | **0.1.0-ms191c71**（九筆 records 的 `buildId`） |
| protocolVersion | 凍結契約常數 **1**（`src/protocol.ts:8`）。⚠️ **正典 JSON 沒有記錄這個欄位**（頂層無 `conditions`，驅動器也不寫入）—— 這一格是宣告值，不是記錄值。見「與登記的差異」末尾 |

這一份標本額外的凍結條件：

- **B 類：`switchKind: 'reload'`**（`src/specimens.ts:208`）。不是實作偏好 —— LCP 在第一次互動後定案且是 per-document 的，不重載的話第二個 mode 永遠拿不到自己的 LCP。模組因此**不實作 `setMode()`**（`specimens/02-long-list.ts:293-306, 322-328`）。
- **一次丟棄的暖身導覽**（跑 `modes[0]`，依協定必為病變版，量完不入帳；`tools/reproducibility.mjs:704-718`）。理由：deep-link 隔離修好之後剩下的位置效應是每支標本第一筆偏高，偏高的是冷啟動不是那個 mode（隔離後實測 `#2 broken` 第一筆 2824ms、之後 2016 / 1948 —— `phase2:999-1001`，**另一 session 的診斷數字，僅證機制**）。
- **輪轉順序**（第 r 輪從 `modes[(i + r − 1) % n]` 起）留著擋單調漂移；舊「輪轉守衛」已整個移除（`tools/reproducibility.mjs:720-726`；守衛缺陷的紀錄在 `phase2:976-987`）。
- **`inpBased: false`、`midGapSnapshot: false`**（`tools/reproducibility.mjs:296`）：不等 INP 收斂、不中途取樣。
- 負載參數：`ITEM_COUNT = 5000`、`ROW_HEIGHT = 120`、`VIRTUAL_BUFFER = 5`、`DATASET_SEED = 20240202`（`specimens/02-long-list.ts:24-32`）。**`ROW_HEIGHT = 120` 同時是三件事**：列高、`contain-intrinsic-size` 初值、虛擬滾動算式基礎，三處必須同一個數字，否則捲軸長度抽動 = 自己製造 CLS（`specimens/02-long-list.ts:25-29, 222-257`）。
- ⚠️ **「請不要動」那段操作說明文字是一個從未登記的凍結變因**（`phase2:1219-1223`；`docs/HANDOFF.md:43-45`）。它就是 LCP 標的，改一個字就改變標的尺寸、甚至換掉標的本身 —— 本標本所有 LCP 數字都綁在這段文字的現行長度上。
- `dispatchSpanMs` / `dispatchSpanNominalMs`：#2 的 records **沒有這兩個欄位**（實查正典 JSON）—— 本標本不走絕對排程，走間隔迴圈；無欄位，不是 0。

#### 動工前登記的預期

> 登記出處：`docs/phase2-expected-results.md:179-231`（標本 #2 段）。
> 修正出處：`phase2:326-340`（煙霧測試）、`:539-545`（節點數計數 bug）、`:936-940`（判 unstable）、
> `:951-1044`（**B 類前導污染，本標本最重要的一節**）、`:1119-1129`（裁決紀錄 §二，兩條明文作廢）、
> `:1201-1232`（LCP 標的追記）。
> **這一節不准回頭改去迎合實測。** 要修正就在該檔「修正紀錄」追加。
> #2 不在「比值判準四條定案」（`phase2:1259-1338`）的凍結範圍內（那是 #4 / #5 / #6），
> 以下登記區間仍可據以判定，但逐條先過修正紀錄確認現行狀態。

- 主指標：**`lcp`**（`phase2:216`；`src/specimens.ts:221`）。
  `broken` 4x 預期 **1200~4000ms**（`phase2:208`；1x 的 400~1200ms 本輪未量，見誠實揭露）。
- 兇手段：**`lcp`**（`phase2:216`；`src/specimens.ts:225`）—— 未被任何修正取代，仍現行有效。
- 病變 vs 治療比值：**本標本沒有登記「≥ N×」硬比值**。登記的是
  `fixed-content-visibility` LCP **降 30~70%**（`phase2:211`，等價 1.4×~3.3×）、
  `fixed-virtual` LCP **絕對上限 4x < 800ms**（`:213`）、
  `fixed-virtual` `domNodeCount` **< 400**（`:214`）、
  `fixed-content-visibility` `domNodeCount` **不變**（`:212`；括號值 ~35,000 已作廢，見下）。
  登記明文寫「**這個標本最重要的一件事是『兩個治療的節點數不同』**」（`:218-221`）——
  治療梯度的骨架是節點數，不是毫秒數。
- 已作廢的登記值（引用時必須帶作廢身分）：
  - `domNodeCount` **~35,000**（5000 列 × 約 7 節點，`:209, 212`）——
    實為**每列 8 節點、基底 21 ⇒ 40,021**（`:539-545`；`specimens/02-long-list.ts:94-103` 反解兩式
    `21 + 5000×8 = 40021` 與 `21 + 15×8 = 141` 獨立同解）。先前「40,021 符合 ~35,000」的判定
    （`:326-336`）是把計數 bug 當量測容差放過（`:545`）。
  - `broken` INP presentation 段 1x 30~120 / 4x 100~400ms（「捲動後點擊」，`:210`）——
    **明文作廢**（`:1121-1124`）：現行 protocol 是 scroll × 10、零點擊，而登記檔 `:49-51`
    自己寫著捲動不產生 `interactionId`。**從登記那天起就不可能有數字。**
  - 風險 R2 的 CLS 示範（`:228-230`）—— **明文作廢**（`:1126-1129`）：
    `:188` 已把 `contain-intrinsic-size: auto 120px` 登記成必備、程式照做
    （`specimens/02-long-list.ts:254-257`），沒有可執行的對照臂。
    ⚠️ 該作廢條目在裁決紀錄裡被誤標成「**#5** 的風險 R2」，內容（`:188`、`:228-230`、
    contain-intrinsic-size）全部屬於 #2 —— 誤標本身兩份 phase 檔都沒記。
- 登記在案、仍有效的風險：
  - **R1**（`:225-227`）：`content-visibility` 的收益在初次渲染上可能比預期小，它真正省的是
    捲動時的樣式與版面；「若 LCP 幾乎沒降，不是治療失效，是指標選錯了 —— 要補捲動期的數字」。
  - **R3**（`:231`）：presentation 落在 8ms 網格上，兩段治療之間**不排名**。標本檔另給了第二個理由：
    虛擬滾動換來 Ctrl+F 失效、無障礙樹不完整、錨點失效（`specimens/02-long-list.ts:155-162`）。
- 登記的設計參數五項（5000 列 / 每列一方塊三行字兩 badge / **頭像不用圖片** / `auto 120px` /
  buffer ±5，`phase2:185-189`）與程式逐項一致（`specimens/02-long-list.ts:24-32, 104-137, 254-257`）。
  頭像不用圖片的理由是校準 D 挖出的規則（`phase2:30-35, 191-194`）：**Chrome 把 < 0.05 bpp 的
  低熵圖片排除在 LCP candidate 之外**，5000 個純色佔位圖既拖慢載入又永遠不會成為 LCP。
- 登記時引用的 `spec:1060` 舉例「5,000 節點 → 60 節點」（`phase2:221`）與本站設計不同源：
  buffer ±5 在 800×600 下實際渲染 **15 列**（records `renderedItems`），引用時要註明。

#### 實測

三輪，同一組凍結條件。**離散度算在每輪的 median 上，不是 max**（`src/protocol.ts:309`
「抗離群。可重現性判定用這個，不用 max」）。LCP 是 per-document 單值，每輪一筆、
該筆即該輪 median。相對離散度 = (max − min) / median-of-three。

| mode | 三輪 LCP（ms） | 相對離散度 | 絕對全距 | 判定 |
|---|---|---|---|---|
| broken 全部渲染 | 1864 / 1788 / 1896 | 5.8%（108 ÷ 1864） | 108ms | ✅ 可重現 |
| fixed-content-visibility | 472 / 548 / 520 | 14.6%（76 ÷ 520） | 76ms | ✅ 可重現 |
| fixed-virtual 虛擬滾動 | 84 / 76 / 80 | 10.0%（8 ÷ 80） | **8ms（< 底線 50ms）** | ✅ 可重現（全距在雜訊底線內） |

出處：`records[mode=broken,run=1..3].lcp.value`、`records[mode=fixed-content-visibility,run=1..3].lcp.value`、
`records[mode=fixed-virtual,run=1..3].lcp.value`。三臂數字與 `phase2:1065` 補記的
「02 broken 1864/1788/1896 (5.8%) cv 472/548/520 (14.6%) virtual 84/76/80 (10.0%▽)」逐位元一致。

判準：相對離散度 ≤ 30%，或絕對全距在該指標雜訊底線內（LCP 50ms）。三臂皆過。
⚠️ 只看相對離散度會把方向搞反：治療有效正是讓分母趨零 —— `fixed-virtual` 的 10.0% 全靠
分母只有 80ms，它的絕對全距 8ms 才是「穩」的證據。

次要指標（終值快照；`M1` 缺口的補法就是為了讓零互動的 B 類標本也能入帳，`phase2:48-55`）：

| mode | `domNodeCount` | `renderedItems` | `droppedFramesPeak` | `cls` |
|---|---|---|---|---|
| broken | 40,021 / 40,021 / 40,021 | 5000 ×3 | 0 / 0 / 0 | **無 entry**（`null` ×3） |
| fixed-content-visibility | 40,021 / 40,021 / 40,021 | 5000 ×3 | 0 / 0 / 0 | **無 entry**（`null` ×3） |
| fixed-virtual | 141 / 141 / 141 | 15 ×3 | **9 / 9 / 10** | **無 entry**（`null` ×3） |

出處：`records[*].custom.domNodeCount / .renderedItems / .droppedFramesPeak`、`records[*].cls`。

- `cls: null` 是**無 entry，不是量到 0**。本標本三臂設計上都不產生位移
  （`contain-intrinsic-size` 必備 + spacer 恆定高度），collector 一筆 entry 都沒收到。
  `clsIgnoredByInput` 九筆皆 0（`records[*].custom.clsIgnoredByInput`）—— 沒有位移被輸入豁免掉。
- INP 整組（`inp` / `inputDelay` / `processing` / `presentation`）九筆皆 `null`、
  `totalInteractions` 皆 0 —— **結構性無樣本**：捲動不產生 `interactionId`（規格如此，
  `phase2:49-51`），不是缺陷。
- ⚠️ `fixed-virtual` 的 `droppedFramesPeak` 9 / 9 / 10 是**全表唯一超過掉幀底線（5 幀）的臂**，
  而且出現在**治療臂**。broken 反而三輪皆 0。這件事兩份 phase 檔都沒記，見「與登記的差異」。

#### 兇手歸因

登記兇手 `lcp`（`phase2:216`）。INP 三段結構性無樣本，表格照模板列出、如實填「無樣本」：

| | broken | fixed-content-visibility | fixed-virtual |
|---|---|---|---|
| inputDelay | 無樣本（`null`，零互動） | 無樣本 | 無樣本 |
| processing | 無樣本 | 無樣本 | 無樣本 |
| presentation | 無樣本 | 無樣本 | 無樣本 |
| LoAF forcedStyleAndLayout | **無強制版面樣本**（`forcedSamples: []`、`forcedMedian: null`） | 同左 | **無 LoAF 幀**（`loafPickedBy: "none"`、`forcedPeak: null`） |
| loafPickedBy | `specimenScriptDuration`（備援路徑） | `specimenScriptDuration` | `none` |
| specimenScript（備援選出的幀） | 172.5 / 156.8 / 162.0 ms | 159.3 / 191.6 / 160.2 ms | 無（`null` ×3） |
| sourceFunctionName | 無（`forcedFn: ""`） | 無 | 無（`forcedFn: null`） |

出處：`records[*].forcedSamples / .forcedMedian / .forcedPeak / .loafPickedBy / .specimenScript / .forcedFn`。
依模板規則，`loafPickedBy` 不是 `forcedStyleAndLayout` 的幀時，`forcedFn` 不構成
「有強制版面幀」的證據 —— 本標本三臂沒有任何一幀是靠強制版面選出來的。
病變不走強制重排路徑（那是標本 #3 的病），它走的是**初次渲染把首屏繪製整段推遲**。

**LCP 標的的身分**（`phase2:1201-1232` 追記，2026-07-26 解決 `:338-340` 登記的待辦）：

- 九筆 records 的 `lcp.el` 一律是裸 `p`（無 id 無 class），光靠協定欄位查不出是誰。
- 用 CDP 在 document 建立前注入 `PerformanceObserver`（`buffered: true`）抓到元素本身：
  `tag=p · parent=#specimen-root · 第 4 個子元素 · size=36672 · rect 769 × 48 @ (8, 129)`，
  內文是「**載入後請先不要動**……」那段操作說明（`phase2:1208-1211`）。
- **這不是缺陷**：LCP 的定義就是最大的一次內容繪製，單一裝置列很小，整段粗體說明
  （769 × 48）贏過任何一列。量到的仍是真實的「這一頁要多久才畫得出最大那塊文字」，
  而它確實被 5000 列的渲染擋住（`phase2:1215-1217`）。
- 所以歸因的誠實寫法是：**本標本量的是「說明文字多久畫得出來，而清單把它擋住了」**，
  不是「清單自己多久畫得出來」（`phase2:1224-1225`）。broken 擋 1864ms、
  `content-visibility` 只渲染首屏附近所以剩 520ms、虛擬滾動只建 141 個節點所以剩 80ms。
- ⚠️ **治療臂的 LCP 標的是否仍是同一個元素，本輪沒有逐臂查**（`phase2:1226-1229`）。
  `fixed-virtual` 只渲染 15 列，說明文字大概率仍是最大那塊 —— 但這是推論不是實測。
  協定目前只送裸 tag 的 `elementDescriptor`，分不出是哪一個 `p`；這是 `RunResult`
  該加欄位的地方（凍結契約只准加欄位）。

三輪兇手段是否一致：**是**（描述子層級：`lcp.el` 九筆皆 `p`；三臂三輪的差異全部呈現在
`lcp.value` 上）。但要註記：`tools/analyze-repro.mjs` 的「三輪一致兇手 vs 登記值」判準
**值域涵蓋不到 `lcp`**（`phase2:1166-1180`：#2 落在 `not-an-inp-segment`，不報警）——
#2 登記的兇手從來沒有被任何自動判準驗證過，上面的「一致」是人工從 records 讀出來的。

> `presentation` 繼承 `duration` 的 8ms 量化，會落在 8ms 網格上。
> 對量級對照無影響，只在替兩個都已經很快的方案排名時咬人（本標本兩段治療刻意不排名）。
> `blockingDuration` 是整幀的值，**含外殼**，規格上無法拆到單一 script；
> `forcedStyleAndLayoutDuration` 是逐 script 的，所以只有它能乾淨濾掉外殼貢獻 ——
> 本標本兩者都沒有進入判定（無強制版面樣本），列出是為了讓讀者確認「沒有」。

#### 治療梯度

| 治療 | LCP（三輪 median） | 相對病變 | 代價 |
|---|---|---|---|
| 一：`content-visibility: auto` + `contain-intrinsic-size: auto 120px` | 520ms | **3.6×**（1864 ÷ 520） | 40,021 個節點**還在 DOM 裡**（`domNodeCount` 與病變逐位元相同）；必須配對 `contain-intrinsic-size`，忘了就把渲染成本換成 CLS（`specimens/02-long-list.ts:247-257`）；需要瀏覽器支援（mode `requires: ['content-visibility']`，`src/specimens.ts:216`） |
| 二：虛擬滾動（可視範圍 ± 5 列） | 80ms | **23.3×**（1864 ÷ 80） | 節點只建 141 個，但換來真實的複雜度：Ctrl+F 找不到沒渲染的列、無障礙樹不完整、錨點失效（`specimens/02-long-list.ts:155-162`，**散文宣稱非量測**）；scroll listener + spacer 維護；**捲動期掉幀 9 / 9 / 10（本輪唯一超過 5 幀底線的臂**，`records[mode=fixed-virtual,run=1..3].custom.droppedFramesPeak`） |

兩臂 LCP median（520 / 80ms）都在雜訊底線 50ms 之上，比值可報。
治療版落進雜訊底線時不報比值 —— 本標本沒有觸發這條，但 `fixed-virtual` 的**全距**（8ms）
已在底線之下，再快一個檔次這個比值就該收起來了。

**兩段治療之間不排名**（登記 R3，`phase2:231`）。毫秒數上 80 < 520，但排名毫無意義：
登記明文說本標本最重要的是節點數之差（`phase2:218-221`），而那一欄是
**40,021 vs 141（283.8×，40021 ÷ 141）**、`renderedItems` **5000 vs 15** ——
`content-visibility` 是「一行 CSS、結構一字不動」（病變與治療一共用同一支
`renderEverything()`，差別只有一個 class，`specimens/02-long-list.ts:141-153`），
虛擬滾動是「根本不建那些節點」，各自的代價欄不同，讀者按自己的相容性與複雜度預算選。

無效或反向的治療：無 —— 但**治療二在次要指標上有一筆反向**（捲動期掉幀 9/9/10 vs
病變的 0/0/0），照實列在代價欄。它是 `renderWindow()` 每次捲動重建視窗的真實成本，
不是雜訊（三輪 9/9/10，離散度 (10−9)/9 = 11%，穩定重現）。

#### 與登記的差異

逐條對照，三種結局分開寫：

- **符合（誤差 ≤ 30%）**：
  - `broken` LCP 4x 登記 1200~4000ms（`phase2:208`）→ 實測 1864 / 1788 / 1896，三輪全in ✅
  - `fixed-virtual` LCP 4x < 800ms（`:213`）→ 80ms，餘裕 10 倍 ✅（上限鬆，但登記如此）
  - `fixed-virtual` `domNodeCount` < 400（`:214`）→ 141 ✅
  - `fixed-content-visibility` `domNodeCount` 不變（`:212`）→ 40,021，與病變逐位元相同 ✅
    （括號裡的 ~35,000 已作廢，實值 40,021 出自 `:539-545` 的反解）
  - `fixed-content-visibility` LCP 降 30~70%（`:211`）→ 實測**降 72.1%**
    （(1864 − 520) ÷ 1864；比值形式 3.6× vs 登記等價 1.4~3.3×）——
    **貼線略過登記上緣**（超出 2.1 個百分點、比值超出上緣 8%），在 30% 帶內判符合，
    但方向要說清楚：是**治療比登記的天花板更有效**，不是失效。
  - 兇手 `lcp`（`:216`）→ 三臂三輪的差異全部呈現在 LCP 上 ✅（惟自動判準涵蓋不到，見兇手歸因）
- **數值落空（同方向但差一個數量級）**：無。
- **方向落空（結論相反或兇手不同）**：登記表內無。
  但**一條未登記的頁面宣稱被本輪資料反向**：標本副標與檔頭寫「LCP 被拖垮，**捲動掉幀**」
  （`src/specimens.ts:205`；`specimens/02-long-list.ts:4`），而正典資料裡 `broken` 的
  `droppedFramesPeak` 三輪皆 **0**，唯一掉幀的是治療臂 `fixed-virtual`（9 / 9 / 10）。
  兩個結構性原因讓這個宣稱在現行儀器下**量不到**：
  ① 掉幀觀測在 `mount()` 完成後才啟動、外加 500ms 暖機（`src/measure/runtime.ts:444-460`），
  病變版最重的初次渲染整段落在觀測窗之外；
  ② 全渲染完成後的捲動是合成器執行緒的事，主執行緒無工作可掉（分析推論，未實測驗證）。
  這條**兩份 phase 檔都沒記**，處置留給主執行緒（改文案，或補一個蓋住載入期的掉幀觀測 ——
  後者動儀器，要走處置順序 ③）。
- **登記風險的結局**：
  - R1（cv 的 LCP 收益可能小）**沒有成真** —— 降 72.1%，貼著登記上緣的外側。
    但 R1 要求的「補捲動期數字」**仍未執行**，而本輪順帶量到的捲動期掉幀（broken 0/0/0）
    暗示在「10 拍 × 120px」這個溫和的捲動強度下，`content-visibility` 的主場根本沒有戲可演
    ——要示範它省捲動成本，得加大捲動強度，那是改凍結變因的下一輪工作。
  - R2（CLS 示範）**結構上不可執行，已明文作廢**（`phase2:1126-1129`，誤標 #5 見登記節）。
  - R3（不排名）遵守。
- **INP presentation 段**（`:210`）：已明文作廢（`:1121-1124`）。本輪資料佐證：
  `totalInteractions` 九筆皆 0。這一格從登記起就結構上量不到，不算落空，算**登記錯誤**。

處置順序固定：① 查環境 ② 換更精確的驅動方式 ③ **最後**才動 protocol。
本標本這一輪正是按這個順序走過來的實例：上午判 unstable（`broken` 34.0%、
`fixed-virtual` 110.7%，`phase2:936-940`，該輪九筆已全數作廢 `:1023`）——
查出來**不是標本不穩，是量測方式不穩**（B 類前導污染，`:951-1015`）：
iframe 與外殼共用 renderer 主執行緒，前一份 document 的拆除落在新 document 的時鐘內，
而 LCP 取 `entry.startTime`。修法（deep-link 全新導覽 + 節流前置 + 暖身丟棄）動的是
驅動方式（②），不是 protocol（③），標本一個字沒改。修完三臂離散度 5.8 / 14.6 / 10.0%。
汙染有多大，同一輪內的對照（`tools/b-class-isolation.mjs`，皆 4x）：`fixed-virtual`
前導 `fixed-content-visibility` 時 888~892ms、deep-link 全新導覽 100 / 92 / 108ms ——
**污染項約 790ms，是訊號的八倍**（`phase2:1032-1037`）。
⚠️ 這個缺陷**沒有症狀**（舊迴圈讓前導恆定、污染成常數，三輪離散度照樣漂亮，`:972-974`）——
任何人把 B 類改回「按按鈕切 mode」，它就無症狀地回來，防線只有回歸測試。

**儀器帳（非標本缺陷）另兩筆**：
① 舊工具註解曾記 `fixed-virtual` 32 / 32 / 40ms，與正式三輪差約三倍 —— 已查明是
前一版探針把節流放在 document 載完後才套，載入期實跑 1x，三倍正是節流率本身
（`tools/reproducibility.mjs:692-694`）。引用不標條件，等於拿 1x 的數字描述 4x 的結論。
② **正典 JSON 沒有 `protocolVersion` 欄位**：頂層鍵只有 `measuredAt / driver / cpuThrottle /
cpuThrottlingRate / runsPerMode / specimensCovered / isFullSweep / records / problems /
consoleErrors`，驅動器程式全文也不寫入該欄。凍結契約的常數在 `src/protocol.ts:8`，
但「JSON 值必須等於 1」這條驗證**無從執行** —— 兩份 phase 檔都沒記，留給主執行緒。

#### 誠實揭露

- **這個標本沒有示範的東西**：
  - **LCP 標的不是列，是儀器自己的操作說明文字**（`phase2:1201-1225`）。本標本示範的是
    「整份 document 的首屏繪製被 5000 列拖慢」，不是「5000 列自己成為 LCP 標的」。
    要示範後者得有大面積的真實內容（真圖片），那是加碼 #7 的題目。
  - **「頭像」不是圖片**，是 CSS 上色的字母方塊（`phase2:187, 191-194`；
    `specimens/02-long-list.ts:15-18, 109-113`）。機制為真（低熵圖片 < 0.05 bpp 不入
    LCP candidate，所以圖片版根本量不到），但「長列表拖垮 LCP」含載入解碼的完整故事沒有示範。
  - **沒有示範 `content-visibility` 真正的主場**（捲動期的樣式與版面節省，登記 R1）。
    本輪的捲動強度下病變版捲動期掉幀為 0 —— 這個主場在現行 protocol 裡**沒有戲可演**。
  - **沒有示範「忘設 `contain-intrinsic-size` 會製造 CLS」**——沒有那個對照臂，已明文作廢。
  - **虛擬滾動的代價大半只有寫、沒有量**（Ctrl+F / 無障礙樹 / 錨點，
    `specimens/02-long-list.ts:155-162`）。本輪唯一量到的代價是捲動期掉幀 9 / 9 / 10。
  - **沒有示範「壞掉的虛擬滾動」**。`renderWindow()` 的「區間沒變就 return」護欄
    （`specimens/02-long-list.ts:173-175`）擋掉一個很容易踩的失敗模式（退化成標本 #6 的
    高頻重建），但那個失敗模式沒有做成一臂。
  - **列是絕對定位、捲軸由 spacer 撐出**（`specimens/02-long-list.ts:228-237, 275-277`）。
    真實世界的長列表多半是 flow layout，layout 成本結構不同 —— 這是讓「捲動距離」
    成為凍結變因付的代價。
- **已知會讓數字失真的因素**：
  - **B 類前導污染**（已修，`phase2:951-1015`；回歸測試 `tools/b-class-isolation.mjs`）。
    缺陷無症狀，改回按鈕切 mode 就會無症狀復發。
  - **冷啟動效應未量化**（`phase2:1055, 999-1001`）：「丟一次暖身」是經驗值不是量出來的門檻。
  - **靜置期任何 CDP 呼叫都會污染載入期**（`tools/reproducibility.mjs:292-299, 733-735`）。
  - **節流必須在導覽前打開**（`phase2:994-996`）；外殼 bundle 因此也在 4x 下解析（常數項）。
  - **捲動也算互動，會讓 LCP 提前定案**（`src/specimens.ts:231-232`；
    `specimens/02-long-list.ts:262-264`）—— 靜置不足時主指標直接報廢。
  - **viewport 實際內部寬度 785**（`phase2:41-42`），列的行數是寬度敏感的。
  - **`domNodeCount` 是 `document.querySelectorAll('*').length`**（`specimens/02-long-list.ts:194-197`），
    含基底 21 個節點，不是「列的節點數」—— 把它讀成 5000 × 每列節點數正是 7 vs 8 錯誤的來源。
  - **掉幀觀測不含 mount 期**（`src/measure/runtime.ts:444-460`）：`droppedFramesPeak = 0`
    只代表「觀測窗內沒掉」，不代表載入不卡。
  - **跨 session 絕對值不可比**（`phase2:944-945`；`phase1:446-456`）；
    治療臂比值跨 session 更是無效（`phase2:1085-1090`，比「絕對值不可比」強一級）。
  - `tools/analyze-repro.mjs` 的 `clsValue` 曾把「沒量到」與「真的是 0」併成同一個值
    （`phase2:552-553`；`:1184-1186` 記為已修）—— 本報告的 CLS 欄直接讀 records 的 `null`，
    不經該工具。
  - **機器負載會讓驗收掉分**（`CLAUDE.md`：load < 2 時 13/13，3.7~5.8 掉到 8~11）。
- **換機器後必須重跑什麼才能沿用結論**：
  1. **先重跑 `tools/b-class-isolation.mjs`**（`phase2:963`）—— 這個缺陷沒有症狀，
     沒跑過就不能相信任何 LCP 數字。
  2. 重跑校準 D（LCP 排程，+2.9%）與校準 C（CLS 解析解，誤差 0.15%）（`phase2:23-28, 313-324`），
     並重驗低熵圖片規則（< 0.05 bpp）在新 Chromium 上還成不成立 ——
     「頭像不用圖片」的整個設計建立在它上面。
  3. 重驗 `navQuietMs = 20000` 夠不夠（慢機器上不夠就會在 LCP 定案前開捲，主指標報廢）。
  4. 重量 viewport 實際內部寬度（捲軸寬度跨平台不同）。
  5. 重讀 `refreshHz`（掉幀門檻由它推導）。
  6. 確認瀏覽器支援 `content-visibility` / `contain-intrinsic-size: auto`
     （`src/specimens.ts:216`）—— 不支援時面板要顯示「瀏覽器沒有這個 API」。
  7. 重跑 `node tools/acceptance.mjs`（13 條全綠），跑前先看 `uptime`。
  8. 兩支工具寫死不同瀏覽器路徑（`tools/acceptance.mjs` 是 `/usr/bin/brave-browser`、
     `tools/reproducibility.mjs:23` 是 `/opt/brave.com/brave/brave`），兩處都要改。
- **本輪未做的事**：
  - **捲動期數字沒有補**（R1 明文要求）。`droppedFramesPeak` 有上報但沒進任何判定，
    而它顯示現行捲動強度下沒有東西可省。
  - **治療臂的 LCP 標的沒有逐臂驗證**（`phase2:1226-1229`，僅推論）；
    協定的 `elementDescriptor` 只有裸 tag，`RunResult` 待加欄位。
  - **CLS 對照臂沒有做**（已作廢，要做得另開一臂）。
  - **1x 的正式三輪從未跑過**。登記的 1x 區間（`phase2:208-214`）至今只有 2026-07-25 煙霧測試
    支撐（`broken` 384ms、`fixed-virtual` 84ms —— `phase2:326-336`，**已作廢**：該輪 B 類數字
    全數由 `:1024` 作廢，其判定並被 `:545` 部分推翻）。
  - **人手複驗沒做**（全部 CDP 機器驅動）。
  - **`?validate=1` 的 web-vitals 對帳沒納入三輪量測**（開關在 `src/shell/App.tsx`；
    校準期的對帳 `deltaLcp = 0` / `deltaCls = 0` 出自 `phase2:322-324`，另一 session）。
  - **冷啟動效應沒有量化**（多大、衰減多快；`phase2:1055`）。
