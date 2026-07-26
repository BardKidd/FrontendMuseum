# 病理報告 · 04 事件處理未節流

> **引用約定**（本檔所有數字都必須能循此找到出處）：
> `records[mode,run].欄位` 指 `docs/measurements/2026-07-26-reproducibility-4x-5.json`
> 內 `specimenId = "04-unthrottled-events"` 的那 12 筆（正典檔，`isFullSweep: true`、
> `problems: []`）。`phase2:N` 指 `docs/phase2-expected-results.md` 第 N 行；
> 行號會漂，引用時連同內容一起引（phase2:1199 的教訓）。
> `04.ts:N` 指 `specimens/04-unthrottled-events.ts` 第 N 行。
>
> **判準凍結聲明**：依 phase2:1164（§四）與 phase2:1334-1338（追記「生效範圍」），
> #4 的比值判準對本份 JSON **不回溯適用**。本報告對臂間關係**只報方向與絕對值**，
> 不寫「通過／未通過比值判準」。新判準（`broken / fixed-raf ≥ 2×`，phase2:1267）
> 自下一輪量測起才生效。

### 04 事件處理未節流（Unthrottled Event Handlers）

**病症一句話**：CDP 以「十拍、每拍連滾三格滾輪」驅動 8000 列清單捲動時，
每次 scroll / wheel 事件都做一整輪 8000 次 `getBoundingClientRect()`（每趟約 36ms，4x），
5 秒量測窗內掉幀峰值 **99~119 幀**（約佔 300 幀窗的三分之一）；把計算移進 rAF 後
掉幀約砍半再多一點（median 113 → 42），換成 `IntersectionObserver` 後剩 10~16 幀 ——
但該臂本輪 unstable，絕對值不可靠。

> ⚠️ 這些絕對值是本 session、本機、4x 宣告節流下的值。未飽和臂的掉幀數
> 是機器速度的函數（phase2:1280、phase2:1085-1090 在 #6 上的同型證據），
> 跨 session 只有方向可信，絕對值不可比（phase2:944-945）。

#### 凍結條件

同一組條件之間才能比較。任何一項改動，先前所有數字作廢。

| | |
|---|---|
| CPU throttle | **4x —— 宣告值**，JS 偵測不到（`records[*].cpuThrottle`；sweep 頂層 `cpuThrottlingRate: 4`） |
| 驅動方式 | CDP 機器驅動（sweep 頂層 `driver`：`Input.dispatchMouseEvent`，非人手） |
| viewport | 800 × 600（`src/specimens.ts:299` 的 `FROZEN_VIEWPORT`） |
| refreshHz | 60（`records[*].refreshHz`，12 筆皆同）→ 5 秒窗約 300 幀 |
| 操作程序 | wheel 連滾 **3 格**（每格 deltaY 120，`tools/reproducibility.mjs:166,187,341`）× **10 拍** · 間隔 500ms **絕對排程**（`src/specimens.ts:283-296`） |
| 節拍護欄 | `dispatchSpanMs` 4999.5 ~ 5014.9（名目 5000，`records[*].dispatchSpanMs` / `dispatchSpanNominalMs`）——最大偏差 0.3%，節奏側 channel（phase2:601-611 的缺陷 C）未復發 |
| buildId | `0.1.0-ms191c71`（`records[*].buildId`，12 筆皆同） |
| protocolVersion | **records 未帶此欄**（本份 JSON 的 record 結構內沒有它，不編造） |
| 負載規模 | N = 8000 列（`04.ts:54`；登記值 2000，經 phase2:342-359 校準，內容總高現行有效值 384,000px，phase2:1110） |

#### 動工前登記的預期

> 登記出處：原始登記 `phase2:59-122`（2026-07-25）；重新設計後的再登記
> `phase2:624-633`（2026-07-26）；判準定案追記 `phase2:1267-1283`（同日稍晚）。
> **這一節不准回頭改去迎合實測。** 修正只在該檔「修正紀錄」追加，此處照錄並標注作廢狀態。

