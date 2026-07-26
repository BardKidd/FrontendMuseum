/**
 * 標本 #6 —— 高頻資料流造成的 re-render 風暴。
 *
 * 病變：模擬 WebSocket 每 25ms 推一批裝置狀態更新，每次推送直接重建整張 1000 列的清單。
 * 每秒 40 次全表重繪，而整表重建一次的真實幀成本約 96ms（4x 節流實測）—— 畫面卡成幻燈片。
 *
 * 這是全案最有原創性的一個（spec:1136）—— 市面上幾乎沒有人把它做成可量測的對照。
 *
 * **治療梯度是樹狀不是鏈狀**（2026-07-26 改，理由見 `docs/phase2-expected-results.md` 修正紀錄）：
 *
 * ```
 * broken ──► fixed-batch ──┬──► fixed-granular      （翻：每一次渲染的成本）
 *                          └──► fixed-backpressure  （翻：渲染的次數）
 * ```
 *
 * 每一臂相對**它自己的父臂**只翻一個變因。
 *
 * 背壓不接在細粒度之後，理由**是實證，不是解析上界**（2026-07-26 降級，見下）：
 * 三輪實測細粒度臂每次渲染只改約 180 列（17943 ÷ 99）、`droppedFramesPeak` 4~8 ——
 * 那等於本站自己量到的雜訊底線（5 幀），也就是說它的幀幾乎沒有超出一幀預算過，
 * 於是背壓閘門沒有可觸發的機會（`rendersSkipped` 三輪恆為 0）。
 * ⚠️ 那三輪跑的是舊參數（50ms / 每批 200 列）。新參數下細粒度臂的一幀約 16.7ms、
 * 一幀併得到 16.7 ÷ 25 ≈ 0.67 批 ≈ 67 列，**每次渲染的工作量比舊參數更小** ——
 * 實證前提在新參數下只會更寬鬆，不會更緊。
 *
 * ⚠️ 舊註解在這裡寫的是解析上界：「`pending` 去重上限 = `DEVICE_COUNT`，
 * 單筆更新實測 11.6µs → 成本上限 11.6ms < 一幀 16.7ms，推送再快也觸發不了背壓」。
 * **那條上界不成立**：11.6µs 是拿 `lastRenderMs`（現名 `renderScriptMs`）除出來的，
 * 而那正是本輪宣告「系統性低估真實幀成本約 7.5 倍」的自報值 ——
 * 它抓不到 style / layout / paint，拿它當上界等於用同一個缺陷去證明另一件事。
 * **「一幀改 1000 個文字節點的真實幀成本」從未量過**，所以這裡只宣稱
 * 「在觀測到的負載下沒有觸發」，不宣稱「不可能觸發」。
 *
 * 可證偽的判準（登記在案）：本輪重跑若量到 `fixed-granular` 的 `rendersSkipped > 0`，
 * 上面那條實證前提就倒了，樹狀梯度的正當性必須整段重寫。
 *
 * 兇手是 LoAF / 掉幀。**這個標本沒有使用者互動**（按一次開始就靜置），
 * 所以 INP 欄會是空的 —— 跟標本 #4 同一個理由。
 *
 * ⚠️ 資料流是計時器不是真 WebSocket：真連線會把網路抖動灌進量測，
 * 而網路抖動不可重現。這裡犧牲的是「真實感」，換到的是**同一份資料每次跑出同一個結果**。
 * 但模擬器**必須照時鐘補發**，見 `pushDeviceBatch` —— 天真的 `setInterval` 會反向塌陷，
 * 把這個標本要治的病一起消掉。補發寫成同步迴圈是**登記在案的建模選擇**，
 * 它讓量到的病變偏保守（方向與代價寫在 `pushDeviceBatch` 的註解裡）。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { RERENDER_STORM_META } from '../src/specimens';
// 刷新率不自己量：`runtime.ts:272` 已寫明「每個標本抄一份遲早會有一份寫死 16.7ms，
// 而那在 120Hz 上是錯的」。這裡用的是**同一支函式**，不是抄一份。
import { measureRefreshHz } from '../src/measure/device';
// median 同理。`device.ts:53` 已寫明「同一個專案裡兩份 median 實作遲早會對不起來，
// 而那種不一致沒有任何徵兆」。
import { computeRunStats } from '../src/measure/metrics';

// ───────────────────────── 凍結的負載參數 ─────────────────────────

/**
 * 裝置數。**spec 原文是 200 台，實測後校準到 1000 —— 校準結論不變，理由重推過兩次，
 * 兩版舊理由都已作廢。**
 *
 * **作廢的第一版**：自報耗時（「1000 台重建一次 14.9ms，接近一幀預算」）。
 * 自報只包住節點建構與 `replaceChildren`，style / layout / paint 發生在那支 callback
 * **結束之後**、下一個 vsync 之前，同步計時器在原理上就抓不到 —— **低估約 7.5 倍**。
 *
 * 真實幀成本從三輪原始資料反推（`5000 = renders×(JS+L) + idleFrames×16.67`，
 * 其中總幀數 `T = 300 − droppedFramesPeak`，因為 `Σ round(Δ/16.67) = 300`）：
 *   整表重建 1000 列 → JS **12.7ms** + style/layout/paint **83.4 ± 3.0ms** = **真實 96ms**。
 * 四個 mode、六輪獨立同解，離散度 8.4%。第三方交叉驗證：`setInterval(50)` 的達成節距
 * 應為 `50 × ceil(96/50) = 100ms`，實測 `5000 / 48 批 = 104ms` ✓。
 * 這一段成立，往下的外推才是出問題的地方。
 *
 * **作廢的第二版**（「掉幀門檻 Δ ≥ 25.0ms → 最少 260 台、穩定掉 2 幀要 434 台」）。
 * **260 與 434 這兩個數字不要再引用**，兩層錯：
 *  (a) **把量化門檻當成連續門檻。** rAF callback 落在 vsync 網格上，幀距實際取得到的值
 *      只有刷新週期的整數倍（16.7 / 33.3 / 50.0…）。`frames.ts:102` 的
 *      `round(Δ/16.67) ≥ 2` 的確等價於 `Δ ≥ 25.0ms`，但在網格上「≥ 25.0ms」
 *      就是「≥ 2 個 vsync」—— 真正的觸發條件是**這一幀的工作超過約一個刷新週期
 *      （16.7ms）**，不是「超過 25.0ms」。拿 25.0 去除單價，除的是一個不存在的門檻。
 *  (b) **單價本身不能外推。** 0.096ms/列 只在 1000 列量過一個點。
 *      舊資料直接反證這條外推：200 台 4x 實測掉幀 **7** ——
 *      既不是第二版理由預測的 0（19ms < 25ms 門檻），
 *      也不是線性外推該給的上百（19ms > 16.7ms → 每次重建都該掉一幀）。
 *      真實成本在這個區間不是線性的，而我手上只有 1000 列那一個點。
 *
 * **撐得住的理由只剩一條：效果對雜訊底線的倍率。**
 * 本站的底噪是量出來的 —— 同一份工作量六輪，`droppedFramesPeak` 全距 **5 幀**
 *（`docs/articles/01-twelve-treatments-four-survive.md` 第二節）。
 *   200 台 4x → **7**：與底噪同量級，任何結論都不准宣稱。
 *  1000 台 4x → **225 / 237 / 231**，離散度 5.2%，約 **46 倍**底噪 → 可宣稱。
 * 選 1000 是因為它把效果推離底噪兩個數量級，**不是因為它跨過某條算出來的門檻**。
 * 200 與 1000 之間沒有量過，所以這裡也不宣稱「最小可用值是多少台」。
 *
 * ⚠️ 代價要寫明：1000 台之下，任何仍在整表重建的臂 `droppedFrames` 都會飽和
 *（`dropped ≈ 300 − 5000/幀距`：幀距 96ms → 248，169ms → 271，**幀距差 1.76 倍只換到 1.09 倍**）。
 * **主指標在 broken 對 fixed-batch 這一對上表達不了差異**，所以另外上報
 * `renderFrameGapMedianMs`（只取「這一幀有渲染」的幀距），那一對的判定改用它 ——
 * 見 `stopStream()` 裡為什麼不能用「全部幀」的 median。
 */
