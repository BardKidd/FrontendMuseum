/**
 * 標本 #1 —— 主執行緒阻塞。
 *
 * 病變：在 click handler 裡同步排序五萬筆訂單。
 * 單獨點一下只會看到自己的 handler 很慢；要照凍結的操作程序連續點十次，
 * 才會看到第 2..10 次點擊排在 task queue 裡等主執行緒 ——
 * 那才是使用者感覺到的「整個網站死掉」（spec §4.1）。
 *
 * **操作程序是機器節拍，不是「模擬使用者連打」，也不是「越快越好」。**
 * 每 `CLICK_INTERVAL_MS` 派送一發、共 `CLICK_REPETITIONS` 發、不等畫面回應，
 * 而且是**絕對排程**：第 k 發打在 `t0 + k × I`，不是「上一發回來之後再等 I」——
 * 後者會被主執行緒的忙碌反過來決定節拍，那就不是凍結變因。
 * 值與完整推導登記在 `docs/phase1-expected-results.md` 的修正紀錄，這裡只記三條邊界：
 *
 *   **上界** I < S（單次排序成本），否則第 2..10 發不排隊，標本退化成標本 #3 的複製品。
 *     S 的 4x 實測是 116~122ms，但登記的 1x 預期是 25~60ms，而 `tools/acceptance.mjs`
 *     跑在 1x —— **綁住上界的是 1x 的 25ms，不是 4x 的 120ms**。
 *   **下界** I ≥ 一個 60Hz 幀（16.67ms）。比一幀還快的節拍，平台本來就不可能替每一發
 *     分別呈現一次回應，量到的是驅動器不是頁面；而且 Node 計時器的 ±1~2ms 抖動
 *     在更小的間隔上會超過 10%。契約的 `intervalMs` 是整數，所以**向上**取整 ——
 *     取 16 會讓宣告的下界自己不成立（16 < 16.67），而且會跟
 *     `MEASURE_CONFIG.eventDurationThreshold = 16` 撞成同一個數字，兩者毫無關係。
 *   **斜率** `inputDelay_k ≈ (k−1) × (S − I)`，backlog 每拍成長 `1 − I/S` 份。
 *     這是一條寫得出算式的階梯，不是「手速決定」。
 *
 * **人手做不到這個節奏，而且人手做的是另一個實驗**：人連打約 150ms 一下，
 * 而 150ms > S ⇒ 完全不排隊 —— 探針實測 INP 120ms、兇手 processing（`docs/phase2-expected-results.md`）。
 * 所以這一格的數字只在機器驅動下成立，散文不准寫成「模擬連打」。
 * 2026-07-26 之前這裡宣告的是 `intervalMs === null`（盡快連續）——
 * 那不是一個值，是「驅動器有多快就多快」，沒有人宣告、沒有人量、換台機器複製不出來。
 *
 * ⚠️ **§4.2 那個坑先答：這十發不會被併成同一個 `interactionId`。**
 * 機制上 `interactionId` 是按 pointerdown/pointerup **配對**產生的，一組配對一個新 id，
 * 與兩組之間隔多久無關（時間窗只影響鍵盤組字與拖曳的判定）；而既有資料是
 * **零間隔**一次灌完十發，三個 mode × 三輪的 `totalInteractions` 全部是 10
 *（`docs/measurements/2026-07-25-reproducibility-4x.json`）。零間隔都沒有併，
 * `CLICK_INTERVAL_MS` 這種量級的間隔更不會。
 * 但「我推論它不會」不是護欄。所以標本自報 `clicksReceived`，事後對照外殼的
 * `totalInteractions`：兩者與 `CLICK_REPETITIONS` 三者不相等時，這一輪的 INP 分母就是錯的。
 *
 * ⚠️ **兇手段的登記值（inputDelay）與實測（presentation）不符，而且不是間隔造成的。**
 * 理由見 `runSynchronousSort` 的註解：同步 handler 讓十次點擊共用同一次 paint。
 * 這是結構性的，任何間隔都改不掉，登記在 `docs/phase1-expected-results.md` 的修正紀錄裡當未裁決項。
 * 階梯本身仍然要看得見 —— 標本自報 `inputLagMaxMs`（handler 進入時刻 − 事件產生時刻），
 * 它不經過 INP 的取樣規則，所以 INP 看不到的那條階梯在它身上是顯形的。
 *
 * 全檔原生 DOM，不用框架：框架的排程與批次更新會替你緩解一部分反模式，
 * 量到的就不是純粹的反模式了（spec §3.1）。這是核心決策，不是風格偏好。
 */
import type { EpochMs, SpecimenContext, SpecimenModule } from '../src/protocol';
import { MAIN_THREAD_BLOCK_META } from '../src/specimens';
// 只借型別。import type 在 build 階段整句被抹掉，所以主檔與 worker 檔之間
// 沒有任何 runtime 相依 —— worker bundle 絕對不能 import 這支主檔，
// 否則 bootstrapSpecimen 會在 worker 裡再跑一次。
import type { SortRequest, WorkerOutbound } from './01-main-thread-block.worker';

// ───────────────────────── 資料集 ─────────────────────────

/** 訂單筆數。worker 檔以 import type 借用這個形狀，兩邊必須是同一個定義 */
export interface Order {
  id: string;
  customer: string;
  region: string;
  amount: number;
  /** epoch ms */
  placedAt: number;
  priority: 'urgent' | 'high' | 'normal' | 'low';
}

export interface RegionSummary {
  region: string;
  count: number;
  total: number;
  /** 排序後該區的第一筆 —— 有排序才有這個欄位，所以它證明排序真的跑完了 */
  topOrderId: string;
}

const ORDER_COUNT = 50_000;

/**
 * 固定種子。用 Math.random() 的話每次 mount 的資料分佈都不同，
 * 排序的實際比較次數也就不同 —— 可重現性是本站的整個論點，
 * 為了一點「真實感」把它賠掉是最划不來的交易。
 */
const DATASET_SEED = 20240117;

const REGIONS = ['北北基', '桃竹苗', '中彰投', '雲嘉南', '高屏', '宜花東'];
const CUSTOMER_PREFIXES = ['永昌', '合豐', '正泰', '鴻運', '明德', '大安', '和成', '嘉禾'];
const PRIORITIES: Array<Order['priority']> = ['urgent', 'high', 'normal', 'low'];
const PRIORITY_RANK: Record<Order['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** mulberry32 —— 32 bit 種子、無相依、十行。夠亂，而且每次跑出同一組資料 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function nextRandom(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateOrders(count: number): Order[] {
  const rand = mulberry32(DATASET_SEED);
  const base = Date.UTC(2024, 0, 1);
  const out: Order[] = new Array<Order>(count);
  for (let i = 0; i < count; i++) {
    out[i] = {
      id: `ORD-${String(i).padStart(6, '0')}`,
      customer: `${CUSTOMER_PREFIXES[(rand() * CUSTOMER_PREFIXES.length) | 0]}企業`,
      region: REGIONS[(rand() * REGIONS.length) | 0],
      amount: Math.round(rand() * 480_000) / 100,
      placedAt: base + Math.floor(rand() * 365 * 86_400_000),
      priority: PRIORITIES[(rand() * PRIORITIES.length) | 0],
    };
  }
  return out;
}

