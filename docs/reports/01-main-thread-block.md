# 病理報告 · 標本 #1

> 實測數字**只**取自 `docs/measurements/2026-07-26-reproducibility-4x-5.json`
> （現行正典檔，`docs/phase2-expected-results.md:1057-1062`；下稱「本份 JSON」）。
> 檔內 `records[...]` 一律指本份 JSON 中 `specimenId = "01-main-thread-block"` 的那九筆；
> `sweep.*` 指其頂層欄位。其他任何數字都是登記值、已作廢值或另一 session 的值，逐處標明。

### 01 主執行緒阻塞（Main-thread Block）

**病症一句話**：在 17ms 絕對排程的十連發點擊下（機器節拍，非人手），click handler 同步排序
五萬筆訂單把主執行緒整段佔住，INP（n = 10，取 max）三輪 median 1028 / 896 / 796ms
（4x throttle、本份 JSON）；治療一（切 chunk + 讓出）把它壓到 24~32ms。

> ⚠️ 這句話刻意標了 session 與條件：同一支標本一個字沒改，同日上午另一 session 的
> 三輪 median 是 1472 / 1508 / 1672ms（`docs/phase1-expected-results.md:400`，另一 session，
> 不可與本份 JSON 的絕對值互比）。不標條件，這個數字就會被當成這個病的常數。
> 也刻意**不寫「模擬使用者連打」**：人手約 150ms 一下，大於單次排序成本，事件根本不排隊，
> 那是另一個實驗（`src/specimens.ts:120-123`、`specimens/01-main-thread-block.ts:26-28`）。

#### 凍結條件

同一組條件之間才能比較。任何一項改動，先前所有數字作廢。

| | |
|---|---|
| CPU throttle | **4x（宣告值）**，JS 偵測不到（`src/protocol.ts:55-56`）。兩半都做了：`Emulation.setCPUThrottlingRate = 4` 才是真的節流、外殼下拉只負責把 `'4x'` 寫進條件（`tools/reproducibility.mjs:15-18, 29-30, 587-595`）。本份 JSON：`sweep.cpuThrottlingRate = 4`、九筆 `records[].cpuThrottle` 皆 `"4x"` |
| 驅動方式 | CDP 機器驅動（`Input.dispatchMouseEvent`，`sweep.driver`），且為 `realClickAbsolute()` **絕對排程**：第 k 發打在 `t0 + k × I`、不等 renderer 回應（`tools/reproducibility.mjs:135-163`；`SPECS[01].absoluteClick = true`，`:275, 485-491`） |
| viewport | 800 × 600（`FROZEN_VIEWPORT`，`src/specimens.ts:10, 135`。CLS 與 LCP 都是 viewport 相對量） |
| refreshHz | **60**（實測，九筆 `records[].refreshHz` 皆 60；欄位定義 `src/protocol.ts:68`。掉幀門檻由它推導，不是寫死 16.7ms） |
| 操作程序 | click · 10 發 · **間隔 17ms 絕對排程**（`src/specimens.ts:125-133`）。名目跨距 (10−1)×17 = **153ms**（`specimens/01-main-thread-block.ts:203-204`）；九筆實測 `dispatchSpanMs` 152.5~153.7ms（護欄，`tools/reproducibility.mjs:659-667`）—— 節拍真的交付了 |
| buildId | `0.1.0-ms191c71`（九筆 `records[].buildId` 一致） |
| protocolVersion | **本份 JSON 未記錄此欄位**（頂層鍵只有 measuredAt / driver / cpuThrottle / cpuThrottlingRate / runsPerMode / specimensCovered / isFullSweep / records / problems / consoleErrors，records 內亦無）。凍結契約常數為 **1**（`src/protocol.ts:8`）。依「未量測不寫成量到」的規矩，這格不填 1，填「JSON 未記錄」 |

這一格額外必須印出來的凍結條件：

- **`machinePaced: true`**（`src/specimens.ts:133`）：外殼不渲染節拍器 —— 節拍器的
  `setInterval` + 每拍 `setState` 會落在待量的那段裡，而本標本的登記兇手段正是
  `presentation`（`docs/phase1-expected-results.md:329-332`）。
