# Phase 2 預期結論與量級（動工前登記）

> 規矩與 `phase1-expected-results.md` 完全相同，不重述：
> **這份文件必須在量測之前寫完、之後不准回頭改去迎合實測。**
> 要改就在檔尾「修正紀錄」追加並寫明理由，原始預期留在上面不動。
>
> 判定規則同樣照 `spec:1356-1358`：差 30% 以內接受、差一個數量級先懷疑量測、
> 方向相反代表發現了更好的題材。通過條件同樣是 §1 原則 4 的三條
>（同一量級帶 / 兇手段一致 / 離散度 ≤ 30%）。

登記日期：2026-07-25
登記時的狀態：Phase 0 驗收 13/13、標本 #1 與 #3 已完成、
**量測層剛補上 LCP / CLS / droppedFrames 與校準 C / D**。

---

## 先記四個錨點（這些預期不是猜的）

| 錨點 | 內容 | 實測 |
|---|---|---|
| **A** 忙迴圈 | 設 300ms | `processing` = 300.6ms（誤差 0.2%）|
| **B** 強制版面 | M=200、600 子元素 | 62~76ms → 每次約 0.31~0.38ms |
| **C** CLS 解析解 **（本次新增）** | impact × distance = **0.0159** | 實測 **0.015924**，誤差 **0.15%** |
| **D** LCP 排程 **（本次新增）** | 標的排程 1500ms 出現（實際寫入 DOM 於 1529ms）| 實測 LCP **1552ms**，繪製延遲 +23ms |
| **E** 標本 #3 | 800 列交替讀寫 | forced layout 187ms → 每次強制重排約 **0.23ms**（800 列的 DOM）|

錨點 C 與 D 是這一批標本的地基：**它們證明 CLS 與 LCP 這兩個新觀測器本身是對的**，
所以下面標本 #2 / #5 量出來的數字若不合預期，該懷疑的是標本設計，不是量測層。

校準 D 順帶挖出一條會反覆咬人的規則，**標本 #2 與加碼 #7 動工前必須先知道**：

> **Chrome 把每像素位元數低於 0.05 bpp 的圖片排除在 LCP candidate 之外。**
> 第一版校準 D 用 SVG data URI（約 0.007 bpp），LCP 靜默選了頁首的一個 `<p>`，
> 面板上顯示 128ms —— 一個看起來完全合理、但量的根本不是那張圖的數字。

---

## 共同的量測條件

- 4x 節流那組數字：DevTools 設定 + 面板下拉宣告，兩邊都要
- viewport **800×600**，但**實際內部寬度是 785**（垂直捲軸吃掉 15px）。
  校準 C 就是靠現場讀 `clientWidth` 才對上解析解的 —— 這批標本一律不准寫死 800
- build 產物（`npm run measure`），不是 dev server
- A 類切 mode 不重載；B 類（#2、#5）切 mode **一定重載**

### 登記在案的量測層缺口（動工前就知道，不是事後補記）

**`finalizeRun()` 目前在 `samples.length === 0` 時直接 return。**
標本 #4 / #6 的主指標是 `custom.droppedFrames`，而捲動與 wheel **不會產生 `interactionId`**
（INP 依規格排除捲動），所以這兩個標本會一筆 INP 樣本都沒有 ——
照現況它們的「三輪」永遠不會進歷史，§1 原則 4 根本無從判定。

處置：`RunResult` **加欄位不改語意**（`protocol.ts` 的凍結規則允許），
補上本輪的 `customFinal` / `lcpFinal` / `clsFinal` 終值快照，
並讓沒有互動樣本、但有 custom / LCP / CLS 的一輪也能入帳。

---

## 標本 #4 — 事件處理未節流

### 動工前必須先讀的陷阱（`spec:1089`）

**Chrome 對掛在 `window` / `document` / `document.body` 上的 `touchstart` / `touchmove` / `wheel`
預設就是 passive。** 照直覺寫，病變版與治療版會量到一樣的數字。
所以本標本的 listener **一律掛在具體的捲動容器元素上**，不是 window/document/body。

另一條要講明的：**`scroll` 事件不可 cancel，對它加 `passive` 是 no-op。**

### 登記的設計參數

| 參數 | 值 | 理由 |
|---|---|---|
| 捲動容器 | `div`，高 400px，`overflow-y: auto` | 具體元素，避開 Chrome 的預設 passive |
| 列數 N | **2000** | 每次 scroll 事件的工作量 = N 次 `getBoundingClientRect()` |
| 每列高度 | 48px | 內容總高 96,000px，捲得動 |
| 病變 handler 的工作 | 對 N 列各讀一次 `getBoundingClientRect()`，算可見比例 | **迴圈裡只讀不寫** |
| wheel listener | `{ passive: false }` + 同步工作 | 直接阻塞捲動 |

