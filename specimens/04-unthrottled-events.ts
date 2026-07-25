/**
 * 標本 #4 —— 事件處理未節流。
 *
 * 病變：`scroll` handler 每次事件都對 2000 列各讀一次 `getBoundingClientRect()`，
 * 而 `wheel` listener 又是 `{ passive: false }` —— 瀏覽器必須等 handler 跑完
 * 才敢開始捲動。於是捲動期間每一幀都在做 O(N) 的工作，畫面掉幀。
 *
 * ⚠️ **這個標本有一個會讓病變版「壞不起來」的陷阱，改任何一行之前先讀完**（spec:1089）：
 *
 *   Chrome 對掛在 `window` / `document` / `document.body` 上的
 *   `touchstart` / `touchmove` / `wheel` **預設就是 passive**。
 *   照直覺把 listener 掛在 window 上，`{ passive: false }` 會被忽略，
 *   病變版與治療版量到一模一樣的數字，而你會 debug 很久才發現不是量測壞掉。
 *
 * 所以本檔的 listener **一律掛在具體的捲動容器 `#thr-scroller` 上**。
 * 另一條要一起講明的：**`scroll` 事件不可 cancel，對它加 `passive` 是 no-op。**
 * 很多人到處亂加 `{ passive: true }`，這個標本正好把「哪裡有用、哪裡沒用」講清楚。
 *
 * 兇手是 LoAF / 掉幀，不是 INP：**捲動與 wheel 依規格不產生 `interactionId`**，
 * 所以面板的 INP 欄會是空的。那不是壞掉，是 INP 明文排除捲動。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { UNTHROTTLED_EVENTS_META } from '../src/specimens';

/**
 * 列數。**登記值是 2000，實測後校準到 8000**（記在 `docs/phase2-expected-results.md` 修正紀錄）。
 *
 * 這是負載規模：每次 scroll 事件的工作量就是 N 次 `getBoundingClientRect()`。
 * 登記在案的最大風險正是這個數字，而它**成真了**：捲動不會弄髒版面，
 * 所以這些讀取讀的是乾淨的 layout，**不像標本 #3 那樣每次都強制重算** ——
 * 實測 N=2000 時每次事件只要 1.8ms（1x）／8.8ms（4x），連一幀都塞不滿，掉幀是 0~4。
 * 單價約 0.9µs/次（1x），比標本 #3 的 0.23ms/次低了 250 倍，正是「乾淨 layout」的差別。
 *
 * 調到 8000 是校準不是修結論：**要展示的病是「每次事件 O(N)」，不是某個特定的 N。**
 * DOM 仍然只有 8000 個節點，遠小於標本 #2 的 40,021，兩個標本的病因不會糊在一起。
 */
const ROW_COUNT = 8000;
const ROW_HEIGHT = 48;
const VIEWPORT_HEIGHT = 400;
const DATASET_SEED = 20240404;

interface SpecimenDom {
  scroller: HTMLElement;
  status: HTMLElement;
}

let ctxRef: SpecimenContext | null = null;
let rootRef: HTMLElement | null = null;
let dom: SpecimenDom | null = null;
let currentMode = 'broken';

let rows: HTMLElement[] = [];

/**
 * listener 的生命週期綁在 mode 上，不是綁在標本上 ——
 * 每次切 mode 都要能乾淨拆掉上一組。所以這裡是**每個 mode 一個** AbortController，
 * 與標本 #1／#3 的「整個標本一個」不同。
 */
let modeAbort: AbortController | null = null;
let observer: IntersectionObserver | null = null;
let rafId = 0;
/** rAF 版用：handler 只寫這個，真正的計算在下一幀做 */
let pendingScrollTop = -1;

let scrollEvents = 0;
let wheelEvents = 0;
let rectReads = 0;
let passes = 0;

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

// ───────────────────────── 負載本體 ─────────────────────────

