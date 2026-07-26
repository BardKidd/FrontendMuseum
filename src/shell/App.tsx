/**
 * 外殼 —— 標本選單、mode 切換、操作程序節拍器、CPU throttle 宣告、run 歷史。
 *
 * 外殼本身不是量測對象，所以用 React 沒問題。**但有一條硬架構約束**（spec §3.3 / §4.8 / 陷阱 #12）：
 *
 *   iframe 不保護 INP 的 presentation 段。paint 是 renderer 層級的，
 *   外殼面板的 style/layout 成本會落在互動的同一幀，直接被算進標本的 presentation。
 *   標本 #2 的兇手正好就是那一段，所以這裡沒有安全邊際。
 *
 * 對應作法：**訊息處理器一行 setState 都不准寫**，只准寫進 ref；
 * 狀態提交一律走 250ms 的節流閘門（scheduleCommit）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MEASURE_CONFIG, PROTOCOL_VERSION, buildSpecimenUrl } from '../protocol';
import type {
  CpuThrottle,
  HostMessage,
  InteractionSample,
  LoafSample,
  RunConditions,
  RunResult,
  SpecimenId,
  SpecimenMessage,
  SpecimenMeta,
  SpecimenMetrics,
  SpecimenModeDef,
  SpecimenReady,
} from '../protocol';
import { SPECIMENS, getSpecimen } from '../specimens';
// ⚠️ RunStats 與 refreshHz 各自只准有一份實作。
// 同一個專案裡兩份 median 定義遲早會對不起來，而那種不一致沒有任何徵兆：
// tsc 不會抱怨（兩邊都吐出合法的 RunStats），面板不會抱怨（數字都在合理範圍），
// 你只會在某天發現同一組樣本算出兩個 median。RunStats.median 是可重現性的判定依據，
// 所以「哪一條公式跑了」是會影響結論的事。
import { computeRunStats } from '../measure/metrics';
import { buildDeviceProfile, measureRefreshHz } from '../measure/device';
import { Panel } from './Panel';
import { startLoafObserver } from './loaf';

/**
 * LoAF 是否可用。判斷式跟 loaf.ts 裡的一樣 —— 那邊決定要不要註冊 observer，
 * 這邊決定面板要不要顯示警告。宣告 Chromium-only，所以到此為止，不寫 fallback（spec §5.3）。
 */
const LOAF_SUPPORTED = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');

/** LoAF 一輪可能上百幀；十次互動的 protocol 用不到那麼多，留最近 60 幀就夠算最嚴重的那一幀 */
const LOAF_BUFFER_MAX = 60;
const NOTE_MAX = 20;

const THROTTLE_OPTIONS: CpuThrottle[] = ['1x', '4x', '6x', 'unknown'];

/** requires 的人話版本。UI 必須標，否則使用者會以為某個 mode 壞掉，其實是瀏覽器沒有那個 API */
const REQUIRES_NOTE: Record<NonNullable<SpecimenModeDef['requires']>[number], string> = {
  'scheduler.yield': '需要 scheduler.yield（Safari 沒有）',
  'web-worker': '需要 Web Worker',
  'content-visibility': '需要 content-visibility',
};

/** modes[0] 依協定必須是病變版本 —— 先讓人痛，再給解藥（spec §2） */
function firstMode(meta: SpecimenMeta): string {
  return [...meta.modes].sort((a, b) => a.order - b.order)[0].id;
}

let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `run-${runCounter}`;
}

function nowEpoch(): number {
  return performance.timeOrigin + performance.now();
}

const INITIAL_META = SPECIMENS[0];
const INITIAL_MODE = firstMode(INITIAL_META);

/** 面板真正吃到的東西。所有欄位都只透過 250ms 的節流閘門更新 */
interface PanelBuffer {
  ready: SpecimenReady | null;
  metrics: SpecimenMetrics | null;
  loaf: LoafSample[];
  notes: string[];
}

