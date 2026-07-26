/**
 * 標本端 bootstrap —— 每個標本 entry 檔案的最後一行都是 `bootstrapSpecimen(module)`。
 *
 * 這一層只做四件事：翻譯 URL 契約、把 postMessage 接到 SpecimenModule 上、
 * 節流回報、把錯誤變成看得見的紅字。
 *
 * 它刻意不含任何一行「怎麼算 INP」（那是 metrics.ts）或「病變長什麼樣」（那是標本檔案）。
 * 這個分界不是美學，是陷阱 #18：一旦這裡開始長 options 與 hook，
 * 三個週末過去會一個標本都沒有。
 */
import { MEASURE_CONFIG, PROTOCOL_VERSION } from '../protocol';
import type {
  EpochMs,
  HostMessage,
  SpecimenContext,
  SpecimenError,
  SpecimenMessage,
  SpecimenMetrics,
  SpecimenModeChanged,
  SpecimenModule,
  SpecimenReady,
  WebVitalsCrossCheck,
} from '../protocol';
import { InteractionCollector } from './metrics';
import { FrameCounter } from './frames';
import { ClsCollector, LcpCollector } from './vitals';

/**
 * 跨 frame 唯一可比的時間軸（spec §5.2 第 19 項）。
 * 所有要送出 iframe 的時間戳都必須先過這裡 —— iframe 與外殼各有自己的 timeOrigin，
 * 直接送 performance.now() 的值，外殼收到的是一個沒有意義的數字。
 */
function nowEpoch(): EpochMs {
  return performance.timeOrigin + performance.now();
}

