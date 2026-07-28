# 病理報告 · 03 強制同步版面重排（Layout Thrashing）

> 實測數字**只取自** `docs/measurements/2026-07-26-reproducibility-4x-5.json`
> （2026-07-26T05:52:29.671Z 的完整掃描，`sweep.problems` 為空陣列 = 無異常輪，
> `sweep.consoleErrors` 為空）。其他 session 的數字只以「另一 session」或「已作廢」
> 的身分出現，並逐一標明來源。跨 session 絕對值不可比（`phase1:455-456`、`phase2:944-945`）。

## 03 強制同步版面重排（Layout Thrashing）

**病症一句話**：對 800 列的清單交替「讀 `offsetHeight`、寫 `width`」，
每次點擊觸發**中位 829~964ms** 的強制同步版面重排（本 session、4x 宣告節流，
三輪 `forcedMedian`：`records[mode=broken,run=1..3].forcedMedian`）；
讀寫分離之後，**三輪皆無任何強制版面幀**（`records[mode=fixed-batched,run=1..3].forcedMedian` 皆 `null`）。

> ⚠️ 方法論警語（跨 session，各自標明來源）：這句話**必須標 session**。
> 同一份程式一個字沒改，三次量測的 broken forced median 分別是
> 744.5 / 716.4 / 678.3（2026-07-25 session，`docs/measurements/2026-07-25-reproducibility-4x.json`，
> 經 `phase2:1234-1253` 裁決為現行有效組）、
> 1158 / 1274 / 1376（2026-07-26 上午 session，`docs/measurements/2026-07-26-reproducibility-4x.json`，
> 登記於 `phase1:448-449`、`phase2:941-942`）、
> 828.85 / 953.75 / 964.45（**本份 JSON**）—— 最大與最小差約兩倍，
> 而每個 session 內部離散度都通過判準。不標條件的那個數字會被當成這個病的常數。
>
> ⚠️「一幀都不再產生」這種絕對句也要標 session：0725 是兩輪零幀、一輪有幀，
> 0726 上午三輪都有幀（0.1 / 0.1 / 0.4ms，出處：模板已填範例的治療梯度警語），
> **本份 JSON 三輪零強制版面幀**。同一句話在三個 session 有三種真值。

## 凍結條件

同一組條件之間才能比較。任何一項改動，先前所有數字作廢。

| | |
|---|---|
| CPU throttle | 4x —— **宣告值**（`records[*].cpuThrottle`、`sweep.cpuThrottlingRate=4`）。JS 偵測不到（`protocol.ts:55`「無法從 JS 偵測，只能由使用者宣告」），且**本份 JSON 內部沒有 1x 臂，無法從資料檢核節流是否真的套用** |
| 驅動方式 | CDP 機器驅動（`sweep.driver`：`Input.dispatchMouseEvent`），非人手 |
| viewport | 800 × 600（`src/specimens.ts:10` 的 `FROZEN_VIEWPORT`，經 `:183` 掛進本標本 meta；records 未記錄此欄） |
| refreshHz | 60（`records[*].refreshHz`，六筆一致） |
| 操作程序 | click · 10 次 · 間隔 2500ms（`src/specimens.ts:176-181`）。節拍護欄：`dispatchSpanNominalMs` 25000，實測 `dispatchSpanMs` 24999.5~25002.4（六筆），偏差 ≤ 2.4ms —— 節拍確實交付。本標本走間隔迴圈而非絕對排程，名目值定義為 reps × I（`tools/reproducibility.mjs:658-663` 的註解） |
| buildId | `0.1.0-ms191c71`（`records[*].buildId`，六筆一致） |
| protocolVersion | 1（`src/protocol.ts:8` 的 `PROTOCOL_VERSION` 常數）。⚠️ 本份 records **沒有這個欄位**，此值取自程式碼，不是取自量測資料 |