function emptyBuffer(notes: string[] = []): PanelBuffer {
  return { ready: null, metrics: null, loaf: [], notes };
}

/**
 * 節拍器 —— 十次連打與十次每秒一下是不同的實驗（spec §2 / §5.1 第 4 項）。
 *
 * 刻意獨立成一個元件、自己持有 tick 狀態：這樣每次翻拍只重繪這一小塊，
 * 不會把整個面板拖進同一幀重繪。翻拍的時間點正好是操作者要點下去的時間點，
 * 這裡多一次 App 級的 re-render 就是直接往 presentation 段裡加料。
 */
function Metronome({ intervalMs, repetitions }: { intervalMs: number; repetitions: number }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setTick(n);
      if (n >= repetitions) window.clearInterval(id);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, repetitions]);

  if (tick >= repetitions) return <span>節拍結束（{repetitions} 拍）—— 按「重跑」開下一輪</span>;
  return (
    <span>
      節拍 {tick % 2 === 0 ? '○' : '●'} 第 {tick} / {repetitions} 拍（每次記號翻面時點一下）
    </span>
  );
}

export function App() {
  const [sessionId] = useState(() => `sid-${Date.now().toString(36)}`);
  const [specimenId, setSpecimenId] = useState<SpecimenId>(INITIAL_META.id);
  const [mode, setMode] = useState<string>(INITIAL_MODE);
  const [runId, setRunId] = useState<string>(() => nextRunId());
  const [cpuThrottle, setCpuThrottle] = useState<CpuThrottle>('unknown');
  const [refreshHz, setRefreshHz] = useState(0);
  const [history, setHistory] = useState<RunResult[]>([]);
  /**
   * web-vitals 交叉驗證。**預設關閉**：web-vitals 自己會註冊一整組 PerformanceObserver，
   * 常態開著等於讓「用來驗 baseline 的工具」變成污染 baseline 的來源（陷阱 #7）。
   *
   * 這個開關是 Phase 2 補的。在此之前 `?validate=1` 的機制早就實作好了
   *（`runtime.ts` 的 validate 分支、`buildSpecimenUrl` 的 validate 參數），
   * 但**外殼從來沒有任何地方會把它加進 URL** —— 也就是說那整段程式碼在 UI 上不可達，
   * 驗收第 8 條只能靠手改網址。功能寫了卻按不到，跟沒寫的差別只在它會通過 typecheck。
   */
  const [validate, setValidate] = useState(false);
  const [view, setView] = useState<PanelBuffer>(() => emptyBuffer());
  /**
   * iframe 的 src 是**狀態，不是衍生值**。
   * 寫成 buildSpecimenUrl(meta, { mode, ... }) 直接放進 JSX 的話，A 類即時切換會改到 URL，
   * iframe 就被 React 重載了 —— 那正好是 A 類最不該發生的事（spec §3.4）。
   */
  const [iframeSrc, setIframeSrc] = useState(() =>
    buildSpecimenUrl(INITIAL_META, {
      mode: INITIAL_MODE,
      t: String(Date.now()),
      sid: sessionId,
    }),
  );

  const meta = getSpecimen(specimenId) ?? INITIAL_META;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /**
   * 每次要換 iframe 網址都走這裡。三個呼叫點（換標本、B 類換 mode、切 validate）
   * 各自組一次 URL 的話，遲早有一個忘了帶 validate 或忘了帶 cache buster，
   * 而症狀是「這個組合下交叉驗證莫名其妙沒開」。
   */
  function specimenUrl(target: SpecimenMeta, modeId: string, wantValidate: boolean): string {
    return buildSpecimenUrl(target, {
      mode: modeId,
      t: String(Date.now()),
      sid: sessionId,
      // 一定要傳 undefined 而不是 '0' 或 ''：iframe 端是 `=== '1'` 判斷，
      // 但 URLSearchParams 對每個值做 ToString，帶了就會多出一個沒意義的參數。
      validate: wantValidate ? '1' : undefined,
    });
  }

  // ── 訊息處理器只讀 ref，不讀 state：它註冊一次就不再重建，讀 state 會讀到舊值 ──
  const specimenIdRef = useRef<SpecimenId>(INITIAL_META.id);
  const modeRef = useRef<string>(INITIAL_MODE);
  const runIdRef = useRef<string>(runId);
  const runStartedAtRef = useRef<number>(nowEpoch());
  /** 本輪累計的有效互動，依 interactionId 去重取 max —— 分組是全清單最重要的一項（陷阱 #1） */
  const runSamplesRef = useRef<Map<number, InteractionSample>>(new Map());
  const lastSeqRef = useRef<number | null>(null);
  /** 已送出 host:reset、還沒收到標本端 seq 歸零後的第一批。這期間的 metrics 全是上一輪的 */
  const awaitingResetRef = useRef(false);
  const bufRef = useRef<PanelBuffer>(emptyBuffer());
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  // ── 250ms 節流閘門（架構約束，不是最佳化）──────────────────────────
  const commit = useCallback(() => {
    dirtyRef.current = false;
    const b = bufRef.current;
    setView({ ready: b.ready, metrics: b.metrics, loaf: [...b.loaf], notes: [...b.notes] });
  }, []);

  const scheduleCommit = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (dirtyRef.current) commit();
    }, MEASURE_CONFIG.flushIntervalMs);
  }, [commit]);

  const note = useCallback((text: string) => {
    const notes = bufRef.current.notes;
    notes.push(`[${runIdRef.current}] ${text}`);
    if (notes.length > NOTE_MAX) notes.splice(0, notes.length - NOTE_MAX);
  }, []);

  const post = useCallback(
    (msg: HostMessage) => {
      // targetOrigin 寫死同源。iframe 端也只收同源訊息，兩邊都關（驗收第 13 條的精神）
      iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
    },
    [],
  );

  // ── refreshHz 實測。120Hz 螢幕上「16.7ms 算掉幀」是錯的（spec §5.1 第 12 項）──
  // 實作在 measure/device.ts，這裡不重寫一份：那邊會把結果**吸附**到常見面板更新率。
  // 不吸附的話同一塊 60Hz 螢幕會依當下雜訊寫進 58 / 59 / 60，而 refreshHz 是
  // RunConditions 的一部分 —— 三筆條件不同的 run 在本站的規則下就不能互相比較，
  // 明明它們是同一塊螢幕。
  useEffect(() => {
    void measureRefreshHz().then(setRefreshHz);
  }, []);

  // ── LoAF 觀測（外殼側，不走 postMessage）──────────────────────────
  useEffect(() => {
    const stop = startLoafObserver({
      // 每次重載 / 換標本 contentWindow 都是新物件，所以用 callback 而不是抓一次
      getSpecimenWindow: () => iframeRef.current?.contentWindow ?? null,
      onSample: (s) => {
        // observer callback 是非同步派送的：主執行緒忙的時候，前一輪的 entry 會在
        // 重跑之後才送到。不擋掉的話，新一輪的「最嚴重的一幀」會是上一輪那個 300ms
        // 忙迴圈 —— 跟 metrics 批次擋舊 mode 是同一個理由，兩輪的樣本不准混。
        if (s.start < runStartedAtRef.current) return;
        const buf = bufRef.current.loaf;
        buf.push(s);
        if (buf.length > LOAF_BUFFER_MAX) buf.splice(0, buf.length - LOAF_BUFFER_MAX);
        scheduleCommit();
      },
    });
    return stop;
  }, [scheduleCommit]);

  // ── postMessage 收信 ───────────────────────────────────────────
  useEffect(() => {
    function onMessage(ev: MessageEvent): void {
      // 三層驗證：同源、協定版本、sessionId。任何一層不過就整包丟掉，不留痕跡。
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data as SpecimenMessage | null;
      if (!msg || typeof msg !== 'object' || msg.v !== PROTOCOL_VERSION) return;
      if (msg.sessionId !== sessionId) return;

      switch (msg.type) {
        case 'specimen:ready': {
          if (msg.specimenId !== specimenIdRef.current) {
            note(`⚠ ready 的 specimenId 是 ${msg.specimenId}，外殼以為是 ${specimenIdRef.current}`);
          }
          bufRef.current.ready = msg;
          post({
            type: 'host:init',
            v: PROTOCOL_VERSION,
            sessionId,
            specimenId: msg.specimenId,
            mode: modeRef.current,
            measure: MEASURE_CONFIG,
          });
          scheduleCommit();
          break;
        }

        case 'specimen:mode-changed': {
          note(`mode → ${msg.mode}，warmup 到 ${Math.round(msg.warmupUntil - msg.at)}ms 後`);
          scheduleCommit();
          break;
        }

        case 'specimen:metrics': {
          // 切 mode 的瞬間可能還有一批舊 mode 的 metrics 在路上。混進來 = 兩個 mode 的樣本
          // 掛在同一輪底下，而 n<50 時 INP 就是 max，一筆就足以變成你報告的那個數字。
          if (msg.mode !== modeRef.current) break;

          // 重跑後的閘門：標本端 reset 會把 seq 歸零，所以新一輪的第一批一定是 seq === 1。
          // 在那之前收到的都還是上一輪的樣本（mode 沒變，上面那道 mode 檢查擋不掉）。
          if (awaitingResetRef.current) {
            if (msg.seq !== 1) break;
            awaitingResetRef.current = false;
          }

          if (lastSeqRef.current !== null && msg.seq !== lastSeqRef.current + 1) {
            note(`⚠ seq 跳號：預期 ${lastSeqRef.current + 1}，收到 ${msg.seq}（有一批 metrics 掉了）`);
          }
          lastSeqRef.current = msg.seq;

          for (const s of msg.interactions) {
            if (s.warmup) continue; // 暖機樣本一律不入帳（陷阱 #1 的第二個坑）
            const prev = runSamplesRef.current.get(s.interactionId);
            if (!prev || s.duration > prev.duration) runSamplesRef.current.set(s.interactionId, s);
          }

          bufRef.current.metrics = msg;
          scheduleCommit();
          break;
        }

        case 'specimen:error': {
          note(`‼ 標本錯誤（${msg.stage}）：${msg.message}`);
          scheduleCommit();
          break;
        }
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sessionId, note, post, scheduleCommit]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  // ── 凍結條件快照。可重現的宣稱只在同一組 conditions 之間成立 ──────────
  const conditions: RunConditions = useMemo(() => {
    return {
      device: buildDeviceProfile(cpuThrottle, refreshHz),
      viewport: meta.viewport,
      protocol: meta.protocol,
      buildId: __BUILD_ID__, // 換一版 build 就不是同一組條件，數字不可跨版比較
      protocolVersion: PROTOCOL_VERSION,
      measure: MEASURE_CONFIG,
    };
  }, [cpuThrottle, refreshHz, meta]);

  // ── run 生命週期 ──────────────────────────────────────────────
  /** 把剛跑完的那一輪存進歷史。**永遠不丟棄前一輪** —— 那是可重現性的唯一證據 */
  function finalizeRun(): void {
    const samples = [...runSamplesRef.current.values()].sort((a, b) => a.startTime - b.startTime);
    const last = bufRef.current.metrics;

    /*
     * 「這一輪值不值得入帳」的判準取自標本的主指標，不是「有沒有互動樣本」。
     *
     * 舊寫法是 `samples.length === 0 → return`，那對 INP 系的標本是對的
     * （換標本／切 mode 都會經過這裡，不擋的話歷史會塞滿空白輪）。
     * 但標本 #4／#6 的主指標是 droppedFrames，它們一輪下來本來就零筆互動 ——
     * 舊寫法會把它們每一輪都丟掉，而面板上只會顯示「還沒有完成的 run」。
     */
    const inpBased = meta.primaryMetric.startsWith('inp');
    if (inpBased ? samples.length === 0 : last === null) return;

    const finished: RunResult = {
      runId: runIdRef.current,
      specimenId: specimenIdRef.current,
      mode: modeRef.current,
      startedAt: runStartedAtRef.current,
      conditions,
      samples,
      stats: computeRunStats(samples.map((s) => s.duration)),
      // 終值快照取「本輪最後一批 metrics」。它們是累計值不是增量，所以最後一批就是全貌。
      customFinal: last ? { ...last.custom } : undefined,
      lcpFinal: last?.lcp ?? null,
      clsFinal: last?.cls ?? null,
    };
    setHistory((h) => [...h, finished]);
  }

  function startNewRun(): string {
    const id = nextRunId();
    runIdRef.current = id;
    runStartedAtRef.current = nowEpoch();
    runSamplesRef.current = new Map();
    lastSeqRef.current = null;
    // 換標本 / 切 mode 走的也是這條路，但它們不會送 host:reset，
    // 閘門要先關掉，否則會一直等一個永遠不來的 seq === 1。rerun() 隨後才把它打開。
    awaitingResetRef.current = false;
    bufRef.current = emptyBuffer(bufRef.current.notes);
    setRunId(id);
    commit();
    return id;
  }

  function rerun(): void {
    finalizeRun();
    const id = startNewRun();
    // 送出 host:reset 到 iframe 真的處理完之間，250ms 的 flush 可能已經先發了一批
    // **上一輪**的 metrics。切 mode 那條路徑有 `msg.mode !== modeRef.current` 擋著，
    // 重跑沒有 —— mode 沒變，那批舊樣本會直接被算進新一輪。
    // 標本端 reset 後 seq 從 1 重新開始，所以「等到 seq === 1 才收」就是乾淨的閘門。
    awaitingResetRef.current = true;
    post({ type: 'host:reset', v: PROTOCOL_VERSION, sessionId, runId: id });
  }

  function switchMode(next: string): void {
    if (next === modeRef.current) return;
    finalizeRun();
    modeRef.current = next;
    setMode(next);
    startNewRun();

    if (meta.switchKind === 'live') {
      // A 類：換掉 handler 實作就好，**不要 reload**。reload 會連 warmup 語意一起洗掉
      post({ type: 'host:set-mode', v: PROTOCOL_VERSION, sessionId, mode: next });
    } else {
      // B 類：LCP 載入後定案、CLS 累積整個 page lifetime，只能整份重載。
      // Phase 0 沒有 B 類標本，但 URL 契約已經凍結，這條分支必須先存在（spec §3.4）。
      setIframeSrc(specimenUrl(meta, next, validate));
    }
  }

  /** 切交叉驗證一定要重載：web-vitals 是在 iframe 開機時決定要不要動態 import 的 */
  function toggleValidate(next: boolean): void {
    finalizeRun();
    setValidate(next);
    startNewRun();
    // 用參數 next 而不是 state validate —— setState 是非同步的，這一行讀到的還是舊值
    setIframeSrc(specimenUrl(meta, modeRef.current, next));
  }

  function switchSpecimen(id: SpecimenId): void {
    const next = getSpecimen(id);
    if (!next || id === specimenIdRef.current) return;
    finalizeRun();
    const m = firstMode(next);
    specimenIdRef.current = id;
    modeRef.current = m;
    setSpecimenId(id);
    setMode(m);
    startNewRun();
    setIframeSrc(specimenUrl(next, m, validate));
  }

  const modes = [...meta.modes].sort((a, b) => a.order - b.order);
  const done = view.metrics?.totalInteractions ?? 0;

  return (
    <main>
      {import.meta.env.DEV && (
        // 唯一允許的 inline style 之一。dev server 不 minify、不打包、有 HMR 開銷 ——
        // 這裡量到的東西不是效能數字，是 Vite 的效能數字（陷阱 #3）。
        <p style={{ color: 'red' }}>
          ⛔ 開發模式：這個頁面量到的數字全部無效。dev server 不 minify、不打包、還有 HMR 開銷，
          而且函式名沒有經過 build 的 keepNames 路徑。量測前必須跑 <code>npm run measure</code>
          （build + preview）。
        </p>
      )}

      <h1>前端效能病理標本館 · Phase 0</h1>

      <h2>標本</h2>
      <p>
        {SPECIMENS.map((s) => (
          <button key={s.id} onClick={() => switchSpecimen(s.id)} disabled={s.id === specimenId}>
            {s.id} {s.title}
          </button>
        ))}
      </p>

      <h2>
        {meta.title} <small>{meta.subtitle}</small>
      </h2>

      <h3>切換（{meta.switchKind === 'live' ? '即時切換，不重載' : '重載整個 iframe'}）</h3>
      <ul>
        {modes.map((m) => (
          <li key={m.id}>
            <button onClick={() => switchMode(m.id)} disabled={m.id === mode}>
              {m.label}
            </button>{' '}
            {m.kind === 'pathological' ? '病變' : '治療'}
            {m.requires?.map((r) => ` · ${REQUIRES_NOTE[r]}`).join('')}
          </li>
        ))}
      </ul>

      <h3>操作程序（凍結變因，spec §5.1 第 4 項）</h3>
      <p>{meta.protocol.instruction}</p>
      <p>
        動作 {meta.protocol.action} · 次數 {meta.protocol.repetitions} · 間隔{' '}
        {meta.protocol.intervalMs === null
          ? '盡快連續（不要等畫面回應）'
          : `${meta.protocol.intervalMs}ms`}
      </p>
      <p>
        {/* 機器節拍的標本不渲染節拍器：它的 setInterval + 每拍一次 setState
            會落在待量的那一段裡，而標本 #1 的兇手段正是 presentation。
            人也照不了 17ms 的拍子 —— 照著做出來的是另一個實驗。 */}
        {meta.protocol.intervalMs !== null && !meta.protocol.machinePaced && (
          <Metronome
            key={runId}
            intervalMs={meta.protocol.intervalMs}
            repetitions={meta.protocol.repetitions}
          />
        )}{' '}
        已記錄 {done} / {meta.protocol.repetitions} 次
      </p>

      <h3>凍結條件</h3>
      <p>
        <label>
          CPU throttle（JS 偵測不到 DevTools 的設定，只能自己宣告）{' '}
          <select value={cpuThrottle} onChange={(e) => setCpuThrottle(e.target.value as CpuThrottle)}>
            {THROTTLE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>{' '}
        <button onClick={rerun}>重跑（把這一輪存進歷史，開新的一輪）</button>
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={validate}
            onChange={(e) => toggleValidate(e.target.checked)}
          />{' '}
          web-vitals 交叉驗證（會重載 iframe）
        </label>{' '}
        —— 預設關閉：web-vitals 自己那組 observer 會污染 baseline，只在對帳時開（陷阱 #7）。
        對帳結果同時進面板的 crossCheck 欄與 iframe 的 console.table。
      </p>

      {/*
        width / height 用 HTML 屬性寫死 800×600，取自 meta.viewport。
        絕對不要用百分比或 vh：CLS = impact fraction × distance fraction，兩者都是 viewport
        相對量，LCP element 的選擇也依賴 viewport —— 改尺寸等於讓所有歷史數字作廢（spec §4.6）。
      */}
      <iframe
        key={meta.id}
        ref={iframeRef}
        src={iframeSrc}
        width={meta.viewport.width}
        height={meta.viewport.height}
        title={`${meta.id} 實驗區`}
      />

      <Panel
        meta={meta}
        mode={mode}
        runId={runId}
        conditions={conditions}
        ready={view.ready}
        metrics={view.metrics}
        loaf={view.loaf}
        loafSupported={LOAF_SUPPORTED}
        history={history}
        notes={view.notes}
      />
    </main>
  );
}
