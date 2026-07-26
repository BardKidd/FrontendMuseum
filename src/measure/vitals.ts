/**
 * 載入期指標 —— LCP 與 CLS。**在 iframe 裡做，不在外殼做。**
 *
 * 這是與 LoAF 相反的一半（見 `src/shell/loaf.ts` 開頭）：
 * LoAF 是頁面級的，iframe 幫不上忙，所以在外殼觀測；
 * **LCP 與 CLS 是 per-document 的**，iframe 真的隔離得掉 ——
 * 標本的圖片載入、字型換入、橫幅插入，只會算進 iframe 自己的 LCP/CLS，
 * 外殼面板每 250ms 重繪一次也不會污染它們。iframe 買到的就是這個。
 *
 * Phase 0 這兩個欄位一律回 `null`（spec §5.3 明文延後，省 2~4h）。
 * 現在補上來**不動協定、不動任何既有標本、先前數字不作廢** ——
 * `LcpSample` / `ClsSample` 的型別從 Phase 0 就凍在 `protocol.ts` 裡了。
 */
import type { ClsSample, EpochMs, LcpSample, MeasureConfig } from '../protocol';

/**
 * 元素描述字串。**只讀屬性，不讀幾何、不讀 textContent。**
 *
 * observer callback 裡不准碰 DOM 是硬約束（spec §4.8），這裡踩在邊界上：
 * tagName / id / class 是同步可得的屬性，不觸發樣式或版面計算；
 * 而 `textContent` 會把整個子樹串起來（LCP 的標的可能是一整段文章），
 * `getBoundingClientRect()` 更是直接強制版面 —— 在量測程式裡做那件事，
 * 我們就變成標本 #3 自己（陷阱 #12）。
 */
function describeNode(node: Node | null): string {
  if (!node || !(node instanceof Element)) return '(未知節點)';
  const el = node;
  const id = el.id ? `#${el.id}` : '';
  // className 在 SVG 上是 SVGAnimatedString，不是字串
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(/\s+/).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

// ───────────────────────── LCP ─────────────────────────

interface LcpEntry extends PerformanceEntry {
  readonly renderTime: DOMHighResTimeStamp;
  readonly loadTime: DOMHighResTimeStamp;
  readonly size: number;
  readonly id: string;
  readonly url: string;
  readonly element: Element | null;
}

/**
 * LCP 收集器。
 *
 * **不需要「停止觀測」的邏輯**：瀏覽器在第一次使用者互動（點擊／按鍵／捲動）之後
 * 就不再派送新的 LCP candidate，所以「最後一筆 entry」自然就是最終值。
 * 自己再寫一套 stop-on-first-input 只會多一份會跟瀏覽器行為不同步的規則。
 *
 * ⚠️ 這也是 B 類標本必須 reload 切換的原因：LCP 在互動後就定案了，
 * A 類那種「不重載換 mode」拿不到第二個 LCP（spec §3.4）。
 */
export class LcpCollector {
  #po: PerformanceObserver | null = null;
  #latest: LcpSample | null = null;
  #dirty = false;

  start(): void {
    if (this.#po) return;
    if (!PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) return;

    const po = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const e = raw as LcpEntry;
        this.#latest = {
          // DocMs：iframe 自己的 timeOrigin 相對時間。
          // 載入期指標用 epoch 沒有意義 —— 讀者要看的是「這份文件開始載入之後幾毫秒」。
          value: e.startTime,
          elementDescriptor: describeNode(e.element),
          // 文字型 LCP 沒有 url，規格回空字串。轉成 null，面板才能區分「沒有」與「空的」
          url: e.url.length > 0 ? e.url : null,
          renderTime: e.renderTime,
          loadTime: e.loadTime,
        };
        this.#dirty = true;
      }
    });
    // buffered: true 是**必要**不是保險：LCP candidate 在 observer 註冊前就已經發生了。
    po.observe({ type: 'largest-contentful-paint', buffered: true });
    this.#po = po;
  }

  stop(): void {
    this.#po?.disconnect();
    this.#po = null;
  }

  /**
   * ⚠️ reset() 只清 dirty 旗標，**不清 #latest**。
   * LCP 是這份 document 的性質，不是這一輪的性質 —— 按「重跑」不會讓圖片重新載入，
   * 清掉的話面板會顯示「這一輪沒有 LCP」，而讀者會以為 LCP 消失了。
   * 真要拿新的 LCP 就得 reload，那是 B 類切換的事。
   */
  reset(): void {
    this.#dirty = false;
  }

  current(): LcpSample | null {
    return this.#latest;
  }

  /** 自上次 drain 以來有沒有新的 candidate。用來決定這批要不要送 */
  takeDirty(): boolean {
    const d = this.#dirty;
    this.#dirty = false;
    return d;
  }
}

// ───────────────────────── CLS ─────────────────────────

interface LayoutShiftAttributionLike {
  readonly node: Node | null;
}

interface LayoutShiftEntry extends PerformanceEntry {
  readonly value: number;
  readonly hadRecentInput: boolean;
  readonly sources: ReadonlyArray<LayoutShiftAttributionLike>;
}

