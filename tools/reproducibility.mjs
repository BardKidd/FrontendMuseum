/**
 * 三輪可重現量測（spec §1 原則 4 / spec:1246）—— 走 CDP 派送真實輸入。
 *
 * ⚠️ 這是**機器驅動**的量測，不是人手。兩件事必須寫進報告：
 *
 *   1. `Input.dispatchMouseEvent` 的輸入延遲特性跟真滑鼠不同。對 processing／forced
 *      layout／droppedFrames 系的標本無所謂，但**標本 #1 的主指標就是 inputDelay**，
 *      它的數字要標成「機器時序」，人手複驗仍待做。
 *   2. 換來的是節拍精度：protocol 宣告 intervalMs = 2500 時，這裡真的是 2500，
 *      人手做不到。對 intervalMs 非 null 的標本，機器比人更貼合已登記的凍結變因。
 *
 * 每個標本開一份乾淨的外殼頁面：history 會一直累積，而面板把整個 history 塞進
 * `<pre>` 的 JSON —— 跑滿六個標本的話那份 JSON 會大到讓外殼自己的 render 變成污染源。
 *
 * CPU throttle 有兩半，兩半都要做：
 *   - `Emulation.setCPUThrottlingRate` 才是真的節流
 *   - 外殼的 select 只是**宣告**（protocol.ts:55「無法從 JS 偵測」），
 *     它負責把 '4x' 寫進 RunConditions。只做前者的話數字是 4x 但條件記成 unknown。
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = '/opt/brave.com/brave/brave';
const PORT = 9335;
const URL_SHELL = 'http://localhost:4173/';
const PROFILE = '/tmp/perf-museum-repro-profile';
const THROTTLE_RATE = 4;
const THROTTLE_LABEL = '4x';
const RUNS = 3;
const OUT = 'docs/measurements/2026-07-25-reproducibility-4x.json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ── CDP 連線樣板（與 tools/acceptance.mjs 同形）────────────────────────
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--disable-gpu',
  '--window-size=1400,1600', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d.toString(); });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome never came up\n' + stderr);
}

const ws = new WebSocket(await browserWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (!p) return;
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    consoleErrors.push(m.params.entry.text);
  }
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
await S('Emulation.setDeviceMetricsOverride', {
  width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false,
});

async function evaluate(expression) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 120));
  return r.result.value;
}

async function realClick(pt) {
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
}

/**
 * 不等回應的點擊，只在 intervalMs === null（盡快連續）時用。
 *
 * `Input.dispatchMouseEvent` 會等 renderer 回覆才 resolve —— 而主執行緒正被標本的
 * 同步排序擋住，回覆要等它做完才送得出來。於是 `await realClick()` 的迴圈變成
 * 「做完一次才點下一次」，事件永遠排不了隊，**input delay 結構上不可能出現**。
 * 第一次跑出來的 delay 是 0.7~2.6ms，不是標本沒病，是驅動器根本沒有連打。
 *
 * 這裡把整串事件一次灌進 WebSocket 不等回應。同一條連線上的訊息瀏覽器依序處理，
 * 所以順序有保證；回應統一在最後收。這才是 protocol 宣告的「不要等畫面回應」。
 */
function realClickNoWait(pt) {
  return [
    S('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 }),
    S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 }),
  ];
}

/** 一格滾輪。protocol 明寫「用滾輪，不要拖捲軸」—— 拖捲軸走的是另一條事件路徑 */
async function realWheel(pt, deltaY = 120) {
  await S('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY,
    pointerType: 'mouse',
  });
}

/**
 * iframe 內元素的 viewport 座標。
 *
 * 不做 `contentWindow.scrollTo(0,0)`（acceptance.mjs 的版本有做）——
 * 標本 #2／#4 的 protocol 動作就是捲動，把 iframe 捲回原點等於把剛做的操作洗掉。
 * 改成捲**外殼**讓 iframe 進可視區，iframe 自己的捲動位置不碰。
 */
