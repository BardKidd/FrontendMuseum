/**
 * 標本 #1 —— 主執行緒阻塞。
 *
 * 病變：在 click handler 裡同步排序五萬筆訂單。
 * 兇手是 **input delay 不是 processing**：單獨點一下只會看到自己的 handler 很慢，
 * 要照凍結的操作程序（連打十次、intervalMs === null）才會看到第 2..10 次點擊
 * 排在 task queue 裡等主執行緒 —— 那才是使用者感覺到的「整個網站死掉」（spec §4.1）。
 *
 * 全檔原生 DOM，不用框架：框架的排程與批次更新會替你緩解一部分反模式，
 * 量到的就不是純粹的反模式了（spec §3.1）。這是核心決策，不是風格偏好。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { MAIN_THREAD_BLOCK_META } from '../src/specimens';
// 只借型別。import type 在 build 階段整句被抹掉，所以主檔與 worker 檔之間
// 沒有任何 runtime 相依 —— worker bundle 絕對不能 import 這支主檔，
// 否則 bootstrapSpecimen 會在 worker 裡再跑一次。
import type { SortRequest, SortResponse } from './01-main-thread-block.worker';

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

/** 已跑完的排序次數；連打十次時 broken 是 10，切 chunk 版會少於 10（見 runChunkedSort） */
let completedSorts = 0;
let cancelledSorts = 0;

/** 進行中的 chunk 排序。物件身分本身就是這一輪的識別碼 */
let inFlight: { cancelled: boolean } | null = null;

let worker: Worker | null = null;
let workerRunId = 0;
let workerSentAt = 0;
let workerSerializeMs = 0;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ───────────────────────── 讓出主執行緒（治療一的教學內容）─────────────────────────

/**
 * scheduler.yield() 不存在時的退路。
 *
 * **兩者的差別就是本標本要教的東西，所以它故意寫在這裡，不抽成共用 util（spec §5.3）。**
 * - scheduler.yield()：讓出之後以**較高的續跑優先權**回來，續跑會排在讓出期間
 *   新進的同級任務**前面**，長工作不會被餓死。
 * - MessageChannel / setTimeout(0)：排到隊尾。連打十次的情境下，每讓出一次
 *   就被新的 click task 插隊一次，chunk 之間的間隔會被拉得非常長。
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
 * 十次連打時，第一次的 handler 一開始跑，第 2..10 次的 pointerdown / click
 * 就只能在 task queue 裡等 —— 它們各自的 processing 其實很短，
 * 長的是「事件產生」到「handler 被呼叫」中間那段 input delay。
 * 所以面板要看的主指標是 inp.inputDelay，不是 inp.processing。
 */
function runSynchronousSort(): void {
  const t0 = performance.now();
  // .slice() 不是潔癖：直接排原陣列的話，第二次點擊起就是在「排序已排序資料」，
  // V8 對接近有序的輸入快非常多，十次點擊的工作量會一次比一次小 —— 可重現性當場報廢。
  const sorted = orders.slice().sort(compareOrders);
  const summary = summarizeByRegion(sorted);
  const sortMs = performance.now() - t0;

  completedSorts += 1;
  renderSummary(summary, `同步排序 ${round1(sortMs)}ms（主執行緒全程被佔住）`);
  ctxRef?.emit({ sortMs: round1(sortMs), completedSorts, cancelledSorts });
}

/**
 * 治療一：切 chunk + 讓出。
 *
 * ⚠️ 誠實揭露：這版與病變版**不只差在有沒有讓出**，排序實作也不同 ——
 * Array.prototype.sort 是不可中斷的原子操作，不換寫法就沒有 chunk 邊界可言。
 * 這裡的作法是把資料切成 4096 筆一段、每段仍用**原生 sort**（比較器的工作量因此
 * 與病變版同一種），再逐層合併，並在段與段、合併的迴圈裡按 wall clock 讓出。
 * 代價是總 CPU 工作量比單次原生 sort **更多**，而它仍然贏 —— 混淆變因往
 * 對自己不利的方向偏，結論反而更硬。兩邊的 sortMs 都有上報，讀者自己看得到。
 */