export function bootstrapSpecimen(mod: SpecimenModule): void {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('sid') ?? '';

  /**
   * 一律 `=== '1'`，**不要用 truthy**。
   * `buildSpecimenUrl` 若漏濾 undefined，這裡拿到的是字串 "undefined" ——
   * 非空即 truthy，會靜默打開交叉驗證模式，把 web-vitals 自己那一整組 observer
   * 混進 baseline，而且面板上看起來一切正常（protocol.ts 有完整說明）。
   */
  const validate = params.get('validate') === '1';

  /**
   * 未指定或指不到的 mode 一律退回 `modes[0]`。
   * 註冊表保證 modes[0] 是病變版本 —— 網址打錯時預設要掉到誇張的那一邊，
   * 免得有人拿著治療版的數字以為那是病變。
   */
  const requestedMode = params.get('mode');
  const initialMode =
    requestedMode !== null && mod.meta.modes.some((m) => m.id === requestedMode)
      ? requestedMode
      : mod.meta.modes[0].id;

  const collector = new InteractionCollector(MEASURE_CONFIG);
  /**
   * 載入期指標與掉幀計數。三個都是 Phase 0 明文延後、Phase 2 才補上的東西
   * （spec §5.3）—— 補的時候**一行協定都沒動**，`LcpSample` / `ClsSample` /
   * `custom.droppedFrames` 的型別從 Phase 0 就凍在那裡了，所以先前的數字不作廢。
   */
  const lcpCollector = new LcpCollector();
  const clsCollector = new ClsCollector(MEASURE_CONFIG);
  const frames = new FrameCounter(MEASURE_CONFIG.droppedFrameWindowMs);

  /**
   * `ctx.mode` 就是「現在是哪個 mode」的唯一來源，不另外維護一個 currentMode。
   * 兩個同義變數遲早有一個忘了更新，而回報裡的 mode 一旦標錯，整批數字就歸錯組
   * —— 這是陷阱 #1 第三坑（「計數器與排序陣列不同源」）的同一種病。
   */
  const ctx: SpecimenContext = {
    mode: initialMode,
    emit(custom) {
      collector.emitCustom(custom);
    },
    mark(name) {
      // 標本不准自己註冊 PerformanceObserver（spec §3.3 職責分工），
      // performance.mark 是它唯一能往量測層說話的通道。
      performance.mark(name);
    },
  };

  // ───────────────────────── 對外通道 ─────────────────────────

  function post(msg: SpecimenMessage): void {
    // 同源，targetOrigin 就寫死自己的 origin。不用 '*'：那等於把量測資料
    // 廣播給任何嵌得進來的頁面，而這裡沒有任何理由需要那樣。
    window.parent.postMessage(msg, window.location.origin);
  }

  function readyMessage(): SpecimenReady {
    return {
      type: 'specimen:ready',
      v: PROTOCOL_VERSION,
      sessionId,
      specimenId: mod.meta.id,
      // 每次現算，不是開機時算好放著 —— host:init 是冪等 ack，
      // 切過 mode 之後再 ack 一次必須回報當下的 mode。
      mode: ctx.mode,
      timeOrigin: performance.timeOrigin,
      support: {
        // 已宣告 Chromium-only，這四個在 Chromium 上永遠是 true。
        // 替恆真的布林寫偵測邏輯，正是 Phase 0 明文要擋掉的過度工程（spec §5.2「降級」）。
        eventTiming: true,
        interactionId: true,
        lcp: true,
        layoutShift: true,
        // 只有這一個是真的要問：scheduler.yield 非 Baseline（Safari 沒有），
        // 而標本 #1 的「治療一」整段就架在它上面，UI 必須標註。
        schedulerYield: typeof window.scheduler?.yield === 'function',
      },
    };
  }

  function fail(stage: SpecimenError['stage'], cause: unknown): void {
    const err = cause instanceof Error ? cause : new Error(String(cause));
    post({
      type: 'specimen:error',
      v: PROTOCOL_VERSION,
      sessionId,
      stage,
      message: err.message,
      stack: err.stack,
    });
    // Phase 0 的降級故事到這裡為止：拋出可見錯誤，紅字寫在 iframe 上（spec §5.3）。
    // 沒有 retry、沒有 fallback —— 量測層壞掉的時候，它看起來就必須是壞的，
    // 否則面板會照常出數字，而那些數字沒有任何意義。
    const box = document.createElement('pre');
    box.style.color = 'red';
    box.textContent = `[specimen:${stage}] ${err.message}\n${err.stack ?? ''}`;
    document.body.appendChild(box);
  }

  // ───────────────────────── 暖機窗 ─────────────────────────

  /**
   * 切 mode 與重跑之後的 warmupMs 內樣本一律丟棄。
   *
   * 因為 minInteractions = 10 而 inpPercentileDivisor = 50，本站的 INP 永遠走 max 分支
   * —— max 沒有平均可以稀釋離群值，**一筆 JIT 暖機樣本就是你報告的那個數字**，
   * 而面板看起來完全正常（spec §3.4、§5.1 第 6 項、陷阱 #1 第二坑）。
   * 所以這不是精修，是可重現性本身。
   */
  function armWarmup(at: EpochMs): EpochMs {
    const warmupUntil = at + MEASURE_CONFIG.warmupMs;
    collector.setWarmupUntil(warmupUntil);
    return warmupUntil;
  }

  // ───────────────────────── flush 迴圈 ─────────────────────────

  let seq = 0;
  let flushTimer = 0;
  /** 本輪內 droppedFrames 的最大值。滾動窗會衰減，跨輪比較要用這個（見 MetricKey 的說明）*/
  let droppedPeak = 0;
  /** 上一次真的送出去的 INP。同時當節流的比較基準與 crossCheck 的手刻側 */
  let lastInp: number | null = null;
  let crossCheck: WebVitalsCrossCheck | null = null;

  /*
   * 交叉驗證只在**第一輪的第一個 mode** 有效，之後永久退役。
   *
   * 原因是兩邊的時間範圍根本不同：手刻側的 INP 只算「上一次 reset / set-mode 之後的
   * 非 warmup 樣本」，而 web-vitals 的 onINP 算的是**整個 document 生命週期**。
   * 本站 A 類標本切 mode 不 reload，所以 document 活過每一次切換 —— 在 busy-300 量到
   * 300ms 之後切到 busy-30，手刻側變成 30、web-vitals 還是 300，Δ = -270ms，
   * 面板會顯示成「手刻實作壞掉了」。那是比對範圍的錯，不是實作的錯。
   *
   * 這條規則同時就是 spec §5.3 講的「人眼看一次，對上就永遠不用再看」——
   * 第一輪對上了就達成目的，不需要為了讓它一直有效去寫一套雙軌統計。
   */
  let crossCheckLive = validate;

  function retireCrossCheck(): void {
    crossCheckLive = false;
    crossCheck = null;
  }

  /**
   * 三個指標各自從不同的 callback 回來，所以 crossCheck 必須是**逐欄補進去**的，
   * 不能每次整個覆蓋 —— 覆蓋的話 onLCP 一回來就會把 onINP 剛填好的 inp 洗成 null，
   * 而面板上看起來只是「INP 這欄還沒對帳」。
   */
  function patchCrossCheck(patch: Partial<WebVitalsCrossCheck>): void {
    if (!crossCheckLive) return;
    crossCheck = {
      inp: null,
      lcp: null,
      cls: null,
      deltaInp: null,
      deltaLcp: null,
      deltaCls: null,
      ...crossCheck,
      ...patch,
    };
  }

  function logCrossCheck(metric: string, mine: number | null, lib: number, extra?: string): void {
    console.table([
      { metric, source: 'hand-rolled', value: mine, note: extra ?? '' },
      { metric, source: 'web-vitals', value: lib, note: '' },
      { metric, source: 'delta (mine - lib)', value: mine === null ? null : mine - lib, note: '' },
    ]);
  }

  function flush(): void {
    try {
      const batch = collector.drain();
      const inpValue = batch.inp?.value ?? null;
      // LCP / CLS 一輪只會變動幾次（candidate 換人、新的位移 session），
      // 所以讓它們有資格觸發一次 flush —— 否則 B 類標本可能整輪沒有互動樣本，
      // 面板就永遠等不到 LCP。
      const lcpDirty = lcpCollector.takeDirty();
      const clsDirty = clsCollector.takeDirty();
      // 峰值必須每個 flush 週期都更新，**不能只在真的送出去的時候更新** ——
      // 掉幀最嚴重的那段時間往往沒有別的東西在變（沒有互動、沒有新的 LCP），
      // 那些週期會走上面的「沒有新東西就不送」提早 return，峰值就正好漏掉最高的那一段。
      const dropped = frames.dropped();
      if (dropped > droppedPeak) droppedPeak = dropped;

      /*
       * 沒有新東西就整包不送。兩個理由，第二個才是重點：
       *   1. 驗收第 9 條：連續互動 5 秒，seq 遞增 ≤ 25 次。
       *   2. 空跳也送 = 每 250ms 把外殼叫醒 re-render，而外殼的 re-render 會落在
       *      互動的同一幀 —— iframe 不保護 presentation delay，標本 #2 的兇手正好
       *      就是那一段，這裡沒有安全邊際（spec §3.3 架構約束、陷阱 #12）。
       * drain() 是破壞性的，所以判斷條件必須涵蓋所有會被丟掉的東西。
       */
      // ⚠️ custom 用 customDirty 判斷，不能用 Object.keys(batch.custom).length。
      // custom 是累計快照（drain 不清空），兩個標本都在 mount 裡 emit 過一次，
      // 所以鍵數從第一次 flush 之後就永遠 > 0 —— 用它當條件，這整道防線是死程式碼。
      //
      // ⚠️ droppedFrames **刻意不在這個條件裡**。它每一幀都可能變，放進來等於
      // 畫面一卡就每 250ms 把外殼叫醒重繪 —— 而外殼的重繪會落在互動的同一幀，
      // 正好加進標本 #4／#6 自己要量的 presentation 段（spec §3.3 架構約束）。
      // 它是**搭便車**的欄位：別的東西觸發 flush 時順便帶出去。
      // 這兩個標本本來就會在 handler 裡 emit 自己的計數器，flush 不缺觸發源。
      if (
        batch.interactions.length === 0 &&
        !batch.customDirty &&
        inpValue === lastInp &&
        !lcpDirty &&
        !clsDirty
      ) {
        return;
      }
      lastInp = inpValue;
      seq += 1;

      const msg: SpecimenMetrics = {
        type: 'specimen:metrics',
        v: PROTOCOL_VERSION,
        sessionId,
        mode: ctx.mode,
        seq,
        flushedAt: nowEpoch(),
        interactions: batch.interactions,
        // 有效樣本數由 collector 從樣本推導，這裡只轉手。
        // 自己在這一層再數一次就是陷阱 #1 第三坑。
        totalInteractions: batch.totalInteractions,
        inp: batch.inp,
        // Phase 0 這兩個欄位一律 null，Phase 2 補上 observer。**協定一行都沒動** ——
        // 這正是 spec §5「凍結型別，不凍結實作」當初要買的東西，先前數字不作廢。
        lcp: lcpCollector.current(),
        cls: clsCollector.current(),
        custom: {
          ...batch.custom,
          // 標本不必各自實作掉幀計數：它需要實測 refreshHz 當門檻，
          // 每個標本抄一份遲早會有一份寫死 16.7ms，而那在 120Hz 上是錯的。
          droppedFrames: dropped,
          droppedFramesPeak: droppedPeak,
          // 被 hadRecentInput 豁免掉的位移筆數。病變版整批被豁免時面板會顯示 CLS=0，
          // 那時候該懷疑的是操作程序（在位移發生前就點了畫面），不是標本沒病。
          clsIgnoredByInput: clsCollector.ignoredByInput(),
        },
        // 只有 ?validate=1 會把它寫成非 null，其餘情況它從頭到尾都是 null。
        crossCheck,
      };
      post(msg);
    } catch (cause) {
      // 量測層自己壞掉之後，每 250ms 再送一次錯誤只會洗版，而且面板上的數字
      // 已經沒有意義。停掉迴圈，讓紅字停在畫面上。
      window.clearInterval(flushTimer);
      fail('runtime', cause);
    }
  }

  // ───────────────────────── 外殼指令 ─────────────────────────

  async function handleSetMode(mode: string): Promise<void> {
    try {
      await mod.setMode?.(mode);
    } catch (cause) {
      fail('set-mode', cause);
      return;
    }
    ctx.mode = mode;
    /*
     * ⚠️ 掉幀窗與峰值必須跟著 mode 一起歸零 —— 這是實測抓到的缺陷，不是防禦性程式。
     *
     * 漏掉的話：病變版跑完峰值是 N，切到治療版之後**峰值原封不動地留著**，
     * 於是治療版的主指標顯示的是病變版的成績。而面板上一切正常 ——
     * 兩個 mode 的數字一模一樣，看起來像「治療沒有效果」。
     * 這正好是本站最怕的那種錯：結論反過來，而且沒有任何徵兆。
     */
    frames.reset();
    droppedPeak = 0;
    // 切 mode 之後手刻側歸零、web-vitals 不歸零，兩邊比的不是同一段時間。
    retireCrossCheck();
    // 外殼靠 `at` 加上每個 sample 自己的 startTime 切開新舊 mode 的樣本，
    // 所以這個時間戳必須在 setMode 真的完成之後才取。
    const at = nowEpoch();
    const warmupUntil = armWarmup(at);
    const msg: SpecimenModeChanged = {
      type: 'specimen:mode-changed',
      v: PROTOCOL_VERSION,
      sessionId,
      mode,
      at,
      warmupUntil,
    };
    post(msg);
  }

  function handleReset(): void {
    // ⚠️ 順序有意義：collector.reset() 必須跑在 mod.reset() **之前**。
    // 兩個標本都在自己的 reset() 裡 emit 條件值（orderCount / layoutIterations）。
    // 反過來寫的話那些值會立刻被 collector.reset() 的 `#custom = {}` 洗掉，
    // 第二輪之後面板上就再也看不到條件 —— 而「條件先於數字出現」是本站的展示前提。
    collector.reset();
    // ⚠️ 掉幀窗清掉，但 LCP / CLS **不清累計值**（見 vitals.ts 的 reset 註解）：
    // 那兩個是這份 document 的性質，不是這一輪的性質。按「重跑」不會讓圖片重載、
    // 不會讓字型重新換入 —— 清掉只會得到一個假的 0，而面板看起來完全正常。
    frames.reset();
    droppedPeak = 0;
    lcpCollector.reset();
    clsCollector.reset();
    // seq 歸零 = 外殼認得出這是新的一輪（HostReset.runId 由外殼自己保管，
    // metrics 訊息裡沒有這個欄位，靠 seq 重新從 1 開始對帳）。
    seq = 0;
    // 節流基準也是每輪的衍生狀態，忘了清就會拿上一輪的值當這一輪的比較對象。
    lastInp = null;
    retireCrossCheck();

    try {
      mod.reset?.();
    } catch (cause) {
      fail('runtime', cause);
      return;
    }
    // 重跑一輪跟切 mode 有一模一樣的冷啟動問題，暖機窗必須重新上膛。
    // 時間戳要在 mod.reset() 真的跑完之後才取 —— 它會重建 DOM。
    armWarmup(nowEpoch());
  }

  /** 只驗信封。內容型別對不對是外殼的責任，這裡不做深度驗證 */
  function isHostMessage(data: unknown): data is HostMessage {
    if (typeof data !== 'object' || data === null) return false;
    const m = data as Record<string, unknown>;
    return m.v === PROTOCOL_VERSION && m.sessionId === sessionId && typeof m.type === 'string';
  }

  /** mount 完成、collector 已啟動、ready 已送出 */
  let started = false;

  window.addEventListener('message', (ev: MessageEvent) => {
    const data: unknown = ev.data;
    // 這個 window 上還有 React DevTools 與 Vite HMR 在丟訊息。
    // 版本或 sessionId 對不上就靜默丟掉 —— 不要 console.warn，dev 模式下會洗版。
    if (!isHostMessage(data)) return;

    if (data.type === 'host:init') {
      /*
       * ⚠️ 絕對不可以在這裡回 ready。
       *
       * 外殼收到 specimen:ready 就會送 host:init。這裡若再回一次 ready，就變成
       *   boot → ready → host:init → ready → host:init → …
       * 一條永不收斂的 postMessage 迴圈。而同源 iframe 與外殼**共用同一條 renderer
       * 主執行緒**，於是從標本開機那一刻起主執行緒就永遠有待處理的訊息任務：
       * 每一筆互動的 input delay 都被墊高、每一幀 LoAF 都摻進 handler、噪音底線整個抬升 ——
       * 正好壓縮掉本站唯一要展示的那個病變／治療比值。而面板全程顯示看起來正常的數字。
       *
       * host:init 在 Phase 0 是純粹的 no-op ack：mode 從 URL 讀、MEASURE_CONFIG 是靜態 import，
       * 標本不需要從這個訊息拿任何東西。保留這個分支只是為了「收到了，而且是合法信封」。
       */
      return;
    }

    // ready 之前的控制訊息一律忽略：mod 都還沒 mount，setMode / reset 沒有意義。
    if (!started) return;

    switch (data.type) {
      case 'host:set-mode':
        void handleSetMode(data.mode);
        break;
      case 'host:reset':
        handleReset();
        break;
      case 'host:flush':
        // 截圖前用。強制把 buffer 倒乾淨，免得畫面上的數字比實際少一批。
        flush();
        break;
    }
  });

  window.addEventListener(
    'pagehide',
    () => {
      // 先停迴圈，才不會在 collector 已經停掉之後還去 drain 它。
      window.clearInterval(flushTimer);
      collector.stop();
      // FrameCounter 的 rAF 迴圈忘了停，驗收第 12 條（切走標本後靜置五秒
      // 不得出現 origin === 'specimen' 的 LoAF entry）就會掛在量測層自己手上。
      frames.stop();
      lcpCollector.stop();
      clsCollector.stop();
      try {
        // 驗收第 12 條：切換標本後靜置 5 秒，不得再出現 origin === 'specimen' 的 LoAF entry。
        // 沒清掉的 timer / RAF / worker 會讓下一個標本的數字掛在這個標本頭上。
        mod.destroy();
      } catch (cause) {
        // 卸載期沒有可靠的回報通道，postMessage 大機率送不出去，只能留在 console。
        console.error('[specimen] destroy failed', cause);
      }
    },
    { once: true },
  );

  // ───────────────────────── 開機 ─────────────────────────

  async function boot(): Promise<void> {
    const root = document.createElement('div');
    root.id = 'specimen-root';
    document.body.appendChild(root);

    try {
      // 整個生命週期只呼叫一次。標本自己讀 ctx.mode 決定初始形態 ——
      // 這裡不補一次 setMode，補了等於 mount 完立刻切一次 mode，
      // 白白製造一段沒人負責丟棄的暖機期。
      await mod.mount(root, ctx);
    } catch (cause) {
      fail('init', cause);
      return;
    }

    try {
      // 首次載入跟切 mode 一樣冷：mount 剛跑完 DOM 建構與第一次 layout，
      // 這 500ms 內的樣本一樣不能算。
      armWarmup(nowEpoch());
      collector.start();
      lcpCollector.start();
      clsCollector.start();
      // 非同步：要先量到 refreshHz 才知道「一幀該多久」。
      // 不 await —— 這裡卡住的話 specimen:ready 送不出去，整個握手就死了。
      // 量測期間（約 20 幀）不計數，剛好被 500ms 暖機窗蓋掉。
      void frames.start();
    } catch (cause) {
      fail('observe', cause);
      return;
    }

    flushTimer = window.setInterval(flush, MEASURE_CONFIG.flushIntervalMs);
    started = true;
    post(readyMessage());

    if (validate) {
      /*
       * 動態 import 必須關在這個分支裡。web-vitals 自己會註冊一整組 PerformanceObserver，
       * 一旦進了預設 bundle，這個用來驗 baseline 的工具就成了污染 baseline 的來源。
       * 而且它必須 bundle 在標本頁裡，不能從外殼驗 —— 該套件對 iframe 內容零可見度，
       * 同源也一樣（陷阱 #7）。
       */
      void import('web-vitals')
        .then(({ onINP, onLCP, onCLS }) => {
          onINP(
            (metric) => {
              // 已經切過 mode 或重跑過就不再比對 —— 見 crossCheckLive 上方的說明。
              // 手刻側取「上一次真的送出去的值」。兩邊最多差一個 flush 週期（250ms），
              // 但第 8 條的容差本來就是結論級不是數值級：目的是確認我沒有錯得離譜，
              // 不是證明我完全正確（spec §5.6）。
              const mine = lastInp;
              patchCrossCheck({
                inp: metric.value,
                deltaInp: mine === null ? null : mine - metric.value,
              });
              // 人眼看一次，對上就永遠不用再看。
              // 不要為這件事寫自動比對 harness，那是明文延後項目（spec §5.3）。
              logCrossCheck('inp', mine, metric.value);
            },
            {
              // 門檻必須跟 MEASURE_CONFIG 同一個值。不同步的話兩邊看到的互動集合就不同，
              // 對不上的原因會變成「你自己設歪的」，這場交叉驗證就白做了（陷阱 #4）。
              durationThreshold: MEASURE_CONFIG.eventDurationThreshold,
              // 預設只在頁面隱藏時回報一次，那時候面板早就看不到了。
              reportAllChanges: true,
            },
          );

          /*
           * LCP / CLS 的交叉驗證沒有 INP 那個「切 mode 之後兩邊比的不是同一段時間」的問題：
           * 這兩個指標本來就是 per-document 的，而用得到它們的 B 類標本切 mode 一律 reload
           * —— 換 mode 就是換 document，兩邊同時歸零。crossCheckLive 的退役規則照舊套用，
           * 因為 A 類標本仍然可能在同一份 document 裡切 mode。
           */
          onLCP(
            (metric) => {
              const mine = lcpCollector.current()?.value ?? null;
              patchCrossCheck({
                lcp: metric.value,
                // 容差 50ms，**而且兩邊要選到同一個 elementDescriptor**。
                // 只比數字會漏掉最危險的那種錯：兩邊各自選了不同元素，
                // 而它們碰巧在同一個時間附近繪製完成（spec §5.6 第 8 條）。
                deltaLcp: mine === null ? null : mine - metric.value,
              });
              logCrossCheck('lcp', mine, metric.value, lcpCollector.current()?.elementDescriptor);
            },
            { reportAllChanges: true },
          );

          onCLS(
            (metric) => {
              const mine = clsCollector.current()?.value ?? null;
              patchCrossCheck({
                cls: metric.value,
                // 容差 0.02 或相對 10%，且要落在同一個門檻區間（0.1 / 0.25）。
                // 這一條是 session window 演算法有沒有抄對的唯一證據 ——
                // 把「所有 window 的最大值」寫成「總和」時，數字會系統性偏高，
                // 而在只有一個 window 的頁面上兩者相等、完全看不出來（spec §4.5）。
                deltaCls: mine === null ? null : mine - metric.value,
              });
              logCrossCheck('cls', mine, metric.value);
            },
            { reportAllChanges: true },
          );
        })
        .catch((cause: unknown) => fail('runtime', cause));
    }
  }

  void boot();
}