const DEVICE_COUNT = 1000;

/**
 * 整表重建 `DEVICE_COUNT` 列的**真實幀成本**（4x 節流）：JS 12.7ms + style/layout/paint 83.4ms。
 * 出處與反推式見上面 `DEVICE_COUNT` 的註解。
 *
 * **它是上一輪的實測常數，不是本輪的量測結果，也不進任何控制流程** ——
 * 只用於參數推導與頁面文案。之所以要給它一個名字：同一個 96ms 同時是
 * `PUSH_INTERVAL_MS` 上界的依據、也是頁面上「一幀併得到幾批」那句話的分子。
 * 兩處各寫一個字面值，遲早會有一處忘了跟著改 —— 上一版就是那樣印出「40÷60 ≈ 3.8」的。
 */
const FULL_REBUILD_FRAME_MS = 96;

/**
 * 推送間隔。**spec 原文 50ms，校準到 25ms**。推導有兩道夾擊，不是挑一個好看的數字：
 *
 * - **上界**：必須明顯短於**治療一的幀時間**（整表重建 `FULL_REBUILD_FRAME_MS` = 96ms），
 *   否則一幀之內沒有第二筆可以合併，rAF 閘門就是恆等式。
 *   可併批數 = **幀時間 ÷ 推送間隔** = 96 ÷ 25 = **3.84 批/幀**。
 *   ⚠️ 分母是推送間隔、分子是**那一臂的幀時間**，**與刷新率無關**：
 *   治療一的一幀是 96ms 不是 16.7ms，寫成「40 ÷ 60」是把「每秒推幾批」除以「每秒幾幀」，
 *   算出來的 0.67 連量綱都不對（上一版頁面文案就是這樣印出 3.8 的，數字碰巧接近而已）。
 * - **下界**：必須大於**病變臂單次重建的 JS 成本**（12.7ms），否則補發佇列發散。
 *   補發迴圈的遞迴式是 `k(n+1) = (JS/p)·k(n) + L/p`，穩定點 `k* = L/(p − JS)`。
 *   p = 25 → `k* = 83.4 / 12.3 = 6.8` 筆/幀，收斂係數 `JS/p = 0.51 < 1`。
 *   p = 13 → `k*` 爆到 278 —— **這條下界不是安全邊際，是相變點。**
 *
 * 資料率**刻意凍住**：批量同步從 200 降到 100，`20 批/秒 × 200 = 40 批/秒 × 100 = 4000 筆/秒`。
 * 只翻「推送頻率」，不翻「每秒送進來多少資料」。
 */
const PUSH_INTERVAL_MS = 25;

/** 每批更新幾台（`DEVICE_COUNT` 的 10%）。跟著推送間隔等比縮，維持 4000 筆/秒的資料率不變 */
const BATCH_SIZE = 100;

/**
 * 治療一的一幀之內併得到幾批 = **幀時間 ÷ 推送間隔** = 96 / 25 = 3.84。
 * 頁面文案與 `PUSH_INTERVAL_MS` 的上界推導共用這一個算式，不各寫一個字面值。
 */
const BATCHES_PER_REBUILD_FRAME = FULL_REBUILD_FRAME_MS / PUSH_INTERVAL_MS;

/**
 * 一次補發最多幾批。正常穩定點是 6.8，這是它的 3.5 倍。
 *
 * 撞到這個上限代表機器比校準時慢兩倍以上（`JS ≥ p` 時遞迴式沒有不動點，佇列無界成長），
 * 那時候「推送率」就不再是凍結變因。所以 `catchupClamped` 一定要上報：
 * **任何一輪 `catchupClamped > 0`，該輪作廢**，並把推送間隔提到 32ms 重跑。
 */
const MAX_CATCHUP_BATCHES = 24;