async function runChunkedSort(): Promise<void> {
  // 重疊處理策略：**取消**前一輪，不排隊。
  // 排隊的話，第十次點擊要等前九輪各自跑完，量到的會是「自己排的隊」而不是
  // 「讓出主執行緒的效果」—— 用一個自己造的瓶頸去掩蓋另一個瓶頸，結論就髒了。
  // 取消 = 最後一次點擊勝出，這也是真實 UI（搜尋即打字）本來就該有的行為。
  if (inFlight) {
    inFlight.cancelled = true;
    cancelledSorts += 1;
  }
  const run = { cancelled: false };
  inFlight = run;

  const t0 = performance.now();
  const sorted = await chunkedMergeSort(orders, run);
  if (run.cancelled || !sorted) return;

  const summary = summarizeByRegion(sorted);
  const sortMs = performance.now() - t0;
  inFlight = null;

  completedSorts += 1;
  // wall clock 會比病變版長很多（中間讓出去畫面了），但沒有任何一段是連續佔住主執行緒的
  renderSummary(
    summary,
    `切 chunk 排序 ${round1(sortMs)}ms（含讓出時間；期間畫面持續更新）· 被取消 ${cancelledSorts} 輪`,
  );
  ctxRef?.emit({ sortMs: round1(sortMs), completedSorts, cancelledSorts });
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
 *    所以下面把它量出來上報（workerSerializeMs / workerTransferMs），
 *    讓取捨是被看見的，而不是被我宣稱的。真要治本得換資料表示法
 *    （欄式 TypedArray + Transferable，或 SharedArrayBuffer），那是另一個標本的題目。
 */
function runWorkerSort(): void {
  const target = ensureWorker();
  workerRunId += 1;
  const runId = workerRunId;

  const t0 = performance.now();
  workerSentAt = performance.timeOrigin + t0;
  const request: SortRequest = { runId, sentAt: workerSentAt, orders };
  target.postMessage(request);
  // postMessage 回來之後才算完，因為序列化就發生在那一行裡面
  workerSerializeMs = performance.now() - t0;

  if (dom) {
    dom.status.textContent = `已送出第 ${runId} 輪給 worker · 主執行緒序列化 ${round1(workerSerializeMs)}ms`;
  }
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./01-main-thread-block.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.addEventListener('message', onWorkerMessage, { signal: listenerAbort?.signal });
  return worker;
}

function onWorkerMessage(event: MessageEvent<SortResponse>): void {
  const res = event.data;
  // 過期回覆：使用者已經又點了好幾次。丟掉，不然畫面會倒退成舊結果。
  // 這裡也是取消語意，與 runChunkedSort 一致 —— 最後一次點擊勝出。
  if (res.runId !== workerRunId) {
    cancelledSorts += 1;
    return;
  }
  const roundTripMs = performance.timeOrigin + performance.now() - workerSentAt;
  completedSorts += 1;
  renderSummary(
    res.summary,
    `worker 排序 ${round1(res.sortMs)}ms（不在主執行緒）· 主執行緒序列化 ${round1(workerSerializeMs)}ms · 往返 ${round1(roundTripMs)}ms`,
  );
  ctxRef?.emit({
    workerSerializeMs: round1(workerSerializeMs),
    workerTransferMs: round1(res.transferMs),
    workerSortMs: round1(res.sortMs),
    workerRoundTripMs: round1(roundTripMs),
    completedSorts,
    cancelledSorts,
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
function sortOrdersOnClick(): void {
  ctxRef?.mark(`sort:${currentMode}`);
  switch (currentMode) {
    case 'fixed-yield':
      void runChunkedSort();
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
       請照操作程序連續快速點擊十次，不要等畫面回應。</p>

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

  ctx.emit({ orderCount: orders.length, completedSorts, cancelledSorts });
}

/**
 * A 類 live 切換：只換行為，不動 DOM。
 * 重建 DOM 會重啟 spinner 動畫、清掉使用者打到一半的字，
 * 那就等於在「有沒有讓出主執行緒」之外又動了第二個變因。
 */
function setMode(mode: string): void {
  // 舊 mode 的工作不准溢到新 mode：進行中的 chunk 一律取消，
  // 不然切到 fixed-worker 之後還會有上一個 mode 的 chunk 在跑，歸因直接錯亂。
  if (inFlight) {
    inFlight.cancelled = true;
    inFlight = null;
  }
  // 同樣的道理要套在 worker 上，而且它更難發現：worker 的回覆是非同步跨執行緒回來的，
  // 只取消 inFlight 擋不住它。50,000 筆訂單光是 structured clone 就要數十到數百 ms，
  // 這段時間切到 fixed-yield，舊 mode 的回覆照樣命中 workerRunId、照樣 renderSummary()、
  // 照樣 emit —— 於是一筆 fixed-worker 的數字掛在 fixed-yield 這一輪底下，
  // 而它產生的 DOM 寫入還會落進新 mode 某次互動的同一幀。
  // 把 runId 往前推一格，讓在途的回覆一律判定為過期。
  workerRunId += 1;
  currentMode = mode;
  // 計數器跟著歸零：這些是「本 mode 內」的次數，跨 mode 累加會讀成別的意思
  completedSorts = 0;
  cancelledSorts = 0;
  if (dom) dom.status.textContent = `已切換到 ${mode}，尚未排序`;
  ctxRef?.emit({ orderCount: orders.length, completedSorts, cancelledSorts });
}

function reset(): void {
  if (inFlight) {
    inFlight.cancelled = true;
    inFlight = null;
  }
  // worker 一併收掉：下一輪要從「還沒開過 worker」開始，
  // 否則第一次點擊會少掉建立 worker 的成本，第一輪與後續輪不是同一件事
  terminateWorker();
  completedSorts = 0;
  cancelledSorts = 0;
  if (dom) {
    dom.status.textContent = '尚未排序';
    dom.summary.textContent = '（排序完成後這裡會出現各區彙總）';
  }
  ctxRef?.emit({ orderCount: orders.length, completedSorts, cancelledSorts });
}

function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  workerRunId = 0;
}

/**
 * 驗收第 12 條：切走標本後靜置五秒，不得出現任何 origin === 'specimen' 的 LoAF entry。
 * 活著的 worker 或沒取消的 chunk 迴圈都會讓這條掛掉 —— chunk 版是靠 cancelled 旗標
 * 停在下一個讓出點，所以取消旗標與 terminate 兩件事都必須做。
 */
function destroy(): void {
  if (inFlight) {
    inFlight.cancelled = true;
    inFlight = null;
  }
  terminateWorker();
  listenerAbort?.abort();
  listenerAbort = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  dom = null;
  ctxRef = null;
  orders = [];
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