**「迴圈裡只讀不寫」是刻意的**：迴圈內若同時寫入，這個標本就變成標本 #3（強制同步版面重排），
兩個標本的病因會糊在一起。這裡要展示的是**頻率 × 每次的工作量**，不是讀寫交替。
所以寫入一律在迴圈結束後做一次。

### 四段模式（每一段只翻動一個變因）

| mode | 與前一段的唯一差別 |
|---|---|
| `broken` | scroll 每次事件算 N 次 rect；wheel `{passive:false}` |
| `fixed-passive` | **只**把 wheel 改成 `{passive: true}` |
| `fixed-raf` | 再加上：scroll handler 只記 `scrollTop`，計算移到 rAF，每幀最多一次 |
| `fixed-observer` | 改用 `IntersectionObserver`，**完全不掛 scroll listener** |

`fixed-passive` 存在的唯一理由是**證明 passive 不夠**：它解決「捲動被 handler 阻塞」，
不解決「handler 本身太重」。少了這一段，讀者會以為加個 `{passive:true}` 就沒事了。

### 預期值

| mode | 指標 | 1x 預期 | 4x 預期 |
|---|---|---|---|
| `broken` | 每次 scroll 事件的 handler 耗時（自報） | 8~30ms | 30~120ms |
| `broken` | **`custom.droppedFrames`（5 秒窗）** | **20~120** | **60~250** |
| `broken` | `loaf.blockingDuration` 代表幀 | 50~150ms | 150~600ms |
| `fixed-passive` | droppedFrames | 15~110（**只小幅改善**）| 50~230 |
| `fixed-raf` | droppedFrames | **< 15** | < 40 |
| `fixed-observer` | droppedFrames | **< 5** | < 15 |
| `fixed-observer` | 每次 scroll 的 rect 呼叫數 | **0** | 0 |

**兇手宣告**：`loaf`（不是 INP —— 捲動不產生 `interactionId`，這個標本的面板 INP 欄會是空的，
那不是壞掉，是規格如此）。

**比值預期**：`broken / fixed-raf` 的 droppedFrames **≥ 4×**。
`fixed-raf` 與 `fixed-observer` 之間**不排名**（兩者都會落進「幾乎不掉幀」）。

### 最可能出錯的地方

1. **N=2000 的 rect 迴圈太便宜，掉不了幀。** 捲動不弄髒版面，所以這 2000 次讀取讀的是
   乾淨的 layout，**不會像標本 #3 那樣每次都強制重算** —— 錨點 E 的 0.23ms/次在這裡不適用，
   實際單價可能低一到兩個數量級。若量到病變版幾乎不掉幀，**先調 N（那是校準）**，
   調完記一筆。這是本標本最可能發生的偏差。
2. **scroll 事件本來就被瀏覽器對齊到每幀最多一次**，所以「節流」的收益可能比直覺小；
   真正的收益來自 rAF 版把工作挪出事件派送路徑，以及 observer 版把 O(N) 變成 O(變動數)。
3. **wheel `{passive:false}` 在程式化捲動下不會觸發** —— CDP 派送的是 `Input.dispatchMouseEvent`
   的 wheel 才算，用 `element.scrollTop = x` 完全不會有 wheel 事件。

---

## 標本 #6 — 高頻資料流造成的 re-render 風暴

全案最有原創性的一個（`spec:1136`）。

### 登記的設計參數

| 參數 | 值 | 理由 |
|---|---|---|
| 裝置數 | **200** | 照 spec 原文 |
| 推送間隔 | **50ms** | 照 spec 原文，每秒 20 批 |
| 每批更新的裝置數 | **40**（200 的 20%） | 要夠多才看得出「整表重繪 vs 只改變動的」差別 |
| 資料來源 | 固定種子的假 WebSocket（`setInterval`） | 真 WebSocket 會把網路變異灌進量測 |
| 量測窗 | 按下「開始推送」後 **10 秒** | droppedFrames 是 5 秒滾動窗，10 秒足夠讓它填滿兩次 |

### 四段模式

| mode | 做法 |
|---|---|
| `broken` | 每次推送直接重建整張 200 列的 DOM |
| `fixed-batch` | 50ms 內的多筆更新合併，用 `requestAnimationFrame` 對齊幀率上限 |
| `fixed-granular` | 再加上：只改真正變動的那幾個文字節點，不重建列 |
| `fixed-backpressure` | 再加上：推送速率超過渲染能力時丟棄中間狀態，只渲染最新值 |

### 預期值