> ⚠️ 方法論警語（來源：模板已填範例，教訓出自 0725/0726 兩個 session）：
> 先前版本的報告曾有一段「4x 對 1x 的換算檢核：比值 4.0× ⇒ 節流確實生效」，**已刪除**。
> 它是跨 JSON 相除（1x 探針來自 `phase1:237-243` 的拋棄式量測、4x 來自另一 session 另一個 buildId），
> 而同一個算式在 0726 上午那輪給出 7.12× —— 兩個獨立浮動量的商不是檢核。
> 本份 JSON 同樣沒有 1x 臂，所以 throttle 這一格**只能是宣告**。
> 要真的檢核，得在同一次 session、同一份 JSON 裡跑一支 1x 臂。

## 動工前登記的預期

> 登記出處：`docs/phase1-expected-results.md:142-210`（標本 #3 段，動工前盲預測）。
> **這一節不准回頭改去迎合實測。** 修正只出現在該檔「修正紀錄」（`phase1:218-263`）。

- 主指標 `loaf.forcedStyleAndLayout`（`src/specimens.ts:166`），
  預期 broken **200~500ms（1x）／600~2000ms（4x）**（`phase1:180-182`）
- INP 預期 broken 250~600ms（1x）／700~2200ms（4x），fixed < 60ms（1x）／< 100ms（4x）（`phase1:183-185`）
- 治療預期 fixed-batched forced < 10ms（1x）／< 25ms（4x）（`phase1:184`）
- 兇手段預期 **processing** —— 與標本 #1 形成對照（`phase1:189-191`；#1 的兇手後來
  經 `phase1:272-307` 改判為 `presentation`，對照本身仍成立，見 `phase1:301-304`）
- 病變 vs 治療比值預期 **> 20×**（`phase1:187`，照抄 `spec:1353`）。
  ⚠️ 判準現況：`phase2:1259-1338` 檔尾追記只作廢／改判 #4、#5、#6 的比值判準
  （生效範圍 `phase2:1334-1338`），**#3 的 > 20× 未被追記推翻，現行有效**
- 登記在案的風險（`phase1:195-210`）：#1 N=800 打不到量級、
  **#2 治療版可能不是數字小，是沒有數字**、#3 外殼貢獻混入 forced 欄、
  #4 寫入值相同導致病變版「安靜地治好自己」
- 動工時補登（`phase1:226-228`）：`intervalMs: 2500`（間隔必須大於 4x 病變上限，
  否則事件排隊、兇手翻成 inputDelay）、`repetitions: 10`、行高 24px 寫死

## 實測

三輪，同一組凍結條件。**離散度算在每輪的 median 上，不是 max** ——
`protocol.ts:309`：「抗離群。可重現性判定用這個，不用 max」（模板引用的 `:290` 已漂移，
內容同一句）。相對離散度 =（三輪 max − 三輪 min）÷ 三輪的 median。

| mode | 三輪 forced median | 相對離散度 | 絕對全距 | 判定 |
|---|---|---|---|---|
| broken 交替讀寫 | 828.85 / 953.75 / 964.45 ms | 14.2%（= 135.6 ÷ 953.75） | 135.6ms | ✅ 可重現 |
| fixed-batched 讀寫分離 | **無 entry / 無 entry / 無 entry** | —（無 entry，無離散度可算） | — | ✅ 可重現（三輪一致零幀） |

出處：`records[mode=broken,run=1..3].forcedMedian`、`records[mode=fixed-batched,run=1..3].forcedMedian`（皆 `null`）。

> ⚠️ `null` 是「沒有產生任何強制版面幀」，不是「量到 0」。
> 治療臂三輪 `forcedSamples` 皆為空陣列；第一輪的 `forcedPeak` 是 0、後兩輪是 `null`，
> 這個差別有意義，見兇手歸因的警語。
> 模板前言明文：「未量測」與「量到 0」是兩件事，
> 「標本 #3 治療版的全部結論就建立在這個區別上」。

INP median 另計（`records[*].stats.median`，每輪 10 次互動的 median；
`inp` 欄本身是 max 不是 p98，六筆 `isMaxNotP98` 皆 `true`）：