- **主指標**：原登記 `custom.droppedFrames`（phase2:100）；**現行有效值是
  `custom.droppedFramesPeak`**（裁決紀錄 phase2:1109；`src/specimens.ts:270`）。
  兩者**不是同一個量**——不用峰值的話跨輪比的是「你多久之後按重跑」（`src/specimens.ts:268-269`）。
- **兇手宣告**：`loaf`，不是 INP——捲動不產生 `interactionId`，INP 欄空是規格不是缺陷
  （phase2:107-108；`src/specimens.ts:277`）。⚠️ 但依 phase2:1174（§五），
  `loaf` 這個登記值**從未被任何判準驗證過**（判準值域只涵蓋 INP 三段）。
- **比值預期的沿革（全部照錄）**：
  - `≥ 4×`（`broken / fixed-raf`，phase2:110 原始登記）—— **作廢**（phase2:1277，從未寫過推導來源）
  - `≥ 3×`（phase2:631 重新登記時括號內順帶寫的）—— **作廢**（同上）
  - `fixed-raf` 掉幀峰值 **≈ 20 幀** 絕對錨（phase2:631）—— **作廢**（phase2:1278-1280：
    上午三輪 52~54、下午三輪 37~48，兩次獨立掃描都在 2 倍以上之外；
    未飽和治療臂的絕對錨只適用於飽和臂或零臂）
  - 現行判準 `≥ 2×`（phase2:1267，附推導與邊際聲明）——**生效於下一輪起，對本份 JSON 不回溯**
- **`fixed-passive`**：方向性判準「**不得優於** `broken`」（phase2:630）；
  預期掉幀量到一個**零改善**，因為本站的掉幀尺量的是主執行緒出幀節奏，
  passive 買到的是 compositor 側收益，**這把尺結構上看不見它**（`04.ts:33-37`）。
- **`fixed-observer`**：≈ 1 幀（phase2:632），只與 `broken` 比；
  `fixed-raf` 與 `fixed-observer` 之間**不排名**——現行理由是「兩臂不共用任何變因」
  （phase2:637-639；括號裡的舊理由已作廢）。
- **護欄登記**：`broken` 的 `passes` 20~60、`passes ≈ 30` 屬預期內不作廢（phase2:628-629）；
  `wheelCancelableCount` 需先確認 `broken` > 0（phase2:633）；
  四臂刺激對帳走 `wheelDeltaTotal` 與 `scrollTop`，不走 `wheelEvents`（`04.ts:117-134`）。
- **登記在案的風險**：N=2000 的乾淨 layout 讀取太便宜撐不起病變（phase2:115-118，
  **已成真**並校準到 8000，phase2:342-359）；scroll 事件本來就每幀最多一次（phase2:119-120）；
  burst 合併使刺激量變成負載的函數（phase2:613-622 缺陷 D 的護欄）。

#### 實測

三輪，同一組凍結條件。**離散度算在每輪的主指標終值上，不是 max**——
`protocol.ts:290`：「抗離群。可重現性判定用這個，不用 max」。
相對離散度 = (max − min) ÷ median-of-three（每格都按此式計算）。
主指標 `custom.droppedFramesPeak`；本輪協定十拍 × 500ms 正好填滿 5 秒滾動窗，
所以每筆 `droppedFrames`（終值）與 `droppedFramesPeak` 逐筆相等。

| mode | 三輪掉幀峰值 | 相對離散度 | 絕對全距 | 判定 |
|---|---|---|---|---|
| `broken` 每次事件全掃 | 119 / 113 / 99 | 17.7% | 20 幀 | ✅ 可重現 |
| `fixed-passive` 只翻 passive | 116 / 112 / 105 | 9.8% | 11 幀 | ✅ 可重現 |
| `fixed-raf` rAF 節流 | 48 / 42 / 37 | 26.2% | 11 幀 | ✅ 可重現 |
| `fixed-observer` 換 IntersectionObserver | 11 / 16 / 10 | **54.5%** | **6 幀** | ❌ **unstable（擦線）** |