| mode | 指標 | 1x 預期 | 4x 預期 |
|---|---|---|---|
| `broken` | **`custom.droppedFrames`（5 秒窗）** | **60~250** | **150~290**（接近上限：5 秒內幾乎每幀都掉）|
| `broken` | 每次推送的渲染耗時（自報） | 8~40ms | 30~160ms |
| `broken` | `loaf.blockingDuration` 代表幀 | 30~120ms | 100~400ms |
| `fixed-batch` | droppedFrames | 5~40 | 20~120 |
| `fixed-granular` | droppedFrames | **< 10** | < 30 |
| `fixed-backpressure` | droppedFrames | **< 5** | < 15 |
| 全部 mode | 實際渲染的批次數 / 收到的批次數 | broken = 1.0；backpressure **< 0.5** | 同 |

**兇手宣告**：`loaf`。同樣沒有 INP 樣本（沒有使用者互動）。

**比值預期**：`broken / fixed-granular` 的 droppedFrames **≥ 6×**。

### 最可能出錯的地方

1. **`droppedFrames` 有上限。** 5 秒窗 × 60Hz = 300 幀，所以這個數字最多 ~299。
   病變版在 4x 下很可能撞到天花板，**兩個病變版之間就分不出高下** ——
   那不是量測錯，是這個指標本來就會飽和。所以同時上報「渲染耗時」與「渲染批次數」，
   飽和時靠它們說話。
2. **背壓版丟棄中間狀態 = 它顯示的資料在某些瞬間不是最新的。**
   這是真實的取捨，不是免費的勝利，文章必須寫出來，面板也要把「丟棄批次數」上報。
3. **`setInterval(50ms)` 在主執行緒卡住時會累積補償性回呼**，於是病變版會在一次卡頓後
   突然連續收到好幾批 —— 這會讓「收到的批次數」超出 20/秒。那是真實現象（真的 WebSocket
   也是這樣塞回來的），但它會讓「每批耗時」的平均值失真，所以兩個數字都要上報。

---

## 標本 #2 — 長列表未虛擬化（B 類）

### 登記的設計參數

| 參數 | 值 | 理由 |
|---|---|---|
| 列數 | **5000** | 照 spec 原文 |
| 每列內容 | 一個字母方塊 + 三行文字 + 兩個 badge | 照 spec 的「頭像、多行文字、幾個 badge」|
| **「頭像」不用圖片** | 用 CSS 上色的字母方塊 | 見下方 |
| `contain-intrinsic-size` | `auto 120px` | 照 spec：瀏覽器記住上次實際尺寸，比寫死猜測值準 |
| 虛擬滾動 buffer | 可視範圍 ± 5 列 | |

**「頭像」刻意不用圖片**，理由是校準 D 挖出來的那條規則：低熵圖片（< 0.05 bpp）
會被排除在 LCP candidate 之外。5000 個純色頭像佔位圖不但拖慢載入，還完全不會成為 LCP ——
於是「LCP 被長列表拖累」這個主張會量不到。要用真圖片就得自架一張有內容的照片，
那是加碼 #7 的題目。這裡改用文字，LCP 標的自然落在第一屏的列上。

### 三段模式（B 類，每次切換都重載）

| mode | 做法 |
|---|---|
| `broken` | 一次渲染 5000 列 |
| `fixed-content-visibility` | 加一行 `content-visibility: auto` + `contain-intrinsic-size: auto 120px` |
| `fixed-virtual` | 真虛擬滾動，只渲染可視範圍 ± 5 列 |

### 預期值

| mode | 指標 | 1x 預期 | 4x 預期 |
|---|---|---|---|
| `broken` | **LCP** | 400~1200ms | 1200~4000ms |
| `broken` | `custom.domNodeCount` | **~35,000**（5000 列 × 約 7 節點）| 同 |
| `broken` | INP 的 presentation 段（捲動後點擊）| 30~120ms | 100~400ms |
| `fixed-content-visibility` | LCP | **降 30~70%** | 同比例 |
| `fixed-content-visibility` | `domNodeCount` | **不變（~35,000）** | 同 |
| `fixed-virtual` | LCP | **< 300ms** | < 800ms |
| `fixed-virtual` | `domNodeCount` | **< 400** | 同 |

**兇手宣告**：`lcp`。

**這個標本最重要的一件事是「兩個治療的節點數不同」**：
`content-visibility` 讓 5000 個節點**還在 DOM 裡**、只是跳過渲染；
虛擬滾動則是根本不建那些節點。`domNodeCount` 一欄會把這個差別講得比任何毫秒數都清楚
（`spec:1060`：「5,000 節點 → 60 節點」比任何毫秒數都直觀）。