/**
 * 「算每一列的可見狀態」—— 曝光追蹤、無限捲動、sticky 標頭都會寫出這種迴圈。
 *
 * ⚠️ **迴圈裡只讀不寫，這是刻意的。**
 * 迴圈內若同時寫入（例如順手加個 class），每次讀 rect 都會強制重算版面，
 * 這個標本就變成標本 #3 了 —— 兩個標本的病因糊在一起，兩邊的教學都被稀釋。
 * 這裡要展示的是「事件頻率 × 每次 O(N) 的工作量」，不是讀寫交替。
 * 所以寫入一律等迴圈結束後做一次。
 */
function measureVisibleRows(): number {
  const scroller = dom?.scroller;
  if (!scroller) return 0;

  // 容器自己的 rect 讀一次就好，放進迴圈是白花 N-1 次
  const box = scroller.getBoundingClientRect();
  let visible = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    rectReads += 1;
    if (r.bottom > box.top && r.top < box.bottom) visible += 1;
  }
  return visible;
}

/** 迴圈跑完之後才寫一次 DOM。名字會進 LoAF 的 sourceFunctionName */
function reportPass(visible: number, elapsedMs: number, how: string): void {
  passes += 1;
  if (dom) {
    dom.status.textContent =
      `${how} · 可見 ${visible} 列 · 這一趟 ${round1(elapsedMs)}ms · ` +
      `scroll ${scrollEvents} 次 / wheel ${wheelEvents} 次 / rect 讀取累計 ${rectReads}`;
  }
  ctxRef?.emit({
    rowCount: rows.length,
    scrollEvents,
    wheelEvents,
    rectReads,
    passes,
    lastPassMs: round1(elapsedMs),
    visibleRows: visible,
  });
}

/** 病變版的 scroll handler：每一次事件都跑完整的 O(N) 掃描 */
function scanOnEveryScroll(): void {
  scrollEvents += 1;
  const t0 = performance.now();
  const visible = measureVisibleRows();
  reportPass(visible, performance.now() - t0, '每次 scroll 事件全掃');
}

/**
 * 病變版的 wheel handler。掛在容器上 + `{ passive: false }` 才有效
 *（掛 window 的話 Chrome 會強制 passive，見檔頭）。
 *
 * **沒有呼叫 preventDefault()**：這個標本要示範的是「非 passive 的 handler
 * 會讓瀏覽器不敢先捲」，不是「攔截捲動」。真的 preventDefault 會讓頁面完全捲不動，
 * 那就不是效能問題而是功能問題了。
 */
function scanOnEveryWheel(): void {
  wheelEvents += 1;
  const t0 = performance.now();
  const visible = measureVisibleRows();
  reportPass(visible, performance.now() - t0, 'wheel（passive:false）全掃');
}

/** wheel 只計數不做事 —— `{ passive: true }` 那一段用 */
function countWheelOnly(): void {
  wheelEvents += 1;
}

/**
 * 治療二的 scroll handler：**只記位置，不算東西**。
 * 真正的計算排到下一幀，所以每幀最多跑一次，而不是每個事件跑一次。
 */
function recordScrollForRaf(): void {
  scrollEvents += 1;
  pendingScrollTop = dom?.scroller.scrollTop ?? 0;
  if (rafId !== 0) return;
  rafId = requestAnimationFrame(scanOnAnimationFrame);
}

function scanOnAnimationFrame(): void {
  rafId = 0;
  if (pendingScrollTop < 0) return;
  pendingScrollTop = -1;
  const t0 = performance.now();
  const visible = measureVisibleRows();
  reportPass(visible, performance.now() - t0, 'rAF 節流（每幀最多一次）');
}

/**
 * 治療三：`IntersectionObserver`。**完全不掛 scroll listener。**
 *
 * 這才是正解：可見性由瀏覽器在算完版面之後回呼，
 * 工作量從「每次事件 O(全部列)」變成「每次回呼 O(跨越邊界的列)」——
 * 捲一格通常只有個位數的列跨越邊界。`rectReads` 那一欄會是 0，
 * 因為我們一次 `getBoundingClientRect()` 都沒有呼叫。
 */
function onIntersect(entries: IntersectionObserverEntry[]): void {
  const t0 = performance.now();
  let visible = 0;
  // entries 只含「狀態有變」的那幾列，不是全部 2000 列
  for (const e of entries) {
    if (e.isIntersecting) visible += 1;
  }
  reportPass(visible, performance.now() - t0, `IntersectionObserver（本次 ${entries.length} 列變動）`);
}