| mode | 三輪 INP median | 相對離散度 | 判定 |
|---|---|---|---|
| broken | 892 / 1016 / 1032 ms | 13.8%（= 140 ÷ 1016） | ✅ 可重現 |
| fixed-batched | 48 / 48 / 48 ms | 0.0% | ✅ 可重現 |

臂間比值 **21.2×**（= 1016 ÷ 48，兩臂各取三輪 median 的中位，同一份 JSON 內部）。
治療臂 48ms 高於 INP 雜訊底線 16ms，比值可報。

## 兇手歸因

代表互動（INP 那一筆）的三段拆解，`records[*].inputDelay / .processing / .presentation`：

| | broken | fixed-batched |
|---|---|---|
| inputDelay | 2.8 / 3.6 / 4.4 ms | 2.1 / 2.0 / 1.8 ms |
| processing | 1215.5 / 1725.3 / 1396.3 ms | 10.5 / 9.0 / 10.1 ms |
| presentation | 29.7 / 31.1 / 31.3 ms | 43.4 / 69.0 / 44.1 ms |
| LoAF forcedStyleAndLayout（僅標本自己的 script） | median 828.85 / 953.75 / 964.45 ms | 無 entry / 無 entry / 無 entry |
| sourceFunctionName | `interleavedReadWrite`（三輪） | 見下方警語 |

三輪兇手段一致：**是，processing**。與 inputDelay 相差約 300~500 倍（兩個半數量級），
與登記值（`phase1:189`、`src/specimens.ts:168` 的 `culprit: 'processing'`）一致。

broken 三輪 `loafPickedBy` 皆為 `forcedStyleAndLayout`
（`records[mode=broken,run=1..3].loafPickedBy`），所以 `forcedFn = interleavedReadWrite`
是有效的兇手證據 —— 挑幀準則正是「強制版面貢獻最大的那一幀」。

> ⚠️ 治療臂的 `forcedFn` **不構成證據**。
> `records[mode=fixed-batched,run=1].forcedFn` 是 `batchedReadThenWrite`，
> 但同筆 `loafPickedBy` 是 `specimenScriptDuration` —— 那一幀是「全部幀的強制版面貢獻皆為 0
> 時退回 script 時長最大」的備援路徑挑出來的（`tools/reproducibility.mjs:440-442`：
> 「不是前者時，forcedFn 與 specimenScript 只是『本輪最重的一幀』，不代表兇手」）。
> 它證明的只是治療版有一幀較長的動畫幀（該幀 `specimenScript` 7.8ms、
> 該輪 presentation 43.4ms），**不是「有強制版面幀」**。
> 第 2、3 輪連備援幀都沒有：`forcedFn` 為 `null`、`loafPickedBy` 為 `none`。
>
> 同筆的 `forcedPeak: 0` 也因此不是「無 entry 卻寫 0」：capture 邏輯在無逐點擊樣本時
> 落回備援幀的 forced 值（`tools/reproducibility.mjs:438`），0 是那一幀實際量到的
> 強制版面貢獻。後兩輪無幀可落回，所以是 `null`。三個值三種語意，不可混讀。

> ⚠️ 另一 session 的對照（來源：模板已填範例引用的 0725 / 0726 上午資料）：
> 0726 上午三輪治療臂都有強制版面幀（0.1 / 0.1 / 0.4ms，三輪 `forcedFn` 皆
> `batchedReadThenWrite`、`loafPickedBy` 皆 `forcedStyleAndLayout`）——
> 那時它反而是**正面證據**：`keepNames` 讓治療版殘餘的那一幀也歸因到它自己，不是歸給外殼，
> 正好回答 `phase1:203-206` 登記的風險 #3。本份 JSON 三輪零幀，這條證據線這輪不存在，
> 但風險 #3 的另一半仍有答案：治療臂沒有卡在任何非零底線上，外殼沒有混進來。

`presentation` 繼承 `duration` 的 8ms 量化（duration 六筆全是 8 的倍數：
1248 / 1760 / 1432 / 56 / 80 / 56）。對量級對照無影響，
只在替兩個都已經很快的方案排名時咬人。`blockingDuration` 是整幀的值，含外殼，
規格上無法拆到單一 script；`forcedStyleAndLayoutDuration` 是逐 script 的，
所以只有它能乾淨濾掉外殼貢獻（`spec:1067` 說本標本「數字最可信」的理由）。