/**
 * 真的有內容的多鍵比較器：先急件、同級金額大的在前、同額先到先出。
 * 刻意不是「五萬次空迴圈」—— 那種假負載會讓讀者覺得「真實專案不會這樣寫」，
 * 標本再準也失去說服力（陷阱 #17）。
 */
function compareOrders(a: Order, b: Order): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  if (a.amount !== b.amount) return b.amount - a.amount;
  return a.placedAt - b.placedAt;
}

function summarizeByRegion(sorted: readonly Order[]): RegionSummary[] {
  const acc = new Map<string, RegionSummary>();
  for (const order of sorted) {
    const hit = acc.get(order.region);
    if (hit) {
      hit.count += 1;
      hit.total += order.amount;
    } else {
      // 走到這裡代表這是排序後該區出現的第一筆 = 該區的第一名
      acc.set(order.region, {
        region: order.region,
        count: 1,
        total: order.amount,
        topOrderId: order.id,
      });
    }
  }
  // 六列的排序成本可忽略，但輸出順序必須決定性，否則每輪畫面不同會被誤讀成資料不穩
  return [...acc.values()].sort((x, y) => y.total - x.total || x.region.localeCompare(y.region));
}

// ───────────────────────── 標本狀態 ─────────────────────────

/** 每 chunk 的 wall clock 預算。5ms 是「一幀還來得及做別的事」的經驗值 */
const CHUNK_BUDGET_MS = 5;
/** 切 chunk 版的基底段長。4096 筆的原生 sort 遠低於 5ms，所以單段不會爆預算 */
const BASE_BLOCK = 4096;

interface SpecimenDom {
  status: HTMLElement;
  summary: HTMLElement;
}

let ctxRef: SpecimenContext | null = null;
let listenerAbort: AbortController | null = null;
let rootRef: HTMLElement | null = null;
let dom: SpecimenDom | null = null;

let currentMode = 'broken';
let orders: Order[] = [];

/**
 * 節拍與次數直接讀 META，不在這裡寫第二份 ——
 * 註解、頁面文案與凍結契約只留一個來源，改 META 不會留下一句過期的文字。
 *
 * 契約允許 `intervalMs === null`（= 盡快連續），但**這個標本不准是 null**，
 * 所以這裡**丟例外**而不是靜默降級成一句「間隔未宣告」的文案。
 * 靜默降級的後果是頁面照樣印得出東西、面板照樣有數字，而那些數字底下沒有
 * 一個凍結的操作程序 —— 那正是這個標本 2026-07-26 之前的狀態。
 */
function requireDeclaredInterval(value: number | null): number {
  if (value === null) {
    throw new Error(
      '標本 #1 的 protocol.intervalMs 是 null。這個標本的整條論證建立在「已宣告的節拍」上：' +
        'inputDelay_k ≈ (k−1)(S − I) 需要一個寫得出來的 I，而「盡快」不是一個值。' +
        '請到 src/specimens.ts 的 MAIN_THREAD_BLOCK_META.protocol 填入節拍值。',
    );
  }
  return value;
}

const CLICK_INTERVAL_MS = requireDeclaredInterval(MAIN_THREAD_BLOCK_META.protocol.intervalMs);
const CLICK_REPETITIONS = MAIN_THREAD_BLOCK_META.protocol.repetitions;
/** 60Hz 的一幀。節拍的下界（見檔頭），也是頁面上「這有多快」的參照物 */
const FRAME_MS_60HZ = 1000 / 60;
/**
 * 頁面文案唯一的來源。節拍值不准在散文裡再寫死一次 ——
 * 「幾個幀」也是算出來的，改 META 之後這句話不會變成謊話。
 */
const CLICK_CADENCE_COPY =
  `每 ${CLICK_INTERVAL_MS}ms 一發（機器節拍，約 ${(CLICK_INTERVAL_MS / FRAME_MS_60HZ).toFixed(1)} 個 60Hz 幀）`;
/** 十發打完的理論跨度 =（發數 − 1）× 節拍。護欄用它判定驅動器有沒有照節拍派送 */
const CLICK_SPAN_EXPECTED_MS = (CLICK_REPETITIONS - 1) * CLICK_INTERVAL_MS;

/**
 * 已跑完的排序次數。**跑完 protocol 之後三個 mode 都必須等於 CLICK_REPETITIONS。**
 * 這是「兩臂做的是同一份工作量」的護欄，不是統計欄位 ——
 * 2026-07-26 之前治療臂會取消被後續點擊蓋掉的工作，三輪實測是病變版 10、
 * 兩段治療各 1，於是比值比的不是同一份工作（見 enqueueChunkedSort 的誠實揭露二）。
 *
 * ⚠️ **它同時是驅動器的收斂訊號。** 驅動器不准用固定 sleep 判定一輪跑完 ——
 * 病變版最後一發點擊之後還要 drain 約 1.16 秒（10 × S），治療一更久（十份切 chunk 的工作）。
 * 沒跑完就收的失敗是**無聲的**：記成 `completedSorts 9 / cancelledSorts 0`，
 * 護欄看起來乾淨；接著「重跑」觸發 `reset()`，殘工被作廢並記進**下一輪**的
 * `cancelledSorts`，於是下一輪的基線帶著一個非零值。
 * 正確判定：輪詢 `custom.completedSorts === CLICK_REPETITIONS`。
 */
let completedSorts = 0;
/**
 * 被**作廢**的切 chunk 排序份數（在途那一筆 + 還沒開始的佇列）。
 *
 * ⚠️ 語意換過兩次，讀這個數字之前先確認你讀的是哪一版：
 * 2026-07-25 之前數的是「被下一次點擊蓋掉」（治療臂偷工的證據）；
 * 治療臂改成排隊之後，這裡只數「切 mode / reset 之後才停下來的在途工作」。
 *
 * **非 0 的正確診斷有三種，先前只寫了第一種而且把它當成唯一解釋：**
 *   1. `setMode()` 作廢的 —— 舊 mode 的工作停在新 mode 的窗裡，**這一輪混了上一個 mode 的主執行緒時間**。
 *   2. `reset()` 作廢的 —— 來源是**上一輪同一個 mode**沒有 drain 完就被「重跑」打斷。
 *      這一輪的 mode 沒有混，混的是**上一輪的殘工**。當初的註解把這種情況一律
 *      診斷成第 1 種，而收斂條件是固定 sleep 的年代，第 2 種才是實際會發生的那一種。
 *   3. 兩者都不是 —— 那就是 `abandonInFlightSorts()` 被別的路徑呼叫了，去找那條路徑。
 * 跨 mode 的 worker 過期回覆**不再記在這裡**（見 `staleWorkerReplies`）：
 * 那是另一種現象，混在同一個計數器裡就分不出上面三種診斷。
 *
 * 判準：一輪量測結束時三個 mode 都必須是 0，而且**本輪開始時**也必須是 0。
 */