// ───────────────────────── mode 切換 ─────────────────────────

function teardownMode(): void {
  modeAbort?.abort();
  modeAbort = null;
  observer?.disconnect();
  observer = null;
  if (rafId !== 0) cancelAnimationFrame(rafId);
  rafId = 0;
  pendingScrollTop = -1;
}

/**
 * 四段模式，**每一段只翻動一個變因**：
 *   broken          scroll 全掃 + wheel `{passive:false}` 全掃
 *   fixed-passive   只把 wheel 換成 `{passive:true}`（scroll 仍然全掃）
 *   fixed-raf       再把 scroll 的計算移進 rAF
 *   fixed-observer  改用 IntersectionObserver，完全不掛 scroll
 *
 * `fixed-passive` 存在的唯一理由是**證明 passive 不夠**：它解決「捲動被 handler 阻塞」，
 * 不解決「handler 本身太重」。少了這一段，讀者會以為加個 `{passive:true}` 就沒事了。
 */
function applyMode(): void {
  teardownMode();
  if (!dom) return;
  modeAbort = new AbortController();
  const { signal } = modeAbort;
  const scroller = dom.scroller;

  if (currentMode === 'fixed-observer') {
    observer = new IntersectionObserver(onIntersect, {
      // root 是容器不是視窗 —— 捲動發生在容器內部
      root: scroller,
      threshold: 0,
    });
    for (const row of rows) observer.observe(row);
    dom.status.textContent = '治療三：IntersectionObserver，沒有任何 scroll / wheel listener';
    return;
  }

  if (currentMode === 'fixed-raf') {
    scroller.addEventListener('scroll', recordScrollForRaf, { signal, passive: true });
    scroller.addEventListener('wheel', countWheelOnly, { signal, passive: true });
    dom.status.textContent = '治療二：scroll 只記位置，計算排進 rAF';
    return;
  }

  // broken 與 fixed-passive 的 scroll handler 是同一支 —— 兩者的差別只在 wheel
  scroller.addEventListener('scroll', scanOnEveryScroll, { signal, passive: true });
  if (currentMode === 'fixed-passive') {
    scroller.addEventListener('wheel', countWheelOnly, { signal, passive: true });
    dom.status.textContent = '治療一：wheel 改 passive:true（scroll 仍然每次全掃）';
  } else {
    // ⚠️ passive: false 必須顯式寫。掛在容器上時預設是 false，但寫出來才看得見意圖，
    // 而且哪天有人把 listener 搬到 window 上，這一行會提醒他為什麼搬不得。
    scroller.addEventListener('wheel', scanOnEveryWheel, { signal, passive: false });
    dom.status.textContent = '病變：每次 scroll 全掃 + wheel passive:false 也全掃';
  }
}

// ───────────────────────── DOM ─────────────────────────