- 收斂訊號是輪詢 `custom.completedSorts`，不是固定 sleep（`tools/reproducibility.mjs:276-282`）；
  **不做 mid-gap 取樣**（`midGapSnapshot: false`，`:282`）。
- 負載 `ORDER_COUNT = 50_000`（九筆 `records[].custom.orderCount` 皆 50000；
  `specimens/01-main-thread-block.ts:78`）、固定種子 `20240117`（`:85`）。
- 執行緒相對速度校準 `CALIBRATION_ITERATIONS = 4_000_000`，主執行緒與 worker 兩份**逐字相同**、
  checksum 自動驗（`specimens/01-main-thread-block.ts:345-356`、
  `specimens/01-main-thread-block.worker.ts:96-106`）。
- INP 是 **max 不是 p98**（n = 10 < 50 永遠走 max 分支，`src/protocol.ts:27-32`；
  九筆 `records[].isMaxNotP98` 皆 true）。
- `sweep.problems` 為空陣列 = 全掃描無異常輪；`consoleErrors` 亦空。

#### 動工前登記的預期

> 登記出處：`docs/phase1-expected-results.md:82-138`（標本 #1 段，2026-07-25 登記；
> 該段自我揭露「不是盲預測」，`:84-86`）。
> 修正出處：同檔 `:267-390`「修正紀錄 · 標本 #1 重新設計（2026-07-26）」。
> **這一節不准回頭改去迎合實測。** 要修正就在登記檔的「修正紀錄」追加 —— 下面照登記照抄，
> 已被修正紀錄作廢的逐條標明。

- 主指標（**現行**）：`inp.presentation`（`phase1:306-307`、`src/specimens.ts:116`）。
  原登記 `inp.inputDelay`（`phase1:91, 100`）**已作廢**，`inp.inputDelay` 降為 secondary。
- 兇手段（**現行登記**）：`presentation`（`phase1:272-307`、`src/specimens.ts:118`）。
  原登記 `inputDelay`（`phase1:91`）已作廢（`phase1:367`）。改判理由是結構性的：
  `I < S` 時十個同步 handler 連續跑完才輪到一次 paint，每一發都結束在同一次 paint，
  `duration_k = T_paint − start_k` 對 k 遞減 ⇒ INP 代表樣本恆為第一發，而它前面沒有隊
  ⇒ `inputDelay ≈ 0`，兇手是 `presentation`（`phase1:286-296`）。
  排隊的階梯改由標本自報 `inputLagMaxMs` 顯形，斜率是算式
  `inputDelay_k ≈ (k−1)(S − I)`（`phase1:298-299, 321`）。
  ⚠️ **這個現行登記值本身留待下一輪裁決**：本份 JSON 量完後已發現兇手是機器速度的函數
  （`docs/phase2-expected-results.md:1078-1084`、`docs/HANDOFF.md:49-51`），依規矩 2 不改登記。
- 預期區間（`phase1:99-105`，均未被修正紀錄取代）：
  `broken` 單次 `sortMs` 4x **100~240ms**；`broken` INP 4x **500~1500ms**（數值欄留用、
  兇手欄作廢，`phase1:367`）；`broken` `loaf.specimenScriptDuration` 4x **100~240ms**；
  `fixed-yield` INP 4x **< 80ms**、其 `sortMs` **比 broken 長**；
  `fixed-worker` INP 4x **< 50ms**、主執行緒序列化 4x **20~80ms**。
- 病變 vs 治療比值（`phase1:107`，未被任何修正取代，仍現行有效）：
  `broken / fixed-yield ≥ 5×`、`broken / fixed-worker ≥ 10×`。
  後者已在裁決紀錄補判（見「與登記的差異」；`docs/phase2-expected-results.md:1131-1144`）。
  （2026-07-26 晚的「比值判準四條定案」只涵蓋 #4 / #5 / #6，#1 不在其列，
  `phase2:1259-1338`。）