let cancelledSorts = 0;
/**
 * 跨世代（跨 mode / 跨 reset）的 worker 過期回覆數。
 * 從 `cancelledSorts` 拆出來：它描述的是「回覆回來時使用者已經切走了」，
 * 與「切 chunk 的工作被作廢」是兩件事，混在一起會讓上面那三種診斷全部失效。
 */
let staleWorkerReplies = 0;

// ───────────────────────── 節拍護欄（事後可查，不靠註解）─────────────────────────

/**
 * 收到的點擊次數。**與外殼的 `totalInteractions` 是兩件事**，而正是這一對回答 §4.2：
 *   `clicksReceived < repetitions`                    ⇒ 驅動器漏派（派送問題，不是量測問題）
 *   `clicksReceived === repetitions` 但 `n < 10`      ⇒ **Event Timing 真的把多發併成一次互動**，
 *                                                        本輪 INP 的分母是錯的，整輪作廢
 *   `n > repetitions`                                  ⇒ 有 protocol 以外的互動混進來
 */
let clicksReceived = 0;
/** 第一發與最後一發的 `event.timeStamp`（事件產生時刻，不是 handler 被呼叫的時刻）*/
let firstClickAt = 0;
let lastClickAt = 0;
/**
 * 標本自己量到的 input delay 上界：handler 進入時刻 − 事件產生時刻。
 *
 * 這是 Event Timing `inputDelay`（processingStart − startTime）的同義量，但**不經過
 * INP 的取樣規則** —— INP 取 max duration，選中的恆是第一發（見 runSynchronousSort），
 * 而第一發沒有排隊，於是那條階梯在面板上是隱形的。這個欄位把它顯形。
 * 它同時是「驅動器到底有沒有讓事件排隊」的唯一直接證據：
 * 逐次等回應的驅動器會讓它趨近 0（實測 0.5~2.8ms），照節拍派送則約 `(N−1)(S − I)`。
 * 標本不准自己註冊 PerformanceObserver（spec §3.3），所以這條證據只能這樣拿。
 */
let inputLagMaxMs = 0;

/** 進行中的 chunk 排序。物件身分本身就是這一輪的識別碼 */
let inFlight: { cancelled: boolean } | null = null;
/**
 * 已入列、還沒開始跑的點擊數。
 * 不變式：`pendingSorts > 0` ⟺ 有一條 drainer 在跑（`enqueueChunkedSort` 保證只會有一條）。
 */
let pendingSorts = 0;
/** 本 mode 內 pendingSorts 的峰值。排隊的代價要看得見，不能只寫在註解裡 */
let peakQueueDepth = 0;

let worker: Worker | null = null;
/**
 * 世代。每次 setMode / reset / terminate 遞增，**只**用來判定「跨 mode 的在途回覆」。
 * 先前這個計數器叫 workerRunId，同時兼「請求序號」與「世代」兩種語意 ——
 * 於是每次點擊都推進一格，第 k 筆回覆一律被第 k+1 筆的送出判定成過期，
 * completedSorts 因此永遠是 1。那描述的是渲染次數，不是工作量。
 */
let workerGeneration = 0;
/** 本 mode 內的請求序號，從 1 起。用來把回覆對回它自己那一筆的送出時刻 */
let workerSeq = 0;
/**
 * seq → 該筆的送出時刻與主執行緒序列化成本。
 * 用 Map 而不是單一全域變數：十筆請求同時在途時，全域變數會讓第 k 筆的往返
 * 算到最後一次 postMessage 的時刻上，量到的就不是往返。
 */
const workerSends = new Map<number, { sentAt: EpochMs; serializeMs: number }>();
/**
 * seq === 1 那筆的 transferMs —— 它是**單趟結構化複製**的成本，前提是 worker 已經開機。
 * 第 k 筆的 transferMs 含 worker 先處理前 k−1 筆的佇列等待，兩者差一個數量級；
 * 不分開上報就會被讀成「搬運這批資料比排序它貴 20 倍」（第一篇文章踩過這個坑）。
 *
 * ⚠️ **兩個必須跟著它一起讀的限制，少一個這個數字就會被讀錯：**
 *  1. **它跨越兩條執行緒，而兩條執行緒不一定在同一個節流率下。**
 *     transferMs = worker 收到的時刻 − 主執行緒送出的時刻，前半段（序列化）在
 *     4x 的主執行緒上、後半段（反序列化）在 worker 上。`threadSpeedRatio` ≈ 4 時
 *     它是一個**混口徑**的數字，不可以拿去跟任何單一執行緒的成本相除。
 *  2. **它必須在 worker 已經開機之後才乾淨。** `workerColdStart === 1` 時這一筆
 *     含 worker 的建立與模組編譯成本，直接作廢（見 ensureWorker / workerBootMs）。
 */
let workerFirstTransferMs: number | null = null;
/** `new Worker()` 的時刻（epoch）。與 worker 回報的 readyAt 相減得到開機成本 */
let workerCreatedAt: EpochMs = 0;
/** worker 已回報 ready。第一發請求送出時它若是 false，`workerColdStart` 會被標起來 */
let workerReady = false;
/**
 * worker 開機成本：`new Worker()` 到 worker 模組頂層開始執行。
 * 拆出來報而不是讓它藏在第一筆 transferMs 裡 —— 它是**真實成本**（治療二第一次用一定要付），
 * 但它不是「搬運五萬筆資料」的成本，兩者混在一起就沒有一個數字是能引用的。
 */
let workerBootMs: number | null = null;
/** worker 端的校準迴圈耗時。與 mainCalibrationMs 相除 = 兩條執行緒的相對速度 */
let workerCalibrationMs: number | null = null;
let workerCalibrationChecksum: number | null = null;
/** 1 = 第一發請求送出時 worker 還沒 ready ⇒ workerFirstTransferMs 不可用 */
let workerColdStart = 0;

/**
 * ───────────── 執行緒相對速度校準（「worker 比較快」的唯一防偽）─────────────
 *
 * `protocol.ts:55` 寫著「CPU throttle 無法從 JS 偵測，只能宣告」—— 那句話對的是
 * **絕對**節流率。**相對**節流率量得到：同一段定量工作在主執行緒與 worker 各跑一次，
 * 比值就是兩條執行緒的速度比。
 *
 * 為什麼非量不可：既有三輪的 `workerSortMs` 是 28.4~29.0ms，而**同一份排序**在
 * 主執行緒是 116~122ms，比值 **4.2 ≈ 宣告的節流率**。
 * `Emulation.setCPUThrottlingRate` 只節流了主執行緒，worker 全速跑 ——
 * 那是一個**對治療臂有利**的混淆變因，不揭露就等於拿未節流的數字宣稱 worker 比較快。
 * 這個標本以前把它寫成「本檔唯一剩下的混淆變因，而它是保守方向的」，那句話是錯的，
 * 而且用 repo 自己的資料就否證得掉。
 *
 * 校準迴圈跑在 mount 與 worker 開機時，兩者都在量測窗外（後面還有 500ms 暖機窗）。
 * checksum 一併上報：兩邊的 checksum 相等才能證明兩條執行緒跑的是同一段程式，
 * 比值才有意義（同 標本 #3 的 layoutChecksum）。
 */
