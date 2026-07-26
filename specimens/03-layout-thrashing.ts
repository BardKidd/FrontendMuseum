/**
 * 標本 #3 —— 強制同步版面重排（Layout Thrashing）。
 *
 * 病變：在一個迴圈裡對 N 列交替「讀版面屬性 → 寫版面屬性」。
 * 讀 `offsetHeight` 會逼瀏覽器把還沒結算的 style 寫入立刻算成 layout，
 * 而上一圈的寫入剛好把 layout 弄髒了 —— 於是 N 圈就是 **N 次強制同步版面**。
 *
 * 治療：讀寫分離。先跑一輪把 N 個高度全部讀進預先配置好的陣列（只有第一次讀
 * 有可能觸發結算），再跑第二輪統一寫入（寫不會觸發結算）。
 * **最終 DOM 完全一樣，只有成本不一樣** —— 這件事由 `layoutChecksum` 逐次驗證。
 *
 * ⚠️ 治療版不是「讓版面計算消失」，是把它移出 script、還給瀏覽器的正常繪製步驟。
 * 那一次版面計算仍然存在，只是記在 LoAF 的 `styleAndLayoutDuration`（整幀）而不是
 * `forcedStyleAndLayoutDuration`（逐 script）。省下來的是 **N-1 次多餘的結算**，
 * 不是那一次必要的結算。面板與文章都要照這個講，否則就是在誇大治療效果。
 *
 * 兇手是 **processing** 不是 input delay（對照標本 #1）：強制重排發生在事件處理器
 * **內部**，撐大的是 processing 段。所以操作程序是「每次節拍點一下、不要連打」——
 * 連打會讓事件排隊，把 input delay 混進來，兇手段就不穩定了（§1 原則 4 第 2 條）。
 *
 * 全檔原生 DOM，不用框架，理由同標本 #1（spec §3.1）。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { LAYOUT_THRASHING_META } from '../src/specimens';

// ───────────────────────── 凍結的負載規模 ─────────────────────────

/**
 * 列數。**動工前登記在 `docs/phase1-expected-results.md` 的值是 800**，
 * 由校準標本按鈕 B 的單位成本（1x 下每次強制版面約 0.31~0.38ms）反推而來。
 *
 * 這是負載規模，不是排版偏好：改了它，先前所有數字作廢，而且必須在
 * `docs/phase1-expected-results.md` 的「修正紀錄」補一筆與理由。
 * 若某台機器上量到的病變值遠低於 200ms，**要調的是這個常數（那是校準），不是預期值**。
 */
const LIST_ITEM_COUNT = 800;

/**
 * 固定種子。理由同標本 #1：用 Math.random() 的話每次 mount 的文字長度分佈都不同，
 * 換行位置就不同，每次強制結算的工作量也不同 —— 可重現性是本站的整個論點。
 * mulberry32 與標本 #1 各留一份，**刻意不抽共用**：抽掉之後動一個標本的負載
 * 會連帶動到另一個標本的負載（spec §5.3）。
 */
const DATASET_SEED = 20240303;

/**
 * 每列的行高，寫死在標本自己注入的 style 裡。
 *
 * 這個數字有一個證明要用到它：見 `widthForRow` —— 因為行高固定，
 * 每列高度的變化量一定是 24 的倍數，寫入寬度才保證「每次點擊都真的不同」。
 * 它是量測條件的一部分，不是視覺設定。
 */
const ROW_LINE_HEIGHT = 24;

/** 寫入寬度的範圍：240 ~ 359px。窄到會逼文字重新斷行，寬到不會超出 800px 實驗區 */
const WIDTH_MIN = 240;
const WIDTH_SPAN = 120;

/**
 * 每次點擊寬度相位前進的量。**13 與 24 的關係是刻意的**，見 `widthForRow`。
 */
const PHASE_STEP = 13;

// ───────────────────────── 狀態 ─────────────────────────

interface SpecimenDom {
  status: HTMLElement;
  runButton: HTMLButtonElement;
  list: HTMLElement;
}