### 最可能出錯的地方

1. **`content-visibility: auto` 的收益在「初次渲染」上可能比預期小**，因為第一屏本來就要渲染。
   它真正省的是**捲動時**的樣式與版面，所以 presentation 段與掉幀才是它的主場。
   若 LCP 幾乎沒降，那不是治療失效，是這個指標選錯了 —— 要補上捲動期的數字。
2. **`contain-intrinsic-size` 沒設會製造 CLS**（捲軸長度亂跳）。
   本標本要順帶量 CLS 來證明這件事：`fixed-content-visibility` 若忘了設 intrinsic size，
   CLS 會從接近 0 跳到明顯可見。
3. **presentation 段落在 8ms 網格上**，兩段治療之間不排名（§4.3）。

---

## 標本 #5 — 版面位移（CLS，B 類）

### 登記的設計參數

| 位移源 | 病變做法 | 治療做法 | 預期貢獻 |
|---|---|---|---|
| 1. 圖片無尺寸 | `<img>` 不寫 `width`/`height`，載入後撐開 | `aspect-ratio` 保留空間 | 0.05~0.20 |
| 2. 字型換入 | 換成 metric 差很多的字族，文字重排 | 預先對齊 fallback metric（`size-adjust` 的概念）| 0.02~0.10 |
| 3. 延遲插入橫幅 | 載入 1500ms 後從**上方**插入通知橫幅 | 預留空間，或 `position: fixed` 疊加 | 0.05~0.25 |

三個位移源刻意排在**載入後 0.3s / 0.9s / 1.5s**：
兩兩間隔小於 `clsSessionGapMs`（1000ms），所以它們會落進**同一個 session window** 並累加。
這正是本標本的教學重點 —— 換成間隔 1.2s 就會變成三個 session，CLS 只取最大的那一個，
數字會小很多，而**畫面上跳動的程度一模一樣**。

### 預期值

| mode | 指標 | 預期 |
|---|---|---|
| `broken` | **CLS** | **0.15~0.50**（「差」區間，門檻 0.25）|
| `broken` | `sessionCount` | **1**（三次位移都在同一個 window 內）|
| `fixed` | **CLS** | **< 0.02** |
| 比值 | broken / fixed | **> 10×** |

**兇手宣告**：`cls`。CLS 與 throttle 無關（位移量取決於幾何不是 CPU），所以**不分 1x / 4x**。
若 4x 下量到明顯不同的 CLS，那代表位移的**時序**被拖慢到跨越了 1000ms 的 session 邊界 ——
那是真實現象，也是文章的好素材，但它不是「CLS 隨 CPU 變化」。

### 登記在案的實作偏差（**這一項是誠實揭露，不是事後補記**）

**位移源 2（網頁字型）不是真的 web font。**
spec 要求字型自架（`spec:1126`：CDN 會被快取，第二次載入就不位移了），
但這個 repo 裡**沒有任何字型檔**，而我不會憑空產生一個合法的字型二進位檔。

所以位移源 2 的做法是：載入後 900ms 把文字區塊的 `font-family` 從一個系統字族換成
另一個 metric 明顯不同的系統字族，製造同樣機制的重排。
**機制是真的（字族 metric 不合 → 文字重排 → 位移），但它不是 `font-display: swap` 的完整故事。**

要補完這一項需要：自架一個 `.woff2`、用 `font-display: swap`、
治療版用 `size-adjust` / `ascent-override` 對齊 fallback。
**這件事登記為已知缺口**，補上之前，文章不得宣稱示範了完整的字型位移。

### 最可能出錯的地方

1. **圖片被快取 → 第二次載入不位移。** 每次載入都帶 cache buster（`?t=`），
   否則第二輪開始 CLS 會神秘地掉到 0，而看起來像治療生效了。
2. **`hadRecentInput` 的 500ms 豁免。** 三個位移都是計時器觸發的，操作程序是
   **載入後靜置，不要碰畫面** —— 提早點一下畫面就會把後續位移全部豁免掉，CLS 變 0。
   面板的 `clsIgnoredByInput` 就是為了讓這種情況看得見（校準 C 已經證實這條路徑會動）。
3. **位移發生在摺線以下不算數。** CLS 只計視窗內的位移，三個位移源都必須落在
   800×600 的第一屏內。

---

## 修正紀錄

（動工後若有任何設計參數變更，追加在這裡。上面的原始預期不動。）

### 2026-07-25 — 四個標本動工後的煙霧測試與校準

以下全部是 headless Brave + CDP 的**煙霧測試**，不是照 protocol 的三輪可重現量測。
它只回答「會不會動、量級對不對」。