/**
 * CLS session window。**演算法照抄 `web-vitals`，不准自己想**（spec §5.3 的決議）。
 *
 * 兩條規則，兩個常數都在 `MEASURE_CONFIG` 裡（`clsSessionGapMs` / `clsSessionMaxMs`，
 * 對應 web-vitals `LayoutShiftManager.ts` 的 1000 / 5000）：
 *   - 距離上一筆位移超過 1000ms → 開新 session
 *   - 這個 session 已經超過 5000ms → 開新 session
 *
 * **CLS 是所有 session window 的最大值，不是總和。** 這是最多人算錯的地方（spec §4.5），
 * 也正是標本 #5 的教學重點：三個位移源分別發生在載入後 0.3s / 0.9s / 1.5s
 *（程式是 300 / 900 / 1500ms —— 先前這裡寫 0.2 / 0.8 / 1.5 與程式不符），
 * 加總與取最大值會給出完全不同的數字，而只有後者是 CLS。
 *
 * `hadRecentInput` 的 500ms 豁免窗由瀏覽器自己標記：使用者剛互動過而產生的位移
 * （例如點開一個 accordion）不算 CLS。我們照規格濾掉，但**濾掉的筆數要記下來** ——
 * 病變版如果整批位移都被標成 hadRecentInput，面板會顯示 CLS=0，
 * 那時候該懷疑的是操作程序（在位移發生前就點了畫面），不是標本沒病。
 */
export class ClsCollector {
  readonly #gapMs: number;
  readonly #maxMs: number;

  #po: PerformanceObserver | null = null;

  /** 目前這個 session window 的累計值 */
  #sessionValue = 0;
  #sessionFirst = 0;
  #sessionLast = 0;
  #sessionCount = 0;

  /** 所有 session window 的最大值 —— 這才是 CLS */
  #maxSessionValue = 0;

  #largestShift: ClsSample['largestShift'] = null;
  /** 被 hadRecentInput 豁免掉的筆數。0 以外的值都值得在面板上說一聲 */
  #ignoredByInput = 0;
  #dirty = false;

  constructor(cfg: MeasureConfig) {
    this.#gapMs = cfg.clsSessionGapMs;
    this.#maxMs = cfg.clsSessionMaxMs;
  }

  start(): void {
    if (this.#po) return;
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) return;

    const po = new PerformanceObserver((list) => {
      for (const raw of list.getEntries()) {
        const e = raw as LayoutShiftEntry;
        if (e.hadRecentInput) {
          this.#ignoredByInput += 1;
          this.#dirty = true;
          continue;
        }
        this.#addShift(e);
      }
    });
    po.observe({ type: 'layout-shift', buffered: true });
    this.#po = po;
  }

  stop(): void {
    this.#po?.disconnect();
    this.#po = null;
  }

  /**
   * ⚠️ 與 LcpCollector.reset() 同一個理由：**不清累計值**。
   * CLS 是這份 document 從載入到現在的累計性質。按「重跑」不會讓圖片重載、
   * 不會讓字型重新換入，清掉只會得到一個假的 0。要新的 CLS 就 reload。
   */
  reset(): void {
    this.#dirty = false;
  }

  current(): ClsSample | null {
    // 一筆都沒收到（含被豁免的）就回 null，面板才能區分「沒有位移」與「還沒開始觀測」
    if (this.#sessionCount === 0 && this.#ignoredByInput === 0) return null;
    return {
      value: this.#maxSessionValue,
      sessionCount: this.#sessionCount,
      largestShift: this.#largestShift,
    };
  }

  /** 被 hadRecentInput 豁免的筆數，面板要標出來 */
  ignoredByInput(): number {
    return this.#ignoredByInput;
  }

  takeDirty(): boolean {
    const d = this.#dirty;
    this.#dirty = false;
    return d;
  }

  #addShift(e: LayoutShiftEntry): void {
    const inSameSession =
      this.#sessionCount > 0 &&
      e.startTime - this.#sessionLast < this.#gapMs &&
      e.startTime - this.#sessionFirst < this.#maxMs;

    if (inSameSession) {
      this.#sessionValue += e.value;
    } else {
      this.#sessionValue = e.value;
      this.#sessionFirst = e.startTime;
      this.#sessionCount += 1;
    }
    this.#sessionLast = e.startTime;

    if (this.#sessionValue > this.#maxSessionValue) {
      this.#maxSessionValue = this.#sessionValue;
    }

    // 「最大的單筆位移」與「最大的 session」是兩件事，這裡記的是前者 ——
    // 它回答的是「畫面上是哪個元素在跳」，那是文章要指的東西。
    if (!this.#largestShift || e.value > this.#largestShift.value) {
      this.#largestShift = {
        value: e.value,
        at: performance.timeOrigin + e.startTime,
        sourceDescriptors: e.sources.map((s) => describeNode(s.node)),
      };
    }
    this.#dirty = true;
  }
}

/** 給校準用：把 EpochMs 換回這份 document 的相對時間。面板顯示用，不參與任何判定 */
export function toDocMs(at: EpochMs): number {
  return at - performance.timeOrigin;
}