- 登記在案的風險（`phase1:109-138`）：
  R1 `fixed-yield` 的 `sortMs` 會比 `broken` 長，量到更短是量測錯了（`:111-114`，仍有效）；
  R2 兩段治療之間不排名（`:116-118`，仍有效）；
  R3「兇手段必須是 `inputDelay`」（`:120-121`，**整條作廢**，`:368`）；
  R4 `intervalMs = null` 不是凍結變因（`:123-131`，風險成真，已改 17ms 絕對排程，`:369`）；
  R5「三輪離散度會是全站最高、卡在 30% 線上」（`:132`，見與登記的差異 —— `:369` 的一句
  「風險本身成真」成真的是 R4 不是 R5，兩者要拆開判）。
- 登記在案的限制（修正紀錄追加，屬登記）：
  **L1** 4x 節流套不到 worker 執行緒，是**對治療臂有利**的混淆變因，與「切 chunk 的額外
  CPU 對治療一不利」方向相反，不可合寫成「保守方向」（`phase1:349-361`）；
  **L2** 同口徑可相除的只有 `sortMs(broken)` 與 `workerSerializeMs`（`phase1:358-360`）；
  **L3** `workerFirstTransferMs` 跨兩條執行緒，混口徑，且 `workerColdStart = 1` 時作廢
  （`specimens/01-main-thread-block.ts:296-310`）；
  **L4** `threadSpeedRatio ≈ 4` 時該臂 `workerSortMs` 不得當成 4x 條件下的結果發表，
  `calibrationChecksumMatch` 必須為 1（`:685-698`）；
  **L5** 治療臂重疊處理是**排隊**不是取消，三臂都做完十次排序（`:466-482`）。

#### 實測

三輪，同一組凍結條件。**離散度算在每輪的 median 上，不是 max**（`src/protocol.ts:309`：
「抗離群。可重現性判定用這個，不用 max」）。每輪 median 直接引自 `records[].stats.median`，
相對離散度 =（三輪 median 之 max − min）÷ 三輪 median 的中位數。

| mode | 三輪 INP median（ms） | 相對離散度 | 絕對全距 | 判定 |
|---|---|---|---|---|
| `broken` 同步排序 | 1028 / 896 / 796 | (1028−796)/896 = **25.9%** | 232ms | ✅ 可重現（低於 30% 線，但只差 4 個百分點） |
| `fixed-yield` 切 chunk + 讓出 | 24 / 28 / 32 | (32−24)/28 = **28.6%** | **8ms** | ✅ 可重現（絕對全距 8ms 在 INP 雜訊底線 16ms 內） |
| `fixed-worker` 丟 Web Worker | 608 / 448 / 464 | (608−448)/464 = **34.5%** | 160ms | ❌ **不可重現**（與 `docs/phase2-expected-results.md:1071, 1137` 的判定一致） |

判準：相對離散度 ≤ 30%，**或**絕對全距在該指標的雜訊底線內。
⚠️ 只看相對離散度會把方向搞反：治療有效正是讓分母趨零，於是「治療越成功，越判它不可重現」。
底線取指標自己的量子（掉幀 5 幀 / INP 16ms＝兩格 8ms 量化 / CLS 0.01 / LCP 50ms）。
`fixed-yield` 正是教科書案例：28.6% 逼近線，但三輪 median 全落在 24~32ms 的 8ms 網格上，
絕對全距只有一格量化。

主指標補充：登記主指標是 `inp.presentation`（`src/specimens.ts:116`），但每輪只有 INP
代表樣本那一筆有分段拆解（一輪一個值，無 per-run median 可算），三輪值列在下節兇手歸因表；
本表依 `phase1:398-402` 同一格式報 INP median。

**護欄全綠**（九筆 records 逐筆檢查）：

- `completedSorts` 九筆皆 **10**（三臂都做完十次排序 —— L5 的「同一份工作量」成立）；
  `cancelledSorts` 皆 0、`staleWorkerReplies` 皆 0、`pendingSorts`（fixed-yield）皆 0。
- `clicksReceived` 皆 10 = `totalInteractions` 皆 10 = `repetitions` 10 ——
  十發沒有被 Event Timing 併成同一筆互動，INP 分母正確
  （這對計數的用途登記在 `specimens/01-main-thread-block.ts:249-254`）。
