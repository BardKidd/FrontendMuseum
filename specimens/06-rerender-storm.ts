/**
 * 標本 #6 —— 高頻資料流造成的 re-render 風暴。
 *
 * 病變：模擬 WebSocket 每 50ms 推一批裝置狀態更新，每次推送直接重建整張 1000 列的清單。
 * 每秒 20 次全表重繪，畫面卡成幻燈片。
 *
 * 這是全案最有原創性的一個（spec:1136）—— 市面上幾乎沒有人把它做成可量測的對照。
 * 治療梯度有三段，每一段只加一件事：
 *   1. **批次化**：50ms 內的多筆更新合併，用 rAF 對齊幀率上限
 *   2. **細粒度更新**：只改真正變動的文字節點，不重建列
 *   3. **背壓**：推送速率超過渲染能力時主動丟棄中間狀態，只渲染最新值
 *
 * 兇手是 LoAF / 掉幀。**這個標本沒有使用者互動**（按一次開始就靜置），
 * 所以 INP 欄會是空的 —— 跟標本 #4 同一個理由。
 *
 * ⚠️ 資料流是 `setInterval` 不是真 WebSocket：真連線會把網路抖動灌進量測，
 * 而網路抖動不可重現。這裡犧牲的是「真實感」，換到的是**同一份資料每次跑出同一個結果**。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { RERENDER_STORM_META } from '../src/specimens';

// ───────────────────────── 凍結的負載參數 ─────────────────────────

/**
 * 裝置數。**spec 原文是 200 台，實測後校準到 1000**
 *（記在 `docs/phase2-expected-results.md` 修正紀錄）。
 *
 * 200 台在 2026 年的桌機上重建一次只要 **0.7ms（1x）／3.2ms（4x）** ——
 * 每秒 20 次也只吃掉 6% 的主執行緒，掉幀是 0~7，**根本不構成病變**。
 * spec 寫 200 是直覺值，不是量出來的；直覺在這件事上落後硬體大約一個數量級。
 *
 * 調整的是負載規模，不是結論：要展示的病是「每批推送都重建整表」，
 * 而那個病要看得見，整表就必須大到重建一次接近一幀的預算。
 */
const DEVICE_COUNT = 1000;
/** 推送間隔。照 spec 原文 50ms —— 每秒 20 批 */
const PUSH_INTERVAL_MS = 50;
/** 每批更新幾台（DEVICE_COUNT 的 20%）。要夠多才看得出「整表重繪 vs 只改變動的」差別 */
const BATCH_SIZE = 200;

/**
 * 串流長度。**刻意等於 `MEASURE_CONFIG.droppedFrameWindowMs`（5000ms）**，
 * 這樣串流結束的那一刻，5 秒滾動窗涵蓋的正好就是整段串流，不多不少。
 *
 * 自動停止而不是讓操作者自己數秒：串流長度是凍結變因，
 * 「我大概放了十秒」與「我大概放了七秒」是兩個不同的實驗。
 */
const STREAM_DURATION_MS = 5000;

const DATASET_SEED = 20240606;

/**
 * 背壓的門檻：上一次渲染超過這個時間，就認定渲染跟不上推送。
 * 16.7ms 是 60Hz 的一幀 —— 渲染一次就吃掉一整幀的話，這條流水線本來就不可能不掉幀。
 */
const RENDER_BUDGET_MS = 16.7;

interface Device {
  id: string;
  name: string;
  state: string;
  value: number;
}

interface DeviceRow {
  root: HTMLElement;
  state: HTMLElement;
  value: HTMLElement;
}

const STATES = ['運轉中', '待機', '維修', '離線'];
const NAMES = ['冷凍櫃', '空壓機', '輸送帶', '烘箱', '幫浦', '風機', '鍋爐', '冰水主機'];

let ctxRef: SpecimenContext | null = null;
let rootRef: HTMLElement | null = null;
let currentMode = 'broken';

