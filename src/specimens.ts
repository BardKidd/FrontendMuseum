/**
 * 標本註冊表 —— 外殼與標本共用同一份 metadata。
 *
 * id 就是 URL 就是文章連結，改了斷連結（spec §5.2 第 22 項）。
 * viewport 凍結，改這裡等於讓歷史數字作廢（spec §4.6）。
 */
import type { SpecimenId, SpecimenMeta } from './protocol';

/** 全站凍結的實驗區尺寸。不要用百分比或 vh */
const FROZEN_VIEWPORT = { width: 800, height: 600 } as const;

/**
 * 校準標本 —— 不是六個標本之一，是 Phase 0 的驗收工具（spec §5.5）。
 *
 * 兩個 mode 的忙迴圈時間是 300ms / 30ms，比值 10× 有解析解，
 * 所以它同時校準「絕對量級」與「病變 vs 治療的比值」這兩件事。
 */
export const CALIBRATION_META: SpecimenMeta = {
  id: '00-calibration',
  order: 0,
  title: '校準標本',
  subtitle: '每個負載都有解析解可以反推 —— 用來證明量測層本身是對的',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'busy-300', label: '忙迴圈 300ms', kind: 'pathological', order: 0 },
    { id: 'busy-30', label: '忙迴圈 30ms', kind: 'treatment', order: 1 },
  ],

  primaryMetric: 'inp.processing',
  // Phase 2 補上 LCP / CLS 觀測之後，校準件多了按鈕 C（位移，解析解可反推）
  // 與校準 D（LCP，載入後定時出現）。兩個新指標一併列進來，面板才會顯示它們。
  secondaryMetrics: [
    'inp',
    'loaf.specimenScriptDuration',
    'loaf.forcedStyleAndLayout',
    'lcp',
    'cls',
    'custom.droppedFrames',
  ],
  culprit: 'processing',

  // 每秒一下 —— 刻意讓互動之間不重疊，這樣 processing 段才會乾淨等於忙迴圈時間，
  // 驗收第 2 條（processing 落在 270~330ms）才有解析解可比。
  protocol: {
    action: 'click',
    repetitions: 10,
    intervalMs: 1000,
    instruction: '每次節拍亮起時點一下「忙迴圈」按鈕，共十次。不要連打。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/00-calibration.html',
  status: 'ready',
  difficulty: 1,
  drama: 1,
  tags: ['calibration', 'phase-0'],
};

/**
 * 標本 #1 —— 主執行緒阻塞。
 *
 * ⚠️ **兇手登記值在 2026-07-26 從 `inputDelay` 改成 `presentation`。**
 * 這不是改結論去迎合實測，是登記值被實測否證：2026-07-25 的三輪原始資料裡
 * `broken` 的 INP 拆解是 inputDelay 1.2~1.8ms / processing 135~143ms /
 * presentation 1120~1240ms，三輪一致 —— 一致地是 presentation。
 *
 * 而且這是**結構性的，不是間隔造成的**。對同步阻塞 handler 只有兩種區間，中間沒有縫：
 *   - `I ≥ S`（單次排序成本）⇒ 完全不排隊，兇手是 processing（退化成標本 #3）
 *   - `I < S` ⇒ 事件排隊，但十個 handler 連續跑完才輪到一次 paint，
 *     每一發都結束在**同一次** paint。`duration_k = T_paint − start_k`，
 *     最早開始的那一發最大 ⇒ **INP 的代表樣本恆為第一發**，而它前面沒有隊可排
 *     ⇒ inputDelay ≈ 0，兇手是 presentation。
 *
 * 所以「排隊」這件事 INP 看不見，不是因為間隔沒調對，是因為 INP 取的是最差的**單筆**。
 * 階梯改由標本自報的 `inputLagMaxMs` 呈現（handler 進入時刻 − 事件產生時刻），
 * 它不經過 INP 的取樣規則。完整推導與作廢清單在 `docs/phase1-expected-results.md` 修正紀錄。
 *
 * 與標本 #3 的對照因此改寫成：同樣是主執行緒被佔住，
 * #1 的代價落在 **presentation**（畫面遲遲不更新），#3 落在 **processing**（handler 自己慢）。
 *
 * `protocol.intervalMs` 同日從 `null`（盡快連續）改成 17ms 的機器節拍 ——
 * `null` 不是一個值，是「驅動器有多快就多快」，沒有人宣告、沒有人量、換台機器複製不出來。
 * 17 的三條邊界（上界 I < S、下界 I ≥ 一個 60Hz 幀、斜率算式）記在
 * `specimens/01-main-thread-block.ts` 檔頭。**驅動器必須絕對排程**：
 * 第 k 發打在 `t0 + k × I`，不是「上一發回來之後再等 I」—— 後者會被主執行緒的忙碌
 * 反過來決定節拍，那就不是凍結變因（已發出文章 §六（二）記錄過這個踩坑）。
 */