（出處：`records[mode,run].custom.droppedFramesPeak` 全 12 筆；
`fixed-observer` 的 54.5% 與 phase2:1071 的補記逐字一致。）

判準：相對離散度 ≤ 30%，**或**絕對全距在雜訊底線內（掉幀底線 5 幀，phase2:448-454）。
`fixed-observer` 全距 6 幀比底線多 1 幀、離散度 54.5% 超過 30%——**兩條都沒過，擦線判 unstable**。
絕對差 6 幀是 300 幀窗的 2%，屬於「治療越有效越判它不可重現」的已知型態
（phase2:878-880 在上午資料上的同一裁定：判準就是判準，不因為擦線就放它過）。

**護欄逐項（全部在正典 JSON 內部核對）：**

| 護欄 | broken | fixed-passive | fixed-raf | fixed-observer |
|---|---|---|---|---|
| `rectReads ÷ passes` | 8000 / 8000 / 8000 | 8000 / 8000 / 8000 | 8000 ×3 | —（rectReads = 0） |
| `wheelDeltaTotal`（px） | 3600 ×3 | 3600 ×3 | 3600 ×3 | 0（**必為 0**：不掛 wheel listener，`04.ts:133`） |
| `scrollTop` 終值（px） | 3600 ×3 | 3600 ×3 | 3600 ×3 | **3600 ×3** |
| `wheelCancelableCount` | 21 / 20 / 20（> 0） | 0 ×3 | 0 ×3 | 0 ×3 |
| `rafSkipped` | 0 ×3 | 0 ×3 | **20 / 20 / 22** | 0 ×3 |

- **每事件工作量逐位元相同**：`broken` 與 `fixed-passive` 的 `rectReads ÷ passes`
  兩臂九筆全部**恰好 8000**（如 `records[broken,run1]`: 328000 ÷ 41；
  `records[fixed-passive,run3]`: 328000 ÷ 41）。這是撤銷「passes 必須逐輪相等」之後
  改立的護欄（phase2:882-892），在本份 JSON 上成立。
- **刺激守恆**：名目刺激 10 拍 × 3 格 × 120px = 3600px；四臂 `scrollTop` 終值皆 3600
  （`fixed-observer` 靠這一欄對帳，`04.ts:190-193`）。`wheelEvents` 20~22 ≠ 30
  ⇒ burst 合併**發生了**，但 delta 守恆、刺激相同——與 phase2:900-901
  「合併成真、屬預期內不作廢」同一機制。
- **旗標證據（單向）**：`broken` 三輪 `wheelCancelableCount` > 0 ⇒ 該臂確定非 passive；
  治療臂的 0 依 `04.ts:90-114` **不做反向解讀**。附帶觀察：`broken` 的計數
  三輪都**等於** `wheelEvents`（21/21、20/20、20/20）——註解預期的 wheel latching
  （burst 第 2、3 格變不可取消，`04.ts:96-98`）在本機這組條件下**沒有出現**；
  判準寫成「> 0」而非「= wheelEvents」因此沒有被咬到。
- **閘門真的動了**：`fixed-raf` 的 `rafSkipped` 20 / 20 / 22，
  且逐輪滿足 `wheelEvents + scrollEvents − rafSkipped = passes`
  （run1: 20+14−20=14；run2: 21+13−20=14；run3: 22+14−22=14）。
  舊設計「閘門一次都沒觸發」（phase2:591-594）已被修法（一拍三格）解決。

**另計（非主指標）**：INP 12 筆皆無互動樣本（`records[*].totalInteractions` = 0、
`inp` = null——未量測，規格排除捲動）；LCP 12 筆逐位元相同（728ms，元素 `p`，
`records[*].lcp`）——A 類不重載 document，這是首載定格值，不隨 mode 變，
**不構成臂間比較項**；CLS 12 筆皆 null = **無 entry**（不是量到 0）。

#### 兇手歸因