#### 一、校準件自己先出過兩次事（兩次都是校準件抓到的）

1. **`position: fixed` 把錨點 B 毀了。** 校準 C／D 的第一版把位移標的與 LCP 標的
   都做成滿版 fixed 覆蓋層。結果同一顆瀏覽器、同一支探針下，按鈕 B 的 200 次強制版面
   從 **64.8ms 變成 1967ms（30 倍）**。原因是 LayoutView 底下一旦有 out-of-flow fixed 盒子，
   Blink 就無法把「只有標的變髒」localize 成小的 layout root，每次強制結算都變成整份文件重排。
   **改成 in-flow（固定高度的舞台 + 推擠塊）之後回到 67.2ms。**
   教訓：校準件的一角改壞，另一角的解析解就跟著失真 —— 而錨點 B 正是標本 #3 的 N=800 的推導基礎。

2. **LCP 對文字算的是文字自己的 bounding box，不是容器的。**
   第二版的 LCP 標的只有「LCP 校準標的」六個字（約 264×60 ≈ 15,800 px²），
   輸給頁面下方一個滿版換行的 `<p>`（769×48 ≈ 36,900 px²），於是 LCP 一直指向那個 `p`。
   把標的文字加長到能換兩行（769×120 ≈ 92,000 px²）之後才穩定勝出。
   加上先前那條低熵圖片規則，**校準 D 前後被三件事擋掉過**：圖片熵、摺線位置、文字面積。

#### 二、四個校準的最終實測

| 校準 | 解析解／排程 | 實測 | 誤差 |
|---|---|---|---|
| A 忙迴圈 | 300ms | `processing` 301.5ms | 0.5% |
| B 強制版面 | —（單位成本錨點）| 200 次 67~81ms | 回到原始量級 |
| C 版面位移 | 0.00573 | **0.005601** | **−2.3%** |
| D LCP | 排程 1500ms | **1544ms** | +2.9% |

**web-vitals 對帳：`deltaLcp = 0`、`deltaCls = 0`** —— 手刻的 session window 演算法與
LCP 取值跟 web-vitals 完全一致。C 的 −2.3% 等價於聯集高度被算成 88px 而非 90px，
是幾何細節不是演算法錯誤（演算法錯的話 delta 不會是 0）。不追這 2%。

#### 三、標本 #2：符合登記，不必調整

| | 登記（1x）| 實測 |
|---|---|---|
| `broken` LCP | 400~1200ms | **384ms**（低於下限 4%，在 30% 帶內）|
| `broken` `domNodeCount` | ~35,000 | **40,021** |
| `fixed-virtual` LCP | < 300ms | **84ms** |
| `fixed-virtual` `domNodeCount` | < 400 | **101** |
| `fixed-virtual` `renderedItems` | —— | **10** |

比值 LCP 4.6×、節點數 **396×**。「5000 節點 → 101 節點」比毫秒數直觀得多，登記時的判斷成立。

⚠️ 一個未解的觀察：兩個 mode 的 LCP 標的都是 `p` 而不是列 ——
兩臂一致所以對照仍然成立，但這代表 LCP 指到的不是「列表本身」。
正式量測前值得確認那個 `p` 是誰。

#### 四、標本 #4：**登記的風險 #1 成真，N 從 2000 校準到 8000**

登記時寫的是：「捲動不弄髒版面，這些讀取讀的是乾淨的 layout……若量到病變版幾乎不掉幀，
**先調 N（那是校準）**」。實測正是如此：

| N | 條件 | 每次事件 | droppedFrames 峰值 |
|---|---|---|---|
| 2000 | 1x | **1.8ms** | **0** |
| 2000 | 4x | 8.8ms | 4 |
| **8000** | **4x** | **29.2ms** | **44** |

乾淨 layout 上的 `getBoundingClientRect()` 單價約 **0.9µs**（1x），
比標本 #3 的強制重排 0.23ms/次**低 250 倍** —— 這個倍數本身就是文章素材：
同樣是讀版面屬性，有沒有弄髒 layout 差了兩個半數量級。

**校準後（N=8000, 4x）**：`broken` 44 掉幀 vs `fixed-observer` **5** 掉幀，比值 **8.8×**
（登記要求 ≥ 4×）。`rectReads` 從 192,000 變成 **0**。
`broken` 的 44 比登記的 4x 下限 60 低 27%，**在 30% 帶內，接受**。

#### 五、標本 #6：**spec 原文的 200 台撐不起病變，校準到 1000 台**

| 裝置數 | 條件 | 每次重建 | droppedFrames 峰值 |
|---|---|---|---|
| 200（spec 原文）| 1x | **0.7ms** | **0** |
| 200 | 4x | 3.2ms | 7 |
| **1000** | **4x** | **14.9ms** | **238** |

