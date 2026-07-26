/**
 * 標本 #4 —— 事件處理未節流。
 *
 * 病變：`scroll` 與 `wheel` 兩個 handler 每次事件都對 8000 列各讀一次
 * `getBoundingClientRect()`，而 `wheel` listener 又是 `{ passive: false }` ——
 * 瀏覽器必須等 handler 跑完才敢開始捲動。於是捲動期間每一幀都在做 O(N) 的工作，畫面掉幀。
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
 * ⚠️ **四段模式不是一條疊加梯度**（2026-07-26 重寫，理由記在
 * `docs/phase2-expected-results.md` 修正紀錄）。前三段是同一個機制底下的**三格變因隔離**，
 * 第四段是**換機制**：
 *
 *   broken → fixed-passive      工作量逐位元固定，只翻 `wheel` 的 `passive` 旗標
 *   fixed-passive → fixed-raf   listener 註冊參數字面不動，只翻「計算在哪裡跑」
 *   fixed-raf → fixed-observer  不共用任何變因，數字只能與 broken 比
 *
 * 舊版把後兩段寫成「再加上……再加上」，而實測揭穿了兩件事：治療一同時偷換了 handler
 *（順手拿掉一整輪 8000 次 rect 讀取），治療二的閘門只蓋在 `scroll` 上、三輪一次都沒觸發。
 *
 * 兇手是 LoAF / 掉幀，不是 INP：**捲動與 wheel 依規格不產生 `interactionId`**，
 * 所以面板的 INP 欄會是空的。那不是壞掉，是 INP 明文排除捲動。
 *
 * ⚠️ 連帶的一條**儀器解析度邊界**（不是缺陷，但它決定治療一該登記什麼預期）：
 * 本站的 `custom.droppedFrames` 來自 `src/measure/frames.ts` 的 rAF 迴圈，
 * 量的是**主執行緒**出幀節奏；而 `passive` 買到的是「瀏覽器不必等你就能先捲」，
 * 那是 **compositor 側**的收益。這把尺結構上看不見 passive 買到的東西 ——
 * 所以治療一預期量到一個零，而那個零正是它的結論。
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

/**
 * 收到的 wheel 事件裡 `cancelable` 為 true 的筆數 —— `passive` 旗標有沒有生效的零成本證據。
 *
 * ⚠️ **這條證據是單向的，不要當成雙向用**（2026-07-26 改寫，理由見下）：
 *
 *   計數 **> 0** ⇒ 這個 listener **不是** passive。規格保證，沒有別的解釋。
 *   計數 **= 0** ⇒ **推不出任何結論**。可能是旗標生效（治療一應當如此），
 *                  也可能是 Chrome 的 wheel latching 把整串手勢標成不可取消。
 *
 * latching 不是理論風險：本標本的機器 protocol 是**一拍連派三格**，
 * 同一串手勢的第 2、3 格很可能就已經是 `cancelable: false`，
 * 所以判準是「**病變版 > 0、治療一 = 0**」，**不是「等於 `wheelEvents`」**。
 * 同理不要用「最後一次的 `e.cancelable`」—— 那在病變版上會讀到 false。計數才穩。
 *
 * ⚠️ **這一欄沒有基線資料。** 2026-07-25 那 12 筆 record 裡根本沒有它（2026-07-26 才加）。
 * 所以**正式三輪之前必須先跑一次拋棄式探針，確認病變版在「一拍三格」底下計數 > 0**；
 * 量到 0 的話這條護欄在本機這組條件下失效，要改用 `wheelDeltaTotal` 與
 * `passes` / `rectReads` 的兩臂比對來判斷，**不准把 0 讀成「旗標生效」**。
 *
 * 讀它一定要**連 `wheelEvents` 一起讀**：0/0（根本沒收到事件）與 0/30（可能生效、
 * 也可能只是 latching）意思完全不同。這也是 `tools/analyze-repro.mjs` 的 `clsValue`
 * 把「沒量到」與「真的是 0」併成一格所犯的錯，不重犯。
 *
 * ⚠️ **它不是檔頭 spec:1089 陷阱的偵測器**（先前的註解這樣寫，是錯的）：
 * listener 若被搬回 window，Chrome 會強制 passive，計數同樣塌成 0 ——
 * 與 latching 造成的 0 **無法區分**，照舊註解讀會得到「listener 被搬走了」的假警報。
 * 那個陷阱靠的是構造：listener 一律註冊在 `dom.scroller` 這個區域變數上（見 `applyMode()`），
 * 而不是靠這個計數器事後偵測。
 */