- 節拍交付：`dispatchSpanMs` 152.5~153.7ms 對名目 153ms（最大偏差 0.7ms）；
  標本端 `clickSpanMs` 152.4~153.5ms。
- 校準：`calibrationChecksumMatch` 三筆皆 1、`workerColdStart` 皆 0、
  `mainCalibrationMs` 皆 10.6ms、`workerCalibrationMs` 3.5 / 3.4 / 3.4ms
  ⇒ `threadSpeedRatio` **3.0 / 3.1 / 3.1**。≈1 才代表兩條執行緒同節流率 ——
  **「worker 執行緒沒被 4x 節流」這個混淆變因（L1）本輪被逐輪實測坐實**，不是推測。

排隊的階梯（INP 結構上看不見，標本自報 `inputLagMaxMs` 顯形）：
`broken` 931.4 / 898.4 / 897.3ms、`fixed-yield` 6.1 / 6.5 / 6.5ms、
`fixed-worker` 536.3 / 383.0 / 395.4ms（`records[].custom.inputLagMaxMs`）。
登記斜率算式的端點檢核：`(10−1) × (sortMs − 17)` 以本份 JSON 的 `broken` `sortMs`
（110.7 / 111.6 / 113.9ms）代入得 843.3 / 851.4 / 872.1ms，實測 lag 高它 3~10% ——
量級與趨勢相符；差值方向合理（算式的 S 只計排序，handler 還付 renderSummary 等成本）。
逐發驗證仍未做（只上報 max，見誠實揭露）。

#### 兇手歸因

INP 代表樣本的分段拆解，取自 `records[].inputDelay / processing / presentation`（單位 ms）：

| | `broken` | `fixed-yield` | `fixed-worker` |
|---|---|---|---|
| inputDelay | 0.8 / **798.5** / **700.9** | 0.6 / 0.4 / 2.0 | 206.4 / 178.4 / 176.9 |
| processing | 135.9 / 113.3 / 116.5 | 7.9 / 7.9 / 2.1 | 94.9 / 55.7 / 57.6 |
| presentation | **951.3** / 120.2 / 238.6 | 23.5 / 23.7 / 27.9 | **386.7 / 293.9 / 309.5** |
| LoAF forcedStyleAndLayout（僅標本 script） | 無 entry ×3 | 無 entry ×3 | 無 entry ×3 |
| sourceFunctionName | （見下，欄位不可信） | （同左） | （同左） |

三輪兇手段是否一致：

- **`broken`：否 —— presentation / inputDelay / inputDelay，本輪不得宣稱歸因。**
  這不是抖動，是已登記的機制在界線上翻面：機器變快之後，十次排隊的點擊中間開始塞得進
  一次 paint，排隊就從 `presentation` 浮出來變成 `inputDelay`
  （`docs/phase2-expected-results.md:1076-1084`：同組對照 —— 上午 session `inputDelay`
  0.4~3.9ms、三輪一致 presentation；本輪 `inputDelay` 0.8 / 798.5 / 700.9ms）。
  **兇手是機器速度的函數；現行登記值 `presentation` 是較慢的上午機器量出來的，
  留待下一輪裁決，本報告不改登記**（`docs/HANDOFF.md:49-51`、規矩 2）。
- `fixed-yield`：是 —— presentation ×3（23.5 / 23.7 / 27.9ms）。但注意量級：整筆 INP 才
  24~32ms，presentation 繼承 8ms 量化，這裡的「一致」是在良好區間內的一致，不承載病理論證。
- `fixed-worker`：是 —— presentation ×3。**但該臂本輪離散度 34.5% 判不可重現，
  且上午 session 同一臂是 inputDelay / presentation / inputDelay（`phase1:402, 427-436`，
  另一 session）—— 跨 session 兇手會翻面，臂落在兩種機制的交界上
  （每發序列化 median 56.1ms ÷ 間隔 17ms ≈ 3.3，`broken` 是 111.6 ÷ 17 ≈ 6.6；比值越接近 1，
  代表樣本越對時序敏感，`phase1:430-431` 同構的論證）。該臂維持「不得單獨發表」
  （`phase2:1144`）。**