**spec 的「200 台」是直覺值不是量出來的**，而直覺在這件事上落後硬體約一個數量級。
批次大小同步從 40 調到 200（維持 20% 的比例）。

**校準後（1000 台, 4x）**：`broken` 238 掉幀 vs `fixed-granular` **6**，比值 **40×**
（登記要求 ≥ 6×）。238 落在登記的 4x 區間 150~290 **正中間**。

順帶證實了登記在案的第 3 條風險：`broken` 五秒內只收到 **46** 批（應為 100），
因為主執行緒卡到 `setInterval` 根本排不進去 —— 治療版收到 100 批。
**病變版連「收到多少資料」都輸**，這比掉幀數更能說明問題。

#### 六、標本 #5：機制成立，但登記的 `sessionCount: 1` 被推翻

| | 登記 | 實測 |
|---|---|---|
| `broken` CLS | 0.15~0.50 | **0.1119**（低於下限 25%，在 30% 帶內）|
| `broken` `sessionCount` | **1** | **2** ❌ |
| `fixed` CLS | < 0.02 | **完全沒有 entry**（null）|
| 最大單筆位移的來源 | —— | `div#ls-prose`（字族換入那一次）|

**`sessionCount: 2` 是方向性的預測失敗，不是數值誤差。**
登記時的推理是「三次位移間隔各 600ms，都小於 1000ms 的 session gap，所以會落進同一個 window」。
實測分成兩個 window，代表**實際觸發時間與排程時間不同** ——
最可能是圖片載入完成的時刻不等於 `src` 設定的時刻（300ms 排程 + 載入時間），
把第一次位移推遲到與第二次相隔超過 1000ms。

這一項**不改設計去迎合預期**。正式量測時要做的是把三次位移的**實際發生時間**量出來
（`largestShift.at` 已經有了，需要的是三筆都記），再判斷要不要調整排程。
`sessionCount` 本身就是這個標本最重要的教學內容，量到 2 反而是更好的素材：
它證明「間隔多久」比「位移多大」更能決定 CLS 分數。

#### 七、順帶修掉的一個真缺陷

**`droppedFramesPeak` 在切 mode 時沒有歸零。**
`handleReset()` 有清，`handleSetMode()` 沒有 —— 於是病變版跑完之後切到治療版，
**峰值原封不動地留著**，治療版的主指標顯示的是病變版的成績。
面板上兩個 mode 的數字一模一樣，看起來像「治療完全沒有效果」。
這正是本站最怕的那種錯：結論反過來，而且沒有任何徵兆。已在 `runtime.ts` 的
`handleSetMode()` 補上 `frames.reset()` 與 `droppedPeak = 0`；
修完之後標本 #4 的治療版從「繼承 44」變成正確的 5。

---

## 修正紀錄 · 三輪可重現量測（2026-07-26）

原始資料：`docs/measurements/2026-07-25-reproducibility-4x.json`
（正式 60 筆 + 被取代 9 筆）。工具：`tools/reproducibility.mjs`、`tools/analyze-repro.mjs`。
宣告 4x CPU throttle、CDP 機器驅動、每個 mode 三輪。

### 更正：先前把一條**被推翻**的風險記成「證實」

上面「順帶證實了登記在案的第 3 條風險」那一段**寫反了**，原文保留不刪。

登記的風險 #3 預測 `setInterval(50ms)` 卡頓後會累積補償性回呼，
「會讓收到的批次數**超出** 20/秒」。實測是相反方向：`broken` 五秒只收到
**48 / 47 / 50** 批（名目 100），治療版收到 100。

`setInterval` 錯過的週期是**被丟棄，不是排隊補發**——同一個 id 任何時刻最多只有一個
pending callback。所以主執行緒一忙，推送率就反向塌陷到跟渲染率一樣慢。
`specimens/06-rerender-storm.ts` 的對應註解同樣預測錯方向，也保留待改。

**方向性預測失敗比預測成功更值錢，但前提是要記對。**

### 六個病變版全部可重現，判準改用 median + 絕對底線

| 標本 | 病變版三輪主指標 | 離散度 | 判定 |
|---|---|---|---|
| #1 | INP median 1368 / 1376 / 1264 ms | 8.2% | ✅ |
| #2 | LCP 1396 / 1356 / 1360 ms | 2.9% | ✅ |
| #3 | forced median 745 / 716 / 678 ms | 9.2% | ✅ |
| #4 | 掉幀峰值 38 / 46 / 43 | 18.6% | ✅ |
| #5 | CLS 0.1266 / 0.1119 / 0.1266 | 11.6% | ✅ |
| #6 | 掉幀峰值 225 / 237 / 231 | 5.2% | ✅ |

