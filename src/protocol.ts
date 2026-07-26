/**
 * 前端效能病理標本館 —— 凍結契約。
 *
 * 這個檔案凍結後**只准加欄位，不准改語意**（spec §5.4）。
 * 外殼與標本 import 同一份，型別單一來源（驗收第 13 條）。
 */

export const PROTOCOL_VERSION = 1 as const;

/** 跨 frame 唯一可比的時間軸：performance.timeOrigin + entry.startTime */
export type EpochMs = number;
/** iframe 自己 document 內的相對時間（載入期指標用這個才有意義） */
export type DocMs = number;

/** '01-main-thread-block'，等同 URL slug 與文章連結，凍結後不可改 */
export type SpecimenId = string;

// ───────────────────────── 量測參數 ─────────────────────────
// 任何一個值改動 = 先前所有數字作廢

export interface MeasureConfig {
  /** 16 = 規格允許的最低值。低於 16ms 的互動永遠不會被回報 */
  readonly eventDurationThreshold: 16;
  readonly flushIntervalMs: 250;
  readonly clsSessionGapMs: 1000;
  readonly clsSessionMaxMs: 5000;
  /**
   * INP ≈ p98：index = min(len-1, floor(count / divisor))
   * 注意：因為 minInteractions = 10，floor(10/50) = 0，本站永遠走 max 分支。
   * 保留這條公式的唯一理由是跟 web-vitals 對得起來 —— 面板要標「max」不是「p98」。
   */
  readonly inpPercentileDivisor: 50;
  /** 切換 mode 後丟棄的暖機時間。在 max 統計下，離群控制是可重現性的核心 */
  readonly warmupMs: 500;
  /** 統計有效所需的最少互動次數，未達標時 UI 必須標示 */
  readonly minInteractions: 10;
  /** droppedFrames 的量測窗。沒有它，掉幀數不可重現 */
  readonly droppedFrameWindowMs: 5000;
  /** 連續幾輪一致才算可重現（spec §1 原則 4） */
  readonly runsForReproducibility: 3;
}

export const MEASURE_CONFIG: MeasureConfig = Object.freeze({
  eventDurationThreshold: 16,
  flushIntervalMs: 250,
  clsSessionGapMs: 1000,
  clsSessionMaxMs: 5000,
  inpPercentileDivisor: 50,
  warmupMs: 500,
  minInteractions: 10,
  droppedFrameWindowMs: 5000,
  runsForReproducibility: 3,
} as const);

/** 無法從 JS 偵測，只能由使用者宣告 */
export type CpuThrottle = '1x' | '4x' | '6x' | 'unknown';

export interface DeviceProfile {
  ua: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  dpr: number;
  cpuThrottle: CpuThrottle;
  /**
   * 實測（一次 rAF 取樣即可）。60 還是 120 會讓 droppedFrames 的定義完全不同 ——
   * 120Hz 上用 16.7ms 當目標幀時間是錯的。
   */
  refreshHz: number;
  /** Phase 0 先填 null，之後補跑分不需改協定 */
  benchScore: number | null;
}

// ───────────────────────── 標本 metadata ─────────────────────────

export type SpecimenClass = 'A' | 'B'; // A = 互動期指標，B = 載入期指標
export type SwitchKind = 'live' | 'reload';

export interface SpecimenModeDef {
  /** 'broken' | 'fixed-yield' | 'fixed-worker' … 第一個必須是病變版本 */
  id: string;
  label: string;
  kind: 'pathological' | 'treatment';
  /** 治療梯度順序，UI 依此排列切換按鈕 */
  order: number;
  /** 這個 mode 用到的非 Baseline API，UI 需標註 */
  requires?: Array<'scheduler.yield' | 'web-worker' | 'content-visibility'>;
}

export type MetricKey =
  | 'inp'
  | 'inp.inputDelay'
  | 'inp.processing'
  | 'inp.presentation'
  | 'loaf.blockingDuration'
  | 'loaf.forcedStyleAndLayout'
  | 'loaf.specimenScriptDuration'
  | 'lcp'
  | 'cls'
  | 'custom.domNodeCount'
  | 'custom.renderedItems'
  | 'custom.droppedFrames'
  /**
   * Phase 2 加的（加值不改語意）。`droppedFrames` 是 5 秒**滾動窗**，
   * 負載結束後它會隨時間衰減 —— 而 `RunResult.customFinal` 取的是本輪最後一批 metrics，
   * 於是「跑完 10 秒串流、停下來、按重跑」會把一個已經衰減過的數字寫進歷史。
   * peak 是本輪內的最大值，不隨時間掉，跨輪比較要用它。
   */
  | 'custom.droppedFramesPeak';