| | broken | fixed-passive | fixed-raf | fixed-observer |
|---|---|---|---|---|
| inputDelay | 未量測（無互動樣本） | 未量測 | 未量測 | 未量測 |
| processing | 未量測 | 未量測 | 未量測 | 未量測 |
| presentation | 未量測 | 未量測 | 未量測 | 未量測 |
| LoAF forcedPeak（僅標本 script） | **548.7** / 2.9 / 2.8 ms | 3.5 / 3.5 / 3.6 ms | 1.9 / 1.2 / 1.5 ms | 無 entry / 0 / 無 entry |
| loafPickedBy | forcedStyleAndLayout ×3 | forcedStyleAndLayout ×3 | forcedStyleAndLayout ×3 | none / specimenScriptDuration / none |
| sourceFunctionName | **（空字串）** / `scanOnEveryScroll` / `scanOnEveryWheel` | `scanOnEveryScroll` / `scanOnEveryWheel` / `scanOnEveryScroll` | `scanOnAnimationFrame` ×3 | 無 entry ×3 |

（出處：`records[mode,run].forcedPeak` / `.forcedFn` / `.loafPickedBy`。
INP 三段皆 null——依模板前言寫「未量測」，不寫 0。）

三輪兇手段是否一致：**INP 三段無資料可判**——這不是缺陷，是本標本的規格
（捲動不產生 `interactionId`，phase2:107-108）。登記的兇手 `loaf` 依 phase2:1174
從未被判準機制驗證，本報告的歸因**走掉幀 + 護欄計數器**，LoAF 只是佐證：

- **病根不是強制重排**：三個有 listener 的臂 `forcedPeak` 只有 1.2~3.6ms
  （唯一例外見下），與 #3 的數百 ms 差兩個數量級。捲動不弄髒版面，
  8000 次 rect 讀的是乾淨 layout——由 `lastPassMs` 粗估單價 ≈ 36ms ÷ 8000 ≈ **4.5µs/次**（4x，
  推導值，取 `records[broken,run2].custom.lastPassMs` = 36.2），與登記時量的
  0.9µs/次（1x，phase2:353）同量級。**病是「每事件 O(N) 的 handler 時間」本身**，
  證據通道是掉幀，不是 forced layout。
- **`keepNames` 的歸因鏈成立**：8 筆 forcedFn 指向標本自己的函式
  （`scanOnEveryScroll` / `scanOnEveryWheel` / `scanOnAnimationFrame`），
  且該 8 筆 `loafPickedBy` 皆為 `forcedStyleAndLayout`——依規則
  （模板 :207、簡報鐵律 6）這些幀才算數。`fixed-observer` 兩輪 `loafPickedBy: none`
  = 無 LoAF 幀；run2 是備援路徑（`specimenScriptDuration`）選出的 0ms 幀，
  **不構成「有強制版面幀」的證據**。
- ⚠️ **一筆不成比例的離群**：`records[broken,run1].forcedPeak` = 548.7ms、
  `specimenScript` = 610.1ms、`forcedFn` = **空字串**——量級是同臂其他輪的
  約 190 倍，且該輪主指標（119）與 run2（113）同帶，看不出對應的掉幀代價。
  疑似首載／進臂殘留幀停留在面板「最近六幀」緩衝內被選中（該選幀機制
  phase2:549-551 記過同型缺陷、phase2:1184-1186 稱已修，但此筆型態相同）。
  **不作為歸因證據**，已列入回報主執行緒的待複核清單。

> `presentation` 繼承 `duration` 的 8ms 量化、`blockingDuration` 含外殼——
> 這兩條模板警語對本標本**無用武之地**（INP 段全部未量測），照錄以示未刪節。

#### 治療梯度

**梯度形狀先講清楚**（`04.ts:19-28,366-385`）：前三臂是同一機制下的**三格變因隔離**
（broken → 只翻 passive 旗標 → 只翻「計算在哪裡跑」），第四臂是**換機制**，
與前三臂不共用任何變因，只與 `broken` 比，不與 `fixed-raf` 排名（phase2:637-639）。