let wheelCancelableCount = 0;
/**
 * 收到的 wheel 事件的 `deltaY` 合計（像素）。**「四臂收到的刺激是否相同」的護欄。**
 *
 * 驅動器一拍**不等回應**連派 3 格（`tools/reproducibility.mjs` 的 `wheelTicks`），
 * 而這三格會不會被 Chrome 的事件佇列合併成一個事件，**取決於主執行緒忙不忙**：
 * broken／fixed-passive 的 handler 各約 33ms，第 2、3 格很可能被併；
 * fixed-raf 的主執行緒是閒的，三格大概率全部交付。
 * 所以 `wheelEvents` 在四臂之間**本來就不會相等**，拿它當「刺激相同」的證據會誤判 ——
 * 那正是把刺激量變成負載的函數（spec §1：凍結變因）。
 *
 * 合併的語意是**把 delta 加起來**，不是丟掉，所以合併發生時這一欄守恆：
 *
 *   `wheelEvents` 變少、`wheelDeltaTotal` 不變 ⇒ 發生合併，**刺激仍相同，對照成立**
 *   `wheelDeltaTotal` 兩臂不相等              ⇒ **刺激本身不同，那一輪的對照作廢**
 *
 * 硬性驗收因此登記在 `wheelDeltaTotal` 與 `scrollTop` 上，不登記在 `wheelEvents` 上。
 * `fixed-observer` 一個 wheel listener 都不掛（那是它的定義），這一欄必為 0 ——
 * 那一臂的刺激量只能由驅動器在量測窗**之外**讀 `scrollTop` 來對帳。
 */
let wheelDeltaTotal = 0;
/**
 * rAF 閘門擋掉的排程次數。**治療二有沒有真的合併到東西，只有這個數字說得準。**
 * 與標本 #6 的 `rendersSkipped` 同一種護欄 —— #6 就是靠它抓出一段從未執行的程式碼。
 */
let rafSkipped = 0;
/**
 * 狀態列上的 wheel 字樣。病變版與治療一**共用同一支 wheel handler**，
 * 只有註冊參數不同，所以字串不能寫死在 handler 裡。
 * 它在 `applyMode()` 裡**緊貼著 addEventListener 那一行**設值：
 * 字串與旗標寫在相鄰兩行，物理上不可能漂移。
 */
let wheelLabel = '';

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

/**
 * 目前的捲動位置（整數像素）。**四臂共通的刺激量對帳欄** ——
 * `fixed-observer` 沒有 wheel listener，`wheelDeltaTotal` 在那一臂必為 0，
 * 只有這一欄四臂都量得到：同一組驅動輸入下四臂的終值必須相等（見 `wheelDeltaTotal` 的說明）。
 *
 * 讀 `scrollTop` **不會**強制版面重算：這裡的四個呼叫點（mount / setMode / reset /
 * `reportPass`）都落在版面已經乾淨的時刻 —— `reportPass` 之前剛跑完一輪 rect 讀取
 *（那一輪已經把版面結算過），IntersectionObserver 的回呼更是在瀏覽器算完版面之後才發。
 * 所以這一欄不會把標本 #3 的病因（讀寫交替）偷渡進來。
 */
function scrollTopPx(): number {
  return Math.round(dom?.scroller.scrollTop ?? 0);
}

/**
 * 護欄計數器快照。四處 emit（mount / setMode / reset / reportPass）共用同一份，
 * **加欄位只改這裡一處** —— 四份手抄的物件字面值遲早會漂。
 */
function counters(): Record<string, number> {
  return {
    rowCount: rows.length,
    scrollEvents,
    wheelEvents,
    wheelCancelableCount,
    wheelDeltaTotal,
    scrollTop: scrollTopPx(),
    rectReads,
    passes,
    rafSkipped,
  };
}