const ptIn = (sel) => evaluate(`(() => {
  const f = document.querySelector('iframe');
  if (!f || !f.contentDocument) return null;
  f.scrollIntoView({ block: 'start' });
  const el = f.contentDocument.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const fr = f.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  return { x: fr.left + b.left + b.width / 2, y: fr.top + b.top + b.height / 2 };
})()`);

/** 外殼按鈕。只比對按鈕自己的 textContent —— 所有標本按鈕同在一個 <p> 底下，
 *  比對 parentElement.textContent 會每次都命中第一顆。 */
const ptShell = (text) => evaluate(`(() => {
  const el = [...document.querySelectorAll('button')]
    .find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
})()`);

const snap = () => evaluate(`(() => {
  const pres = [...document.querySelectorAll('pre')];
  try { return JSON.parse(pres[pres.length - 1].textContent); } catch { return null; }
})()`);

async function clickShell(text, what) {
  const pt = await ptShell(text);
  if (!pt) throw new Error(`外殼按鈕找不到或已 disabled：「${text}」（${what}）`);
  await realClick(pt);
}

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await fn()) return true; } catch {}
    await sleep(250);
  }
  log(`      ⚠ 等待逾時（${(timeoutMs / 1000).toFixed(0)}s）：${label}`);
  return false;
}

// ── 標本表 ────────────────────────────────────────────────────────────
// trigger：protocol 動作要打在哪個元素上
// readyMark：iframe 掛載完成的判定元素
const SPECS = [
  {
    id: '00-calibration', button: '00-calibration',
    readyMark: '#cal-busy-btn', cls: 'A',
    modes: [
      { id: 'busy-300', label: '忙迴圈 300ms' },
      { id: 'busy-30', label: '忙迴圈 30ms' },
    ],
    action: 'click', trigger: '#cal-busy-btn', reps: 10, intervalMs: 1000,
    inpBased: true, midGapSnapshot: true,
  },
  {
    id: '01-main-thread-block', button: '01-main-thread-block',
    readyMark: '#mtb-sort-btn', cls: 'A',
    modes: [
      { id: 'broken', label: '病變：同步排序' },
      { id: 'fixed-yield', label: '治療一' },
      { id: 'fixed-worker', label: '治療二' },
    ],
    // intervalMs = null：盡快連續。**不做 mid-gap 取樣** —— 這個標本量的就是 inputDelay，
    // protocol 進行中多打一次 CDP evaluate 等於往待量的那段裡加料。
    action: 'click', trigger: '#mtb-sort-btn', reps: 10, intervalMs: null,
    inpBased: true, midGapSnapshot: false,
  },
  {
    id: '02-long-list', button: '02-long-list',
    readyMark: '#ll-list', cls: 'B',
    modes: [
      { id: 'broken', label: '病變：全部渲染' },
      { id: 'fixed-content-visibility', label: '治療一' },
      { id: 'fixed-virtual', label: '治療二：虛擬滾動' },
    ],
    // protocol：先靜置等 LCP 定案，再捲十格。捲動算互動，會讓 LCP 提前定案。
    // quietMs 是**固定**的靜置，不是輪詢等待：iframe 同源 = 同一個 renderer 主執行緒，
    // 每 250ms 讀一次面板的 <pre> 會把外殼的工作插進標本正在量的載入期。
    action: 'scroll', trigger: '#ll-list', reps: 10, intervalMs: 500,
    inpBased: false, midGapSnapshot: false, quietMs: 12000,
  },
  {
    id: '03-layout-thrashing', button: '03-layout-thrashing',
    readyMark: '#lt-run-btn', cls: 'A',
    modes: [
      { id: 'broken', label: '病變：交替讀寫' },
      { id: 'fixed-batched', label: '治療：讀寫分離' },
    ],
    action: 'click', trigger: '#lt-run-btn', reps: 10, intervalMs: 2500,
    inpBased: true, midGapSnapshot: true,
  },
  {
    id: '04-unthrottled-events', button: '04-unthrottled-events',
    readyMark: '#thr-scroller', cls: 'A',
    modes: [
      { id: 'broken', label: '病變：每次事件全掃' },
      { id: 'fixed-passive', label: '治療一' },
      { id: 'fixed-raf', label: '治療二' },
      { id: 'fixed-observer', label: '治療三' },
    ],
    action: 'scroll', trigger: '#thr-scroller', reps: 10, intervalMs: 500,
    inpBased: false, midGapSnapshot: false,
  },
  {
    id: '05-layout-shift', button: '05-layout-shift',
    readyMark: '#ls-status', cls: 'B',
    modes: [
      { id: 'broken', label: '病變：三個位移源' },
      { id: 'fixed', label: '治療：全部預留空間' },
    ],
    // 位移源排在 300 / 900 / 1500ms。protocol 說靜置三秒不要碰 ——
    // 互動後 500ms 內的位移會被 hadRecentInput 豁免，碰一下就把要量的東西豁免掉了。
    // 「不要碰」包含不要輪詢：整段靜置期一次 CDP 呼叫都不發。
    action: 'idle', reps: 1, intervalMs: null, idleMs: 0,
    inpBased: false, midGapSnapshot: false, quietMs: 6000,
  },
  {
    id: '06-rerender-storm', button: '06-rerender-storm',
    readyMark: '#rs-start', cls: 'A',
    modes: [
      { id: 'broken', label: '病變：每批重建整表' },
      { id: 'fixed-batch', label: '治療一' },
      { id: 'fixed-granular', label: '治療二' },
      { id: 'fixed-backpressure', label: '治療三' },
    ],
    // 按一次開始，串流 5000ms 後自停（STREAM_DURATION_MS，刻意等於掉幀滾動窗長度）
    action: 'stream', trigger: '#rs-start', reps: 1, intervalMs: null, streamMs: 6500,
    inpBased: false, midGapSnapshot: false,
  },
];