function buildRows(list: HTMLElement): HTMLElement[] {
  const rand = mulberry32(DATASET_SEED);
  const names = ['冷凍櫃', '空壓機', '輸送帶', '烘箱', '幫浦', '風機', '鍋爐', '冰水主機'];
  const states = ['運轉中', '待機', '維修', '離線'];
  const frag = document.createDocumentFragment();
  const out: HTMLElement[] = new Array<HTMLElement>(ROW_COUNT);

  for (let i = 0; i < ROW_COUNT; i++) {
    const li = document.createElement('li');
    li.className = 'thr-row';
    li.textContent =
      `${String(i).padStart(4, '0')} ${names[(rand() * names.length) | 0]} · ` +
      `${states[(rand() * states.length) | 0]} · ${(rand() * 100).toFixed(1)}%`;
    frag.appendChild(li);
    out[i] = li;
  }
  list.replaceChildren(frag);
  return out;
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;

  root.innerHTML = `
    <style>
      /*
        ⚠️ 量測條件，不是排版。列高與容器高度決定「一次捲動會跨越幾列」，
        也就決定 IntersectionObserver 版每次回呼要處理幾筆。
      */
      #thr-scroller {
        height: ${VIEWPORT_HEIGHT}px;
        overflow-y: auto;
        border: 1px solid #999;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .thr-row {
        height: ${ROW_HEIGHT}px;
        line-height: ${ROW_HEIGHT}px;
        border-bottom: 1px solid #eee;
        box-sizing: border-box;
        font-size: 14px;
      }
    </style>

    <h1>標本 #4 —— 事件處理未節流</h1>
    <p>下面的清單有 ${ROW_COUNT} 列，捲動容器是一個具體的 <code>div</code>
       ——<strong>不是 window / document / body</strong>。這件事是本標本能成立的前提：
       Chrome 對掛在那三者上的 <code>wheel</code> 預設就是 passive，
       掛錯地方的話病變版與治療版會量到一模一樣的數字。</p>
    <p>請照操作程序：每次節拍亮起時在清單上滾一格滑鼠滾輪，共十次。</p>

    <p id="thr-status">尚未捲動</p>
    <ul id="thr-scroller"></ul>

    <details>
      <summary>哪裡加 <code>passive</code> 有用、哪裡沒用</summary>
      <ul>
        <li><strong>有用</strong>：<code>wheel</code> / <code>touchstart</code> /
            <code>touchmove</code> —— 這些事件可以 <code>preventDefault()</code>，
            所以瀏覽器必須先等 handler 跑完才敢捲。宣告 passive 等於承諾不攔截，
            瀏覽器就能立刻開始捲。</li>
        <li><strong>沒用</strong>：<code>scroll</code> —— <strong>它根本不可 cancel</strong>，
            對它加 <code>{ passive: true }</code> 是 no-op。捲動已經發生了才派送這個事件。</li>
        <li><strong>已經是預設</strong>：掛在 <code>window</code> /
            <code>document</code> / <code>document.body</code> 上的
            <code>wheel</code> / <code>touchstart</code> / <code>touchmove</code>。
            在那裡寫 <code>{ passive: false }</code> 會被忽略。</li>
      </ul>
      <p><strong>passive 不能解決 handler 太重。</strong>它只讓捲動不必等你，
         handler 該花的時間一秒都沒少 —— 那些時間仍然落在同一條主執行緒上，仍然掉幀。
         這就是本標本第二段模式存在的理由。</p>
    </details>
  `;

  dom = {
    scroller: root.querySelector<HTMLElement>('#thr-scroller')!,
    status: root.querySelector<HTMLElement>('#thr-status')!,
  };
  rows = buildRows(dom.scroller);
  applyMode();

  ctx.emit({ rowCount: rows.length, scrollEvents, wheelEvents, rectReads, passes });
}

/**
 * A 類 live 切換：只換 listener 組合，不重建列。
 * 重建 2000 列會把捲動位置一起清掉，那等於在「怎麼監聽」之外又動了「從哪裡開始捲」。
 */
function setMode(mode: string): void {
  currentMode = mode;
  // 計數器是「本 mode 內」的，跨 mode 累加會讀成別的意思
  scrollEvents = 0;
  wheelEvents = 0;
  rectReads = 0;
  passes = 0;
  applyMode();
  ctxRef?.emit({ rowCount: rows.length, scrollEvents, wheelEvents, rectReads, passes });
}

function reset(): void {
  scrollEvents = 0;
  wheelEvents = 0;
  rectReads = 0;
  passes = 0;
  // 捲回頂端：不同的起始位置會讓「可見列」與跨越邊界的列數都不同
  if (dom) {
    dom.scroller.scrollTop = 0;
    dom.status.textContent = '尚未捲動';
  }
  ctxRef?.emit({ rowCount: rows.length, scrollEvents, wheelEvents, rectReads, passes });
}

/**
 * 驗收第 12 條。這一頁有三種殘留物要清：listener、IntersectionObserver、待處理的 rAF。
 * 少清 rAF 那一個最難發現 —— 它只會在切走的那一瞬間多跑一次。
 */
function destroy(): void {
  teardownMode();
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  dom = null;
  ctxRef = null;
  rows = [];
}

const mod: SpecimenModule = {
  meta: UNTHROTTLED_EVENTS_META,
  mount,
  setMode,
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