export const MAIN_THREAD_BLOCK_META: SpecimenMeta = {
  id: '01-main-thread-block',
  order: 1,
  title: '主執行緒阻塞',
  subtitle: '在事件處理器裡同步排序五萬筆訂單，期間整個 UI 凍結',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'broken', label: '病變：同步排序', kind: 'pathological', order: 0 },
    {
      id: 'fixed-yield',
      label: '治療一：切 chunk + yield',
      kind: 'treatment',
      order: 1,
      requires: ['scheduler.yield'],
    },
    {
      id: 'fixed-worker',
      label: '治療二：丟 Web Worker',
      kind: 'treatment',
      order: 2,
      requires: ['web-worker'],
    },
  ],

  primaryMetric: 'inp.presentation',
  secondaryMetrics: ['inp', 'inp.inputDelay', 'inp.processing', 'loaf.specimenScriptDuration'],
  culprit: 'presentation',

  /**
   * 17ms 是機器節拍，不是「模擬使用者連打」。人手連打約 150ms 一下，
   * 而 150 > S ⇒ 完全不排隊，那是另一個實驗（探針實測 INP 120ms、兇手 processing）。
   * 這一格的數字只在 CDP 絕對排程下成立，散文不准寫成「模擬連打」。
   */
  protocol: {
    action: 'click',
    repetitions: 10,
    intervalMs: 17,
    instruction:
      '這一格是機器節拍：每 17ms 派送一發、共十發、不等畫面回應（絕對排程，第 k 發打在 t0 + k×17ms）。'
      + '人手複驗做不到這個節奏，做出來的是另一個實驗 —— 請看驅動器的輸出，不要用手點。',
    machinePaced: true,
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/01-main-thread-block.html',
  status: 'ready',
  difficulty: 1,
  drama: 5,
  tags: ['inp', 'input-delay', 'scheduler', 'web-worker'],
};

/**
 * 標本 #3 —— 強制同步版面重排（Layout Thrashing）。
 *
 * 兇手是 processing，不是 input delay：強制重排發生在事件處理器**內部**，
 * 撐大的是 processing 段。這與標本 #1 形成對照 —— 同樣是主執行緒被佔住，
 * 兇手段不同（spec §4.1、`docs/phase1-expected-results.md`）。
 *
 * 所以 protocol.intervalMs **不可以是 null**：連打會讓事件排隊、把 input delay
 * 混進來，兇手段就不穩定了，§1 原則 4 第 2 條（三輪兇手一致）當場不通過。
 */
export const LAYOUT_THRASHING_META: SpecimenMeta = {
  id: '03-layout-thrashing',
  order: 3,
  title: '強制同步版面重排',
  subtitle: '在迴圈裡交替讀寫版面屬性，讀一次就逼瀏覽器把版面重算一次 —— 800 列就是 800 次',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'broken', label: '病變：交替讀寫', kind: 'pathological', order: 0 },
    { id: 'fixed-batched', label: '治療：讀寫分離', kind: 'treatment', order: 1 },
  ],

  primaryMetric: 'loaf.forcedStyleAndLayout',
  secondaryMetrics: ['inp', 'inp.processing', 'loaf.specimenScriptDuration', 'loaf.blockingDuration'],
  culprit: 'processing',

  /**
   * 間隔 2500ms 不是隨手填的：登記的 4x 預期上限是 2000ms
   * （`docs/phase1-expected-results.md`）。間隔若不大於那個上限，節流下的第 k 次點擊
   * 會落在第 k-1 次還沒跑完的時候，事件開始排隊，兇手段就從 processing 翻成 inputDelay。
   * 若某台機器上 4x 的病變值超過 2500ms，**要調的是這個間隔，不是結論**。
   */
  protocol: {
    action: 'click',
    repetitions: 10,
    intervalMs: 2500,
    instruction: '每次節拍亮起時點一下「更新列表」，共十次。不要連打 —— 連打會把 input delay 混進來。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/03-layout-thrashing.html',
  status: 'ready',
  difficulty: 2,
  drama: 5,
  tags: ['loaf', 'forced-reflow', 'layout-thrashing', 'processing'],
};