// ── 取樣 ──────────────────────────────────────────────────────────────
/** 一幀 LoAF 裡標本自己造成的強制版面重排；同時撈出兇手函式名 */
function loafForced(s) {
  const frames = [...(s?.loafRecent || []), s?.loafWorst].filter(Boolean);
  let best = null;
  for (const f of frames) {
    if (best === null || f.specimenForcedStyleAndLayoutDuration > best.specimenForcedStyleAndLayoutDuration) best = f;
  }
  if (!best) return { forced: null, fn: null, specimenScript: null };
  const script = (best.topScripts || []).find((x) => x.forcedStyleAndLayoutDuration > 0)
    || (best.topScripts || [])[0];
  return {
    forced: best.specimenForcedStyleAndLayoutDuration,
    fn: script ? script.sourceFunctionName : null,
    specimenScript: best.specimenScriptDuration,
  };
}

function capture(s, forcedSamples) {
  const m = s?.metrics || null;
  const inp = m?.inp || null;
  const rep = inp?.representative || null;
  const lf = loafForced(s);
  const fs = forcedSamples || [];
  return {
    totalInteractions: m?.totalInteractions ?? 0,
    inp: inp?.value ?? null,
    isMaxNotP98: inp?.isMaxNotP98 ?? null,
    inputDelay: rep?.inputDelay ?? null,
    processing: rep?.processing ?? null,
    presentation: rep?.presentation ?? null,
    duration: rep?.duration ?? null,
    presentationClamped: rep?.presentationClamped ?? null,
    /** 逐次樣本。跨輪比較用 median，peak 只拿來看離群 */
    forcedSamples: fs,
    forcedMedian: median(fs),
    forcedPeak: fs.length ? Math.max(...fs) : (lf.forced ?? null),
    forcedFn: lf.fn,
    specimenScript: lf.specimenScript,
    lcp: m?.lcp ? { value: m.lcp.value, el: m.lcp.elementDescriptor } : null,
    cls: m?.cls ? { value: m.cls.value, sessionCount: m.cls.sessionCount } : null,
    custom: m?.custom ? { ...m.custom } : {},
    mode: s?.mode ?? null,
    runId: s?.runId ?? null,
    cpuThrottle: s?.conditions?.device?.cpuThrottle ?? null,
    refreshHz: s?.conditions?.device?.refreshHz ?? null,
    buildId: s?.conditions?.buildId ?? null,
  };
}