let ctxRef: SpecimenContext | null = null;
let listenerAbort: AbortController | null = null;
let rootRef: HTMLElement | null = null;
let dom: SpecimenDom | null = null;

let currentMode = 'broken';

/** mount 之後就固定的列參照。每次點擊都重新 querySelectorAll 的話，量到的就包含查詢成本 */
let rows: HTMLElement[] = [];

/**
 * 治療版寫入用的高度緩衝區，在 mount 就配置好。
 *
 * 每次點擊現配一個 800 格的陣列，量到的會混進配置與 GC 成本 —— 而那正是
 * 治療版唯一比病變版多做的事，混進去等於自己替治療版加碼（陷阱 #12）。
 * 病變版本來就不需要陣列，兩邊在「點擊當下」都不配置記憶體才是公平的對照。
 */
let heightBuffer: Int32Array = new Int32Array(0);

/** 寬度相位。每次點擊 +1，保證每次寫入的值都與上一次不同 —— 見 widthForRow */
let phaseCounter = 0;
let clicks = 0;

/** 目前掛在按鈕上的那支 handler。換 mode 時要拆掉舊的，所以必須留參照 */
let activeHandler: (() => void) | null = null;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ───────────────────────── 負載 ─────────────────────────

/** mulberry32 —— 32 bit 種子、無相依、十行。夠亂，而且每次跑出同一組文字 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function nextRandom(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 寫入寬度的純函式：同樣的 (h, index, phase) 一定給同樣的寬度。
 *
 * **純函式是治療版能成立的前提**：治療版是「先讀完 N 個 h，再照同樣的公式寫 N 次」，
 * 只有當寬度只相依於 h 而不相依於「寫到第幾個了」，兩個 mode 的最終 DOM 才會一模一樣。
 * `layoutChecksum` 就是在逐次驗證這件事。
 *
 * **為什麼要有 phase**：寫入的值每輪都必須不同。寫成同一個值的話瀏覽器可以判定
 * 版面沒被弄髒，下一圈的讀就不強制結算，N 次讀寫實際上只發生一次重排 ——
 * 病變版會安靜地「治好自己」，而面板上看起來只是數字比較小
 * （`00-calibration.ts:119-120` 踩過同一個坑）。
 *
 * **13 這個數字是可以證明的，不是隨便挑的**：行高固定 24px（ROW_LINE_HEIGHT），
 * 所以同一列在兩次點擊之間的高度變化 Δh 必定是 24 的倍數。
 * 兩次寫入的寬度差 = (Δh + 13) mod 120，要它等於 0 就得 24k ≡ 107 (mod 120)，
 * 而 24k mod 120 只可能是 {0, 24, 48, 72, 96} —— 不可能。
 * 也就是說：**沒有任何一列會在任何一次點擊寫入與上次相同的寬度。**
 */
function widthForRow(h: number, index: number, phase: number): number {
  return WIDTH_MIN + ((h + index * 7 + phase * PHASE_STEP) % WIDTH_SPAN);
}

/**
 * 病變版 —— 交替讀寫。
 *
 * 這支函式的名字會原樣出現在 LoAF 的 `sourceFunctionName`（vite.config.ts 的
 * keepNames 保的就是它），所以它必須**直接掛在 addEventListener 上**，不准包匿名箭頭，
 * 而且兩個 mode 掛的是不同的具名函式 —— 面板上的證據因此會自己說出兇手是哪一版。
 */
function interleavedReadWrite(): void {
  if (rows.length === 0) return;
  ctxRef?.mark(`layout-thrash:broken:${clicks + 1}`);
  const phase = ++phaseCounter;

  const t0 = performance.now();
  let checksum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // 讀 → 逼瀏覽器立刻把上一圈的寫入結算成 layout
    const h = row.offsetHeight;
    checksum += h;
    // 寫 → 把 layout 再弄髒，下一圈的讀又得重算
    row.style.width = `${widthForRow(h, i, phase)}px`;
  }
  const elapsed = performance.now() - t0;

  finishPass(elapsed, checksum);
}

