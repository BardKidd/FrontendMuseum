/**
 * 標本 #1 治療二的 worker 端 —— 排序完全離開主執行緒。
 *
 * 這支檔案**不准 import 標本主檔的任何 runtime 值**：那會把 bootstrapSpecimen
 * 一起打包進 worker，等於在 worker 裡再啟動一次量測層。
 * 所以下面的比較器、彙總與校準迴圈是刻意複製的，只有型別用 import type 借（build 時整句抹掉）。
 * 三份都必須逐字一致 —— 排序規則不同就不是同一個實驗、校準迴圈不同就不是同一把尺，
 * 兩者都不是小瑕疵。校準那一份有 checksum 自動驗，排序那兩份沒有（靠 review）。
 */
import type { EpochMs } from '../src/protocol';
import type { Order, RegionSummary } from './01-main-thread-block';

export interface SortRequest {
  /**
   * 世代。主執行緒每次 setMode / reset / terminate 才推進一格，**不是每次請求都推進**。
   * worker 原樣回傳，主執行緒用它判定「這筆回覆屬不屬於當前這個 mode」。
   * 先前這裡叫 runId 且每次請求都推進，於是同一個 mode 內的第 k 筆回覆
   * 一律被第 k+1 筆的送出判定成過期 —— 十筆工作只認得一筆。
   */
  generation: number;
  /** 本 mode 內的請求序號，從 1 起。主執行緒用它把回覆對回自己那一筆的送出時刻 */
  seq: number;
  /**
   * performance.timeOrigin + performance.now()。
   * worker 與主執行緒各有自己的 timeOrigin，只有換算到同一條 epoch 時間軸
   * 才減得出有意義的差（protocol.ts 的 EpochMs 定義）。
   */
  sentAt: EpochMs;
  orders: Order[];
}

export interface SortResponse {
  type: 'sort-done';
  generation: number;
  seq: number;
  summary: RegionSummary[];
  /**
   * worker 內的純排序時間，不含傳輸。
   *
   * ⚠️ **這個數字量在 worker 執行緒上，而 `Emulation.setCPUThrottlingRate`
   * 只節流主執行緒。** 既有三輪：同一份排序在主執行緒 116~122ms、在這裡 28.4~29.0ms，
   * 比值 4.2 ≈ 宣告的節流率。所以它**不可以**直接跟主執行緒上的任何數字相除，
   * 除非 `threadSpeedRatio` ≈ 1。相對節流率由主檔的校準迴圈逐輪量出來。
   */
  sortMs: number;
  /**
   * 送出到收到之間的差 = 結構化複製（序列化 + 反序列化）+ 排程。
   *
   * ⚠️ 兩件事跟著它一起：
   *  1. **第 k 筆含 worker 先處理完前 k−1 筆的佇列等待。** 十發點擊在
   *     `(N−1) × intervalMs` 之內全部送出，而 worker 一次只吃一筆，所以第 10 筆
   *     幾乎全是排隊，不是複製成本 —— 只有 `seq === 1` 那筆是單趟複製
   *     （前提是 worker 已經開機，見主檔的 workerColdStart）。
   *     主執行緒因此把 first / last 分開上報，不留一個會被讀成「搬運費」的單一數字。
   *  2. **它跨兩條執行緒**：前半段（序列化）在被節流的主執行緒上，
   *     後半段（反序列化）在這裡。混口徑的數字不可以拿去算比值。
   */
  transferMs: number;
}

/**
 * 開機回報。**沒有 generation** —— 開機是這條 worker 的性質，不屬於任何一輪。
 * 主執行緒靠它做兩件事：把開機成本從 `workerFirstTransferMs` 裡拆出來，
 * 以及拿 `calibrationMs` 與自己那份相除，量出兩條執行緒的相對節流率。
 */
export interface WorkerReady {
  type: 'worker-ready';
  /** performance.timeOrigin + performance.now()，在校準迴圈**之前**取 */
  readyAt: EpochMs;
  /** 定量校準迴圈的耗時 */
  calibrationMs: number;
  /** 校準迴圈的結果。與主執行緒那份相等才證明兩邊跑的是同一段程式 */
  checksum: number;
}