// ── 執行一輪 protocol ─────────────────────────────────────────────────
async function runProtocol(spec) {
  /**
   * 逐次取樣，不是只留峰值。
   *
   * 可重現性的判定依據是 median 不是 max（`protocol.ts:290`「抗離群。可重現性判定
   * 用這個，不用 max」）。只記峰值的話，跨輪比的是三個離群值，離散度必然虛高 ——
   * 那是儀器的問題，不是標本不可重現。
   */
  const forcedSamples = [];
  const seenFrames = new Set();

  if (spec.action === 'idle') {
    await sleep(spec.idleMs);
    return forcedSamples;
  }

  if (spec.action === 'stream') {
    const pt = await ptIn(spec.trigger);
    if (!pt) throw new Error(`找不到觸發元素 ${spec.trigger}`);
    await realClick(pt);
    await sleep(spec.streamMs);
    return forcedSamples;
  }

  const pt = await ptIn(spec.trigger);
  if (!pt) throw new Error(`找不到觸發元素 ${spec.trigger}`);

  // 盡快連續：整串事件一次灌完不等回應，讓它們在主執行緒被擋住時真的排隊
  if (spec.intervalMs === null && spec.action === 'click') {
    const inflight = [];
    for (let i = 0; i < spec.reps; i++) inflight.push(...realClickNoWait(pt));
    await Promise.all(inflight);
    return forcedSamples;
  }

  for (let i = 0; i < spec.reps; i++) {
    if (spec.action === 'click') await realClick(pt);
    else await realWheel(pt);

    if (spec.intervalMs === null) continue; // 盡快連續，中間不插任何東西

    if (spec.midGapSnapshot) {
      // 取樣點放在間隔中段：強制版面的工作在點擊後 ~200ms 內結束，
      // 這時主執行緒已閒置，讀 <pre> 的 textContent 不會落進待量的那一幀
      await sleep(spec.intervalMs * 0.5);
      const s = await snap();
      // 面板只留最近 6 幀，而且同一幀會連續出現在好幾次取樣裡。
      // 用 start 當識別碼去重，才不會把同一幀重複計進中位數
      let best = null;
      for (const f of [...(s?.loafRecent || []), s?.loafWorst].filter(Boolean)) {
        if (seenFrames.has(f.start)) continue;
        seenFrames.add(f.start);
        if (f.specimenForcedStyleAndLayoutDuration > 0
          && (best === null || f.specimenForcedStyleAndLayoutDuration > best)) {
          best = f.specimenForcedStyleAndLayoutDuration;
        }
      }
      if (best !== null) forcedSamples.push(best);
      await sleep(spec.intervalMs * 0.5);
    } else {
      await sleep(spec.intervalMs);
    }
  }
  return forcedSamples;
}