## 治療梯度

| 治療 | forced median | 相對病變 | 代價 |
|---|---|---|---|
| 讀寫分離（先全讀進 `Int32Array`，再全寫；`specimens/03-layout-thrashing.ts:180-200`） | 無 entry / 無 entry / 無 entry | **不報比值** —— 分母無 entry，除式無定義 | 需要 mount 時預配的 800 格暫存（`:89`，點擊當下不配置，避免把配置與 GC 成本算進治療臂，陷阱 #12）；讀與寫不能再交錯寫在同一個迴圈裡 |

「716ms ÷ 0.1ms ＝ 7163 倍」這種算式描述的是除數多小，不是治療多有效；
治療臂零 entry 時誠實的寫法就是「治療版沒有產生任何強制版面幀」。

輔助指標（同一份 JSON 內部）：

- **INP**：1016 → 48ms，**21.2×**（見實測節；48ms 高於 16ms 底線，可報）。
- **droppedFrames**：broken 118 / 214 / 193，fixed 2 / 1 / 2
  （`records[*].custom.droppedFrames`）。治療臂落在雜訊底線 5 幀之內，**不報比值**。
- **自報單趟耗時 `lastPassMs`**（`records[*].custom.lastPassMs`）：
  broken 1208.3 / 880.9 / 1003.2ms，fixed 5.1 / 4.8 / 5.5ms。
  自報值、非判準指標，列出供對照，不做除法宣稱。
- 治療臂殘餘的 presentation 43.4~69.0ms 對應 `phase1:260-263` 的探針發現：
  **那一次必要的版面計算沒有消失**，只是移出 script、還給瀏覽器的正常繪製步驟
  （`specimens/03-layout-thrashing.ts:170-173` 的誠實揭露註解）。
  省下來的是 799 次多餘結算，不是那一次必要的結算 —— 講成「讓版面計算消失」就是誇大。

`layoutChecksum` 兩臂皆 **54888**（`records[*].custom.layoutChecksum`，
六筆全部相同）—— 讀寫分離**沒有偷工**，第 k 次點擊後的最終 DOM 完全相同
（自我驗證機制見 `specimens/03-layout-thrashing.ts:210-229`）。
這個檢核必須有：否則「治療版比較快」最無聊的解釋就是它少做了事。

> ⚠️ 數字搬運警語（來源：模板已填範例）：checksum 曾被誤寫成 54168 ——
> 那是 `phase1:258` 那支 **1x、四次點擊**校準探針的值。
> checksum 是最後一次點擊的高度總和，第 k 次讀到的高度取決於第 k−1 次寫入的相位，
> 四次與十次必然落在不同相位，兩個數字本來就不該相同。
> 本份 JSON 是十次點擊，六筆全部 54888。

## 與登記的差異

- **符合**（誤差 ≤ 30%）：
  - 兇手段 processing，三輪一致（登記 `phase1:189`）✅
  - broken forced 4x 帶 600~2000ms（`phase1:182`）：實測 828.85~964.45ms，帶內 ✅
  - broken INP 4x 帶 700~2200ms（`phase1:183`）：每輪 median 892~1032ms
    （max 口徑 1248~1760ms）皆帶內 ✅
  - fixed INP < 100ms（`phase1:185`）：48ms ✅
  - fixed forced < 25ms（`phase1:184`）：以「零 entry」這個**更強的形式**成立 ✅
  - 比值 > 20×（`phase1:187`，#3 判準現行有效，見「動工前登記的預期」節）：
    數值比值**不可計算**（分母無 entry），判準所主張的方向以治療臂歸零的形式成立。
    照模板規則不報數字。
- **數值落空**：無。1x 登記帶 200~500ms（`phase1:182`）本輪沒有 1x 臂，**未檢核**，
  不列入任何一欄 —— 沒量的東西沒有「符合」可言。