/**
 * 串流長度。**刻意等於 `MEASURE_CONFIG.droppedFrameWindowMs`（5000ms）**，
 * 這樣串流結束的那一刻，5 秒滾動窗涵蓋的正好就是整段串流，不多不少。
 *
 * 自動停止而不是讓操作者自己數秒：串流長度是凍結變因，
 * 「我大概放了十秒」與「我大概放了七秒」是兩個不同的實驗。
 *
 * ⚠️ `docs/phase2-expected-results.md:138` 登記的是「量測窗 10 秒」，與這裡從來沒對齊過。
 * 維持 5000ms，理由如上；登記值已在該檔修正紀錄更正。
 */
const STREAM_DURATION_MS = 5000;

/**
 * 狀態列最多多久寫一次。**用時鐘限流，不是用幀數限流。**
 *
 * 「每幀最多一次」聽起來對稱，其實不對稱：治療臂一秒有 60 幀、病變臂只有 6 幀，
 * 那等於對跑得快的那一臂加十倍的量測負載。用時鐘當上限，四臂才真的收到同一份儀器開銷。
 * 250ms 是抄外殼的 flush 週期（本站凍結值，spec:1504）。
 */
const STATUS_PAINT_INTERVAL_MS = 250;

const DATASET_SEED = 20240606;

/**
 * 一幀的預算。**由 `measureRefreshHz()` 實測，不寫死 16.7** ——
 * 與 `frames.ts` 的掉幀門檻同源，否則 120Hz 面板上「背壓」與「掉幀計數」會用兩把尺。
 *
 * 初值 `1000/60` 只是還沒量到之前的暫代值：`mount()` 一掛上就發動量測（約 20 幀 ≈ 350ms），
 * 而操作程序是頁面載入完成之後才按「開始推送」，所以串流期間用到的一定是實測值。
 */
let targetFrameMs = 1000 / 60;

interface Device {
  id: string;
  name: string;
  state: string;
  value: number;
}

interface DeviceRow {
  root: HTMLElement;
  state: HTMLElement;
  value: HTMLElement;
}

const STATES = ['運轉中', '待機', '維修', '離線'];
const NAMES = ['冷凍櫃', '空壓機', '輸送帶', '烘箱', '幫浦', '風機', '鍋爐', '冰水主機'];

let ctxRef: SpecimenContext | null = null;
let rootRef: HTMLElement | null = null;
let currentMode = 'broken';

let devices: Device[] = [];
/** 細粒度模式用的每列節點參照。整表重建模式不會用到它（它每次都把節點丟掉重建）*/
let rowNodes: DeviceRow[] = [];

let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let startButton: HTMLButtonElement | null = null;

let pushTimer = 0;
let stopTimer = 0;
let rafId = 0;
let streaming = false;
let rand: () => number = () => 0;

/** 待套用的更新，key = 裝置 index。**Map 本身就是「只保留最新值」** */
const pending = new Map<number, Device>();

let batchesReceived = 0;
let batchesRendered = 0;
let rendersSkipped = 0;
let updatesApplied = 0;

/** 自報耗時：**只含 JS**（節點建構 + `replaceChildren`），不含 style / layout / paint */
let renderScriptMs = 0;

/**
 * 實測幀距：rAF callback 到下一個 rAF callback。
 *
 * ⚠️ **它量的是「這一幀多久」，不是「這一次渲染多久」。** 兩者在治療臂上碰巧接近
 *（一幀最多渲染一次），在病變臂上差很多：病變臂一幀之內會呼叫約 6.8 次 `renderAll`，
 * 那一格幀距是**六到七次節點重建 + 瀏覽器只做一次的 style/layout/paint** 的總和。
 * 上一版註解寫「這才是一次渲染的真實成本」，那句話錯了 ——
 * 沒有任何一欄量得到「單獨一次渲染」的成本，而正是那幾次白做的重建構成了病變。
 */
let lastFrameGapMs = 0;
let lastFrameAt = 0;
/** 每一幀的幀距，含背壓跳過的便宜幀。**不是判定欄**，理由見 `stopStream()` */
const frameGaps: number[] = [];
/** 只含「前一幀真的渲染過」的幀距。**跨臂判定用這一組**，理由見 `stopStream()` */
const renderFrameGaps: number[] = [];
/**
 * 取樣用的 latch：上一格幀距之內有沒有跑過渲染。
 * 由 `finishRender()` 立起（四臂共用，病變臂的渲染在計時器回呼裡，不在 rAF 裡），
 * 在下一個 rAF callback 算完幀距之後放下。
 * **與背壓用的 `renderedOnLastFrame` 是兩個 latch**：那一個會被閘門消耗掉，
 * 共用一個的話，背壓臂被跳過的幀會把取樣一起關掉。
 */
let renderedSincePrevFrame = false;

/** 背壓用：下一次允許渲染的最早時間 */
let renderNotBefore = 0;
/** 背壓用：上一幀有沒有真的渲染。控制律要靠它對相位，見 `onAnimationFrame` */
let renderedOnLastFrame = false;

/** 串流起點。補發是拿它跟時鐘對帳算出來的，不是數 callback 次數 */
let streamStartedAt = 0;
/** 被 `MAX_CATCHUP_BATCHES` 砍掉的批數。> 0 代表這一輪的推送率不是凍結變因 */
let catchupClamped = 0;

let statusDirty = false;
let statusPaintedAt = 0;
let lastRenderHow = '';