/**
 * 治療版 —— 讀寫分離。
 *
 * 第一輪只讀：第一次讀有可能觸發一次結算（若前一幀留下髒版面），之後 N-1 次都是
 * 讀乾淨的 layout，不花錢。第二輪只寫：寫不觸發結算。
 *
 * ⚠️ 誠實揭露：**這一版並沒有讓版面計算消失。** 寫完之後版面是髒的，瀏覽器會在
 * 這一幀的正常繪製步驟裡算一次 —— 那一次記在 LoAF 的 `styleAndLayoutDuration`
 * （整幀，含外殼），不是 `forcedStyleAndLayoutDuration`（逐 script）。
 * 省下來的是 N-1 次多餘的結算，不是那一次必要的結算。
 *
 * 順帶一提，更根本的作法是**不要手動量**：需要知道尺寸變化用 `ResizeObserver`、
 * 需要知道是否進入視窗用 `IntersectionObserver`，兩者都在瀏覽器算完版面之後才回呼，
 * 從源頭就沒有「在 script 裡問尺寸」這件事。這裡不做成第三個 mode，是因為那會同時
 * 換掉「什麼時候算」與「誰來算」兩個變因，對照就不乾淨了（§1 原則 4）。
 */
function batchedReadThenWrite(): void {
  if (rows.length === 0) return;
  ctxRef?.mark(`layout-thrash:fixed-batched:${clicks + 1}`);
  const phase = ++phaseCounter;

  const t0 = performance.now();
  let checksum = 0;
  // 第一輪：只讀，全部收進預先配置好的緩衝區
  for (let i = 0; i < rows.length; i++) {
    const h = rows[i].offsetHeight;
    heightBuffer[i] = h;
    checksum += h;
  }
  // 第二輪：只寫。公式與病變版同一支 widthForRow，所以最終 DOM 一模一樣
  for (let i = 0; i < rows.length; i++) {
    rows[i].style.width = `${widthForRow(heightBuffer[i], i, phase)}px`;
  }
  const elapsed = performance.now() - t0;

  finishPass(elapsed, checksum);
}

/**
 * 兩個 mode 共用的收尾。
 *
 * `layoutChecksum` 是這個標本的自我驗證：從同一份幾何（reset / setMode 之後）開始，
 * 第 k 次點擊的 checksum 在兩個 mode 下**必須完全相同** ——
 * 相同就證明「治療沒有偷工，只是換了做事順序」；不同就代表兩臂做的不是同一件事，
 * 那時候比出來的比值沒有意義，要先修那個，不是修結論。
 */
function finishPass(elapsedMs: number, checksum: number): void {
  clicks += 1;
  if (dom) {
    const shape =
      currentMode === 'fixed-batched'
        ? `讀寫分離：先讀 ${rows.length} 次、再寫 ${rows.length} 次`
        : `交替讀寫：${rows.length} 次強制同步版面`;
    dom.status.textContent =
      `第 ${clicks} 次 · ${shape} · 這一趟 ${round1(elapsedMs)}ms · 高度總和 ${checksum}`;
  }
  ctxRef?.emit({
    itemCount: rows.length,
    clicks,
    lastPassMs: round1(elapsedMs),
    // 不上報「強制了幾次版面」—— 那是預測不是量測，真正的量測值是外殼從 LoAF 讀到的
    // specimenForcedStyleAndLayoutDuration。這裡只報結構事實與自報耗時。
    readsPerClick: rows.length,
    writesPerClick: rows.length,
    layoutChecksum: checksum,
  });
}

// ───────────────────────── DOM ─────────────────────────

/**
 * 一次建好 800 列。每列是「一段長度不等的文字 + 一個 badge」。
 *
 * 文字長度必須不一，而且要落在「240px 時斷三行、360px 時斷兩行」的兩側 ——
 * 這樣寫入寬度才會真的改變 offsetHeight，讀值才確實相依於上一輪的寫入
 * （理由同 `00-calibration.ts:103-107`）。文字太短、每列都只有一行的話，
 * 寫 width 仍然弄髒版面、讀仍然強制結算，但這個標本就少了「版面真的被重算」的說服力。
 */