const CALIBRATION_ITERATIONS = 4_000_000;

/**
 * ⚠️ 這個函式在 worker 檔案裡有一份**逐字相同**的複製（worker 不准 import 本檔的 runtime 值）。
 * 兩份不一致，比值就不是比值 —— 改一邊就要改另一邊。
 */
function calibrationSpin(iterations: number): number {
  let acc = 0;
  // 有回傳值而且被上報，優化器不能整段消掉；Math.imul 保證是整數乘法，跨執行緒同成本
  for (let i = 1; i <= iterations; i++) acc = (acc + Math.imul(i, 2654435761)) >>> 0;
  return acc;
}

let mainCalibrationMs = 0;
let mainCalibrationChecksum = 0;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 每次 emit 都帶上的節拍護欄。三個欄位加起來就是「這一輪的派送到底長什麼樣」，
 * 而且完全不依賴 LoAF 選幀（`specimenScript` 那條 trip-wire 就是被選幀咬死的：
 * 同一組條件三輪跑出 72.1 / 1340.9 / 1225.4）。
 */
function cadenceGuardrail(): Record<string, number> {
  return {
    clicksReceived,
    clickSpanMs: round1(clicksReceived > 1 ? lastClickAt - firstClickAt : 0),
    inputLagMaxMs: round1(inputLagMaxMs),
  };
}

// ───────────────────────── 讓出主執行緒（治療一的教學內容）─────────────────────────

/**
 * scheduler.yield() 不存在時的退路。
 *
 * **兩者的差別就是本標本要教的東西，所以它故意寫在這裡，不抽成共用 util（spec §5.3）。**
 * - scheduler.yield()：讓出之後以**較高的續跑優先權**回來，續跑會排在讓出期間
 *   新進的同級任務**前面**，長工作不會被餓死。
 * - MessageChannel / setTimeout(0)：排到隊尾。十發點擊在 `CLICK_SPAN_EXPECTED_MS`
 *   之內全部到齊的情境下，每讓出一次就被新的 click task 插隊一次，
 *   chunk 之間的間隔會被拉得非常長。
 * 支援度：Chrome / Edge / Firefox 有，**Safari 沒有**，不是 Baseline。
 */
function messageChannelYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      // port 不關會一直被 event loop 抓著，destroy 之後仍算殘留物（驗收第 12 條）
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

// ───────────────────────── 三種 mode 的負載 ─────────────────────────

/**
 * 病變版：同步排序，整支跑完才還主執行緒。
 *
 * 十發點擊照 `CLICK_INTERVAL_MS` 的節拍派送，而單次 handler 要 100ms 以上（4x），
 * 所以第一次的 handler 一開始跑，第 2..10 次的 pointerdown / click 就只能在 task queue 裡等 ——
 * 它們各自的 processing 其實很短，長的是「事件產生」到「handler 被呼叫」那段 input delay，
 * 而且它有解析解：`inputDelay_k ≈ (k−1) × (S − I)`，S = 單次 handler 成本、I = 間隔。
 *
 * ⚠️ **但面板的兇手段不會是 inputDelay，而那不是量測錯，是這個標本的物理。**
 * 同步排序不可中斷，整串 handler 中間插不進一次繪製，十筆互動因此共用同一次 paint：
 * `duration_k = 10S − (k−1)I`，對 k **遞減** ⇒ INP 的代表樣本（n < 50 時取 max，
 * `src/measure/metrics.ts`）恆為第一次點擊 —— 而第一次沒有排隊、inputDelay ≈ 0，
 * 它的 duration 幾乎全部記在 presentation 段。
 * 任何 I < S 都是這個結果；I > S 則完全不排隊，標本退化成標本 #3 的複製品。
 * 排隊是真的，只是 INP 的取樣規則看不到它：每一筆都在 `RunResult.samples` 裡，
 * 而**面板快照的 history 只帶 stats 不帶 samples**，所以量測工具那一側看不到 ——
 * 這就是 `inputLagMaxMs` 存在的理由（標本自己把階梯的頂端報出來）。
 * 這個落差登記在 `docs/phase1-expected-results.md` 的修正紀錄，屬於未裁決項 ——
 * **不准反過來把 culprit 改成 presentation 了事**：那會教錯（讀者會以為是「瀏覽器算樣式+繪製慢」，
 * 實情是「根本沒有機會繪製」）。
 */
function runSynchronousSort(): void {
  const t0 = performance.now();
  // .slice() 不是潔癖：直接排原陣列的話，第二次點擊起就是在「排序已排序資料」，
  // V8 對接近有序的輸入快非常多，十次點擊的工作量會一次比一次小 —— 可重現性當場報廢。
  const sorted = orders.slice().sort(compareOrders);
  const summary = summarizeByRegion(sorted);
  const sortMs = performance.now() - t0;

  completedSorts += 1;
  renderSummary(
    summary,
    `同步排序 ${round1(sortMs)}ms（主執行緒全程被佔住）· 第 ${completedSorts}/${CLICK_REPETITIONS} 次`,
  );
  ctxRef?.emit({
    sortMs: round1(sortMs),
    completedSorts,
    cancelledSorts,
    staleWorkerReplies,
    ...cadenceGuardrail(),
  });
}