let listenerAbort: AbortController | null = null;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function nextRandom(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 所有計數器與量測狀態歸零。**開始串流、切 mode、重跑三處共用同一支**：
 * 各寫一份的話，遲早有一處漏掉新加的欄位，而那個漏掉會表現成「上一輪的數字黏在新一輪上」——
 * `droppedFramesPeak` 就是這樣被 `handleSetMode()` 漏掉過一次（見 phase2 修正紀錄）。
 */
function resetCounters(): void {
  batchesReceived = 0;
  batchesRendered = 0;
  rendersSkipped = 0;
  updatesApplied = 0;
  renderScriptMs = 0;
  renderNotBefore = 0;
  renderedOnLastFrame = false;
  lastFrameGapMs = 0;
  lastFrameAt = 0;
  frameGaps.length = 0;
  renderFrameGaps.length = 0;
  renderedSincePrevFrame = false;
  catchupClamped = 0;
  statusDirty = false;
  statusPaintedAt = 0;
  lastRenderHow = '';
  pending.clear();
}

// ───────────────────────── 資料流 ─────────────────────────

/** 產生一批更新。抽出來是因為補發時要連跑好幾批 */
function generateBatch(): void {
  batchesReceived += 1;
  for (let k = 0; k < BATCH_SIZE; k++) {
    const i = (rand() * devices.length) | 0;
    const d = devices[i];
    d.state = STATES[(rand() * STATES.length) | 0];
    d.value = Math.round(rand() * 1000) / 10;
    pending.set(i, d);
  }
}

/**
 * 假的 WebSocket 推送。**照時鐘補發，不是每次回呼推一批。**
 * 名字會進 LoAF 的 `sourceFunctionName`，面板上因此看得出「這一幀是推送造成的」。
 *
 * ⚠️ 三輪實測推翻了原本的預測（原註解說 `setInterval` 卡住之後會「補償性連續回呼」，
 * 方向記反了）：**同一個 id 任何時刻最多只有一個 pending callback，漏掉的週期是被丟棄、
 * 不是排隊補發**。病變臂五秒只收到 48 批（名目 100），治療臂收到 100 ——
 * 兩臂餵進去的資料量差兩倍，這本身就是一個沒凍住的變因。
 *
 * 更糟的是它把這個標本要治的病一起消掉了：病變臂的主執行緒被 96ms 的重建塞到零空檔，
 * 一幀之內最多只送得進**一筆**推送（**不論 `PUSH_INTERVAL_MS` 設多小**），
 * 於是 rAF 閘門與 `setInterval` 的塌陷做的是同一件事，兩臂成為恆等式（實測比值 1.04×）。
 * **單改推送間隔治不了它，必須改推送來源。**
 *
 * 真的 WebSocket 不會塌陷：訊息在網路那端照原速到達，主執行緒一空就把積著的訊息派送出去，
 * 天真的程式碼於是在很短的時間內重建好幾次整表，而中間那幾次重建的結果沒有人看到。
 * **這正是批次化買到的東西。** 所以這裡照時鐘補發。
 *
 * ⚠️ **登記在案的建模選擇（不是對瀏覽器行為的斷言）：補發是一個同步 `for` 迴圈，
 * 七批在同一個 task 裡跑完。**
 *
 * 真實情境是七個**獨立的 message task**，瀏覽器可以（也常常會）在它們之間插進
 * 一次 BeginMainFrame，於是那幾次重建可能**各付一次 style/layout/paint**。
 * 這一版讓七次重建共用一次排版，代價寫清楚：
 *
 *   量到的 broken → fixed-batch 差距 = 白做的**節點建構**（約 7 × 12.7 = 89ms/幀）
 *   量不到的部分  = 白做的**排版**（真實情境下每次 83.4ms）
 *
 * **所以這個標本量到的是病變的下界，偏差方向對病變不利、對治療保守。**
 * 明知偏保守還是選它，是因為另一條路（`setTimeout(0)` 拆成獨立 task）把
 * 「一幀塞得進幾批」交給瀏覽器的 task 排程決定，而那個排程在負載下不可重現 ——
 * 那會讓「每幀併幾批」變成一個沒凍住的變因，換掉本站的第一原則去換真實感。
 * 要補這一項，正確做法是另開一臂（同步補發 vs 逐 task 補發），不是把這一臂改掉。
 */
function pushDeviceBatch(): void {
  const nominal = Math.floor((performance.now() - streamStartedAt) / PUSH_INTERVAL_MS);
  let due = nominal - batchesReceived;
  if (due > MAX_CATCHUP_BATCHES) {
    catchupClamped += due - MAX_CATCHUP_BATCHES;
    due = MAX_CATCHUP_BATCHES;
  }
  for (let n = 0; n < due; n++) {
    generateBatch();
    // 病變：收到就重繪，一次不漏 —— 同一幀裡收到幾批就重建幾次整表。
    // 治療臂什麼都不做，等 rAF 迴圈來收（見 onAnimationFrame）。
    if (currentMode === 'broken') renderAll();
  }
}

/**
 * 串流期間唯一的 rAF 迴圈。**四個 mode 都跑**（病變版只取樣不渲染），
 * 這樣「量測本身的開銷」在四臂上完全相同，不會偏袒任何一臂。
 *
 * 續排是無條件的：幀距要連續取樣才量得到真實幀成本，斷一次就有一段量不到。
 * 代價寫在誠實欄：它是本頁的第二支 rAF 迴圈（第一支是 `FrameCounter`），
 * 每幀約十個算術運算，且會進 LoAF 的 `scripts[]` —— 所以函式必須具名，
 * 而且 `stopStream()` / `destroy()` 一定要停（驗收第 12 條）。
 */
function onAnimationFrame(now: DOMHighResTimeStamp): void {
  if (lastFrameAt > 0) {
    lastFrameGapMs = now - lastFrameAt;
    frameGaps.push(lastFrameGapMs);
    // 分兩組取樣是 2026-07-26 的修正，**不是多此一舉**：
    // 無條件取樣會把背壓臂跳過的便宜幀（16.7ms）也算進去，而那一臂正是靠跳過取勝，
    // 於是它的 median 與 p75 都會變成 16.7ms、與細粒度臂逐欄完全相同 ——
    // 那正是已發出文章第二節在罵的那個缺陷（治療二與治療三六輪逐欄相同）的翻版。
    // 只有「這一格幀距之內有渲染過」的幀，才回答得了「有做事的幀有多長」——
    // 注意問的是幀不是單次渲染：病變臂一格裡有約 6.8 次重建，那一格就是它們的總和。
    if (renderedSincePrevFrame) renderFrameGaps.push(lastFrameGapMs);
  }
  renderedSincePrevFrame = false;
  lastFrameAt = now;
  rafId = requestAnimationFrame(onAnimationFrame);

  if (statusDirty && now - statusPaintedAt >= STATUS_PAINT_INTERVAL_MS) {
    paintStatus();
    statusDirty = false;
    statusPaintedAt = now;
  }

  // 病變版的渲染發生在推送回呼裡，不在這裡。這支迴圈對它只是取樣器。
  if (currentMode === 'broken') return;

  if (currentMode === 'fixed-backpressure' && !passesBackpressureGate(now)) return;

  if (pending.size === 0) return;

  if (currentMode === 'fixed-granular') {
    renderChangedOnly();
    return;
  }
  // fixed-batch 與 fixed-backpressure 都走整表重建 —— 背壓翻的變因是「渲染的次數」，
  // 不是「每次的成本」。兩臂的 DOM 工作量必須一模一樣，差別才乾淨。
  renderAll();
  renderedOnLastFrame = true;
}

/**
 * 治療二乙 —— 背壓。**只有這一段會主動丟掉工作。**
 *
 * 判斷依據是**實測幀距**，不是自報耗時。自報只包住節點建構與 `replaceChildren`；
 * style / layout / paint 發生在那支 callback 結束之後，同步計時器在原理上抓不到。
 * 三輪原始資料反推：整表重建的 style+layout+paint 約 83ms，而自報只有 12.7ms ——
 * **低估 7.5 倍**。拿低估 7.5 倍的數字去比一幀預算，守衛永遠不成立
 *（實測 `rendersSkipped` 三輪皆為 0，那是死程式碼不是收斂）。
 *
 * ⚠️ 相位是這支函式唯一的難點，**寫錯就會退化成另一段死程式碼**：
 * 幀距要到**下一幀**才量得到，所以期限必須在「上一幀有渲染」的那一幀才設。
 * 若照直覺寫成「通過閘門就順手設 `renderNotBefore = now + over`」，
 * 期限 `over = gap − 一幀` 恆小於下一幀到達所需的 `gap`，閘門一次都不會成立 ——
 * 跟它要修的缺陷是同一類。`renderedOnLastFrame` 這個 latch 就是為了對這個相位。
 *
 * 控制律：這一幀超出一幀預算多少，就讓出多少時間給瀏覽器。
 * 幀距 ≤ 一幀預算時 `over ≤ 0` → 不跳過。**那是正確行為**：
 * 渲染塞得進一幀就不需要背壓（治療二正是靠這件事讓背壓無事可做）。
 *
 * ⚠️ 代價是真的：跳過的那幾幀，畫面顯示的不是最新狀態。
 * 這是取捨不是免費的勝利，所以 `rendersSkipped` 一定要上報 ——
 * 讓取捨被看見，而不是被我宣稱。
 */
function passesBackpressureGate(now: DOMHighResTimeStamp): boolean {
  if (renderedOnLastFrame) {
    renderedOnLastFrame = false;
    const over = lastFrameGapMs - targetFrameMs;
    renderNotBefore = over > 0 ? now + over : 0;
  }
  if (now < renderNotBefore) {
    rendersSkipped += 1;
    return false;
  }
  return true;
}

// ───────────────────────── 兩種寫 DOM 的方式 ─────────────────────────

/**
 * 整表重建 —— 病變版、治療一、治療二乙都用這個。
 *
 * 治療一與病變版的差別**只有一件事**：什麼時候呼叫它。
 * 病變版每收到一批就叫一次（補發之後同一幀裡會叫六到七次），治療一每幀最多一次。
 * 兩者每次做的 DOM 工作量完全相同，這樣「批次化」的收益才是乾淨的單一變因。
 */
function renderAll(): void {
  if (!listEl) return;
  const t0 = performance.now();

  const frag = document.createDocumentFragment();
  for (const d of devices) {
    const li = document.createElement('li');
    li.className = 'rs-row';
    const name = document.createElement('span');
    name.textContent = `${d.id} ${d.name}`;
    const state = document.createElement('span');
    state.className = 'rs-state';
    state.textContent = d.state;
    const value = document.createElement('span');
    value.className = 'rs-value';
    value.textContent = `${d.value.toFixed(1)}%`;
    li.append(name, state, value);
    frag.appendChild(li);
  }
  listEl.replaceChildren(frag);
  // 整表重建之後，先前存的節點參照全部失效 —— 細粒度模式若拿舊參照去寫，
  // 寫到的是已經不在文件裡的節點，畫面不動而程式不報錯。切 mode 時要重建參照。
  rowNodes = [];

  updatesApplied += pending.size;
  pending.clear();
  finishRender(performance.now() - t0, `整表重建 ${devices.length} 列`);
}

/**
 * 細粒度更新 —— 治療二用這個。
 * 只寫「這一幀真的變了的那幾台」的兩個文字節點，不動結構。
 */
function renderChangedOnly(): void {
  if (rowNodes.length === 0) return;
  const t0 = performance.now();

  let applied = 0;
  for (const [i, d] of pending) {
    const node = rowNodes[i];
    if (!node) continue;
    // textContent 的比較是刻意的：值沒變就不寫，寫入本身也要錢
    const nextState = d.state;
    const nextValue = `${d.value.toFixed(1)}%`;
    if (node.state.textContent !== nextState) node.state.textContent = nextState;
    if (node.value.textContent !== nextValue) node.value.textContent = nextValue;
    applied += 1;
  }
  updatesApplied += applied;
  pending.clear();
  finishRender(performance.now() - t0, `細粒度更新 ${applied} 列`);
}

function finishRender(elapsedMs: number, how: string): void {
  batchesRendered += 1;
  renderScriptMs = elapsedMs;
  lastRenderHow = how;
  // 這一格幀距要進 renderFrameGaps。立在這裡而不是各渲染路徑裡，是因為病變臂的渲染
  // 發生在計時器回呼、治療臂發生在 rAF 回呼 —— 只有這支是四臂都會經過的匯流點。
  renderedSincePrevFrame = true;
  // 只標髒不寫 DOM：實際寫入由 rAF 迴圈限流。補發之後病變臂一個回呼裡渲染六到七次，
  // 每次都寫一段狀態文字等於在熱路徑上多弄髒一次 DOM，而那筆成本只加在病變臂身上。
  statusDirty = true;

  ctxRef?.emit({
    deviceCount: devices.length,
    pushIntervalMs: PUSH_INTERVAL_MS,
    batchesReceived,
    batchesRendered,
    rendersSkipped,
    updatesApplied,
    // 舊名 lastRenderMs。改名是為了把「只含 JS」寫在欄名上 ——
    // 舊名讓人以為它是「這次渲染的成本」，而它系統性低估真實幀成本 7.5 倍。
    renderScriptMs: round1(elapsedMs),
    // 上一格**幀距**（含 style / layout / paint）—— 注意是「上一幀多久」，
    // **不是「這一次渲染多久」**：病變臂一幀裡呼叫約 6.8 次 renderAll，
    // 這一欄是那幾次重建加上瀏覽器只做一次的排版的總和。
    // 背壓閘門拿它跟一幀預算比是刻意的：閘門要問的正是「上一幀有沒有超時」。
    frameGapMs: round1(lastFrameGapMs),
    // > 0 代表補發被上限砍過，該輪的推送率不是凍結變因 → 作廢重跑
    catchupClamped,
    // 「渲染次數 / 收到批次數」—— 病變版恆為 1.0（收到就渲染），批次化把它壓下去。
    // ⚠️ 只在**渲染路徑相同**的兩臂之間可比：細粒度臂的幀很便宜，它渲染得更頻繁，
    // 比值反而比治療一高，那不代表它「批得比較差」。
    renderRatio: batchesReceived === 0 ? 0 : Math.round((batchesRendered / batchesReceived) * 100) / 100,
  });
}

// ───────────────────────── 串流控制 ─────────────────────────

/**
 * 「還沒跑」的快照。**切 mode 與重跑都必須送這一份，而且鍵要送滿。**
 *
 * `runtime.ts` 的 `handleSetMode()` 只歸零掉幀窗與峰值，**沒有清 collector 的 custom**
 *（`metrics.ts:174` 的 `reset()` 只有 `host:reset` 那條路徑會走）。
 * 所以任何一個沒被新 mode 覆寫的鍵，都會原封不動地掛在新 mode 頭上 ——
 * 這正是 2026-07-25 抓到的 `droppedFramesPeak` 缺陷的同一個坑，
 * 而 `renderFrameGapMedianMs` 這種「整輪只送一次」的鍵最容易掉進去。
 * **在 `stopStream()` 加一個鍵，就要在這裡加一個 0**，兩份鍵集必須逐字對齊。
 *
 * `renderFrameSamples: 0` / `allFrameSamples: 0` 是這份快照的誠實聲明：樣本數為零時，
 * 旁邊那幾個幀距欄位代表「這一輪還沒量」，不是「量到 0」。
 */
function emitIdleSnapshot(): void {
  ctxRef?.emit({
    deviceCount: devices.length,
    pushIntervalMs: PUSH_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    batchesReceived: 0,
    batchesRendered: 0,
    rendersSkipped: 0,
    updatesApplied: 0,
    renderScriptMs: 0,
    frameGapMs: 0,
    renderFrameGapMedianMs: 0,
    renderFrameGapP75Ms: 0,
    renderFrameSamples: 0,
    allFrameGapMedianMs: 0,
    allFrameGapP75Ms: 0,
    allFrameGapMaxMs: 0,
    allFrameSamples: 0,
    catchupClamped: 0,
    renderRatio: 0,
  });
}

function paintStatus(): void {
  if (!statusEl) return;
  statusEl.textContent =
    `${lastRenderHow} · 這一次 JS ${round1(renderScriptMs)}ms / 上一幀 ${round1(lastFrameGapMs)}ms` +
    ` · 收到 ${batchesReceived} 批 / 渲染 ${batchesRendered} 次` +
    (rendersSkipped > 0 ? ` / 背壓跳過 ${rendersSkipped} 次` : '');
}

/** 唯一的 click 進入點。名字不准包匿名箭頭，理由同其他標本 */
function toggleStreamOnClick(): void {
  if (streaming) {
    stopStream('手動停止');
    return;
  }
  ctxRef?.mark(`rerender-storm:start:${currentMode}`);
  // 每次開始都重置種子：同一個 mode 的第二輪必須推送與第一輪一模一樣的資料，
  // 否則兩輪之間差的不只是「渲染策略」，還有「這輪剛好比較多台變 離線」。
  //
  // 補發不會破壞決定性：每批固定消耗 BATCH_SIZE 次 rand()、批次嚴格按序產生，
  // 所以「種子決定的資料序列」與「哪幾批落在同一幀」完全無關。
  // 時間只影響分組，不影響內容。
  rand = mulberry32(DATASET_SEED);
  resetCounters();

  streaming = true;
  streamStartedAt = performance.now();
  if (startButton) startButton.textContent = `推送中…（${STREAM_DURATION_MS / 1000} 秒後自動停止）`;
  pushTimer = window.setInterval(pushDeviceBatch, PUSH_INTERVAL_MS);
  stopTimer = window.setTimeout(() => stopStream('時間到'), STREAM_DURATION_MS);
  rafId = requestAnimationFrame(onAnimationFrame);
}

function stopStream(why: string): void {
  streaming = false;
  window.clearInterval(pushTimer);
  window.clearTimeout(stopTimer);
  pushTimer = 0;
  stopTimer = 0;
  if (rafId !== 0) cancelAnimationFrame(rafId);
  rafId = 0;
  lastFrameAt = 0;
  if (startButton) startButton.textContent = '開始推送';

  /*
   * 幀距的 median 只在這裡算一次。
   * 放進 finishRender 的話，每渲染一次就要排序最多 300 筆 —— 那會變成量測本身的負載，
   * 而且只加在渲染次數多的那一臂身上。
   *
   * 用 median 不用 mean：一幀裡若混進外殼的 flush（每 250ms 一次）或 GC，
   * 那筆幀距就含了別人的工作，mean 會被單一離群值拉走（`device.ts:49` 同一個理由）。
   *
   * ⚠️ **兩組樣本，只有一組能拿來跨臂判定。**（2026-07-26 修正）
   *
   * `renderFrameGaps` —— 只收「這一幀有渲染」的幀距。**判定用這一組。**
   * `frameGaps` —— 每一幀都收，含背壓跳過的便宜幀。**不准用於跨臂判定。**
   *
   * 理由不是口味問題，是它會複製本站已經犯過一次的錯：背壓臂的分布是
   * 少數約 100ms 的渲染幀混大量 16.7ms 的跳過幀（離散模擬：27 對 140），
   * 於是全部幀的 median 與 p75 **雙雙落在 16.7ms、與細粒度臂逐欄完全相同** ——
   * 跟已發出文章第二節罵的「治療二與治療三六輪逐欄相同」是同一個病。
   * 唯一分得開那兩臂的是 max，而 max **明文不准用於跨輪判定**
   *（`protocol.ts:290`「抗離群。可重現性判定用這個，不用 max」）。
   * 所以分開兩組，讓判定欄自己就是抗離群統計量。
   *
   * `allFrameGap*` 仍然上報，因為它是「使用者實際看到的畫面更新節奏」，
   * 而背壓的代價正好藏在兩組的差裡（渲染幀 100ms、但有 140 幀顯示的不是最新值）。
   * 它是誠實欄，不是判定欄 —— 欄名前綴就是這個意思。
   */
  const renderGapStats = computeRunStats(renderFrameGaps);
  const gapStats = computeRunStats(frameGaps);
  const finalMetrics: Record<string, number> = {
    batchesReceived,
    batchesRendered,
    rendersSkipped,
    updatesApplied,
    catchupClamped,
  };
  // 沒串流過就不要上報 0：「沒量到」與「真的是 0」併成同一個值，
  // 方向永遠偏向「治療完美」——`analyze-repro.mjs` 的 clsValue 就是栽在這裡。
  if (renderGapStats.n > 0) {
    finalMetrics.renderFrameGapMedianMs = round1(renderGapStats.median);
    finalMetrics.renderFrameGapP75Ms = round1(renderGapStats.p75);
    finalMetrics.renderFrameSamples = renderGapStats.n;
  }
  if (gapStats.n > 0) {
    finalMetrics.allFrameGapMedianMs = round1(gapStats.median);
    finalMetrics.allFrameGapP75Ms = round1(gapStats.p75);
    // max 只給人看離群值，**不可用於跨輪或跨臂判定**（protocol.ts:290）。
    finalMetrics.allFrameGapMaxMs = round1(gapStats.max);
    finalMetrics.allFrameSamples = gapStats.n;
  }

  if (statusEl) {
    statusEl.textContent =
      `已停止（${why}）· 收到 ${batchesReceived} 批 / 渲染 ${batchesRendered} 次` +
      (rendersSkipped > 0 ? ` / 背壓跳過 ${rendersSkipped} 次` : '') +
      (renderGapStats.n > 0
        ? ` · 有渲染的幀 ${renderGapStats.n} 格、median ${round1(renderGapStats.median)}ms`
        : '') +
      (gapStats.n > 0 ? ` · 全部幀 median ${round1(gapStats.median)}ms（含跳過的便宜幀，不用於判定）` : '') +
      (catchupClamped > 0 ? ` · ⚠️ 補發被砍 ${catchupClamped} 批，此輪作廢` : '') +
      ` · 主指標看面板的 droppedFrames 峰值（滾動窗會衰減，要看峰值），` +
      `但病變與治療一在 ${DEVICE_COUNT} 台之下都會飽和 —— 那一對要看上面的「有渲染的幀 median」`;
  }
  ctxRef?.emit(finalMetrics);
}

// ───────────────────────── DOM ─────────────────────────

function buildDevices(): Device[] {
  const seed = mulberry32(DATASET_SEED);
  const out: Device[] = new Array<Device>(DEVICE_COUNT);
  for (let i = 0; i < DEVICE_COUNT; i++) {
    out[i] = {
      id: `DEV-${String(i).padStart(3, '0')}`,
      name: NAMES[(seed() * NAMES.length) | 0],
      state: STATES[(seed() * STATES.length) | 0],
      value: Math.round(seed() * 1000) / 10,
    };
  }
  return out;
}

/** 建一次列，並記下每列的兩個文字節點 —— 細粒度模式靠這份參照才不必查 DOM */
function buildRowNodes(): void {
  if (!listEl) return;
  const frag = document.createDocumentFragment();
  const nodes: DeviceRow[] = new Array<DeviceRow>(devices.length);
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    const li = document.createElement('li');
    li.className = 'rs-row';
    const name = document.createElement('span');
    name.textContent = `${d.id} ${d.name}`;
    const state = document.createElement('span');
    state.className = 'rs-state';
    state.textContent = d.state;
    const value = document.createElement('span');
    value.className = 'rs-value';
    value.textContent = `${d.value.toFixed(1)}%`;
    li.append(name, state, value);
    frag.appendChild(li);
    nodes[i] = { root: li, state, value };
  }
  listEl.replaceChildren(frag);
  rowNodes = nodes;
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  listenerAbort = new AbortController();

  root.innerHTML = `
    <style>
      /* 量測條件：列高與欄寬決定整表重建時要算多少版面 */
      #rs-list { margin: 0; padding: 0; list-style: none; height: 380px; overflow-y: auto; border: 1px solid #999; }
      .rs-row { display: flex; gap: 12px; height: 22px; line-height: 22px; font-size: 13px; box-sizing: border-box; }
      .rs-row > span:first-child { width: 150px; }
      .rs-state { width: 60px; }
      .rs-value { width: 60px; text-align: right; }
    </style>

    <h1>標本 #6 —— re-render 風暴</h1>
    <p>模擬 WebSocket 每 ${PUSH_INTERVAL_MS}ms 推一批 ${BATCH_SIZE} 台裝置的狀態更新，共 ${DEVICE_COUNT} 台。
       病變版每收到一批就重建整張清單 —— 每秒 ${Math.round(1000 / PUSH_INTERVAL_MS)} 次全表重繪。
       <strong>整表重建一次的真實成本實測約 ${FULL_REBUILD_FRAME_MS}ms ≈ 5.7 幀</strong>（4x 節流），
       所以病變版是「一幀之內重建六七次整表，而瀏覽器只排版一次」。</p>
    <p><small>誠實欄：補發是同步迴圈，七批在同一個 task 裡跑完，因此那七次重建
       <strong>共用一次排版</strong>。真的 WebSocket 是七個獨立 task，瀏覽器可能在其間各排版一次 ——
       也就是說這一頁量到的是病變的<strong>下界</strong>，偏差方向對治療有利。
       這是刻意的建模選擇：拆成獨立 task 會讓「一幀塞幾批」變成不可重現的變因。</small></p>
    <p><strong>按一次「開始推送」，然後靜置 ${STREAM_DURATION_MS / 1000} 秒不要碰畫面。</strong>
       串流會自動停止 —— 串流長度是凍結變因，不能靠手感計時。</p>

    <p><button id="rs-start" type="button">開始推送</button></p>
    <p id="rs-status">尚未開始</p>
    <ul id="rs-list"></ul>

    <details>
      <summary>三段治療各自解決什麼</summary>
      <p>治療梯度是<strong>樹狀不是鏈狀</strong>：治療二與治療二乙都接在治療一之後，
         各自相對治療一只翻一個變因。</p>
      <ol>
        <li><strong>治療一 · 批次化 + rAF</strong>（翻的變因：<em>渲染的時機</em>）
            把「每收到一批渲染一次」改成「每幀最多渲染一次」。
            每次的 DOM 工作量一模一樣，變的只有頻率 ——
            這一臂的一幀是 ${FULL_REBUILD_FRAME_MS}ms（整表重建的真實成本），
            所以一幀之內會收到 ${FULL_REBUILD_FRAME_MS}÷${PUSH_INTERVAL_MS} ≈
            ${BATCHES_PER_REBUILD_FRAME.toFixed(1)} 批，合併成一次重建。</li>
        <li><strong>治療二 · 只改變動的節點</strong>（接在治療一之後，翻的變因：<em>每一次的成本</em>）
            不重建 ${DEVICE_COUNT} 列，只改真的變了的那幾個文字節點。
            每次的成本從 O(全部) 降到 O(變動數)。</li>
        <li><strong>治療二乙 · 背壓降頻</strong>（同樣接在治療一之後，翻的變因：<em>渲染的次數</em>）
            上一幀的<strong>實測幀距</strong>超出一幀預算多少，就主動讓出多少時間，
            那幾幀不渲染。<strong>代價是畫面在那幾幀顯示的不是最新值</strong> ——
            這是取捨不是免費的勝利，所以「跳過幾次」有上報。</li>
      </ol>
      <p>背壓<strong>不</strong>疊在治療二之後。理由是<strong>實證的，不是解析上界</strong>：
         三輪實測細粒度臂每幀只改約 180 列、掉幀峰值 4~8 幀
         （等於本站量到的雜訊底線 5 幀），它的幀從來沒有超出過一幀預算，
         背壓閘門因此一次都沒有可觸發的機會（<code>rendersSkipped</code> 恆為 0）。
         疊在那裡它就是一段永遠不執行的程式碼。</p>
      <p><small>這裡刻意<strong>不</strong>宣稱「不可能觸發」。要宣稱上界，得先量到
         「一幀改 ${DEVICE_COUNT} 個文字節點的<strong>真實幀成本</strong>」，而那從來沒有量過 ——
         舊版寫的「單筆 11.6µs × ${DEVICE_COUNT} = 11.6ms &lt; 16.7ms」是拿
         <strong>自報耗時</strong>除出來的，而自報值系統性低估真實幀成本約 7.5 倍
         （它抓不到 style / layout / paint）。用一個已知會低估的數字去證明「不可能超過」，
         是用同一個缺陷證明另一件事。判準登記在案：這一輪若量到細粒度臂
         <code>rendersSkipped &gt; 0</code>，上面那段理由就倒了，要整段重寫。</small></p>
    </details>
  `;

  listEl = root.querySelector<HTMLElement>('#rs-list')!;
  statusEl = root.querySelector<HTMLElement>('#rs-status')!;
  startButton = root.querySelector<HTMLButtonElement>('#rs-start')!;
  startButton.addEventListener('click', toggleStreamOnClick, { signal: listenerAbort.signal });

  // 一幀該多久由實測決定。這裡與 FrameCounter 各跑一次取樣（各約 350ms，只做算術），
  // 是「量測本身的開銷」帳上多的一筆 —— 長期解是讓 SpecimenContext 直接帶 refreshHz 下來。
  void measureRefreshHz().then((hz) => {
    targetFrameMs = 1000 / hz;
  });

  devices = buildDevices();
  buildRowNodes();

  emitIdleSnapshot();
}