> `presentation` 繼承 `duration` 的 8ms 量化，會落在 8ms 網格上。
> 對量級對照無影響，只在替兩個都已經很快的方案排名時咬人。
> `blockingDuration` 是整幀的值，**含外殼**，規格上無法拆到單一 script；
> `forcedStyleAndLayoutDuration` 是逐 script 的，所以只有它能乾淨濾掉外殼貢獻。

LoAF 欄的說明：九筆 `records[].forcedSamples` 皆空陣列、`forcedMedian` 皆 null、
`forcedPeak` 皆 0 —— 本標本**沒有強制版面**，寫「無 entry」不寫 0。
九筆 `loafPickedBy` 皆 `"specimenScriptDuration"`＝退回備援路徑選幀，所以
`forcedFn`（broken / fixed-worker 記 `sortOrdersOnClick`、fixed-yield 記空字串）
**不構成任何強制版面證據**；且該備援對「沒有強制版面的標本」有已知選幀缺陷
（`docs/phase2-expected-results.md:547-551`），`specimenScript` 欄（broken 1060.8 / 916.6 /
796.3ms 等）**整欄不可信**，本報告不引用它下任何結論。標本自己記過這條 trip-wire：
同一組條件三輪跑出 72.1 / 1340.9 / 1225.4（`specimens/01-main-thread-block.ts:366-368`）。

#### 治療梯度

| 治療 | INP median（三輪） | 相對病變 | 代價 |
|---|---|---|---|
| 一：切 chunk + `scheduler.yield`（退路 MessageChannel） | 24 / 28 / 32 ms | **32.0×**（896 ÷ 28，同一份 JSON 內的 median-of-three 相除） | `sortMs` 變長：120.5 / 128.5 / 118.4ms vs broken 110.7 / 111.6 / 113.9ms（切段 + 合併的總 CPU 更多，R1 預期方向）；「第一次點擊到看見第十份結果」被拉長 —— `queueDrainMs` 1336.3 / 1287.2 / 1304.5ms、`peakQueueDepth` 9 / 9 / 9；掉幀仍在（`droppedFrames` 53 / 51 / 52 vs broken 69 / 67 / 67）—— 工作沒有消失，只是拆開；`scheduler.yield` 非 Baseline（Safari 沒有，`specimens/01-main-thread-block.ts:389`），走到哪條退路本輪未上報 |
| 二：丟 Web Worker | 608 / 448 / 464 ms | **不作療效宣稱** —— 該臂本輪不可重現（34.5%）且背著對它有利的混淆變因（L1，本輪 `threadSpeedRatio` 3.0~3.1 坐實）。方向上仍低於病變（896 ÷ 464 = 1.9×，此數字僅作為「數值落空」的裁決證據引用，`phase2:1137`） | 序列化仍在主執行緒：`workerSerializeMs` 58.9 / 52.4 / 56.1ms **每發都付**；佇列照樣堆（`inputLagMaxMs` 383~536ms —— 55ms 仍大於 17ms 節拍）；`workerBootMs` 10.4 / 11.9 / 6.6ms；`workerSortMs` 32.2 / 31.9 / 32.0ms **不得當成 4x 條件下的結果發表**（L4，ratio ≈ 3） |

治療版落進雜訊底線時**不報比值** —— 本輪 `fixed-yield` 的 24~32ms 高於 INP 底線 16ms，
32.0× 可報；`fixed-worker` 不在底線內，但被可重現性與混淆變因兩關擋下，一樣不報療效。

同口徑的誠實對照（L2 —— 治療二唯一能與病變直接相除的一對，皆在被節流的主執行緒上）：
`workerSerializeMs` median 56.1ms ÷ `sortMs(broken)` median 111.6ms = **50.3%** ——
治療二把主執行緒的每發成本**降到約一半（2.0×），不是降到 0**。
（上午 session 同口徑是約 44%、2.3×，`phase1:358-359`，另一 session，僅供方向對照。）