/**
 * 治療一：切 chunk + 讓出。
 *
 * ⚠️ 誠實揭露一：這版與病變版**不只差在有沒有讓出**，排序實作也不同 ——
 * Array.prototype.sort 是不可中斷的原子操作，不換寫法就沒有 chunk 邊界可言。
 * 這裡的作法是把資料切成 4096 筆一段、每段仍用**原生 sort**（比較器的工作量因此
 * 與病變版同一種），再逐層合併，並在段與段、合併的迴圈裡按 wall clock 讓出。
 * 代價是總 CPU 工作量比單次原生 sort **更多** —— 這個混淆變因的方向對**這一臂**不利，
 * 所以這一臂量到的比值是下界。
 *
 * ⚠️ **但「本檔唯一剩下的混淆變因，而它是保守方向的」這句話是錯的，已刪。**
 * 治療二那一臂還有一個方向相反的：**4x 節流沒有套用到 worker 執行緒**
 *（`Emulation.setCPUThrottlingRate` 只作用在主執行緒）。證據在 repo 自己的資料裡 ——
 * 同一份排序，主執行緒 116~122ms、worker 28.4~29.0ms，比值 4.2 ≈ 節流率。
 * 那個混淆變因對治療臂**有利**，方向與這裡相反，兩者不會互相抵銷，
 * 也不可以合寫成一句「保守方向」。相對節流率現在由 `threadSpeedRatio` 逐輪量出來。
 *
 * ⚠️ 誠實揭露二：重疊處理策略是**排隊**，不是取消。
 * 2026-07-26 之前這裡會把前一輪標成 cancelled，於是十次點擊只有最後一次跑完 ——
 * 三輪實測 `completedSorts` / `cancelledSorts`：病變版 **10 / 0**，兩段治療皆 **1 / 9**。
 * 取消被後續操作蓋掉的工作確實是非同步實作的正確行為，也正是讓出主執行緒買到的東西之一
 *（同步實作沒有這個選項），但它是**第二個變因**，而一段治療只准翻一個。
 * 舊寫法讓 17× 變成「讓出的效果 + 少做九成工作」的混合體，拆不開。
 * 所以取消被拿掉了：這一臂只翻「有沒有讓出」，兩臂都做完十次排序。
 *
 * 排隊**不會**污染 INP：click handler 只做 `pendingSorts += 1` 就返回，
 * 排的隊在讓出點之間消化，而每個讓出點都是一次繪製機會。
 * 它真正的代價是「第一次點擊到看見第十份結果」的 wall clock 被拉長到十倍 ——
 * 那筆代價用 `queueDrainMs`（drainer 啟動起算，逐筆上報）與 `peakQueueDepth` 攤開，
 * 不藏在註解裡。
 *
 * ⚠️ `queueDrainMs` / `peakQueueDepth` 是**單臂診斷欄位，不可以跨臂對照**：
 * 病變版沒有自己的佇列，它的隊排在瀏覽器的事件佇列裡，標本量不到。
 */
function enqueueChunkedSort(): void {
  pendingSorts += 1;
  if (pendingSorts > peakQueueDepth) peakQueueDepth = pendingSorts;
  // 已經有 drainer 在跑就讓它吃完，不要開第二條：兩條 drainer 會互相搶讓出點，
  // 量到的就變成「兩份工作交錯」而不是「一份工作被切開」。
  if (!inFlight) void drainChunkedSorts();
}

async function drainChunkedSorts(): Promise<void> {
  const run = { cancelled: false };
  inFlight = run;
  const queueStart = performance.now();

  while (pendingSorts > 0) {
    pendingSorts -= 1;
    const t0 = performance.now();
    const sorted = await chunkedMergeSort(orders, run);
    if (run.cancelled || !sorted) {
      // 被 setMode / reset / destroy 作廢了。作廢的份數已經在 abandonInFlightSorts()
      // 那裡結算過，這裡不再動任何計數器；inFlight 也不准碰 —— 它已經換人了。
      return;
    }

    const summary = summarizeByRegion(sorted);
    const sortMs = performance.now() - t0;
    completedSorts += 1;
    // wall clock 會比病變版長很多（中間讓出去畫面了），但沒有任何一段是連續佔住主執行緒的
    renderSummary(
      summary,
      `切 chunk 排序 ${round1(sortMs)}ms（第 ${completedSorts}/${CLICK_REPETITIONS} 次；含讓出時間，期間畫面持續更新）`,
    );
    ctxRef?.emit({
      sortMs: round1(sortMs),
      completedSorts,
      cancelledSorts,
      staleWorkerReplies,
      peakQueueDepth,
      // 還沒開始跑的份數。收斂訊號是 completedSorts，這個是「還剩多少」的直接讀數 ——
      // 一輪卡住時它會停在非 0，比「completedSorts 停在 9」更早看得出來
      pendingSorts,
      queueDrainMs: round1(performance.now() - queueStart),
      ...cadenceGuardrail(),
    });
  }

  // 只有自己還是當前那條 drainer 時才清。setMode 已經換掉 inFlight 的話不准回頭清掉新的那條
  if (inFlight === run) inFlight = null;
}

/**
 * 把在途的 chunk 排序作廢，回傳被丟掉的份數（在途那一筆 + 還沒開始的佇列）。
 *
 * 呼叫端要把回傳值**指派**成歸零後的 `cancelledSorts`（`cancelledSorts = abandoned`），
 * 不是加在舊 mode 的帳上：這些工作是在切換／重置**之後**才真的停下來的，
 * 它偷走的主執行緒時間落在新那一輪的量測窗裡，記在新的帳上才對得起「這一輪量到的是什麼」。
 * 語意與 worker 臂的過期回覆一致（見 onWorkerMessage）。
 */
function abandonInFlightSorts(): number {
  // 先算再清。`pendingSorts > 0 ⟺ inFlight !== null` 是不變式，但這裡不依賴它 ——
  // 依賴不變式的寫法（`if (!inFlight) return 0`）在不變式被破壞的那天會**靜默**漏掉
  // 佇列裡的份數，而漏掉的那些正是下一輪要背的帳。
  const abandoned = (inFlight ? 1 : 0) + pendingSorts;
  if (inFlight) inFlight.cancelled = true;
  inFlight = null;
  pendingSorts = 0;
  return abandoned;
}

async function chunkedMergeSort(
  source: readonly Order[],
  run: { cancelled: boolean },
): Promise<Order[] | null> {
  if (source.length === 0) return [];
  let chunkStart = performance.now();

  async function yieldIfChunkSpent(): Promise<void> {
    if (performance.now() - chunkStart < CHUNK_BUDGET_MS) return;
    await (window.scheduler?.yield ? window.scheduler.yield() : messageChannelYield());
    chunkStart = performance.now();
  }

  let runs: Order[][] = [];
  for (let i = 0; i < source.length; i += BASE_BLOCK) {
    runs.push(source.slice(i, i + BASE_BLOCK).sort(compareOrders));
    await yieldIfChunkSpent();
    if (run.cancelled) return null;
  }

  while (runs.length > 1) {
    const merged: Order[][] = [];
    for (let i = 0; i < runs.length; i += 2) {
      const left = runs[i];
      if (i + 1 >= runs.length) {
        merged.push(left);
        break;
      }
      const right = runs[i + 1];
      const out: Order[] = new Array<Order>(left.length + right.length);
      let li = 0;
      let ri = 0;
      let oi = 0;
      while (li < left.length && ri < right.length) {
        out[oi++] = compareOrders(left[li], right[ri]) <= 0 ? left[li++] : right[ri++];
        // 每 1024 筆才看一次時鐘。performance.now() 自己也要錢，
        // 而 5ms 的預算根本不需要逐筆精度 —— 量測開銷混進負載是陷阱 #12。
        if ((oi & 1023) === 0) {
          await yieldIfChunkSpent();
          if (run.cancelled) return null;
        }
      }
      while (li < left.length) out[oi++] = left[li++];
      while (ri < right.length) out[oi++] = right[ri++];
      merged.push(out);
    }
    runs = merged;
  }
  return runs[0];
}