/** 計數器是「本 mode 內」的，跨 mode 累加會讀成別的意思 */
function resetCounters(): void {
  scrollEvents = 0;
  wheelEvents = 0;
  wheelCancelableCount = 0;
  wheelDeltaTotal = 0;
  rectReads = 0;
  passes = 0;
  rafSkipped = 0;
}

/** 迴圈跑完之後才寫一次 DOM。名字會進 LoAF 的 sourceFunctionName */
function reportPass(visible: number, elapsedMs: number, how: string): void {
  passes += 1;
  if (dom) {
    /*
     * ⚠️ 尾端那兩欄不是裝飾。治療一修好之後它的 `passes` / `rectReads` / 這一趟耗時
     * 會與病變版**一模一樣**（那正是變因隔離的目的），而畫面上「兩個 mode 數字相同」
     * 長得跟 2026-07-25 修掉的 `droppedFramesPeak` 沒歸零那個缺陷一模一樣。
     * 「wheel 可取消」與「閘門擋下」是把**正確的相同**與**錯誤的相同**分開的唯一手段。
     */
    dom.status.textContent =
      `${how} · 可見 ${visible} 列 · 這一趟 ${round1(elapsedMs)}ms · ` +
      `scroll ${scrollEvents} 次 / wheel ${wheelEvents} 次 / rect 讀取累計 ${rectReads} · ` +
      `wheel 可取消 ${wheelCancelableCount}/${wheelEvents} · 閘門擋下 ${rafSkipped} · ` +
      `刺激量 wheel Δ${wheelDeltaTotal}px / 已捲 ${scrollTopPx()}px`;
  }
  ctxRef?.emit({
    ...counters(),
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
 * wheel handler。**病變版與治療一共用這一支。**
 *
 * 兩個 mode 唯一的差別是 `addEventListener` 第三個參數裡的 `passive`，
 * 工作量逐位元相同 —— 變因隔離不靠註解宣稱，靠「兩個 mode 引用同一個識別字」
 * 這件語法事實。將來誰想再偷換 handler，都得先寫出第二個函式名字。
 * 機械驗收條件：`passes` 與 `rectReads` 兩欄在 broken 與 fixed-passive 之間必須逐輪相等。
 *
 * 掛在容器上 + `{ passive: false }` 才有效
 *（掛 window 的話 Chrome 會強制 passive，見檔頭）。
 *
 * **沒有呼叫 preventDefault()**：這個標本要示範的是「非 passive 的 handler
 * 會讓瀏覽器不敢先捲」，不是「攔截捲動」。真的 preventDefault 會讓頁面完全捲不動，
 * 那就不是效能問題而是功能問題了。
 */
function scanOnEveryWheel(e: WheelEvent): void {
  wheelEvents += 1;
  if (e.cancelable) wheelCancelableCount += 1;
  // 刺激量守恆欄。兩個 wheel handler 都要記，否則四臂之間比不了（見 wheelDeltaTotal）
  wheelDeltaTotal += Math.round(Math.abs(e.deltaY));
  const t0 = performance.now();
  const visible = measureVisibleRows();
  reportPass(visible, performance.now() - t0, wheelLabel);
}

/**
 * 治療二的排程閘門：**一幀之內只排一次掃描**，之後的事件只更新待處理的位置。
 * 那個 `rafId !== 0` 的 return 就是閘門本身。
 *
 * ⚠️ **wheel 也必須走這裡，`scroll` 一個人走不通。**
 * `scroll` 事件在事件迴圈的 update-the-rendering 步驟派送、同一個 target 每幀去重 ——
 * **一幀最多一個**，瀏覽器已經替你節流過了，對它做 rAF 節流是 no-op。
 * 三輪實測（2026-07-25）的直接證據：舊版閘門只蓋在 scroll 上，`fixed-raf` 的
 * `passes` 與 `scrollEvents` 逐輪相等（10=10、11=11、11=11），閘門一次都沒有動過。
 * 一幀之內真的能來好幾個的是 `wheel`，閘門就得蓋在它上面。
 */
function scheduleScan(): void {
  pendingScrollTop = dom?.scroller.scrollTop ?? 0;
  if (rafId !== 0) {
    rafSkipped += 1;
    return;
  }
  rafId = requestAnimationFrame(scanOnAnimationFrame);
}

/**
 * 治療二的 scroll handler：**只記位置，不算東西**。
 * 真正的計算排到下一幀，所以每幀最多跑一次，而不是每個事件跑一次。
 */
function recordScrollForRaf(): void {
  scrollEvents += 1;
  scheduleScan();
}

/** 治療二的 wheel handler：同樣只記位置。閘門能合併到東西，靠的就是這一條路徑 */
function recordWheelForRaf(e: WheelEvent): void {
  wheelEvents += 1;
  if (e.cancelable) wheelCancelableCount += 1;
  wheelDeltaTotal += Math.round(Math.abs(e.deltaY));
  scheduleScan();
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
  // entries 只含「狀態有變」的那幾列，不是全部 8000 列
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
 * 四段模式。**前三段是同一個機制底下的三格變因隔離，第四段是換機制** ——
 * 不是一條「再加上……再加上」的疊加梯度：
 *
 *   broken          scroll 全掃 + wheel `{passive:false}` 全掃
 *   fixed-passive   工作量與 broken **逐位元相同**，只翻 wheel 的 `passive` 旗標
 *   fixed-raf       兩個 listener 的註冊參數與 fixed-passive **字面相同**，
 *                   只翻「計算在哪裡跑」：掃描排進 rAF，每幀最多一次
 *   fixed-observer  換掉機制：一個 scroll / wheel listener 都不掛
 *
 * 前三段的差分可以機械驗收：broken 與 fixed-passive 掛的是**同一個函式物件**
 *（`scanOnEveryWheel`），所以 `passes` / `rectReads` 必須逐輪相等；
 * fixed-passive 與 fixed-raf 各自那兩行 addEventListener 的第三個參數字面完全相同
 *（皆 `{ signal, passive: true }`），差的只有掛哪一支函式。
 *
 * `fixed-observer` 與前三段**不共用任何變因**，它的數字只能與 broken 比，
 * 不能與 fixed-raf 排名。
 *
 * `fixed-passive` 存在的唯一理由是**證明 passive 不夠**：它解決「捲動被 handler 阻塞」，
 * 不解決「handler 本身太重」。少了這一段，讀者會以為加個 `{passive:true}` 就沒事了。
 * 而它在本站預期量到一個**零**（見檔頭的儀器解析度邊界），那個零就是它的結論。
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
    // 這兩行的第三個參數與治療一的兩行**字面完全相同**（皆 `{ signal, passive: true }`）——
    // 唯一翻動的變因是掃描從「在 handler 裡同步跑」變成「排進 rAF、每幀最多一次」。
    // wheel 也走閘門：scroll 由規格保證一幀最多一次，只蓋 scroll 的話閘門不可能觸發。
    scroller.addEventListener('scroll', recordScrollForRaf, { signal, passive: true });
    scroller.addEventListener('wheel', recordWheelForRaf, { signal, passive: true });
    dom.status.textContent = '治療二：scroll 與 wheel 都只記位置，計算排進 rAF';
    return;
  }

  // broken 與 fixed-passive 的 scroll handler 是同一支 —— 兩者的差別只在下面那一行 wheel
  scroller.addEventListener('scroll', scanOnEveryScroll, { signal, passive: true });
  if (currentMode === 'fixed-passive') {
    // ⚠️ 掛的是與 else 分支**同一個函式物件**：同樣一輪 8000 次 getBoundingClientRect()。
    // 兩行唯一的差別是 passive。要偷換 handler 的人得先寫出第二個函式名字，
    // 而 passes / rectReads 逐輪相等是這件事的機械驗收。
    wheelLabel = 'wheel（passive:true）全掃';
    scroller.addEventListener('wheel', scanOnEveryWheel, { signal, passive: true });
    dom.status.textContent = '治療一：只翻 passive:true，wheel 的工作量與病變版完全相同';
  } else {
    // ⚠️ passive: false 必須顯式寫。掛在容器上時預設是 false，但寫出來才看得見意圖，
    // 而且哪天有人把 listener 搬到 window 上，這一行會提醒他為什麼搬不得。
    wheelLabel = 'wheel（passive:false）全掃';
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

    <!--
      ⚠️ **捲動容器必須排在說明文字之前，而且要整個落在標本頁的前 ${UNTHROTTLED_EVENTS_META.viewport.height}px 內。**
      這不是排版偏好，是量測條件（2026-07-26 由拋棄式探針抓到）：

      外殼用 iframe 載入標本頁，iframe 的可視高度就是凍結的 viewport 高度，
      而驅動器（tools/reproducibility.mjs 的 ptIn）**不捲 iframe 內部**
      —— 它算的是「元素中心在外殼座標系的位置」。容器一旦被上方的段落推到
      600px 以下，那個座標就落在 iframe 之外，滾輪事件會**靜默地打到外殼身上**：
      標本一個事件都收不到，四臂的 wheelEvents / rectReads / passes 全是 0，
      而畫面上完全看不出異常（狀態列停在「尚未捲動」，看起來只是沒人操作）。

      這正是先前發生的事：說明文字從一行長成三段，容器被推到 y≈465，
      中心 y≈666 > 604，探針量到四臂全 0。所以：**新增文字一律加在容器下方。**
      mount() 尾端的 warnIfScrollerBelowFold() 是同一件事的執行期檢查：
      容器越界時會在它上方插一行紅字。
    -->
    <p>操作程序：每次節拍亮起時在清單上<strong>連滾三格</strong>滑鼠滾輪
       ——<strong>一次順手的短撥，不要一格一格慢慢滾</strong>——共十拍。
       用滾輪，不要拖捲軸。理由寫在清單下方。</p>

    <ul id="thr-scroller"></ul>
    <!--
      狀態列放在清單**下方**，不是上方（2026-07-26 改）。
      它每跑一趟就重寫一次，而那串文字的行數會從一行長到三行 ——
      放上方的話容器會在量測進行中被推下去，最後又踩回上面那個「容器掉出 iframe」的坑。
      放下方，容器的位置只由 h1 與一段短文字決定，量測期間不會動。
    -->
    <p id="thr-status">尚未捲動</p>

    <p>上面的清單有 ${ROW_COUNT} 列，捲動容器是一個具體的 <code>div</code>
       ——<strong>不是 window / document / body</strong>。這件事是本標本能成立的前提：
       Chrome 對掛在那三者上的 <code>wheel</code> 預設就是 passive，
       掛錯地方的話病變版與治療版會量到一模一樣的數字。</p>
    <p>為什麼是三格：<code>scroll</code> 事件一幀最多派送一次，
       所以要讓治療二的 rAF 閘門有東西可合併，一幀之內至少要有第二個
       <code>wheel</code> 事件。三格是量測條件，不是隨手寫的。</p>
    <p>⚠️ <strong>三格不等於三個 <code>wheel</code> 事件。</strong>瀏覽器會把同一拍裡
       還沒送進主執行緒的 wheel 事件合併成一個（<code>deltaY</code> 相加），
       而<strong>合不合併取決於主執行緒忙不忙</strong>——病變版每個事件要跑 33ms，
       第二、三格很可能被併掉；治療二的主執行緒是閒的，三格可能全部交付。
       所以狀態列的「wheel N 次」<strong>四段模式之間本來就不會相等</strong>，
       它不是刺激量。刺激量是後面那兩欄：<code>wheel Δ</code>（收到的 deltaY 合計）
       與<code>已捲 Npx</code>——<strong>合併只是把 delta 加起來，不會讓它消失</strong>，
       所以這兩欄在四段模式之間必須相等。不相等就代表四段收到的輸入根本不同，
       那一輪的對照作廢，跟治療有沒有效無關。</p>

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
      <p>所以<strong>治療一刻意與病變版做一模一樣的工作</strong>：同一支 wheel handler、
         同樣一輪 ${ROW_COUNT} 次 <code>getBoundingClientRect()</code>，
         只有 <code>passive</code> 旗標不同。狀態列的
         <code>wheel 可取消 N/M</code> 是旗標有沒有生效的證據，
         但它<strong>只在一個方向上有效</strong>：<code>N &gt; 0</code> 代表這個 listener
         確定不是 passive；<code>N = 0</code> <strong>什麼都證明不了</strong>——
         可能是旗標生效了，也可能是 Chrome 把同一串手勢的後續滾輪標成不可取消
         （wheel latching），這一頁一拍連滾三格，正是會踩到的情形。
         所以判準是「病變版 N &gt; 0、治療一 N = 0」，不是「N 等於 M」。
         而掉幀數預期<strong>不會改善</strong>：本站的掉幀是用主執行緒的
         <code>requestAnimationFrame</code> 迴圈量的，passive 買到的是 compositor 側
         「不必等你就能先捲」，<strong>這把尺結構上看不見它</strong>。
         那個零不是治療失敗，那個零就是這一段的結論。</p>
    </details>

    <details>
      <summary>哪裡做 <code>requestAnimationFrame</code> 節流有用、哪裡沒用</summary>
      <ul>
        <li><strong>有用</strong>：<code>wheel</code> / <code>mousemove</code> /
            <code>resize</code> / <code>input</code> —— 這些事件一幀之內可以來好幾個，
            把計算排進 <code>requestAnimationFrame</code> 才有東西可以合併。</li>
        <li><strong>沒用</strong>：<code>scroll</code> —— 它在瀏覽器的 update-the-rendering
            步驟派送、同一個 target <strong>每幀去重</strong>，一幀最多一個。
            瀏覽器已經替你節流過了，只對它做 rAF 節流，閘門一次都不會觸發。</li>
      </ul>
      <p>這與上面那段是<strong>同一句話的兩個例子</strong>：先問「這個事件的派送規則是什麼」，
         再決定要不要加那一行。狀態列的「閘門擋下 K」數的就是被合併掉的排程次數 ——
         它若是 0，這段治療沒有進入作用區間，那時候該懷疑的是驅動方式，不是治療無效。</p>
    </details>
  `;

  dom = {
    scroller: root.querySelector<HTMLElement>('#thr-scroller')!,
    status: root.querySelector<HTMLElement>('#thr-status')!,
  };
  rows = buildRows(dom.scroller);
  applyMode();
  warnIfScrollerBelowFold();

  ctx.emit(counters());
}

/**
 * 捲動容器越過 iframe 下緣時，在容器上方插一行紅字
 *（誠實原則：限制寫在 UI 上，不寫在心裡）。
 *
 * 這條檢查存在的理由是它抓過真的東西：說明文字長到把容器推下去、容器中心 y≈666
 * 而 iframe 只有 600px 高，於是驅動器派的滾輪**打在外殼身上**，
 * 四臂的計數器全部量到 0，而畫面上看起來只是「沒有人操作」。
 * 靜默歸零是本站最怕的失敗模式，所以它必須自己喊出來。
 *
 * 不寫進 `#thr-status`：那一行每次 pass 都會被覆寫，紅色留著會染到正常訊息上。
 * 只在 mount 跑一次、只讀一次 rect —— 在量測窗之外，不影響任何數字。
 */
function warnIfScrollerBelowFold(): void {
  if (!dom) return;
  const viewportH = UNTHROTTLED_EVENTS_META.viewport.height;
  const b = dom.scroller.getBoundingClientRect();
  const centerY = b.top + b.height / 2;
  if (centerY <= viewportH) return;
  const warn = document.createElement('p');
  warn.id = 'thr-fold-warn';
  warn.style.color = 'red';
  warn.style.fontWeight = 'bold';
  warn.textContent =
    `⚠️ 捲動容器的中心落在 y=${Math.round(centerY)}px，超出凍結 viewport 的 ${viewportH}px：` +
    `機器驅動的滾輪會打到外殼、標本一個事件都收不到（計數器會全是 0）。` +
    `把說明文字搬到清單下方再量。`;
  dom.scroller.parentNode?.insertBefore(warn, dom.scroller);
}

/**
 * A 類 live 切換：只換 listener 組合，不重建列。
 * 重建 8000 列會把捲動位置一起清掉，那等於在「怎麼監聽」之外又動了「從哪裡開始捲」。
 */
function setMode(mode: string): void {
  currentMode = mode;
  resetCounters();
  applyMode();
  ctxRef?.emit(counters());
}

function reset(): void {
  resetCounters();
  // 捲回頂端：不同的起始位置會讓「可見列」與跨越邊界的列數都不同
  if (dom) {
    dom.scroller.scrollTop = 0;
    dom.status.textContent = '尚未捲動';
  }
  ctxRef?.emit(counters());
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