function median(xs) {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

// ── 主流程 ────────────────────────────────────────────────────────────
const records = [];
const problems = [];

async function bootShell() {
  await S('Emulation.setCPUThrottlingRate', { rate: 1 });
  await S('Page.navigate', { url: URL_SHELL });
  const ok = await waitFor(async () => {
    return await evaluate(`(() => { const f = document.querySelector('iframe');
      return !!(f && f.contentDocument && f.contentDocument.querySelector('#cal-busy-btn')); })()`);
  }, 40000, '外殼開機');
  if (!ok) throw new Error('外殼沒有掛載');
  await sleep(1500);
  // 宣告寫進 RunConditions（select 只是宣告，不會真的節流）
  await evaluate(`(() => {
    const sel = document.querySelector('select');
    sel.value = ${JSON.stringify(THROTTLE_LABEL)};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  // 真正的節流。放在外殼開機**之後**：外殼開機不是量測對象，
  // 讓 React bundle 在 4x 底下解析只是白等
  await S('Emulation.setCPUThrottlingRate', { rate: THROTTLE_RATE });
  await sleep(500);
}

async function measureSpecimen(spec) {
  log(`\n━━ ${spec.id} ━━ (${spec.cls} 類, ${spec.modes.length} 個 mode × ${RUNS} 輪)`);
  await bootShell();

  if (spec.id !== '00-calibration') {
    await clickShell(spec.button, '換標本');
    if (spec.cls === 'B') {
      // B 類不輪詢掛載：換標本載入的就是第一輪要量的那份 document，
      // 每 250ms 打一次 querySelector 等於把觀測放進載入期。交給迴圈裡的固定靜置
      await sleep(500);
    } else {
      const ok = await waitFor(async () => await evaluate(`(() => { const f = document.querySelector('iframe');
        return !!(f && f.contentDocument && f.contentDocument.querySelector(${JSON.stringify(spec.readyMark)})); })()`),
        40000, `${spec.id} 掛載`);
      if (!ok) { problems.push(`${spec.id} 沒掛載`); return; }
      await sleep(1500);
    }
  }

  if (spec.cls === 'A') {
    for (const m of spec.modes) {
      const first = m === spec.modes[0];
      if (!first) {
        await clickShell(m.label, `切 mode ${m.id}`);
        await sleep(1500); // 過 warmup（500ms）再留餘裕
      }
      for (let r = 1; r <= RUNS; r++) {
        const forcedSamples = await runProtocol(spec);
        if (spec.inpBased) {
          await waitFor(async () => {
            const s = await snap();
            return (s?.metrics?.totalInteractions ?? 0) >= spec.reps;
          }, 30000, `${spec.id}/${m.id} 第 ${r} 輪收斂到 ${spec.reps} 筆互動`);
        }
        await sleep(1500); // 讓最後一批 flush 進來
        const s = await snap();
        const c = capture(s, forcedSamples);
        if (c.mode !== m.id) problems.push(`${spec.id} 第 ${r} 輪 snapshot.mode=${c.mode} 但預期 ${m.id}`);

        // 「重跑」會把這一輪 finalize 進 history，RunStats 就是在那時候算出來的。
        // median / spread 只有這條路徑拿得到 —— 面板即時區的 INP 是 max，
        // 而可重現性判定明文不用 max
        const runIdBefore = c.runId;
        await clickShell('重跑', '開下一輪');
        await sleep(1200);
        const after = await snap();
        const finished = (after?.history || []).find((h) => h.runId === runIdBefore) || null;

        records.push({
          specimenId: spec.id, mode: m.id, run: r, ...c,
          stats: finished ? finished.stats : null,
        });
        log(`   ${m.id} #${r}  ${fmt(spec, c, finished)}`);
      }
    }
  } else {
    // B 類：一輪 = 一份新 document。同一個 mode 連按兩次不會重載
    //（switchMode 對 next === modeRef.current 直接 return，按鈕本身也 disabled），
    // 所以走「輪流切」：mode 之間交替，順帶把單調漂移也擋掉
    // 換標本時外殼已經把 modes[0] 載好了（firstMode），那顆按鈕因此是 disabled。
    // 第一輪第一個 mode 不必再按 —— 它本來就是一份剛載入的新 document，
    // 正是 B 類要的東西。之後 mode 交替，不會再撞到自己
    let current = spec.modes[0].id;
    for (let r = 1; r <= RUNS; r++) {
      for (const m of spec.modes) {
        const alreadyFresh = r === 1 && m.id === current && spec.modes[0].id === m.id;
        if (!alreadyFresh) {
          await clickShell(m.label, `切 mode ${m.id}（重載）`);
          current = m.id;
        }
        // 固定靜置，整段不發任何 CDP 呼叫。載入期指標（LCP／CLS）就是在這段裡定案的，
        // 輪詢等於把觀測動作放進被觀測的視窗
        await sleep(spec.quietMs);
        const mounted = await evaluate(`(() => { const f = document.querySelector('iframe');
          return !!(f && f.contentDocument && f.contentDocument.querySelector(${JSON.stringify(spec.readyMark)})); })()`);
        if (!mounted) { problems.push(`${spec.id}/${m.id} 第 ${r} 輪靜置 ${spec.quietMs}ms 後仍未掛載`); continue; }

        const forcedSamples = await runProtocol(spec);
        await sleep(1500);
        const s = await snap();
        const c = capture(s, forcedSamples);
        if (c.mode !== m.id) problems.push(`${spec.id} 第 ${r} 輪 snapshot.mode=${c.mode} 但預期 ${m.id}`);
        records.push({ specimenId: spec.id, mode: m.id, run: r, ...c, stats: null });
        log(`   ${m.id} #${r}  ${fmt(spec, c, null)}`);
      }
    }
  }
}