export interface SpecimenMeta {
  id: SpecimenId;
  order: number;
  title: string;
  subtitle: string;

  class: SpecimenClass;
  /** A 類 = 'live'，B 類 = 'reload'。外殼據此渲染不同切換 UI */
  switchKind: SwitchKind;
  modes: SpecimenModeDef[];

  /** 面板置頂、文章主打的那一個 */
  primaryMetric: MetricKey;
  secondaryMetrics: MetricKey[];
  /** 教學重點：兇手落在哪 */
  culprit: 'inputDelay' | 'processing' | 'presentation' | 'loaf' | 'lcp' | 'cls';

  /**
   * 操作程序也是凍結變因 —— 十次連打與十次每秒一下是不同的實驗。
   * UI 照這個發指令（做成節拍器），文章照這個描述條件。
   */
  protocol: {
    action: 'click' | 'scroll' | 'type' | 'stream';
    repetitions: number;
    /** 每次之間的間隔；null = 盡快連續（這本身也是一種凍結） */
    intervalMs: number | null;
    /** '每次節拍亮起時點一下，共十次' */
    instruction: string;
    /**
     * 這個間隔是**機器節拍**，人手做不到（2026-07-26 新增欄位）。
     *
     * 為真時外殼**不渲染節拍器**：節拍器的用途是替人打拍子，而人照著它做出來的
     * 是另一個實驗；更嚴重的是它的 `setInterval` + 每拍一次 `setState` 會落在
     * 待量的那一段裡 —— 標本 #1 的兇手段正是 `presentation`，節拍器等於直接往裡面加料。
     *
     * 省略 = false = 人手做得到，照舊渲染節拍器。加欄位不改既有語意。
     */
    machinePaced?: boolean;
  };

  /** 凍結。CLS 與 LCP 都依賴 viewport，改這裡等於讓歷史數字作廢 */
  viewport: { width: number; height: number };

  entry: string; // '/specimens/01-main-thread-block.html'
  status: 'draft' | 'ready';
  difficulty: 1 | 2 | 3;
  drama: 1 | 2 | 3 | 4 | 5;
  tags: string[];
}

// ───────────────────────── URL 契約（B 類的生命線）─────────────────────────

export interface SpecimenUrlParams {
  mode: string;
  /** cache buster，B 類必帶 */
  t: string;
  /** 外殼的 sessionId，讓 iframe 回報時帶回來對帳 */
  sid: string;
  /**
   * '1' 時額外載入 web-vitals 交叉驗證。預設不載入，避免污染 baseline。
   * iframe 端一律用 `params.get('validate') === '1'` 判斷，**不要用 truthy**。
   */
  validate?: '1';
}

export function buildSpecimenUrl(meta: SpecimenMeta, p: SpecimenUrlParams): string {
  // 必須先濾掉 undefined。URLSearchParams 對每個值做 ToString，
  // 所以 { validate: undefined } 會變成字串 "validate=undefined" ——
  // 而 iframe 端 params.get('validate') 拿到 "undefined" 這個非空字串，
  // truthy 判斷會誤開 crossCheck 模式，污染 baseline。
  //   不帶 key               → mode=broken&t=1&sid=x          ✅
  //   帶 validate: undefined → …&validate=undefined           ❌
  // 省略 key 時本來就安全，但 `validate: cond ? '1' : undefined` 是很自然的寫法。
  const clean = Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  return `${meta.entry}?${new URLSearchParams(clean)}`;
}

// ───────────────────────── 樣本型別 ─────────────────────────

export interface InteractionSample {
  /** 一律 > 0；interactionId === 0 的 entry 必須丟棄 */
  interactionId: number;
  eventType: string;
  startTime: EpochMs;

  /** 已知四捨五入到最接近的 8ms */
  duration: number;
  inputDelay: number; // 高解析度
  processing: number; // 高解析度
  /**
   * 繼承 duration 的 8ms 量化，所以會落在 8ms 網格上。
   * 對「病變 vs 治療」的量級對照無影響；只在替兩個都已經很快的方案排名時咬人（spec §4.3）。
   * duration < 32ms 時 UI 標 ±8ms。
   */
  presentation: number;
  /** 量化誤差導致算出負值而被 clamp —— 這本身是重要的教學訊號 */
  presentationClamped: boolean;

  /** 這組底下的原始 entry 數（除錯用，正常點擊約 2~3） */
  entryCount: number;
  warmup: boolean;
}