/**
 * A 類 live 切換。**串流一律停掉**：讓上一個 mode 的推送溢進新 mode，
 * 量到的就是兩種策略的混合，而面板上看起來只是「數字有點怪」。
 */
function setMode(mode: string): void {
  stopStream('切換 mode');
  currentMode = mode;
  resetCounters();
  // 整表重建模式跑過之後 rowNodes 是空的（節點被換掉了）。
  // 切回細粒度模式前必須重建參照，否則它會對著已經不在文件裡的節點寫入 ——
  // 畫面不動、程式不報錯，是最難查的那種安靜失敗。
  devices = buildDevices();
  buildRowNodes();
  if (statusEl) statusEl.textContent = `已切換到 ${mode}，尚未開始`;
  emitIdleSnapshot();
}

function reset(): void {
  stopStream('重跑');
  resetCounters();
  devices = buildDevices();
  buildRowNodes();
  if (statusEl) statusEl.textContent = '尚未開始';
  emitIdleSnapshot();
}

/**
 * 驗收第 12 條。這一頁的殘留物最多：setInterval、setTimeout、rAF、click listener。
 * 其中 setInterval 是最兇的 —— 沒清掉的話，切走之後它會永遠每 `PUSH_INTERVAL_MS`
 * 產生一次 origin === 'specimen' 的工作，而下一個標本的數字全部掛在它頭上。
 * rAF 迴圈同理：它現在四個 mode 都在跑，漏停一樣會汙染下一個標本。
 */
function destroy(): void {
  stopStream('destroy');
  listenerAbort?.abort();
  listenerAbort = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  listEl = null;
  statusEl = null;
  startButton = null;
  ctxRef = null;
  devices = [];
  rowNodes = [];
  pending.clear();
}

const mod: SpecimenModule = {
  meta: RERENDER_STORM_META,
  mount,
  setMode,
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