判準兩處修正，**兩處都是儀器缺陷不是標本缺陷**：

1. **離散度必須算在每輪的 median，不是 max。** 第一版拿 forced 峰值跨輪比，
   標本 #3 算出 871 / 792 / 1245ms、離散度 **52%**、判定不可重現；
   換成每輪 median 是 721 / 709 / 751ms、**5.9%**。
   `protocol.ts:290` 本來就寫著「抗離群。可重現性判定用這個，不用 max」。
2. **相對離散度需要一條絕對雜訊底線。** 治療版掉幀 4 / 1 / 1 算出 300%，
   但絕對差只有 3 幀。治療有效正是讓分母趨零，
   於是「治療越成功，越判它不可重現」。已加 `floor`
   （掉幀 5 / INP 16ms / CLS 0.01 / LCP 50ms）。

底線不是猜的：標本 #6 的 `fixed-granular` 與 `fixed-backpressure`
實測跑的是位元級同一條路徑（見下），六輪 `droppedFramesPeak` 全距 = 5 幀。

### 標本 #1：`intervalMs: null` 不是凍結的變因（登記風險成真）

三種驅動方式，三個不同的結論：

| 驅動方式 | INP median | 兇手 |
|---|---|---|
| CDP 每次點擊等回應 | 124 / 112 / 120 ms | processing |
| CDP 一次灌完不等回應 | 1368 / 1376 / 1264 ms | **presentation**（約 1230ms） |
| CDP 固定 150ms 間隔（探針） | 128 / 120 / 112 ms | processing |

等回應時事件排不了隊（回覆要等被擋住的主執行緒送出），不等回應時十次點擊
**同時**發生、十個 handler 連續跑完才輪到一次 paint。人手連打是 ~150ms 一下。
**兩種機器驅動法都錯，錯在相反方向。**

登記的兇手 `inputDelay` 三輪皆未觀測到（0.5~2.8ms）。要讓它成為兇手，
單次工作量必須遠大於點擊間隔；`ORDER_COUNT = 50_000` 在 4x 下單次排序約 120ms，
與可達的點擊間隔同量級。**這是設計參數問題，尚未裁決。**

### 標本 #1：兩段治療都只做了十分之一的工作

`completedSorts` / `cancelledSorts`：病變版 **10 / 0**，兩段治療皆 **1 / 9**。
非同步實作取消被蓋掉的工作是正確行為，但 17× 不是同一份工作量的對照。
`01-main-thread-block.ts:206-207` 宣稱這個混淆變因往對治療不利的方向偏，**方向記反了**。

Web Worker 一臂：`workerSortMs` 28.4ms、`workerTransferMs` **589.7ms**。
搬運比排序貴 20 倍，576ms 的 INP 幾乎全是 structured clone 的費用。

### 標本 #6：治療三的背壓守衛從未執行

`renderNotBefore = now + Math.max(0, lastRenderMs - RENDER_BUDGET_MS)`
（`06-rerender-storm.ts:179`，`RENDER_BUDGET_MS = 16.7`）。
治療三走細粒度路徑，`lastRenderMs` 實測 1.7~2.7ms，`Math.max` 恆為 0，
`renderNotBefore` 恆等於 `now`，跳過分支不可達（需要 `lastRenderMs > 33.4ms`）。

實測交叉證實：三輪 `rendersSkipped` 全為 0，且 `fixed-granular` 與
`fixed-backpressure` 六輪的 `batchesReceived` 100、`batchesRendered` 99、
`updatesApplied` **17943** 逐欄完全相同。登記的「backpressure `renderRatio` < 0.5」
在現行設計下**永遠不可能達成**（實測皆 1.0）。

次要：`RENDER_BUDGET_MS` 寫死 16.7，與 `frames.ts` 依實測 `refreshHz` 推導門檻不同源。

### 標本 #6：治療一未進入作用區間（不是無效）

`fixed-batch` 掉幀 219 / 222 / 223 vs 病變 225 / 237 / 231，比值 1.04×，
離散度 1.8%（高度可重現的零效果）。登記 4x 預期 20~120，實測超出上限 1.85 倍。

原因是 `PUSH_INTERVAL_MS = 50`（20 推送/秒），60Hz 一幀平均只有 0.33 筆推送，
沒有東西可以合併（實測 `renderRatio` 0.91 / 1.0 / 1.0）。
要讓「批次化」成為乾淨的單一變因，推送間隔必須明顯短於幀時間。**尚未裁決。**