/**
 * 治療二：整段排序離開主執行緒。
 *
 * **什麼時候這是錯的選擇**：
 * 1. 需要頻繁碰 DOM 的工作 —— worker 裡沒有 DOM，每次存取都得換成一次
 *    postMessage 往返，往返成本很快就超過你省下來的計算。
 * 2. 大 payload —— 結構化複製的**序列化發生在 postMessage 這一行，同步、在主執行緒上**。
 *    五萬筆物件的複製成本不會消失，只是從「排序」換成「複製」。
 *    所以下面把它量出來上報（workerSerializeMs / workerFirstTransferMs），
 *    讓取捨是被看見的，而不是被我宣稱的。真要治本得換資料表示法
 *    （欄式 TypedArray + Transferable，或 SharedArrayBuffer），那是另一個標本的題目。
 * 3. **工作本身是 CPU bound 而你在比「誰比較快」** —— worker 不會讓 CPU 變快，
 *    它只是換一條執行緒。這個標本的量測環境正好示範了為什麼這件事會被讀錯：
 *    節流只作用在主執行緒時，同一份排序在 worker 上看起來快 4.2 倍，
 *    那個 4.2 是節流率不是治療效果（見 `threadSpeedRatio`）。
 *
 * ⚠️ **worker 是在量測窗外開機的（mount / setMode / reset），不是第一次點擊時。**
 * 反過來做的話 `workerFirstTransferMs` 由構造必然含建立 worker + 編譯模組的成本，
 * 而那筆成本與「搬運五萬筆資料」無關 —— 兩者混在一起就沒有一個數字能引用。
 * 開機成本沒有被藏起來，它自己一欄（`workerBootMs`）。
 */
function runWorkerSort(): void {
  const target = ensureWorker();
  // 沒 ready 就送 = 第一筆的 transferMs 混了開機成本。不靜默，標起來讓那一筆作廢
  if (!workerReady) workerColdStart = 1;
  workerSeq += 1;
  const seq = workerSeq;

  const t0 = performance.now();
  const sentAt: EpochMs = performance.timeOrigin + t0;
  const request: SortRequest = { generation: workerGeneration, seq, sentAt, orders };
  target.postMessage(request);
  // postMessage 回來之後才算完，因為序列化就發生在那一行裡面
  const serializeMs = performance.now() - t0;
  // 逐筆記，不是只留最後一筆：十筆同時在途時，單一全域變數會把第 k 筆的往返
  // 算成「離現在最近的那次送出到現在」，那不是往返
  workerSends.set(seq, { sentAt, serializeMs });

  if (dom) {
    dom.status.textContent = `已送出第 ${seq}/${CLICK_REPETITIONS} 筆給 worker · 主執行緒序列化 ${round1(serializeMs)}ms`;
  }
}

/**
 * 建立（或取得）worker。**呼叫時機是 mount / setMode / reset，不是第一次點擊。**
 *
 * 這裡曾經有一組互相打架的註解：這支檔案的 `reset()` 寫著「worker 一併收掉，
 * 否則第一次點擊會少掉建立 worker 的成本」，而 `workerFirstTransferMs` 的註解寫著
 * 它是「純結構化複製的成本」—— 兩件事不可能同時成立。
 * 裁決：**開機成本要留下來，但不准留在 transferMs 裡。**
 * 每一輪仍然從一個全新的 worker 開始（沒有跨輪的 JIT 暖度），但開機發生在
 * reset 之後、第一發點擊之前的空檔，而且自己一欄上報。
 */