export interface InpSummary {
  value: number | null; // null = 樣本數為 0
  count: number;
  /** count < inpPercentileDivisor 時為 true，代表這是 max 不是 p98 */
  isMaxNotP98: boolean;
  representative: InteractionSample | null;
}

export interface LcpSample {
  value: DocMs; // 相對 iframe 自己的 timeOrigin
  elementDescriptor: string;
  url: string | null;
  renderTime: DocMs;
  loadTime: DocMs;
}

export interface ClsSample {
  /** 所有 session window 的最大值，不是總和 */
  value: number;
  sessionCount: number;
  largestShift: { value: number; at: EpochMs; sourceDescriptors: string[] } | null;
}

export interface WebVitalsCrossCheck {
  inp: number | null;
  lcp: number | null;
  cls: number | null;
  /**
   * 容差是「結論級」不是「數值級」—— 目的是確認我沒有錯得離譜，
   * 不是證明我完全正確。詳見 spec §5.6 驗收第 8 條。
   */
  deltaInp: number | null; // 容差 max(24ms, 10%)，且兩者落在同一 CWV 區間
  deltaLcp: number | null; // 容差 50ms，且兩者選到同一個 elementDescriptor
  deltaCls: number | null; // 容差 0.02 或相對 10%，且落在同一門檻區間
}

// ───────────────────────── 可重現性（spec §1 原則 4）─────────────────────────

/** 一輪 = 一次「重置 → 照 protocol 互動 n 次 → 收斂」的完整量測 */
export interface RunResult {
  runId: string;
  specimenId: SpecimenId;
  mode: string;
  startedAt: EpochMs;
  /** 凍結條件快照。可重現的宣稱只在同一組 conditions 之間成立 */
  conditions: RunConditions;
  /** 本輪所有非 warmup 的互動 */
  samples: InteractionSample[];
  stats: RunStats;

  /*
   * ───── 以下三個是 Phase 2 加的欄位（「只准加欄位，不准改語意」的那個加）─────
   *
   * 為什麼非加不可：`samples` 與 `stats` 全部建立在 INP 之上，而**捲動與 wheel
   * 依規格不產生 `interactionId`**（INP 明文排除捲動）。標本 #4／#6 的主指標是
   * `custom.droppedFrames`，它們一輪下來會是零筆互動樣本 ——
   * 沒有這三個欄位，那兩個標本的「連跑三輪」永遠不會有東西可以比，
   * §1 原則 4 就從判準退化成宣稱。
   *
   * 都是可選欄位，先前的 RunResult 不受影響，歷史數字不作廢。
   */

  /** 本輪最後一批的 custom 快照（`droppedFrames` / `domNodeCount` 靠它進歷史）*/
  customFinal?: Record<string, number>;
  /** 本輪的 LCP 終值。B 類標本每個 mode 一份 document，所以這是 per-run 的 */
  lcpFinal?: LcpSample | null;
  /** 本輪的 CLS 終值 */
  clsFinal?: ClsSample | null;
}

export interface RunConditions {
  device: DeviceProfile; // 含 cpuThrottle 與 refreshHz
  viewport: { width: number; height: number };
  /** 操作程序快照，取自 SpecimenMeta.protocol */
  protocol: SpecimenMeta['protocol'];
  /** build 產物識別。換一版 build 就不是同一組條件，數字不可跨版比較 */
  buildId: string;
  protocolVersion: number;
  measure: MeasureConfig;
}

export interface RunStats {
  n: number;
  /** 面板顯示的 INP（n < 50 時等同 max） */
  max: number;
  /** 抗離群。可重現性判定用這個，不用 max */
  median: number;
  p75: number;
  /** (max - min) / median。> 0.3 時面板提示「條件可能沒凍住」 */
  spread: number;
}

/** 同一標本、同一 mode、同一組 conditions 下的多輪比較 */
export interface ReproducibilityReport {
  runs: RunResult[]; // 至少 MEASURE_CONFIG.runsForReproducibility
  /** 各輪 median 彼此的相對離散度 */
  medianSpread: number;
  /** 各輪的兇手段是否一致 */
  culpritStable: boolean;
  verdict: 'reproducible' | 'unstable' | 'insufficient-runs';
}

// ───────────────────────── LoAF（外殼側，不走 postMessage）─────────────────────────

export type LoafOrigin = 'specimen' | 'shell' | 'unknown';

export interface LoafScriptSample {
  sourceURL: string;
  sourceFunctionName: string;
  sourceCharPosition: number;
  duration: number;
  forcedStyleAndLayoutDuration: number;
  invoker: string;
  invokerType: string;
  origin: LoafOrigin;
}