function buildRows(list: HTMLElement): HTMLElement[] {
  const rand = mulberry32(DATASET_SEED);
  const words = ['庫存', '批次', '倉別', '料號', '入庫', '出貨', '盤點', '調撥', '驗收', '報廢'];
  const regions = ['北北基', '桃竹苗', '中彰投', '雲嘉南', '高屏', '宜花東'];
  const frag = document.createDocumentFragment();
  const out: HTMLElement[] = new Array<HTMLElement>(LIST_ITEM_COUNT);

  for (let i = 0; i < LIST_ITEM_COUNT; i++) {
    const li = document.createElement('li');
    li.className = 'lt-row';

    const label = document.createElement('span');
    label.className = 'lt-label';
    // 8 ~ 22 個詞，每詞兩字 → 16 ~ 44 個中文字，橫跨兩行與三行的分界
    const wordCount = 8 + ((rand() * 15) | 0);
    let text = `${String(i).padStart(4, '0')} `;
    for (let w = 0; w < wordCount; w++) text += words[(rand() * words.length) | 0];
    label.textContent = text;

    const badge = document.createElement('span');
    badge.className = 'lt-badge';
    badge.textContent = regions[(rand() * regions.length) | 0];

    li.append(label, badge);
    frag.appendChild(li);
    out[i] = li;
  }

  list.replaceChildren(frag);
  return out;
}

/**
 * 把 handler 換成當前 mode 的那一支。
 *
 * 不是為了省事才這樣寫：LoAF 的 `sourceFunctionName` 取的是這次 script 執行的**進入點**
 * 函式名。掛同一支 dispatcher 再在裡面 switch 的話，兩個 mode 拿到的函式名一模一樣，
 * 而這個標本最珍貴的證據正是「面板直接指出是哪一支函式在強制重排」。
 *
 * 換 listener 不算「重建 DOM」—— 節點沒有被建立或銷毀，捲動位置與使用者狀態都還在，
 * A 類 live 切換的約束仍然滿足。
 */
function bindHandler(): void {
  if (!dom || !listenerAbort) return;
  if (activeHandler) dom.runButton.removeEventListener('click', activeHandler);
  activeHandler = currentMode === 'fixed-batched' ? batchedReadThenWrite : interleavedReadWrite;
  dom.runButton.addEventListener('click', activeHandler, { signal: listenerAbort.signal });
}

/**
 * 把所有列的行內寬度清掉，回到「全部等寬」的初始幾何。
 *
 * reset 與 setMode 都要做。setMode 也做的理由是 `layoutChecksum` 的比對前提：
 * 兩個 mode 必須從**同一份幾何**開始，第 k 次點擊的 checksum 才能逐次對照。
 * 殘留上一個 mode 寫進去的寬度，第一次點擊讀到的高度就已經不同了。
 */