| 治療 | 掉幀峰值（三輪 / median） | 相對病變（方向與絕對值） | 代價 |
|---|---|---|---|
| 一 `fixed-passive` 只翻 `passive: true` | 116 / 112 / 105（112） | **無改善**：median 113 → 112，臂間差 1 幀，遠低於底線 5 幀 | 承諾不 `preventDefault()`；換到的是本尺量不到的 compositor 側收益 |
| 二 `fixed-raf` 計算移進 rAF | 48 / 42 / 37（42） | **改善**：113 → 42，比值 2.7×（113 ÷ 42 = 2.69）；`passes` 41→14、`rectReads` 328k→112k | 計算晚一幀（pending 狀態管理）；每次執行仍是全量 8000 次讀取 |
| 三 `fixed-observer` 換機制 | 11 / 16 / 10（11） | **方向大幅改善、絕對值不可靠**：median 比 10.3×（113 ÷ 11），但該臂 unstable（54.5%）；最保守配對 99 ÷ 16 = 6.2× | 換掉整個機制：`rectReads` 歸 0，但回呼語意變了（只報跨界列）；進臂要跑 8000 次 `observer.observe()` |

- **治療一的「零」就是它的結論**（`04.ts:383-385`）：工作量護欄證明兩臂每事件
  做逐位元相同的事（8000 rect/事件），掉幀差 1 幀在雜訊內。這正是登記預期
  「passive 解決捲動被阻塞，不解決 handler 太重」的實測形狀。
  ⚠️ 上午另一 session（`2026-07-26-reproducibility-4x.json`，經 phase2:870,894-896 引用）
  同一對臂是 119 → 122（劣 3 幀）——**兩次掃描的 1~3 幀差方向相反**，
  進一步佐證這對臂的差就是雜訊，不是效果。
  另：上午資料裡「passive:false 壓低 scroll 事件數」的機制（phase2:885-889，34 vs 40）
  在本份 JSON 幾乎不可見（`scrollEvents` 20/20/18 vs 20/21/21）——該機制的振幅
  也是機器狀態的函數。
- **治療二**未落進雜訊底線（37~48 遠高於 5 幀），比值可報：**2.7×**。
  與追記自己引的「下午 2.69×」（phase2:1275）一致。依判準凍結聲明，
  此處**不宣稱**它相對任何一條比值判準的通過與否。
- **治療三**的比值以 unstable 臂為分母，只宣稱「量級在一位數十倍上下、方向確定」
  ——三輪最差值 16 對病變最好值 99 仍有 6.2×，方向不靠離散度成立。
  `visibleRows` 該臂是 5/8/8 而非其他臂的 10（`records[fixed-observer,*].custom.visibleRows`），
  因為 `onIntersect` 數的是**本次跨界的列**不是全量可見列（`04.ts:343-351`）——
  功能語意與前三臂不同，這也是「換機制」不排名的一部分。

無效的治療照實寫：**治療一在主指標上無效，而這個無效是登記在案的預期結論**——
一個沒效的治療比三個有效的更值得寫，它說明 passive 的成本假設落在讀者以為的位置以外。

#### 與登記的差異

- **符合**：
  - `broken` 的 `passes` 38~41（`records[broken,*].custom.passes`）落在登記帶 20~60
    （phase2:628）。
  - burst 合併預期成真：30 格派送、20~22 個 wheel 事件、delta 守恆 3600
    ——登記明寫「passes ≈ 30 屬預期內、不作廢」（phase2:629），照登記處理。
  - `wheelCancelableCount` 護欄：`broken` > 0 成立（21/20/20），無假警報（phase2:633,904-905）。
  - 「刺激量變成負載的函數」的風險未觸發：四臂 `scrollTop` 終值相同（3600）、
    三個 listener 臂 `wheelDeltaTotal` 相同（3600），跨臂比較的前提成立（phase2:620-622）。
  - 治療一零改善的預期成立（見治療梯度）。