export interface LoafSample {
  start: EpochMs;
  duration: number;
  /** 整幀的值，規格上無法拆到單一 script。UI 必須標明「含外殼」 */
  blockingDuration: number;
  styleAndLayoutDuration: number;

  /** 唯一可拆的部分 */
  specimenScriptDuration: number;
  shellScriptDuration: number;
  /** 只加總 origin === 'specimen' 的 script —— 標本 #3 的核心數字 */
  specimenForcedStyleAndLayoutDuration: number;

  attribution: LoafOrigin | 'mixed';
  topScripts: LoafScriptSample[]; // 依 duration 取前 5
}

// ───────────────────────── Shell → Specimen ─────────────────────────

export interface HostInit {
  type: 'host:init';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  specimenId: SpecimenId;
  mode: string;
  measure: MeasureConfig;
}

export interface HostSetMode {
  type: 'host:set-mode';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  mode: string;
}

/** 清空累積樣本但不 reload。「重跑」按鈕發這個 —— 前一輪的 RunResult 由外殼保留 */
export interface HostReset {
  type: 'host:reset';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  /** 新一輪的識別碼，後續 metrics 都掛在這個 run 底下 */
  runId: string;
}

/** 強制立即 flush，用於截圖前 */
export interface HostFlush {
  type: 'host:flush';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
}

export type HostMessage = HostInit | HostSetMode | HostReset | HostFlush;

// ───────────────────────── Specimen → Shell ─────────────────────────

export interface SpecimenReady {
  type: 'specimen:ready';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  specimenId: SpecimenId;
  mode: string;
  /** 外殼用來把 iframe 的 DocMs 換算成 EpochMs */
  timeOrigin: number;
  support: {
    eventTiming: boolean;
    interactionId: boolean;
    lcp: boolean;
    layoutShift: boolean;
    schedulerYield: boolean;
  };
}

export interface SpecimenModeChanged {
  type: 'specimen:mode-changed';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  mode: string;
  /** 這個時間點之後的樣本才屬於新 mode */
  at: EpochMs;
  /** 這之前的樣本標記 warmup，不列入統計 */
  warmupUntil: EpochMs;
}

export interface SpecimenMetrics {
  type: 'specimen:metrics';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  mode: string;
  /** 遞增序號，外殼可偵測掉包 */
  seq: number;
  flushedAt: EpochMs;

  /** 本批新增的互動（已依 interactionId 分組取 max） */
  interactions: InteractionSample[];
  /**
   * 本輪累計的**有效**（非 warmup）互動數 —— 算 index 與顯示 `n=` 都用它。
   * 不等於 interactions.length（那是本批新增的）。
   * 一律從有效樣本推導，不要另外維護計數器：計數器與排序陣列一旦不同源，index 就會偏移。
   */
  totalInteractions: number;
  inp: InpSummary | null;

  /** Phase 0 可先永遠回 null，欄位先存在 */
  lcp: LcpSample | null;
  cls: ClsSample | null;

  /** 標本自訂數值，避免每加一個標本就改協定 */
  custom: Record<string, number>;

  /** 只有 ?validate=1 時才有 */
  crossCheck: WebVitalsCrossCheck | null;
}

export interface SpecimenError {
  type: 'specimen:error';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  stage: 'init' | 'observe' | 'set-mode' | 'runtime';
  message: string;
  stack?: string;
}

export type SpecimenMessage = SpecimenReady | SpecimenModeChanged | SpecimenMetrics | SpecimenError;

// ───────────────────────── 標本檔案的 runtime contract ─────────────────────────

export interface SpecimenContext {
  mode: string;
  /** 標本上報自訂數值，會併進下一批 flush */
  emit(custom: Record<string, number>): void;
  /** 標本不准自己註冊 PerformanceObserver，一律用這個打標記 */
  mark(name: string): void;
}

export interface SpecimenModule {
  meta: SpecimenMeta;

  /** 建立實驗區 DOM。整個生命週期只呼叫一次 */
  mount(root: HTMLElement, ctx: SpecimenContext): void | Promise<void>;

  /**
   * A 類必須實作：即時換掉行為，不 reload。
   * B 類不實作，外殼偵測 switchKind === 'reload' 時走 URL 重載路徑。
   */
  setMode?(mode: string): void | Promise<void>;

  /** 回到初始狀態但不 reload。清 DOM、清計時器、清累積資料 */
  reset?(): void;

  /** 必須移除所有 listener / timer / observer / worker / RAF */
  destroy(): void;
}