function ensureWorker(): Worker {
  if (worker) return worker;
  workerReady = false;
  workerBootMs = null;
  workerCreatedAt = performance.timeOrigin + performance.now();
  worker = new Worker(new URL('./01-main-thread-block.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', onWorkerMessage, { signal: listenerAbort?.signal });
  return worker;
}

/**
 * ⚠️ 十筆回覆**全部**渲染並計數，不再只留最後一筆。
 *
 * 主執行緒本來就替十次點擊各付了一次序列化、worker 也真的排序了十次 ——
 * 先前被丟掉的只有「回覆」，所以舊的 `completedSorts: 1` 描述的是**渲染次數不是工作量**。
 * 回覆亂序不是這裡要擔心的事：單一 worker 的訊息是 FIFO，而且十次排的是同一份資料、
 * 結果逐字相同，畫面不會倒退。代價是主執行緒多付十次 renderSummary（約 1~2ms 一次），
 * 方向對治療臂不利 —— 換到的是這個計數器從此代表工作量。
 */
function onWorkerMessage(event: MessageEvent<WorkerOutbound>): void {
  const res = event.data;

  // ── worker 開機回報。它沒有 generation：開機是 worker 本身的性質，不屬於任何一輪 ──
  if (res.type === 'worker-ready') {
    workerReady = true;
    workerBootMs = round1(res.readyAt - workerCreatedAt);
    workerCalibrationMs = round1(res.calibrationMs);
    workerCalibrationChecksum = res.checksum;
    ctxRef?.emit({
      workerBootMs,
      workerCalibrationMs,
      mainCalibrationMs: round1(mainCalibrationMs),
      // 兩邊的 checksum 相等才證明跑的是同一段程式，比值才有意義。
      // 不相等時比值一律不可信 —— 那代表兩份複製的迴圈已經分岔了。
      calibrationChecksumMatch: workerCalibrationChecksum === mainCalibrationChecksum ? 1 : 0,
      /**
       * 兩條執行緒的相對速度。≈1 = 兩條在同一個節流率下；≈4 = 只有主執行緒被節流。
       * **這不是一個「預期值」，是一個判準**：ratio ≈ 4 時，這一臂的 workerSortMs
       * 不可以當成「4x 條件下的結果」發表。
       */
      threadSpeedRatio: res.calibrationMs > 0 ? round1(mainCalibrationMs / res.calibrationMs) : 0,
      workerColdStart,
    });
    return;
  }

  // 跨 mode 的過期回覆：使用者已經切走了。丟掉，不然一筆 fixed-worker 的數字
  // 會掛在別的 mode 那一輪底下（見 setMode）。**這裡不再是「被下一次點擊蓋掉」** ——
  // 同一個 mode 內的十筆回覆全部有效。
  // 記在 staleWorkerReplies 而不是 cancelledSorts：那是另一種現象（見 cancelledSorts）。
  if (res.generation !== workerGeneration) {
    staleWorkerReplies += 1;
    return;
  }
  const sent = workerSends.get(res.seq);
  // 同一世代卻找不到送出記錄 = reset 清過表，這筆屬於上一輪，不計入任何一邊
  if (!sent) return;
  workerSends.delete(res.seq);

  const roundTripMs = performance.timeOrigin + performance.now() - sent.sentAt;
  if (res.seq === 1) workerFirstTransferMs = res.transferMs;
  completedSorts += 1;
  renderSummary(
    res.summary,
    `worker 排序 ${round1(res.sortMs)}ms（不在主執行緒）· 第 ${completedSorts}/${CLICK_REPETITIONS} 筆 · 主執行緒序列化 ${round1(sent.serializeMs)}ms · 往返 ${round1(roundTripMs)}ms`,
  );
  ctxRef?.emit({
    // 主執行緒付的那一段。**這一欄與病變版的 sortMs 是同口徑的**（同一條執行緒、
    // 同一個節流率），治療二唯一能直接跟病變版相除的就是這兩個數字。
    workerSerializeMs: round1(sent.serializeMs),
    // 拆成 first / last 而不是沿用一個 workerTransferMs：舊欄位上報的是最後一筆，
    // 而最後一筆的 transferMs 幾乎全是「worker 先處理前九筆」的佇列等待，
    // 被讀成「搬運這批資料比排序它貴 20 倍」。first 才是單趟結構化複製的成本 ——
    // 但它跨兩條執行緒，混口徑，不可以拿去跟單一執行緒的成本相除（見宣告處）。
    workerFirstTransferMs: round1(workerFirstTransferMs ?? res.transferMs),
    workerLastTransferMs: round1(res.transferMs),
    // ⚠️ worker 執行緒的成本。`threadSpeedRatio` ≈ 1 才能跟主執行緒的數字比較。
    workerSortMs: round1(res.sortMs),
    workerRoundTripMs: round1(roundTripMs),
    workerBootMs: workerBootMs ?? 0,
    workerColdStart,
    completedSorts,
    cancelledSorts,
    staleWorkerReplies,
    ...cadenceGuardrail(),
  });
}

// ───────────────────────── DOM ─────────────────────────

function renderSummary(summary: RegionSummary[], status: string): void {
  if (!dom) return;
  dom.status.textContent = status;
  dom.summary.textContent = summary
    .map(
      (r) =>
        `${r.region}\t${String(r.count).padStart(6)} 筆\t合計 ${r.total.toFixed(0).padStart(12)}\t首單 ${r.topOrderId}`,
    )
    .join('\n');
}

/** 唯一的 click 進入點。名字會出現在 LoAF 的 sourceFunctionName，所以不准包匿名箭頭 */
function sortOrdersOnClick(event: MouseEvent): void {
  /*
   * 節拍護欄先記，三個 mode 都一樣，成本是兩次減法一次比較。
   *
   * `event.timeStamp` 是**事件產生的時刻**，不是 handler 被呼叫的時刻 ——
   * 主執行緒被擋住時這兩者會差開，差值就是 input delay。
   * 所以標本不必碰 PerformanceObserver（spec §3.3 明文禁止）也拿得到排隊的直接證據，
   * 而且它不經過 INP「取 max duration」那條會把階梯藏起來的取樣規則。
   * 派送節拍也從這裡反推：clickSpanMs 應 ≈ (N−1) × CLICK_INTERVAL_MS。
   */
  const lag = performance.now() - event.timeStamp;
  if (lag > inputLagMaxMs) inputLagMaxMs = lag;
  clicksReceived += 1;
  if (clicksReceived === 1) firstClickAt = event.timeStamp;
  lastClickAt = event.timeStamp;

  ctxRef?.mark(`sort:${currentMode}`);
  switch (currentMode) {
    case 'fixed-yield':
      // 只入列就返回 —— handler 本身的成本必須趨近 0，這才是「讓出」的意思。
      // 實際的排序在 drainer 裡，在讓出點之間消化。
      enqueueChunkedSort();
      return;
    case 'fixed-worker':
      runWorkerSort();
      return;
    default:
      runSynchronousSort();
  }
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  listenerAbort = new AbortController();
  const { signal } = listenerAbort;

  // 只在 mount 產生一次。每次點擊重新產生資料的話，量到的就包含了生成成本，
  // 而且「同一份資料排十次」這個凍結條件也沒了。
  orders = generateOrders(ORDER_COUNT);

  root.innerHTML = `
    <style>
      /*
        ⚠️ 這段是標本的視覺負載本身，不是面板樣式（Phase 0 唯一允許的 style 區塊）。
        動的是 margin-left 而**不是** transform：Chromium 會把 transform / opacity
        的動畫丟到 compositor thread，主執行緒卡死時它照樣轉 —— 那樣 spinner 就會
        在最該卡住的時候騙人。margin-left 每一幀都要主執行緒重算版面，卡住就是真的卡住。
      */
      @keyframes mtb-sweep { from { margin-left: 0; } to { margin-left: 240px; } }
      .mtb-runner {
        width: 24px;
        animation: mtb-sweep 1.1s linear infinite alternate;
      }
    </style>

    <h1>標本 #1 —— 主執行緒阻塞</h1>
    <p>在事件處理器裡同步排序 ${ORDER_COUNT.toLocaleString('en-US')} 筆訂單。
       操作程序是<strong>機器節拍</strong>：${CLICK_CADENCE_COPY}、共 ${CLICK_REPETITIONS} 發，
       絕對排程（第 k 發打在 t₀ + k × ${CLICK_INTERVAL_MS}ms），不等畫面回應，
       ${CLICK_REPETITIONS} 發打完的跨度是 ${CLICK_SPAN_EXPECTED_MS}ms。
       <strong>這不是在模擬使用者連打</strong> —— 人連打約 150ms 一下，而 150ms 已經大於
       單次排序成本，那樣的話事件根本不排隊（探針實測：INP 120ms、兇手變成 processing）。
       自己動手點只能看方向，數字要看機器驅動那一份。</p>

    <div class="mtb-runner">◼</div>
    <p><label>這裡打字試試看：<input id="mtb-typing" type="text" placeholder="卡住時一個字都打不出來"></label></p>

    <p><button id="mtb-sort-btn" type="button">排序訂單</button></p>
    <p id="mtb-status">尚未排序</p>
    <pre id="mtb-summary">（排序完成後這裡會出現各區彙總）</pre>
  `;

  const sortButton = root.querySelector<HTMLButtonElement>('#mtb-sort-btn')!;
  dom = {
    status: root.querySelector<HTMLElement>('#mtb-status')!,
    summary: root.querySelector<HTMLElement>('#mtb-summary')!,
  };
  sortButton.addEventListener('click', sortOrdersOnClick, { signal });

  // 計數器歸零：它們是模組層變數，上一次 destroy 之後可能還有一條 drainer 在收尾
  // 並且把作廢份數記了上去。不歸零的話那筆帳會掛在這次掛載的第一輪底下 ——
  // 而這一組計數器現在全部是護欄（做了幾份工作、派了幾發、排了多久），誤報等於護欄失效。
  resetCounters();

  /*
   * 執行緒速度校準跑在這裡：mount 之後還有 500ms 暖機窗（runtime.ts 的 armWarmup），
   * 所以它落在所有量測窗之外，而且三個 mode 一視同仁 —— 它是儀器，不是負載。
   * 沒有它的話，「worker 比較快」與「worker 沒有被節流」在資料上長得一模一樣。
   */
  const calibrationT0 = performance.now();
  mainCalibrationChecksum = calibrationSpin(CALIBRATION_ITERATIONS);
  mainCalibrationMs = performance.now() - calibrationT0;

  // worker 在量測窗外開機（見 ensureWorker）。只有真的要用它的 mode 才開 ——
  // 別的 mode 開一條閒置 worker 是白付一次編譯成本，而且會讓「這一臂做了什麼」變模糊
  if (currentMode === 'fixed-worker') ensureWorker();

  ctx.emit({
    orderCount: orders.length,
    completedSorts,
    cancelledSorts,
    staleWorkerReplies,
    mainCalibrationMs: round1(mainCalibrationMs),
    ...cadenceGuardrail(),
  });
}

/**
 * 所有「本輪 / 本 mode 內」的計數器。三個入口（mount / setMode / reset）都要清同一組 ——
 * 分三份寫遲早有一份漏掉一個欄位，而漏掉的那個欄位剛好就是護欄時，
 * 護欄會安靜地失效（這正是 `cancelledSorts` 帶著非零值進下一輪的那條路徑）。
 */
function resetCounters(): void {
  completedSorts = 0;
  cancelledSorts = 0;
  staleWorkerReplies = 0;
  pendingSorts = 0;
  peakQueueDepth = 0;
  clicksReceived = 0;
  firstClickAt = 0;
  lastClickAt = 0;
  inputLagMaxMs = 0;
  workerColdStart = 0;
}

/**
 * A 類 live 切換：只換行為，不動 DOM。
 * 重建 DOM 會重啟 spinner 動畫、清掉使用者打到一半的字，
 * 那就等於在「有沒有讓出主執行緒」之外又動了第二個變因。
 */
function setMode(mode: string): void {
  // 舊 mode 的工作不准溢到新 mode：進行中的 chunk 一律作廢，
  // 不然切到 fixed-worker 之後還會有上一個 mode 的 chunk 在跑，歸因直接錯亂。
  const abandoned = abandonInFlightSorts();
  // 同樣的道理要套在 worker 上，而且它更難發現：worker 的回覆是非同步跨執行緒回來的，
  // 只取消 inFlight 擋不住它。50,000 筆訂單光是 structured clone 就要數十到數百 ms，
  // 這段時間切到 fixed-yield，舊 mode 的回覆照樣命中世代、照樣 renderSummary()、
  // 照樣 emit —— 於是一筆 fixed-worker 的數字掛在 fixed-yield 這一輪底下，
  // 而它產生的 DOM 寫入還會落進新 mode 某次互動的同一幀。
  // 把世代往前推一格，讓在途的回覆一律判定為過期。
  workerGeneration += 1;
  workerSeq = 0;
  workerSends.clear();
  workerFirstTransferMs = null;
  currentMode = mode;
  // 計數器跟著歸零：這些是「本 mode 內」的次數，跨 mode 累加會讀成別的意思。
  // 唯一的例外是剛剛作廢的那些工作 —— 它們是切換之後才停下來的，
  // 偷走的主執行緒時間落在新 mode 的量測窗裡，所以記在新的帳上。
  resetCounters();
  cancelledSorts = abandoned;
  // 切進 fixed-worker 時就把 worker 開起來：這裡到第一發點擊之間有一整段
  // 暖機窗（runtime.ts armWarmup 500ms）+ 驅動器的固定靜置，開機成本落在那裡面。
  // 切出去時不 terminate —— 那會讓 destroy 以外的路徑多一個 terminate 時機，
  // 而世代機制已經負責擋掉在途回覆了（`staleWorkerReplies` 會記下來）。
  if (mode === 'fixed-worker') ensureWorker();
  if (dom) dom.status.textContent = `已切換到 ${mode}，尚未排序`;
  ctxRef?.emit({
    orderCount: orders.length,
    completedSorts,
    cancelledSorts,
    staleWorkerReplies,
    mainCalibrationMs: round1(mainCalibrationMs),
    ...cadenceGuardrail(),
  });
}

function reset(): void {
  const abandoned = abandonInFlightSorts();
  /*
   * worker 收掉再開一條新的，**不是收掉就算了**。
   *
   * 這兩句註解以前互相打架：這裡寫「否則第一次點擊會少掉建立 worker 的成本」，
   * 而 workerFirstTransferMs 那裡寫它是「純結構化複製的成本」——
   * 讓第一次點擊付開機成本，就等於讓那個數字必然含開機成本。
   * 裁決：每一輪仍然從一條**全新**的 worker 開始（不繼承上一輪的 JIT 暖度，
   * 這是「第一輪與後續輪是同一件事」真正要的東西），但開機發生在 reset 這一刻，
   * 也就是量測窗之外；成本沒有被藏起來，它在 `workerBootMs` 自己一欄。
   */
  terminateWorker();
  resetCounters();
  // 同 setMode：作廢的工作是在 reset 之後才停下來的，它的成本落在新一輪的窗裡。
  // ⚠️ 這一欄在新一輪開頭非 0 = **上一輪沒有 drain 完就被「重跑」打斷**，
  // 不是「混了上一個 mode」。收斂條件請用 completedSorts，不要用固定 sleep。
  cancelledSorts = abandoned;
  if (currentMode === 'fixed-worker') ensureWorker();
  if (dom) {
    dom.status.textContent = '尚未排序';
    dom.summary.textContent = '（排序完成後這裡會出現各區彙總）';
  }
  ctxRef?.emit({
    orderCount: orders.length,
    completedSorts,
    cancelledSorts,
    staleWorkerReplies,
    mainCalibrationMs: round1(mainCalibrationMs),
    ...cadenceGuardrail(),
  });
}

function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  workerReady = false;
  workerBootMs = null;
  // 推前一格而**不是**歸零：歸零會讓上一批世代在下一個 worker 開起來之後復活，
  // 還在路上的舊回覆就會被當成當前世代收下。
  workerGeneration += 1;
  workerSeq = 0;
  workerSends.clear();
  workerFirstTransferMs = null;
}

/**
 * 驗收第 12 條：切走標本後靜置五秒，不得出現任何 origin === 'specimen' 的 LoAF entry。
 * 活著的 worker 或沒取消的 chunk 迴圈都會讓這條掛掉 —— chunk 版是靠 cancelled 旗標
 * 停在下一個讓出點，所以取消旗標與 terminate 兩件事都必須做。
 * 排隊之後 drainer 最長要跑十份排序，這條就更不能省：只取消一份不夠，
 * `abandonInFlightSorts()` 會把還沒開始的佇列一起清掉，drainer 才不會醒來繼續吃。
 */
function destroy(): void {
  // 標本要收掉了，作廢份數沒有人可以回報，回傳值刻意丟棄
  abandonInFlightSorts();
  terminateWorker();
  listenerAbort?.abort();
  listenerAbort = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  dom = null;
  ctxRef = null;
  orders = [];
  resetCounters();
}

const mod: SpecimenModule = {
  meta: MAIN_THREAD_BLOCK_META,
  mount,
  setMode,
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