- **數值落空**（同方向但差距大）→ 先懷疑量測，不是先改結論：
  - `fixed-raf` 37~48 幀對已作廢的 ≈ 20 幀錨——**已由追記裁定為推導錯**
    （用舊刺激量推的，一拍三格把工作量變三倍，phase2:874-875,1278-1280），此處不重判。
  - `fixed-observer` 10~16 幀對登記的 ≈ 1 幀（phase2:632）——差一個數量級，
    上午資料已判 ❌（phase2:872），本份 JSON 同型。該錨**未被追記正式作廢**，
    但追記的作廢理由（絕對錨只適用於飽和臂或零臂，phase2:1280）同樣適用於它——狀態懸置，
    已列入回報主執行緒的清單。
  - 舊 4x 掉幀帶 60~250（phase2:100）：本輪 99~119 落在其中，但那條帶登記於
    一拍一格＋`droppedFrames` 時代，刺激量已 ×3、主指標欄位已換
    （phase2:1109），**落在帶內不構成驗證**，只照錄。
- **方向落空**：無。四臂順序 `broken`(113) ≥ `fixed-passive`(112) > `fixed-raf`(42) >
  `fixed-observer`(11) 與登記的方向敘事一致。
  ⚠️ 一條**字面邊界**要記：方向性判準「`fixed-passive` 不得優於 `broken`」（phase2:630）
  沒有寫雜訊容忍帶，而本份 JSON 的 median 恰好 112 < 113——嚴格字面上「優於」1 幀，
  實質上遠低於 5 幀底線。本報告**不裁決**（判準凍結 + 差在雜訊內），
  但這條判準下一輪就會再遇到同一題，已列入回報清單。

處置順序照模板：① 查環境（本輪 `dispatchSpanMs` 全部貼著名目、sweep `problems: []`，
無環境異常記錄）② 換更精確的驅動方式（絕對排程已是現行）③ 動 protocol——本輪不需要。

#### 誠實揭露

- **這個標本沒有示範的東西**：
  - passive 真正買到的 compositor 側收益。本站的掉幀尺是主執行緒 rAF 迴圈，
    **結構上看不見它**（`04.ts:33-37`）——治療一的「零」是儀器解析度邊界上的結論，
    不是「passive 無用」的證明。
  - 觸控裝置上的 `touchstart` / `touchmove`（只示範了 wheel）；真人手勢
    （CDP 的 wheel burst 是等間隔機器刺激）。
  - INP 維度的任何結論（規格排除捲動，12 筆互動樣本數皆 0）。
- **已知會讓數字失真的因素**：
  - 未飽和臂的掉幀絕對值是機器速度的函數；本輪 `broken` 99~119、佔窗 33~40%，
    兩臂皆未飽和是新判準的適用前提（phase2:1272-1273），但**本報告不執行該判準**。
  - `fixed-observer` 進臂成本（8000 次 `observe()`）曾把切換殘幀記到該臂帳上，
    修法（`frames.reset()` 重設 `#last`）方向對治療臂不利、結論不翻轉（phase2:558-563）。
  - `records[broken,run1]` 的 548.7ms LoAF 離群幀（見兇手歸因）——不影響主指標，
    但該欄位在這一筆上不可信。
  - 捲動容器一旦被推出 iframe 摺線，四臂計數器會**靜默歸零**（`04.ts:486-499`）；
    本輪四臂 `scrollTop` 皆 3600，證明未發生。
  - B 類前導污染與 #4 無關（A 類不重載 document，phase2:1048-1049）。
- **換機器後必須重跑什麼才能沿用結論**：全部四臂重量（未飽和臂絕對值不可搬），
  並先確認 `broken` 未飽和（`droppedFramesPeak < 0.8 × 窗幀數`，窗幀數由實測 refreshHz 推導）；
  依站規另需先重跑校準錨點 B 重新校準單位成本（`docs/phase1-expected-results.md` 登記的機器相依性）。
- **本輪未做的事**：人手複驗（`protocol.instruction` 的「連滾三格」全程由 CDP 代打）；
  web-vitals 對帳（`?validate=1`）；`fixed-observer` unstable 的複跑裁決；
  LCP 標的（裸 `p`，728ms ×12）未逐臂確認是哪一個 `p`——A 類首載定格、非比較項，
  但元素身分未查。