/**
 * 標本 #2 —— 長列表未虛擬化。**第一個 B 類標本。**
 *
 * `switchKind: 'reload'` 不是實作偏好：LCP 在第一次互動後定案、且是 per-document 的，
 * 不重載的話第二個 mode 永遠拿不到自己的 LCP（spec §3.4）。
 * 對應的標本模組因此**不實作 `setMode()`**。
 *
 * `content-visibility` 需要瀏覽器支援，兩段治療的 requires 各自標出來 ——
 * 使用者才不會把「瀏覽器沒有這個 API」誤讀成「這個 mode 壞了」。
 */
export const LONG_LIST_META: SpecimenMeta = {
  id: '02-long-list',
  order: 2,
  title: '長列表未虛擬化',
  /**
   * 2026-07-26 撤下「捲動掉幀」：正典掃描 broken 的 droppedFramesPeak 三輪皆 0 ——
   * 掉幀觀測在 mount 之後才啟動，載入期的卡頓落在觀測窗外，這個宣稱現行儀器量不到；
   * 反而是 fixed-virtual 捲動期穩定掉 9~10 幀（open-questions 十一.31）。
   * 不觀測就不宣稱。要重新掛回這四個字，先補載入期掉幀觀測。
   */
  subtitle: '一次渲染 5000 筆裝置狀態，約 40,000 個 DOM 節點 —— LCP 被拖垮',

  class: 'B',
  switchKind: 'reload',
  modes: [
    { id: 'broken', label: '病變：全部渲染', kind: 'pathological', order: 0 },
    {
      id: 'fixed-content-visibility',
      label: '治療一：content-visibility',
      kind: 'treatment',
      order: 1,
      requires: ['content-visibility'],
    },
    { id: 'fixed-virtual', label: '治療二：虛擬滾動', kind: 'treatment', order: 2 },
  ],

  primaryMetric: 'lcp',
  // domNodeCount 是這個標本最有說服力的第二指標：它把兩段治療的**本質差異**
  // 講得比任何毫秒數都清楚 —— content-visibility 的 5000 個節點還在，虛擬滾動的根本沒建。
  secondaryMetrics: ['custom.domNodeCount', 'custom.renderedItems', 'inp.presentation', 'cls'],
  culprit: 'lcp',

  protocol: {
    action: 'scroll',
    repetitions: 10,
    intervalMs: 500,
    instruction:
      '載入後先不要動，等面板出現 LCP（捲動也算互動，會讓 LCP 提前定案）；之後每次節拍捲動一格。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/02-long-list.html',
  status: 'ready',
  difficulty: 2,
  drama: 4,
  tags: ['lcp', 'content-visibility', 'virtual-scroll', 'dom-size'],
};

/**
 * 標本 #4 —— 事件處理未節流。
 *
 * 主指標是 `custom.droppedFrames` 而不是 INP，因為**捲動與 wheel 依規格不產生
 * `interactionId`**（INP 明文排除捲動）—— 這個標本的面板 INP 欄會是空的，
 * 那是規格如此，不是壞掉。跨輪可重現性因此改看 droppedFrames 的每輪終值
 *（`RunResult.customFinal`，Phase 2 加的欄位）。
 */
export const UNTHROTTLED_EVENTS_META: SpecimenMeta = {
  id: '04-unthrottled-events',
  order: 4,
  title: '事件處理未節流',
  subtitle: 'scroll handler 每次事件都掃過 8000 列；wheel 又是 passive:false，瀏覽器不敢先捲',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'broken', label: '病變：每次事件全掃', kind: 'pathological', order: 0 },
    // 這一段刻意只改一個變因，用來證明 passive 不夠 —— 它解決「捲動被阻塞」，
    // 不解決「handler 本身太重」。少了它，讀者會以為加個 passive 就沒事了。
    { id: 'fixed-passive', label: '治療一：wheel 改 passive', kind: 'treatment', order: 1 },
    { id: 'fixed-raf', label: '治療二：rAF 節流', kind: 'treatment', order: 2 },
    { id: 'fixed-observer', label: '治療三：IntersectionObserver', kind: 'treatment', order: 3 },
  ],

  // 用 peak 不用當下值：droppedFrames 是 5 秒滾動窗，捲完停手之後它會衰減，
  // 而歷史取的是本輪最後一批 metrics —— 不用峰值的話跨輪比的是「你多久之後按重跑」。
  primaryMetric: 'custom.droppedFramesPeak',
  secondaryMetrics: [
    'custom.droppedFrames',
    'loaf.blockingDuration',
    'loaf.specimenScriptDuration',
    'inp',
  ],
  culprit: 'loaf',

  protocol: {
    action: 'scroll',
    repetitions: 10,
    // 十拍 × 500ms = 5 秒，正好填滿 droppedFrames 的 5 秒滾動窗
    intervalMs: 500,
    /**
     * 2026-07-26：從「滾一格、共十次」改成「連滾三格、共十拍」。
     *
     * 一拍只滾一格時，rAF 閘門**一次都沒觸發過** —— 一幀之內永遠沒有第二個事件
     * 可以合併，所以「治療二：rAF 節流」量到的數字不是它的效果，是它從未進入作用區間。
     * 三輪原始資料裡 `fixed-raf` 與 `fixed-passive` 的 `passes` / `rectReads`
     * 逐輪完全相同，就是這件事的直接證據。
     *
     * ⚠️ 這是 protocol 的一部分，不是驅動器的內部細節：
     * `tools/reproducibility.mjs` 的 `SPECS[04].wheelTicks` 與這句話必須同時改，
     * 否則人手複驗做的不是機器做的那件事（spec §1 原則 3）。
     */
    instruction: '每次節拍亮起時在清單上連滾三格滑鼠滾輪，共十拍。用滾輪，不要拖捲軸。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/04-unthrottled-events.html',
  status: 'ready',
  difficulty: 1,
  drama: 3,
  tags: ['scroll', 'passive', 'raf', 'intersection-observer', 'dropped-frames'],
};