另：`renderAll` 的自報耗時只包住節點建構與 `replaceChildren`，
不含 style / layout / paint。`broken` 自報 12.7~14.4ms，而實際幀距約 104ms
（5000ms ÷ 48 批）。當初用來把 200 台校準到 1000 台的「每次重建 14.9ms」
**系統性低估真實幀成本約 7 倍**——校準結論不變（負載仍需放大），但理由要改寫。

### 標本 #4：治療一同時翻了兩個變因，治療二未進入作用區間

`fixed-passive` 登記為「**只**把 wheel 改成 `passive: true`」，
但 `04-unthrottled-events.ts:245` 同時把 handler 從 `scanOnEveryWheel`
換成 `countWheelOnly`，順手拿掉一整輪 8000 次 `getBoundingClientRect()`。
實測 `passes` 21 → 11、`rectReads` 168,000 → 88,000。
掉幀降幅 0.63× **小於**工作量降幅 0.52×，`passive` 旗標沒有留下可歸因的殘差。

`fixed-raf` 與 `fixed-passive` 的 `passes` 與 `rectReads` **逐輪完全相同** ——
驅動器每 500ms 才派一次滾輪，一幀內永遠沒有第二個事件可合併，rAF 閘門一次都沒觸發。

只有 `fixed-observer` 乾淨（`scrollEvents` = 0、`rectReads` = 0，43 → 1），
但它是換機制，不是「治療一再加一點」。這個標本的梯度敘事需要重寫。

### 標本 #5：位移源二不產生位移，這才是 `sessionCount = 2` 的原因

`fireFontShift` 只改 `#ls-prose` 自己的 `fontFamily` / `fontSize`
（`05-layout-shift.ts:93-94`），而 `#ls-prose` 是模板的**最後一個元素**，
下方沒有內容可被推動——元素自己往下長高、左上角不動，不符合 layout shift 記錄條件。

於是實際只有兩筆 entry：300ms 與 1500ms，間隔 **1200ms > 1000ms**，開兩個 session window。
**先前登記的 `sessionCount: 1` 是錯的，實測的 2 完全正確，
而正確的原因是這個標本比它自己以為的少了三分之一。**

連帶：治療版的 `min-height: 168px` 治的是不存在的位移；
`shiftSourcesFired` 數的是排程數不是 entry 數，兩個 mode 都顯示 3/3，缺陷在 UI 上隱形；
標本頁面上印給讀者的「三次位移會落進同一個 session 並累加」是錯的。

### 標本 #2：每列是 8 個節點不是 7

`domNodeCount` 實測 40,021。反解兩式：`21 + 5000×8 = 40021`、
`21 + 15×8 = 141`（虛擬滾動臂），兩式獨立同時解出每列 8 個節點、基底 21。
`buildRow` 漏算了 badges 包裝層。程式註解、頁面文案（`約 35000 個節點`）
與 `src/specimens.ts` 的 subtitle 三處都還印著 35,000。
先前把實測 40,021 判為「符合登記 ~35,000，不必調整」，等於把計數 bug 當成量測容差放過。

### 量測工具自身的缺陷（已知，未修）

1. `tools/reproducibility.mjs` 的 `loafForced()` 用嚴格 `>` 選幀，
   該指標全為 0 時 `best` 固定停在 `frames[0]`（面板最近六幀裡**最舊**的一幀）。
   對 #1 / #4 / #6 這類沒有強制版面的標本，`specimenScript` 與 `forcedFn` 欄位不可信。
2. `tools/analyze-repro.mjs` 的 `clsValue` 把「沒量到」與「真的是 0」併成同一個值，
   方向永遠偏向「治療完美」。同檔的 `SAMPLED_FORCED` 正是為了擋這種錯，CLS 沒有等價防線。
3. 寫檔路徑的 `Infinity` 經 `JSON.stringify` 變成 `null`，只讀 JSON 的人會把
   「治療版該指標為零」誤讀成「比值算不出來」。console 分支有處理，寫檔沒有。
4. B 類的 `for r { for m of modes }` 讓 mode 與循環位置完全共線，
   註解卻宣稱「順帶把單調漂移也擋掉」。三輪不是打散共線，是複製三次。
5. `src/measure/frames.ts` 的 `reset()` 不重設 `#last`，切 mode 期間主執行緒被塞住、
   沒有 rAF tick，等切換結束後第一個 tick 算出的 `delta` 跨越整段切換工作，
   那筆 miss 記在新 mode 帳上。受害最深的是 `fixed-observer`
   （進入該 mode 要跑 8000 次 `observer.observe()`）。
   偏差方向對治療版不利，所以 43 → 1 是保守下界，結論不翻轉。
   修法是 `#last = performance.now()`。