export type WorkerOutbound = WorkerReady | SortResponse;

/**
 * tsconfig 的 lib 是 DOM（外殼與標本都要），worker 的全域型別不在裡面。
 * 不用 `/// <reference lib="webworker" />` 的理由：那是**整個 program 生效**的，
 * 會把 worker 的全域宣告塞進外殼那些檔案的作用域裡。為了兩個 API 去動全站型別環境
 * 不划算，就地宣告需要的兩個方法即可 —— 用不到的東西不宣告，寫錯會被擋下來。
 */
interface DedicatedWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<SortRequest>) => void,
  ): void;
  postMessage(message: WorkerOutbound): void;
}
const workerScope = globalThis as unknown as DedicatedWorkerScope;

/**
 * 執行緒相對速度校準。
 *
 * ⚠️ 這個函式在 `01-main-thread-block.ts` 有一份**逐字相同**的複製
 *（worker 不准 import 主檔的 runtime 值，理由見檔頭）。
 * 兩份不一致，比值就不是比值 —— 改一邊就要改另一邊，checksum 是這件事的自動檢查。
 */
function calibrationSpin(iterations: number): number {
  let acc = 0;
  for (let i = 1; i <= iterations; i++) acc = (acc + Math.imul(i, 2654435761)) >>> 0;
  return acc;
}

const CALIBRATION_ITERATIONS = 4_000_000;

const PRIORITY_RANK: Record<Order['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function compareOrdersInWorker(a: Order, b: Order): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  if (a.amount !== b.amount) return b.amount - a.amount;
  return a.placedAt - b.placedAt;
}

function summarizeByRegionInWorker(sorted: readonly Order[]): RegionSummary[] {
  const acc = new Map<string, RegionSummary>();
  for (const order of sorted) {
    const hit = acc.get(order.region);
    if (hit) {
      hit.count += 1;
      hit.total += order.amount;
    } else {
      acc.set(order.region, {
        region: order.region,
        count: 1,
        total: order.amount,
        topOrderId: order.id,
      });
    }
  }
  return [...acc.values()].sort((x, y) => y.total - x.total || x.region.localeCompare(y.region));
}

workerScope.addEventListener('message', function onSortRequest(event: MessageEvent<SortRequest>): void {
  const request = event.data;
  const receivedAt: EpochMs = performance.timeOrigin + performance.now();

  const t0 = performance.now();
  // 這裡的 orders 已經是結構化複製產生的私有副本，就地排序沒有副作用 ——
  // 主執行緒那版之所以要 .slice()，是因為那邊排的是唯一那份原始資料。
  const sorted = request.orders.sort(compareOrdersInWorker);
  const summary = summarizeByRegionInWorker(sorted);
  const sortMs = performance.now() - t0;

  // 只送回六列彙總。把五萬筆排序結果送回去的話，複製成本會在主執行緒上
  // 再付一次，治療二就自己把自己治死了。
  const response: SortResponse = {
    type: 'sort-done',
    generation: request.generation,
    seq: request.seq,
    summary,
    sortMs,
    transferMs: receivedAt - request.sentAt,
  };
  workerScope.postMessage(response);
});

/*
 * 頂層立刻回報開機完成 + 跑一次校準。順序有意義：
 * `readyAt` 取在校準**之前**，所以 `workerBootMs`（= readyAt − new Worker() 的時刻）
 * 量到的是「建立 + 抓模組 + 編譯」，不含校準；而 ready 訊息是在校準跑完之後才送出，
 * 所以主執行緒收到它的那一刻，這條 worker 是真的閒著的。
 * 兩者都發生在量測窗之外（主執行緒在 mount / setMode / reset 才建 worker）。
 */
const readyAt: EpochMs = performance.timeOrigin + performance.now();
const calibrationT0 = performance.now();
const checksum = calibrationSpin(CALIBRATION_ITERATIONS);
workerScope.postMessage({
  type: 'worker-ready',
  readyAt,
  calibrationMs: performance.now() - calibrationT0,
  checksum,
});