/**
 * 標本 #5 —— 版面位移（CLS）。B 類。
 *
 * `action: 'idle'`（載入後靜置觀察，零互動）是 2026-07-26 補進協定的詞彙。
 * 在此之前這裡登記的是 'stream'（當時的四個值沒有一個是「靜置觀察」，選最接近的
 * 並把缺口寫明），而驅動器（tools/reproducibility.mjs）同一個程序寫的是 'idle' ——
 * 同一件事兩邊叫不同名字。缺口補上後兩邊同源；此臂實際執行的程序沒有變。
 */
export const LAYOUT_SHIFT_META: SpecimenMeta = {
  id: '05-layout-shift',
  order: 5,
  title: '版面位移',
  subtitle: '圖片沒尺寸 + 字族換入 + 延遲插入橫幅，三次位移落進同一個 session window',

  class: 'B',
  switchKind: 'reload',
  /**
   * 2026-07-26：單一 `fixed` 臂拆成梯度三段。
   *
   * 修好位移源二（字族換入原本不產生任何 entry）之後，原本那一臂的三條 CSS
   * 全部生效 —— 它一次翻三個變因，而已發出的文章正是用「一段治療只准翻一個變因」
   * 這把尺判過標本 #4 的死刑。同一把尺量下去，不拆就是自己的標本退讓。
   *
   * 拆法照標本 #4 的形狀：**每一臂相對前一臂只翻一個變因**，三條 CSS 是累加的，
   * 不是三選一。`fixed-banner` 同時帶著前兩段的預留。
   */
  modes: [
    { id: 'broken', label: '病變：三個位移源', kind: 'pathological', order: 0 },
    { id: 'fixed-image', label: '治療一：圖片 aspect-ratio', kind: 'treatment', order: 1 },
    { id: 'fixed-font', label: '治療二：再預留內文行高', kind: 'treatment', order: 2 },
    { id: 'fixed-banner', label: '治療三：再預留橫幅', kind: 'treatment', order: 3 },
  ],

  primaryMetric: 'cls',
  secondaryMetrics: ['lcp'],
  culprit: 'cls',

  protocol: {
    action: 'idle',
    repetitions: 1,
    intervalMs: null,
    instruction:
      '載入後靜置三秒，什麼都不要碰 —— 互動後 500ms 內的位移會被 hadRecentInput 豁免，不算 CLS。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/05-layout-shift.html',
  status: 'ready',
  difficulty: 1,
  drama: 4,
  tags: ['cls', 'aspect-ratio', 'font-metrics', 'session-window'],
};

/**
 * 標本 #6 —— 高頻資料流造成的 re-render 風暴。
 *
 * spec:1136 給它的定位：全案最有原創性、市面上幾乎沒有人做過，
 * 同時是唯一的差異化資產（IoT 背景），所以放進核心六件而不是加碼。
 *
 * `action: 'stream'` 沒有節拍器可言 —— 操作程序是「按一次開始，然後不要碰畫面」，
 * 串流長度由標本自己計時（5 秒，等於掉幀滾動窗），不靠操作者的手感。
 */
export const RERENDER_STORM_META: SpecimenMeta = {
  id: '06-rerender-storm',
  order: 6,
  title: 're-render 風暴',
  subtitle: '每 25ms 推一批裝置狀態，病變版每批都重建整張 1000 列清單 —— 每秒 40 次全表重繪',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'broken', label: '病變：每批重建整表', kind: 'pathological', order: 0 },
    { id: 'fixed-batch', label: '治療一：批次化 + rAF', kind: 'treatment', order: 1 },
    { id: 'fixed-granular', label: '治療二：只改變動的節點', kind: 'treatment', order: 2 },
    /**
     * 2026-07-26 從「治療三：背壓丟中間狀態」改名。
     *
     * 治療梯度是**樹狀不是鏈狀**：背壓接在 `fixed-batch` 之下，與 `fixed-granular`
     * 是兄弟不是後繼（前者翻「渲染的次數」，後者翻「每一次渲染的成本」）。
     * 叫「治療三」會讓讀者以為它是「治療二再加一點」，而那正是本專案要消滅的那種誤讀。
     *
     * ⚠️ `tools/reproducibility.mjs` 的 `SPECS[06].modes` 必須逐字相同 ——
     * 驅動器靠 `textContent.includes(label)` 點按鈕。
     */
    { id: 'fixed-backpressure', label: '治療二乙：背壓降頻', kind: 'treatment', order: 3 },
  ],

  primaryMetric: 'custom.droppedFramesPeak',
  secondaryMetrics: [
    'custom.droppedFrames',
    'loaf.blockingDuration',
    'loaf.specimenScriptDuration',
    'inp.presentation',
  ],
  culprit: 'loaf',

  protocol: {
    action: 'stream',
    // 只有一次操作（按開始），之後全自動。節拍器對這個標本沒有意義，所以 intervalMs 是 null。
    repetitions: 1,
    intervalMs: null,
    instruction: '按一次「開始推送」，然後靜置五秒不要碰畫面。串流會自動停止。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/06-rerender-storm.html',
  status: 'ready',
  difficulty: 2,
  drama: 5,
  tags: ['websocket', 'batching', 'raf', 'backpressure', 'dropped-frames'],
};

export const SPECIMENS: SpecimenMeta[] = [
  CALIBRATION_META,
  MAIN_THREAD_BLOCK_META,
  LONG_LIST_META,
  LAYOUT_THRASHING_META,
  UNTHROTTLED_EVENTS_META,
  LAYOUT_SHIFT_META,
  RERENDER_STORM_META,
].sort((a, b) => a.order - b.order);

export function getSpecimen(id: SpecimenId): SpecimenMeta | undefined {
  return SPECIMENS.find((s) => s.id === id);
}
