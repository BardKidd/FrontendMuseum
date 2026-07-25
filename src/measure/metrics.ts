/**
 * 互動指標收集器 —— 全站數字的來源。
 *
 * ⚠️ 這個檔案**刻意寫死、刻意耦合**到本專案（spec §5.3 / 陷阱 #18）。
 * 沒有 options 物件、沒有 hook、沒有 adapter，因為它現在只有一個使用者。
 * 一旦開始想「別人怎麼用」就會長出三層抽象，然後三個週末過去一個標本都沒有。
 * **六個標本全部上線之前，不准把它抽成套件。**
 *
 * 另外兩條硬約束：
 * 1. observer callback 絕對不碰 DOM，只寫 Map（spec §4.8）。
 *    因為 iframe **不保護** presentation delay —— 面板 re-render 會落在互動的同一幀，
 *    量測程式本身就變成它要量的那個瓶頸。批次與節流是呼叫端的責任。
 * 2. 統計量一律從「有效樣本陣列」推導，不另外維護計數器。
 */
import type {
  EpochMs,
  InpSummary,
  InteractionSample,
  MeasureConfig,
  RunStats,
} from '../protocol';

/**
 * lib.dom 的 PerformanceObserverInit 還沒有 durationThreshold。
 * 在本檔補型別而不是動 types/perf.d.ts：那個檔案是全域補丁，
 * 而這個欄位只有這一個 observe() 呼叫用得到。
 */
interface EventObserverInit extends PerformanceObserverInit {
  durationThreshold: number;
}

/**
 * 一次互動的累積器。**不是**某一筆 entry 的複本。
 *
 * 一次點擊會產生 pointerdown / pointerup / click，共用同一個 interactionId，
 * 而且每一筆的 duration 都算到同一次 paint。所以 duration 最大的通常是 startTime
 * 最早那筆（pointerdown/pointerup），但真正做事的 handler 往往掛在 click 上。
 * 把三段拆解全部從「duration 最大那筆」算 = 總數對、兇手指錯。
 *
 * 所有欄位都是 document 相對時間（沒有加 timeOrigin），只有輸出成
 * InteractionSample 時才換算成 EpochMs。
 */
interface InteractionGroup {
  interactionId: number;
  /** duration 最大那筆的事件名。純粹除錯／顯示用，不參與計算 */
  repEventType: string;
  /** 組內最早的 startTime —— 這次互動什麼時候開始 */
  groupStart: number;
  /** 組內最早的 processingStart —— input delay 的終點 */
  firstProcessingStart: number;
  /** 組內最晚的 processingEnd —— processing 的終點 */
  lastProcessingEnd: number;
  /** 組內最大的 duration，就是 INP 認定的這次互動延遲 */
  maxDuration: number;
  entryCount: number;
}

export class InteractionCollector {
  readonly #cfg: MeasureConfig;

  /** interactionId → 該次互動的累積器（不是單一 entry，見 InteractionGroup） */
  readonly #byInteraction = new Map<number, InteractionGroup>();

  /** 自上次 drain 以來新建或被更新的 interactionId */
  readonly #dirty = new Set<number>();

  /** 由 host:set-mode 設定（EpochMs）。這之前開始的互動一律標 warmup */
  #warmupUntil: EpochMs = 0;

  #custom: Record<string, number> = {};

  /**
   * custom 是**累計快照**（drain 不清空它，面板要一直看得到 orderCount 這種條件值），
   * 所以「這批有沒有新東西」不能用 Object.keys(custom).length 判斷 —— mount 時 emit 一次
   * 之後它就永遠非空，呼叫端的「沒有新資料就不送」那道防線會整條變成死程式碼，
   * 於是每 250ms 都把外殼叫醒 re-render，正好違反 spec §3.3 的架構約束。
   */
  #customDirty = false;

  #po: PerformanceObserver | null = null;

  constructor(cfg: MeasureConfig) {
    this.#cfg = cfg;
  }