function fmt(spec, c, finished) {
  const bits = [];
  if (spec.inpBased) bits.push(`n=${c.totalInteractions}`);
  if (finished) bits.push(`med=${finished.stats.median.toFixed(0)} max=${finished.stats.max.toFixed(0)} spread=${(finished.stats.spread * 100).toFixed(0)}%`);
  if (c.inputDelay !== null) bits.push(`delay=${c.inputDelay.toFixed(1)}`);
  if (c.processing !== null) bits.push(`proc=${c.processing.toFixed(1)}`);
  if (c.forcedMedian !== null) bits.push(`forcedMed=${c.forcedMedian.toFixed(1)}(n=${c.forcedSamples.length},peak=${c.forcedPeak.toFixed(0)})`);
  if (c.lcp) bits.push(`LCP=${Math.round(c.lcp.value)}ms<${c.lcp.el}>`);
  if (c.cls) bits.push(`CLS=${c.cls.value.toFixed(4)}(w=${c.cls.sessionCount})`);
  if (c.custom.droppedFramesPeak !== undefined) bits.push(`dropPeak=${c.custom.droppedFramesPeak}`);
  return bits.join('  ');
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const targets = only.length ? SPECS.filter((s) => only.some((o) => s.id.includes(o))) : SPECS;

/**
 * 探針用的間隔覆寫。**這會讓數字脫離已登記的 protocol**，只用來蒐集
 * 「該不該改 protocol」的證據，不得當成正式量測結果。
 * 用法：PROBE_INTERVAL_MS=150 node tools/reproducibility.mjs 01-main
 */
const PROBE_INTERVAL = process.env.PROBE_INTERVAL_MS ? Number(process.env.PROBE_INTERVAL_MS) : null;
if (PROBE_INTERVAL !== null) {
  for (const t of targets) t.intervalMs = PROBE_INTERVAL;
  log(`⚠ 探針模式：intervalMs 覆寫成 ${PROBE_INTERVAL}ms —— 脫離已登記 protocol，非正式數字`);
}
log(`宣告 CPU throttle ${THROTTLE_LABEL}（Emulation.setCPUThrottlingRate rate=${THROTTLE_RATE}）`);
log(`目標：${targets.map((t) => t.id).join(', ')}`);

const startedAt = Date.now();
for (const spec of targets) {
  try {
    await measureSpecimen(spec);
  } catch (e) {
    problems.push(`${spec.id} 中斷：${e.message}`);
    log(`   ‼ ${spec.id} 中斷：${e.message}`);
  }
}

mkdirSync('docs/measurements', { recursive: true });
writeFileSync(OUT, JSON.stringify({
  measuredAt: new Date(startedAt).toISOString(),
  driver: 'CDP (Input.dispatchMouseEvent) —— 機器驅動，非人手',
  cpuThrottle: THROTTLE_LABEL,
  cpuThrottlingRate: THROTTLE_RATE,
  runsPerMode: RUNS,
  records,
  problems,
  consoleErrors: [...new Set(consoleErrors)],
}, null, 2));

log(`\n寫入 ${OUT}（${records.length} 筆）`);
log(`耗時 ${((Date.now() - startedAt) / 1000 / 60).toFixed(1)} 分鐘`);
if (problems.length) log(`\n⚠ 問題 ${problems.length} 項：\n` + problems.map((p) => '  · ' + p).join('\n'));
if (consoleErrors.length) log(`\nconsole errors:\n` + [...new Set(consoleErrors)].join('\n'));
chrome.kill();
process.exit(0);