- **方向落空**：無。
- **登記風險 #2（`phase1:199-201`）第二度成真**：治療版不是數字小，是沒有數字。
  0725 動工探針第一次證實（`phase1:251-252`），本份 JSON 三輪再次全部零幀。
  「有取樣但零筆」與「沒量到」必須分開，否則會被判成「樣本不足」。

量測過程中修掉的**儀器**缺陷（不是標本缺陷；教訓出自另一 session，標明來源）：

> ⚠️ 來源：0725 session（模板已填範例「與登記的差異」節）。
> 第一版拿 forced **峰值**跨輪比，算出離散度 52%，判定不可重現；
> 改用每輪 median 之後是 9.2%。**不可重現的是儀器。**
> 本份 JSON 自己也重演了這一課：`records[mode=broken,run=2]` 的 `forcedPeak` 1630.1ms
> 是該輪 median 953.75 的 1.7 倍，被 median 吸收 —— 判定用 median 不用 max
> 不是風格偏好，是這組資料反覆證明的規則。

> ⚠️ 無來源數字警語（來源：`phase2:1234-1257` 的裁決）：0725 session 曾同時流傳兩組
> 「每輪 median」——745 / 716 / 678（9.2%）與 721 / 709 / 751（5.9%）。
> 逐項反推原始資料後，後者**不是任何算式的結果，無來源，作廢**（`phase2:1253`）。
> 一組看起來很具體、還附了離散度的數字在檔案裡活了整輪都沒人問它從哪來 ——
> 所以本報告每個數字都附欄位路徑或行號。

## 誠實揭露

- 這個標本**沒有**示範的東西：只示範了一種讀寫交錯樣式（讀 `offsetHeight` / 寫 `width`）。
  沒有涵蓋 `getComputedStyle`、`scrollTop`、`getBoundingClientRect` 等其他強制重排觸發點
  （標本頁自己列了不完整清單，`specimens/03-layout-thrashing.ts:335-348`）。
  也刻意不把 `ResizeObserver` / `IntersectionObserver` 做成第三個 mode ——
  那會同時換掉「什麼時候算」與「誰來算」兩個變因，對照就不乾淨了（`:174-178`）。
- 已知會讓數字失真的因素：
  - N = 800 由校準錨點 B 反推（`phase1:159-172`），而錨點 B 機器相依性極高
    （同一份程式在不同 headless 設定下曾差 30 倍，`phase1:78`）。
  - **跨 session 絕對值漂移約 2 倍**（本報告病症警語列出的三個 session），
    可比較單位是同一份 JSON 內部的臂間比值，不是跨 JSON 的絕對毫秒數
    （`phase1:455-456`、`phase2:944-945`）。
  - CPU 4x 是宣告值，本份 JSON 無 1x 臂，無法內部檢核（見凍結條件警語）。
  - `inp` 欄是 max 不是 p98（n = 10，`isMaxNotP98: true`）；判定一律用 `stats.median`。
  - 本標本的 LCP / CLS 欄**不是判準指標**：A 類 live 切換不重載 document，
    六筆 `lcp` 全是同一次首載的 184ms（裸 `p`）；`cls.sessionCount` 跨輪、
    **跨 mode** 累積（10 → 21 → 32 → 43 → 54 → 65），治療臂三筆 `cls.value`
    0.4252567150290073 與 broken run 2/3 逐位元相同，是同一份 document 的累積殘留，
    **不得當成治療臂自己的 CLS 引用**。
- 換機器後必須重跑什麼才能沿用結論：**先重跑校準按鈕 B**，重新校準單次強制版面的
  單位成本，再看 N = 800 的預期還成不成立（`phase1:78`、`specimens/03-layout-thrashing.ts:29-35`）。
- 本輪未做的事：人手複驗（本輪全部 CDP 機器驅動）；`?validate=1` 的 web-vitals 對帳；
  1x 對照臂（節流檢核因此只能是宣告）；治療臂 LCP / CLS 的逐臂獨立量測
  （對 A 類結構上不存在，見上）。