兩段治療之間**不排名**（R2）。但 R2 的前提「兩者都會落進良好區間 < 200ms」本輪只有治療一
成立 —— 治療二沒進良好區間不是排名結果，是它未達自己的登記值（見下節）。
一個沒效到登記值的治療比三個有效的更值得寫：治療二的成本沒有消失，
它從「排序」換成「複製」，而複製的那一半還留在主執行緒上
（`specimens/01-main-thread-block.ts:602-616` 的設計說明）。

#### 與登記的差異

逐條對照，三種結局分開寫：

- **符合**（誤差 ≤ 30%）：
  - `broken` INP 4x 500~1500ms（數值欄，`phase1:100` + `:367`）：1028 / 896 / 796ms ✅
  - `broken` `sortMs` 4x 100~240ms（`phase1:99`）：110.7 / 111.6 / 113.9ms ✅
  - `fixed-yield` INP 4x < 80ms（`phase1:102`）：24 / 28 / 32ms ✅
  - `fixed-yield` `sortMs` 比 `broken` 長（`phase1:103`、R1）：三輪逐輪都更長
    （118.4~128.5 vs 110.7~113.9ms）✅ —— R1 說「量到更短就是量測錯了」，沒有發生
  - `fixed-worker` 主執行緒序列化 4x 20~80ms（`phase1:105`）：52.4~58.9ms ✅
  - 比值 `broken / fixed-yield ≥ 5×`（`phase1:107`）：32.0× ✅
- **數值落空**（同方向但差距懸殊）：
  - `fixed-worker` INP 4x **< 50ms**（`phase1:104`）：實測 median 608 / 448 / 464ms ——
    **差一個數量級**。
  - 比值 `broken / fixed-worker ≥ 10×`（`phase1:107`）：實測 **1.9×**。
  - 這兩條懸置到 2026-07-26 晚才有裁決，現行裁決是：**數值落空（差一個數量級），
    且該臂本輪不可重現（34.5%）；在「4x 節流套不到 worker」這個對它有利的混淆變因
    被處理掉之前，這一臂不得單獨發表**（`docs/phase2-expected-results.md:1131-1144`）。
    處置順序照模板：先懷疑量測（混淆變因正是量測環境的），不是先改結論。
- **方向落空**（兇手不同）：
  - 現行登記兇手 `presentation`（`src/specimens.ts:118`）在本輪 `broken` 臂**連「三輪一致」
    都沒過**：presentation / inputDelay / inputDelay。已查明機制 —— 兇手是機器速度的函數，
    機器快到能在排隊的點擊間塞進一次 paint 時，排隊從 `presentation` 浮出來變成
    `inputDelay`（`phase2:1076-1084`）。**登記值不在本報告改，留待下一輪裁決**
    （`docs/HANDOFF.md:49-51`；規矩 2）。注意時序：原登記 `inputDelay` 被上午三輪否證後
    改成 `presentation`，本輪（下午、機器較快）又翻回一半 —— 這支標本的兇手欄
    本身就卡在兩種機制的交界上，這是它現在最重要的教學點，不是缺陷。
- **不可驗證**：
  - `broken` `loaf.specimenScriptDuration` 4x 100~240ms（`phase1:101`）：本輪九筆
    `loafPickedBy` 全是備援路徑，該欄對沒有強制版面的標本不可信
    （`phase2:547-551`，缺陷已知未修）——「不可驗證」，不判符合也不判落空
    （懸置狀態登記於摘要包作業，判準來源 `phase2:549-551`）。
- **登記風險的結局拆開判**（`phase1:369` 一句「風險本身成真」蓋了兩個結局不同的預測）：
  - R4（`intervalMs: null` 不是凍結變因）：**成真**，已依處置第 3 步改 17ms 絕對排程
    （`phase1:309-332`），該節轉為歷史紀錄。
  - R5（離散度全站最高、卡在 30% 線上）：**「全站最高」不成真** —— 本輪全站最高是
    #4 `fixed-observer` 54.5%（`phase2:1071`）；「卡線」對 `broken`（25.9%）接近成真、
    `fixed-worker`（34.5%）越線。R5 與 R4 是兩個預測，結局不同，不得合併判定。