let devices: Device[] = [];
/** 細粒度模式用的每列節點參照。整表重建模式不會用到它（它每次都把節點丟掉重建）*/
let rowNodes: DeviceRow[] = [];

let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let startButton: HTMLButtonElement | null = null;

let pushTimer = 0;
let stopTimer = 0;
let rafId = 0;
let streaming = false;
let rand: () => number = () => 0;

/** 待套用的更新，key = 裝置 index。**Map 本身就是「只保留最新值」** */
const pending = new Map<number, Device>();

let batchesReceived = 0;
let batchesRendered = 0;
let rendersSkipped = 0;
let updatesApplied = 0;
let lastRenderMs = 0;
/** 背壓用：下一次允許渲染的最早時間 */
let renderNotBefore = 0;

let listenerAbort: AbortController | null = null;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function nextRandom(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── 資料流 ─────────────────────────

/**
 * 假的 WebSocket 推送。名字會進 LoAF 的 sourceFunctionName，
 * 面板上因此看得出「這一幀是推送造成的」還是「是渲染造成的」。
 *
 * ⚠️ `setInterval` 在主執行緒卡住時會補償性地連續回呼 ——
 * 病變版卡一次之後會突然收到好幾批。那是真實現象（真的 WebSocket 也是這樣塞回來的），
 * 但它會讓「每批耗時」失真，所以 `batchesReceived` 與 `batchesRendered` 兩個數字都要上報。
 */
function pushDeviceBatch(): void {
  batchesReceived += 1;
  for (let k = 0; k < BATCH_SIZE; k++) {
    const i = (rand() * devices.length) | 0;
    const d = devices[i];
    d.state = STATES[(rand() * STATES.length) | 0];
    d.value = Math.round(rand() * 1000) / 10;
    pending.set(i, d);
  }

  if (currentMode === 'broken') {
    // 病變：收到就重繪，一次不漏。每秒 20 次全表重建
    renderAll();
    return;
  }
  // 三段治療都是「先進 pending，等 rAF」——差別在 rAF 裡怎麼寫 DOM
  scheduleFrame();
}

function scheduleFrame(): void {
  if (rafId !== 0) return;
  rafId = requestAnimationFrame(renderOnFrame);
}

/**
 * 治療共用的入口：一幀最多跑一次，而不是一批跑一次。
 * 20 批/秒 → 60 幀/秒的上限下，這一步就已經把「重繪次數」壓到不超過幀率。
 */
function renderOnFrame(): void {
  rafId = 0;
  if (pending.size === 0) return;

  /*
   * 治療三 —— 背壓。**只有這一段會主動丟掉工作。**
   *
   * 判斷依據是「上一次渲染花了多久」：超過一幀的預算就代表渲染跟不上推送，
   * 這時候硬要每幀都渲染只會讓佇列越積越長、延遲越來越大。
   * 主動讓渲染稀疏一點，畫面反而穩。
   *
   * ⚠️ 代價是真的：跳過的那幾幀，畫面顯示的不是最新狀態。
   * 這是取捨不是免費的勝利，所以 `rendersSkipped` 一定要上報 ——
   * 讓取捨被看見，而不是被我宣稱。
   */
  if (currentMode === 'fixed-backpressure') {
    const now = performance.now();
    if (now < renderNotBefore) {
      rendersSkipped += 1;
      scheduleFrame(); // 還是要排下一幀，否則就永遠不渲染了
      return;
    }
    renderNotBefore = now + Math.max(0, lastRenderMs - RENDER_BUDGET_MS);
  }

  if (currentMode === 'fixed-batch') {
    renderAll();
  } else {
    renderChangedOnly();
  }
}

// ───────────────────────── 兩種寫 DOM 的方式 ─────────────────────────

/**
 * 整表重建 —— 病變版與治療一都用這個。
 *
 * 治療一與病變版的差別**只有一件事**：什麼時候呼叫它。
 * 病變版每收到一批就叫一次（20 次/秒），治療一每幀最多一次。
 * 兩者做的 DOM 工作量完全相同，這樣「批次化」的收益才是乾淨的單一變因。
 */
function renderAll(): void {
  if (!listEl) return;
  const t0 = performance.now();

  const frag = document.createDocumentFragment();
  for (const d of devices) {
    const li = document.createElement('li');
    li.className = 'rs-row';
    const name = document.createElement('span');
    name.textContent = `${d.id} ${d.name}`;
    const state = document.createElement('span');
    state.className = 'rs-state';
    state.textContent = d.state;
    const value = document.createElement('span');
    value.className = 'rs-value';
    value.textContent = `${d.value.toFixed(1)}%`;
    li.append(name, state, value);
    frag.appendChild(li);
  }
  listEl.replaceChildren(frag);
  // 整表重建之後，先前存的節點參照全部失效 —— 細粒度模式若拿舊參照去寫，
  // 寫到的是已經不在文件裡的節點，畫面不動而程式不報錯。切 mode 時要重建參照。
  rowNodes = [];

  updatesApplied += pending.size;
  pending.clear();
  finishRender(performance.now() - t0, `整表重建 ${devices.length} 列`);
}

/**
 * 細粒度更新 —— 治療二與治療三用這個。
 * 只寫「這一幀真的變了的那幾台」的兩個文字節點，不動結構。
 */
function renderChangedOnly(): void {
  if (rowNodes.length === 0) return;
  const t0 = performance.now();

  let applied = 0;
  for (const [i, d] of pending) {
    const node = rowNodes[i];
    if (!node) continue;
    // textContent 的比較是刻意的：值沒變就不寫，寫入本身也要錢
    const nextState = d.state;
    const nextValue = `${d.value.toFixed(1)}%`;
    if (node.state.textContent !== nextState) node.state.textContent = nextState;
    if (node.value.textContent !== nextValue) node.value.textContent = nextValue;
    applied += 1;
  }
  updatesApplied += applied;
  pending.clear();
  finishRender(performance.now() - t0, `細粒度更新 ${applied} 列`);
}

function finishRender(elapsedMs: number, how: string): void {
  batchesRendered += 1;
  lastRenderMs = elapsedMs;
  if (statusEl) {
    statusEl.textContent =
      `${how} · 這一次 ${round1(elapsedMs)}ms · 收到 ${batchesReceived} 批 / 渲染 ${batchesRendered} 次` +
      (rendersSkipped > 0 ? ` / 背壓跳過 ${rendersSkipped} 次` : '');
  }
  ctxRef?.emit({
    deviceCount: devices.length,
    pushIntervalMs: PUSH_INTERVAL_MS,
    batchesReceived,
    batchesRendered,
    rendersSkipped,
    updatesApplied,
    lastRenderMs: round1(elapsedMs),
    // 「渲染次數 / 收到批次數」—— 病變版恆為 1.0，背壓版應該明顯低於 0.5。
    // droppedFrames 在 4x 下會撞到天花板（5 秒 × 60Hz ≈ 299），那時候靠這個數字說話。
    renderRatio: batchesReceived === 0 ? 0 : Math.round((batchesRendered / batchesReceived) * 100) / 100,
  });
}

// ───────────────────────── 串流控制 ─────────────────────────

/** 唯一的 click 進入點。名字不准包匿名箭頭，理由同其他標本 */
function toggleStreamOnClick(): void {
  if (streaming) {
    stopStream('手動停止');
    return;
  }
  ctxRef?.mark(`rerender-storm:start:${currentMode}`);
  // 每次開始都重置種子：同一個 mode 的第二輪必須推送與第一輪一模一樣的資料，
  // 否則兩輪之間差的不只是「渲染策略」，還有「這輪剛好比較多台變 離線」。
  rand = mulberry32(DATASET_SEED);
  batchesReceived = 0;
  batchesRendered = 0;
  rendersSkipped = 0;
  updatesApplied = 0;
  lastRenderMs = 0;
  renderNotBefore = 0;
  pending.clear();

  streaming = true;
  if (startButton) startButton.textContent = `推送中…（${STREAM_DURATION_MS / 1000} 秒後自動停止）`;
  pushTimer = window.setInterval(pushDeviceBatch, PUSH_INTERVAL_MS);
  stopTimer = window.setTimeout(() => stopStream('時間到'), STREAM_DURATION_MS);
}

function stopStream(why: string): void {
  streaming = false;
  window.clearInterval(pushTimer);
  window.clearTimeout(stopTimer);
  pushTimer = 0;
  stopTimer = 0;
  if (rafId !== 0) cancelAnimationFrame(rafId);
  rafId = 0;
  if (startButton) startButton.textContent = '開始推送';
  if (statusEl) {
    statusEl.textContent =
      `已停止（${why}）· 收到 ${batchesReceived} 批 / 渲染 ${batchesRendered} 次` +
      (rendersSkipped > 0 ? ` / 背壓跳過 ${rendersSkipped} 次` : '') +
      ` · 面板的 droppedFrames 峰值才是這一輪的成績（滾動窗會衰減）`;
  }
  ctxRef?.emit({ batchesReceived, batchesRendered, rendersSkipped, updatesApplied });
}

// ───────────────────────── DOM ─────────────────────────

function buildDevices(): Device[] {
  const seed = mulberry32(DATASET_SEED);
  const out: Device[] = new Array<Device>(DEVICE_COUNT);
  for (let i = 0; i < DEVICE_COUNT; i++) {
    out[i] = {
      id: `DEV-${String(i).padStart(3, '0')}`,
      name: NAMES[(seed() * NAMES.length) | 0],
      state: STATES[(seed() * STATES.length) | 0],
      value: Math.round(seed() * 1000) / 10,
    };
  }
  return out;
}

/** 建一次列，並記下每列的兩個文字節點 —— 細粒度模式靠這份參照才不必查 DOM */
function buildRowNodes(): void {
  if (!listEl) return;
  const frag = document.createDocumentFragment();
  const nodes: DeviceRow[] = new Array<DeviceRow>(devices.length);
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    const li = document.createElement('li');
    li.className = 'rs-row';
    const name = document.createElement('span');
    name.textContent = `${d.id} ${d.name}`;
    const state = document.createElement('span');
    state.className = 'rs-state';
    state.textContent = d.state;
    const value = document.createElement('span');
    value.className = 'rs-value';
    value.textContent = `${d.value.toFixed(1)}%`;
    li.append(name, state, value);
    frag.appendChild(li);
    nodes[i] = { root: li, state, value };
  }
  listEl.replaceChildren(frag);
  rowNodes = nodes;
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  listenerAbort = new AbortController();

  root.innerHTML = `
    <style>
      /* 量測條件：列高與欄寬決定整表重建時要算多少版面 */
      #rs-list { margin: 0; padding: 0; list-style: none; height: 380px; overflow-y: auto; border: 1px solid #999; }
      .rs-row { display: flex; gap: 12px; height: 22px; line-height: 22px; font-size: 13px; box-sizing: border-box; }
      .rs-row > span:first-child { width: 150px; }
      .rs-state { width: 60px; }
      .rs-value { width: 60px; text-align: right; }
    </style>

    <h1>標本 #6 —— re-render 風暴</h1>
    <p>模擬 WebSocket 每 ${PUSH_INTERVAL_MS}ms 推一批 ${BATCH_SIZE} 台裝置的狀態更新，共 ${DEVICE_COUNT} 台。
       病變版每收到一批就重建整張清單 —— 每秒 ${Math.round(1000 / PUSH_INTERVAL_MS)} 次全表重繪。</p>
    <p><strong>按一次「開始推送」，然後靜置 ${STREAM_DURATION_MS / 1000} 秒不要碰畫面。</strong>
       串流會自動停止 —— 串流長度是凍結變因，不能靠手感計時。</p>

    <p><button id="rs-start" type="button">開始推送</button></p>
    <p id="rs-status">尚未開始</p>
    <ul id="rs-list"></ul>

    <details>
      <summary>三段治療各自解決什麼</summary>
      <ol>
        <li><strong>批次化</strong>：把「每批渲染一次」改成「每幀最多渲染一次」。
            DOM 工作量沒變，變的是頻率 —— 20 次/秒 降到最多 60 次/秒但實際上是
            每幀合併多批，所以總次數反而少。</li>
        <li><strong>細粒度更新</strong>：不重建 ${DEVICE_COUNT} 列，只改真的變了的那幾個文字節點。
            這一段把每次的成本從 O(全部) 降到 O(變動數)。</li>
        <li><strong>背壓</strong>：上一次渲染超過一幀預算時，主動跳過幾幀。
            <strong>代價是畫面在那幾幀顯示的不是最新值</strong> ——
            這是取捨不是免費的勝利，所以「跳過幾次」有上報。</li>
      </ol>
    </details>
  `;

  listEl = root.querySelector<HTMLElement>('#rs-list')!;
  statusEl = root.querySelector<HTMLElement>('#rs-status')!;
  startButton = root.querySelector<HTMLButtonElement>('#rs-start')!;
  startButton.addEventListener('click', toggleStreamOnClick, { signal: listenerAbort.signal });

  devices = buildDevices();
  buildRowNodes();

  ctx.emit({
    deviceCount: devices.length,
    pushIntervalMs: PUSH_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    batchesReceived,
    batchesRendered,
  });
}

