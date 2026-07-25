/**
 * 標本 #1 治療二的 worker 端 —— 排序完全離開主執行緒。
 *
 * 這支檔案**不准 import 標本主檔的任何 runtime 值**：那會把 bootstrapSpecimen
 * 一起打包進 worker，等於在 worker 裡再啟動一次量測層。
 * 所以下面的比較器與彙總是刻意複製的，只有型別用 import type 借（build 時整句抹掉）。
 * 兩份必須逐字一致 —— 排序規則不同就不是同一個實驗，而不是小瑕疵。
 */
import type { EpochMs } from '../src/protocol';
import type { Order, RegionSummary } from './01-main-thread-block';

export interface SortRequest {
  runId: number;
  /**
   * performance.timeOrigin + performance.now()。
   * worker 與主執行緒各有自己的 timeOrigin，只有換算到同一條 epoch 時間軸
   * 才減得出有意義的差（protocol.ts 的 EpochMs 定義）。
   */
  sentAt: EpochMs;
  orders: Order[];
}

export interface SortResponse {
  runId: number;
  summary: RegionSummary[];
  /** worker 內的純排序時間，不含傳輸 */
  sortMs: number;
  /** 送出到收到之間的差 = 結構化複製（序列化 + 反序列化）+ 排程 */
  transferMs: number;
}

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
  postMessage(message: SortResponse): void;
}
const workerScope = globalThis as unknown as DedicatedWorkerScope;

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
    runId: request.runId,
    summary,
    sortMs,
    transferMs: receivedAt - request.sentAt,
  };
  workerScope.postMessage(response);
});