三輪之間另一個不對稱值得記錄：`broken` 的輪內 spread（`records[].stats.spread`，
單輪十筆樣本的離散）從 run1 的 13.2% 逐輪升到 run3 的 42.2%，而 `fixed-worker` 三輪
輪內 spread 都在 73~76% —— 交界機制下代表樣本對時序敏感的直接痕跡，
與跨輪離散度（25.9% / 34.5%）是兩個不同的量，不可混讀。

#### 誠實揭露

**（一）這個標本沒有示範的東西**

- 只示範一種阻塞形狀：click handler 裡對五萬筆物件做多鍵比較排序 + 分區彙總
  （`specimens/01-main-thread-block.ts:125-151`）。大字串 `JSON.parse`、正則回溯、
  同步 XHR、一次建大量 DOM 等其他阻塞源都不在內。
- 治療二示範的**不是「把工作搬走就對了」**：五萬筆物件的結構化複製成本不會消失，
  序列化同步發生在主執行緒的 `postMessage` 那一行（`:602-616, 630-638`）。
  真正治本要換資料表示法（欄式 TypedArray + Transferable 或 SharedArrayBuffer），
  那是另一個標本的題目，本標本沒有做。
- 治療一示範的**不是純粹的「有沒有讓出」**：切 chunk 版換了排序實作
  （4096 筆原生 sort + 逐層合併，`:449-458, 551-600`），總 CPU 更多。
  方向對該臂不利，所以 32.0× 是下界 —— 但它仍是第二個變因。
- `scheduler.yield()` 與 `MessageChannel` 退路沒有分開量，本輪也沒上報走了哪條
  （`:380-402`）。兩者續跑優先權不同，17ms 節拍下「每讓出一次就被新 click 插隊一次」
  正是這個差別會咬人的場景。
- 這一格量的**不是使用者連打**：17ms 是機器節拍，人手約 150ms 一下、大於 S，完全不排隊
  （探針結論 `docs/phase2-expected-results.md:456-467`，該節數字已作廢、結論保留，
  `phase1:374`）。
- 沒有示範「INP 抓到排隊」—— 結構上抓不到。階梯只在標本自報的 `inputLagMaxMs` 顯形，
  那是自報值，不是 Web Vitals 指標。
- `peakQueueDepth` / `queueDrainMs` 是單臂診斷欄位，不可跨臂對照：病變版的隊排在
  瀏覽器事件佇列裡，標本量不到（`:480-482`）。

**（二）已知會讓數字失真的因素**

- **L1：4x 節流套不到 worker 執行緒**，對治療臂有利（`phase1:349-361`）。本輪逐輪實測
  `threadSpeedRatio` 3.0~3.1（≈1 才是同節流率），混淆變因在資料上成立。
  與「切 chunk 額外 CPU 對治療一不利」方向相反，**兩者不會互相抵銷，不可合寫成
  「保守方向」**（標本檔曾那樣寫，已改，`specimens/01-main-thread-block.ts:459-464`）。
- `workerFirstTransferMs`（本輪 79.0~83.0ms）混口徑：跨兩條不同節流率的執行緒（L3）。
  第 k 筆（k>1）的 transfer 幾乎全是佇列等待 —— 第一篇文章把最後一筆讀成
  「搬運比排序貴 20 倍」，該讀法已宣告錯誤（`phase1:375`）。
- LoAF 備援選幀缺陷讓 `specimenScript` / `forcedFn` 欄對本標本不可信
  （`phase2:547-551`，已知未修）。
- 節拍必須絕對排程；護欄是逐輪 `dispatchSpanMs` vs 名目 153ms（本輪最大偏差 0.7ms）。
  相對 sleep 會讓實際節拍變成 `S + I`（`phase1:323-327`）。
- 收斂必須輪詢 `completedSorts`；固定 sleep 的截斷是無聲的，殘工會在下一輪 `reset()`
  時 emit 成非零 `cancelledSorts` 被誤診（`phase1:334-340`、
  `specimens/01-main-thread-block.ts:206-244`）。`cancelledSorts` 語意換過兩次，
  非 0 有三種正確診斷（`:220-238`）。