/**
 * A 類 live 切換。**串流一律停掉**：讓上一個 mode 的推送溢進新 mode，
 * 量到的就是兩種策略的混合，而面板上看起來只是「數字有點怪」。
 */
function setMode(mode: string): void {
  stopStream('切換 mode');
  currentMode = mode;
  batchesReceived = 0;
  batchesRendered = 0;
  rendersSkipped = 0;
  updatesApplied = 0;
  // 整表重建模式跑過之後 rowNodes 是空的（節點被換掉了）。
  // 切回細粒度模式前必須重建參照，否則它會對著已經不在文件裡的節點寫入 ——
  // 畫面不動、程式不報錯，是最難查的那種安靜失敗。
  devices = buildDevices();
  buildRowNodes();
  if (statusEl) statusEl.textContent = `已切換到 ${mode}，尚未開始`;
  ctxRef?.emit({ deviceCount: devices.length, batchesReceived, batchesRendered, rendersSkipped });
}

function reset(): void {
  stopStream('重跑');
  batchesReceived = 0;
  batchesRendered = 0;
  rendersSkipped = 0;
  updatesApplied = 0;
  devices = buildDevices();
  buildRowNodes();
  if (statusEl) statusEl.textContent = '尚未開始';
  ctxRef?.emit({ deviceCount: devices.length, batchesReceived, batchesRendered, rendersSkipped });
}

/**
 * 驗收第 12 條。這一頁的殘留物最多：setInterval、setTimeout、rAF、click listener。
 * 其中 setInterval 是最兇的 —— 沒清掉的話，切走之後它會永遠每 50ms 產生一次
 * origin === 'specimen' 的工作，而下一個標本的數字全部掛在它頭上。
 */
function destroy(): void {
  stopStream('destroy');
  listenerAbort?.abort();
  listenerAbort = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  listEl = null;
  statusEl = null;
  startButton = null;
  ctxRef = null;
  devices = [];
  rowNodes = [];
  pending.clear();
}

const mod: SpecimenModule = {
  meta: RERENDER_STORM_META,
  mount,
  setMode,
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