  start(): void {
    if (this.#po) return;

    const po = new PerformanceObserver((list) => {
      // 用 getEntriesByType 而非 getEntries：本站架構下這個 observer 只有 'event' 一種型別
      // （LoAF 在外殼、Event Timing 在 iframe，不同 document），所以理論上不必。
      // 但這段會被複製貼上 —— 一旦有人把它併進多型別 observer，getEntries() 會混入
      // 沒有 interactionId 的 entry，下面的相減全部變 NaN。防禦成本零。
      for (const e of list.getEntriesByType('event') as PerformanceEventTiming[]) {
        if (!e.interactionId) continue; // 0 或 undefined 都丟棄（`=== 0` 擋不掉 undefined）

        // 一次點擊會產生 pointerdown / pointerup / click 三筆 entry，共用同一個
        // interactionId。不分組 = 一次互動算三次 = 全站每一個 INP 都是錯的。
        // 這是整份規格最重要的一項（spec §4.2 / §5.1 第 1 項）。
        const g = this.#byInteraction.get(e.interactionId);
        if (!g) {
          this.#byInteraction.set(e.interactionId, {
            interactionId: e.interactionId,
            repEventType: e.name,
            groupStart: e.startTime,
            firstProcessingStart: e.processingStart,
            lastProcessingEnd: e.processingEnd,
            maxDuration: e.duration,
            entryCount: 1,
          });
        } else {
          // ⚠️ 三段拆解必須**跨整組聚合**，不能全部從「duration 最大的那一筆」算。
          //
          // 實測踩到過：忙迴圈跑在 click 的 handler 裡，但 duration 最大的是 pointerup
          // （它 startTime 最早，而每一筆的 duration 都算到同一次 paint）。
          // 只看代表 entry 的話，pointerup 的 processing 本來就趨近 0，
          // 於是 300ms 全被算進 presentation —— **總數 304ms 是對的，兇手指錯了**。
          // 這正好是本站最怕的那種錯：面板看起來完全正常，而標本 #1／#3 的教學主張
          //（「兇手落在 input delay／processing」）直接反過來。
          //
          // 正確的邊界（與 Google 的 INP attribution 同義）：
          //   input delay  = 最早的 processingStart − 最早的 startTime
          //   processing   = 最晚的 processingEnd  − 最早的 processingStart
          //   presentation = 這次互動的結束 − 最晚的 processingEnd
          g.groupStart = Math.min(g.groupStart, e.startTime);
          g.firstProcessingStart = Math.min(g.firstProcessingStart, e.processingStart);
          g.lastProcessingEnd = Math.max(g.lastProcessingEnd, e.processingEnd);
          if (e.duration > g.maxDuration) {
            g.maxDuration = e.duration;
            g.repEventType = e.name;
          }
          g.entryCount++;
        }
        // 兩個分支都改到了這一組的內容，一律標 dirty，否則外殼手上會留著過期的值。
        this.#dirty.add(e.interactionId);
      }
    });