function clearRowWidths(): void {
  for (const row of rows) row.style.removeProperty('width');
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  listenerAbort = new AbortController();

  root.innerHTML = `
    <style>
      /*
        ⚠️ 這段是量測條件，不是裝飾（Phase 0 允許的 style 例外，同標本 #1）。
        行高、字級、內距決定了文字在哪個寬度換行，也就決定了每次強制結算的工作量。
        改這裡等於改負載規模，先前數字作廢 —— 要改請一併更新
        docs/phase1-expected-results.md 的修正紀錄。
      */
      #lt-list { margin: 0; padding: 0; list-style: none; }
      .lt-row {
        font-size: 16px;
        line-height: ${ROW_LINE_HEIGHT}px;
        padding: 4px 0;
        border-bottom: 1px solid #ddd;
      }
      .lt-badge { margin-left: 8px; }
    </style>

    <h1>標本 #3 —— 強制同步版面重排</h1>
    <p>下面是一份 ${LIST_ITEM_COUNT} 列的清單。每次點「更新列表」都會走訪全部 ${LIST_ITEM_COUNT} 列，
       各讀一次 <code>offsetHeight</code>、各寫一次 <code>width</code>。
       兩個 mode 做的事完全一樣、最終畫面也一樣，<strong>只有讀與寫的順序不同</strong>。</p>
    <p>請照操作程序：每次節拍亮起時點一下，共十次，<strong>不要連打</strong>。</p>

    <p><button id="lt-run-btn" type="button">更新列表</button></p>
    <p id="lt-status">尚未執行</p>

    <details>
      <summary>讀到就會強制瀏覽器立刻結算版面的屬性（不完整清單）</summary>
      <ul>
        <li><code>offsetTop</code> / <code>offsetLeft</code> / <code>offsetWidth</code> / <code>offsetHeight</code></li>
        <li><code>clientTop</code> / <code>clientLeft</code> / <code>clientWidth</code> / <code>clientHeight</code></li>
        <li><code>scrollTop</code> / <code>scrollLeft</code> / <code>scrollWidth</code> / <code>scrollHeight</code></li>
        <li><code>getBoundingClientRect()</code> / <code>getClientRects()</code></li>
        <li><code>getComputedStyle()</code>（讀到版面相關屬性時）</li>
        <li><code>innerText</code>（要知道哪些文字被排出去了）</li>
        <li><code>window.scrollY</code> / <code>window.getComputedStyle()</code></li>
      </ul>
      <p>共通點：<strong>它們的值只有在版面算完之後才知道。</strong>
         在還有未結算的寫入時讀它們，瀏覽器只能當場把版面算完再回答。</p>
    </details>

    <ul id="lt-list"></ul>
  `;

  dom = {
    status: root.querySelector<HTMLElement>('#lt-status')!,
    runButton: root.querySelector<HTMLButtonElement>('#lt-run-btn')!,
    list: root.querySelector<HTMLElement>('#lt-list')!,
  };

  // 只在 mount 產生一次。每次點擊重建列表的話，量到的會包含建構成本，
  // 而且「同一份清單被更新十次」這個凍結條件也沒了。
  rows = buildRows(dom.list);
  heightBuffer = new Int32Array(rows.length);
  bindHandler();

  // 一顆都還沒按之前，面板就該看得到這一輪的條件 —— 條件先於數字出現
  ctx.emit({
    itemCount: rows.length,
    clicks,
    readsPerClick: rows.length,
    writesPerClick: rows.length,
  });
}

/**
 * A 類 live 切換：換掉 handler、回到同一份初始幾何，**不重建任何節點**。
 * 重建清單會重跑一次 800 列的建構，那是另一個變因，而且捲動位置也會被清掉。
 */
function setMode(mode: string): void {
  currentMode = mode;
  bindHandler();
  // 相位與次數都是「本 mode 內」的計數，跨 mode 累加會讀成別的意思
  phaseCounter = 0;
  clicks = 0;
  clearRowWidths();
  if (dom) dom.status.textContent = `已切換到 ${mode}，尚未執行`;
  ctxRef?.emit({
    itemCount: rows.length,
    clicks,
    readsPerClick: rows.length,
    writesPerClick: rows.length,
  });
}

function reset(): void {
  phaseCounter = 0;
  clicks = 0;
  clearRowWidths();
  if (dom) dom.status.textContent = '尚未執行';
  ctxRef?.emit({
    itemCount: rows.length,
    clicks,
    readsPerClick: rows.length,
    writesPerClick: rows.length,
  });
}

/**
 * 驗收第 12 條：切走標本後靜置五秒，不得出現任何 origin === 'specimen' 的 LoAF entry。
 * 這一頁沒有 timer、沒有 rAF、沒有 worker、沒有 observer，
 * 所以拆掉 listener 與 DOM 就真的乾淨了 —— 但 rows 持有 800 個節點參照，
 * 不清掉的話那 800 個節點會跟著這支模組一起活到分頁關閉。
 */
function destroy(): void {
  listenerAbort?.abort();
  listenerAbort = null;
  activeHandler = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  dom = null;
  ctxRef = null;
  rows = [];
  heightBuffer = new Int32Array(0);
}

const mod: SpecimenModule = {
  meta: LAYOUT_THRASHING_META,
  mount,
  setMode,
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