- **跨 session 絕對值不可比**（`phase1:446-456`）；對治療臂更強一級 ——
  **跨 session 比治療臂的比值也無效**（`docs/HANDOFF.md:46-48`）。本報告引用的上午值
  全部只作方向對照並標明 session。
- 機器負載會讓數字掉分；本輪 `sweep.problems` 為空，且 `phase2:1076-1077` 記錄本輪
  機器比上午快且穩（`sortMs` 輪內抖動 36% → 3%）—— 這正是兇手翻面的環境成因。
- build 保留函式名（`vite.config.ts` 的 keepNames；唯一 click 進入點 `sortOrdersOnClick`
  刻意不包匿名箭頭，`specimens/01-main-thread-block.ts:758-759`）。

**（三）換機器後必須重跑什麼才能沿用結論**

1. 先重跑校準錨點 A（`00-calibration` 按鈕 A：忙迴圈 300ms ⇒ `processing` 應為 300.x）。
   不過這關，下面全部免談。
2. 重新量 1x 的 S（單次同步排序成本）。**綁住 17ms 節拍上界的是 1x 的 S ≈ 25ms**，
   不是 4x 的值（`specimens/01-main-thread-block.ts:15-17`、`phase1:319`）。
   1x 的 S 掉到 17ms 以下，節拍當場失效、事件不再排隊 —— 要改的是 `ORDER_COUNT`
   或節拍，不是結論。
3. 重新量 `threadSpeedRatio`（`calibrationChecksumMatch` 必須為 1）。它決定治療二的
   數字能不能發表；換個 headless 設定就可能從 3 變成 1。
4. 重新讀 `refreshHz`（掉幀門檻由它推導）。
5. 確認 build 開著 keepNames（Vite 8 之後 `output.keepNames` +
   `output.minify.mangle.keepNames`，**worker 是獨立 config 介面要另設一份**，`CLAUDE.md`）。
6. 重跑 `node tools/acceptance.mjs`（13 條全綠），跑前先看 `uptime`。
7. 兩支工具寫死了不同瀏覽器路徑（`tools/acceptance.mjs` 是 `/usr/bin/brave-browser`、
   `tools/reproducibility.mjs:23` 是 `/opt/brave.com/brave/brave`），換機器兩處都要改。
8. **本標本特有**：兇手欄是機器速度的函數（`phase2:1078-1084`）。換機器（或同機不同負載）
   前先算 `sortMs ÷ 17` —— 比值離 1 越近，兇手欄越會跳；上午 ≈ 8 時三輪一致、
   本輪 ≈ 6.6 時已翻面。裁決前不要拿任何單一 session 的兇手欄當結論。

**（四）本輪未做的事**

- 人手複驗 —— **而且刻意不做**。protocol 宣告 `machinePaced: true`，人手做不到 17ms，
  做出來的是另一個實驗（`src/specimens.ts:128-132`）。本標本沒有人手對照組，
  這件事印在面板上，不是寫在心裡。
- 1x 的正式三輪從未跑過；登記的 1x 區間（`phase1:99-105`）至今只有推導與探針支撐。
- `?validate=1` 的 web-vitals 對帳未納入本輪三輪。
- `inputLagMaxMs` 只上報 max，斜率算式沒有被逐發驗證（本報告只做了端點檢核）。
- `fixed-worker` 的兩個懸案未處置：兇手交界問題（處置順序登記在 `phase1:433-436`，
  本輪不動）與「明文例外 vs 換同口徑實作」的裁決（`phase1:386-388`）。
- 護欄計數器（`cancelledSorts` / `staleWorkerReplies` / `clicksReceived`）的判準
  沒有任何一行程式在自動檢查，只有 `drainSignal` 與 `snapshot.mode` 有
  （`tools/reproducibility.mjs:634-646`）；「本輪開始時也必須是 0」那一半
  （`specimens/01-main-thread-block.ts:236`）完全沒人執行。
- 讓出路徑（`scheduler.yield` vs `MessageChannel`）沒有分開量、也沒上報本輪走哪條 ——
  換瀏覽器會安靜地換機制而數字看起來還是同一個 mode。