    // durationThreshold 是規格允許的最低值 16。忘了調的話預設是 104ms，
    // 治療版本的數字會整批消失，看起來像程式壞了（陷阱 #4）。
    // buffered: true 是因為 observer 註冊前可能已經有互動發生（陷阱 #13）。
    const init: EventObserverInit = {
      type: 'event',
      buffered: true,
      durationThreshold: this.#cfg.eventDurationThreshold,
    };
    po.observe(init);
    this.#po = po;
  }

  stop(): void {
    this.#po?.disconnect();
    this.#po = null;
  }

  /** host:set-mode 時呼叫。這之前 startTime 的互動一律標 warmup */
  setWarmupUntil(until: EpochMs): void {
    this.#warmupUntil = until;

    // warmup 是**推導值**，不是存下來的欄位（見 #isWarmup），所以這裡不必回頭改樣本 ——
    // 改了 warmupUntil，所有既有分組的 warmup 判定就自動跟著變。
    // 這一點很重要：切 mode 時 warmupUntil 會跳到未來，前一個 mode 的所有樣本都落在它之前，
    // 於是自動退出統計。少了這個機制，病變版本的 400ms 會留在 Map 裡，
    // 而 n<50 時 INP 就是 max，那筆舊樣本會直接變成治療版本回報的數字。
    //
    // 唯一還要做的是標 dirty，讓外殼手上那份也跟著更新。
    for (const id of this.#byInteraction.keys()) this.#dirty.add(id);
  }

  /** host:reset。清空所有累積樣本與 custom */
  reset(): void {
    this.#byInteraction.clear();
    this.#dirty.clear();
    this.#custom = {};
    this.#customDirty = false;
    // warmupUntil 不動：reset 是「重跑同一個 mode」，mode 沒變就沒有新的暖機期。
    // 需要新暖機期的是 set-mode，那條路徑會自己設。
  }

  emitCustom(c: Record<string, number>): void {
    Object.assign(this.#custom, c);
    this.#customDirty = true;
  }

  /** 自上次 drain 以來新建或被更新的互動 + 當前全量統計 */
  drain(): {
    interactions: InteractionSample[];
    totalInteractions: number;
    inp: InpSummary | null;
    custom: Record<string, number>;
    /** 自上次 drain 以來 custom 有沒有被寫過。判斷「這批要不要送」用這個，不要用 custom 的鍵數 */
    customDirty: boolean;
  } {
    const interactions: InteractionSample[] = [];
    for (const id of this.#dirty) {
      const g = this.#byInteraction.get(id);
      if (g) interactions.push(this.#toSample(g));
    }
    this.#dirty.clear();

    // ⚠️ 這裡**不清空** #byInteraction。totalInteractions 與 inp 是整輪累計的，
    // 只有「本批新增/更新」那份清單是 per-batch。清掉 Map = 每 250ms 的 INP
    // 都只看得到最近 250ms 的互動，那個數字沒有任何意義。
    const inp = this.#computeInp();
    const customDirty = this.#customDirty;
    this.#customDirty = false;

    return {
      interactions,
      customDirty,
      // 跟 inp 同源。獨立的 totalInteractions++ 計數器（含 warmup）拿去索引一個
      // 已濾掉 warmup 的陣列，兩邊一定會偏移（spec §4.2）。同源，或者不要。
      totalInteractions: inp.count,
      inp,
      custom: { ...this.#custom },
    };
  }

  /**
   * warmup 是推導值。存成欄位再回頭改，就會出現「換代表 entry 時翻面」這類
   * 沒有徵兆的錯誤 —— 分組的開始時間是整組的性質，不是某一筆 entry 的性質。
   * ⚠️ 絕對不可以寫死 false。早期草稿真的出過這個 bug（spec §4.2）。
   */
  #isWarmup(g: InteractionGroup): boolean {
    return performance.timeOrigin + g.groupStart < this.#warmupUntil;
  }

  #toSample(g: InteractionGroup): InteractionSample {
    // 三段的邊界一律取自整組的聚合值（見 observer callback 裡的說明）。
    const inputDelay = g.firstProcessingStart - g.groupStart;
    const processing = g.lastProcessingEnd - g.firstProcessingStart;
    // 這次互動的結束 = 分組開始 + INP 認定的 duration（= 組內最大值）。
    // 用同一個 span 推 presentation，三段才會剛好加總回 duration ——
    // 面板上「三段相加不等於總數」比任何解釋都難收拾。
    const raw = g.groupStart + g.maxDuration - g.lastProcessingEnd;
    return {
      interactionId: g.interactionId,
      eventType: g.repEventType,
      // 跨 frame 唯一可比的時間軸。iframe 與外殼各有自己的 timeOrigin。
      startTime: performance.timeOrigin + g.groupStart,
      duration: g.maxDuration,
      inputDelay,
      processing,
      // duration 已被規格四捨五入到 8ms，presentation 用它算就繼承了量化誤差，
      // 誤差夠大時甚至算出負值。clamp 到 0，但把「被 clamp 過」記下來 ——
      // 那代表真實的 presentation 小於 8ms 網格的解析度，是教學訊號不是 bug（spec §4.3）。
      presentation: Math.max(0, raw),
      presentationClamped: raw < 0,
      entryCount: g.entryCount,
      warmup: this.#isWarmup(g),
    };
  }

  #computeInp(): InpSummary {
    // ⚠️ 第一步就是濾掉 warmup —— 這比下面的 index 公式重要得多。
    // 因為 n < 50 時 idx = 0，INP 就是 max：只要有一筆暖機離群值留在陣列裡，
    // 它就會直接變成你報告的那個數字，而面板看起來完全正常。
    const valid = [...this.#byInteraction.values()]
      .filter((g) => !this.#isWarmup(g))
      .map((g) => this.#toSample(g));
    if (valid.length === 0) {
      // 樣本數 0 時仍然回一個 summary（value: null），不是回 null ——
      // 面板要能顯示 `n=0`，而不是整塊消失。
      return { value: null, count: 0, isMaxNotP98: true, representative: null };
    }

    const sorted = valid.sort((a, b) => b.duration - a.duration);

    // 計數與排序陣列必須同源。n 一律從 valid 推導。
    const n = valid.length;
    const idx = Math.min(n - 1, Math.floor(n / this.#cfg.inpPercentileDivisor));
    const rep = sorted[idx];

    return {
      value: rep.duration,
      count: n,
      // 因為 minInteractions = 10，floor(10/50) = 0，本站永遠走 max 分支。
      // 保留公式只是為了跟 web-vitals 對得起來；面板要標「max」不是「p98」。
      isMaxNotP98: n < this.#cfg.inpPercentileDivisor,
      representative: rep,
    };
  }
}

/**
 * 用於 RunStats：median / p75 / spread 都從有效樣本推導。
 *
 * 面板顯示的 INP 是 max，但可重現性判定看 median —— max 天生抗離群值為零，
 * 三輪的 max 各差 30% 不代表條件沒凍住，三輪的 median 各差 30% 就代表了。
 */
export function computeRunStats(values: number[]): RunStats {
  const n = values.length;
  if (n === 0) return { n: 0, max: 0, median: 0, p75: 0, spread: 0 };

  // 複製再排序：呼叫端傳進來的陣列不該被我們就地改掉。
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // clamp 到 n-1：n 很小時 ceil(n * 0.75) - 1 仍在界內，但這條防線比註解便宜。
  const p75 = sorted[Math.min(n - 1, Math.ceil(n * 0.75) - 1)];

  return {
    n,
    max,
    median,
    p75,
    // median 為 0 時回 0，不是 NaN 也不是 Infinity ——
    // 面板上的 Infinity 會被誤讀成「條件完全沒凍住」，那是假警報。
    spread: median === 0 ? 0 : (max - min) / median,
  };
}
