/**
 * 標本 #2 —— 長列表未虛擬化。
 *
 * 病變：一次把 5000 筆裝置狀態全部渲染成 DOM。初次渲染把 LCP 拖垮，捲動掉幀。
 *
 * **B 類標本：切 mode 一律重載整個 iframe。**
 * 理由不是實作偷懶 —— LCP 在第一次互動後就定案、而且是 per-document 的，
 * 不重載的話第二個 mode 永遠拿不到自己的 LCP（spec §3.4）。
 * 所以這個模組**不實作 `setMode()`**：外殼看到 `switchKind === 'reload'` 就走重載路徑。
 *
 * 兩段治療差在一件關鍵的事上，`custom.domNodeCount` 會把它講得比毫秒數更清楚：
 *   - `content-visibility: auto`：5000 個節點**還在 DOM 裡**，只是跳過渲染
 *   - 虛擬滾動：那些節點**根本沒有被建出來**
 *
 * ⚠️ **「頭像」刻意不用圖片。** 校準 D 實測出 Chrome 會把每像素位元數低於 0.05 bpp
 * 的圖片排除在 LCP candidate 之外（擋純色佔位圖用的）。5000 個純色頭像不但拖慢載入，
 * 還完全不會成為 LCP —— 於是「LCP 被長列表拖累」這個主張會量不到。
 * 這裡改用 CSS 上色的字母方塊，LCP 標的自然落在第一屏的文字上。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { LONG_LIST_META } from '../src/specimens';

/** 列數。照 spec 原文 5000 */
const ITEM_COUNT = 5000;
/**
 * 每列高度。**這個數字同時是 `contain-intrinsic-size` 的猜測值**，
 * 兩者必須一致，否則捲軸長度會在列真正渲染出來時抽動 —— 那就是自己製造 CLS。
 */
const ROW_HEIGHT = 120;
/** 虛擬滾動的緩衝列數（上下各留幾列）。太小會在快速捲動時看到空白 */
const VIRTUAL_BUFFER = 5;
const DATASET_SEED = 20240202;

interface Item {
  id: string;
  initials: string;
  hue: number;
  name: string;
  location: string;
  note: string;
  state: string;
  tier: string;
}

const STATES = ['運轉中', '待機', '維修', '離線'];
const TIERS = ['A 級', 'B 級', 'C 級'];
const NAMES = ['冷凍櫃', '空壓機', '輸送帶', '烘箱', '幫浦', '風機', '鍋爐', '冰水主機'];
const SITES = ['北北基', '桃竹苗', '中彰投', '雲嘉南', '高屏', '宜花東'];

let ctxRef: SpecimenContext | null = null;
let rootRef: HTMLElement | null = null;
let currentMode = 'broken';

let items: Item[] = [];
let listEl: HTMLElement | null = null;
let spacerEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let listenerAbort: AbortController | null = null;

/** 虛擬滾動用：目前渲染的區間，避免同一區間重複渲染 */
let renderedFrom = -1;
let renderedTo = -1;
let rafId = 0;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function nextRandom(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildItems(): Item[] {
  const rand = mulberry32(DATASET_SEED);
  const out: Item[] = new Array<Item>(ITEM_COUNT);
  for (let i = 0; i < ITEM_COUNT; i++) {
    const name = NAMES[(rand() * NAMES.length) | 0];
    out[i] = {
      id: `DEV-${String(i).padStart(4, '0')}`,
      initials: name.slice(0, 2),
      hue: (rand() * 360) | 0,
      name,
      location: `${SITES[(rand() * SITES.length) | 0]} 第 ${1 + ((rand() * 9) | 0)} 廠`,
      note: `最近保養 ${1 + ((rand() * 28) | 0)} 日前 · 累計運轉 ${(rand() * 9999).toFixed(0)} 小時`,
      state: STATES[(rand() * STATES.length) | 0],
      tier: TIERS[(rand() * TIERS.length) | 0],
    };
  }
  return out;
}

/**
 * 一列 = 7 個節點（li + 方塊 + 三行文字 + 兩個 badge）。
 * 5000 列就是 35,000 個節點 —— 這個數字本身就是病變，`domNodeCount` 會把它報出來。
 */
function buildRow(item: Item, index: number): HTMLElement {
  const li = document.createElement('li');
  li.className = 'll-row';
  li.style.top = `${index * ROW_HEIGHT}px`;

  const avatar = document.createElement('div');
  avatar.className = 'll-avatar';
  // CSS 上色的字母方塊，不是圖片 —— 理由見檔頭
  avatar.style.background = `hsl(${item.hue} 45% 82%)`;
  avatar.textContent = item.initials;

  const title = document.createElement('div');
  title.className = 'll-title';
  title.textContent = `${item.id} ${item.name}`;

  const sub = document.createElement('div');
  sub.textContent = item.location;

  const note = document.createElement('div');
  note.className = 'll-note';
  note.textContent = item.note;

  const badges = document.createElement('div');
  const state = document.createElement('span');
  state.className = 'll-badge';
  state.textContent = item.state;
  const tier = document.createElement('span');
  tier.className = 'll-badge';
  tier.textContent = item.tier;
  badges.append(state, tier);

  li.append(avatar, title, sub, note, badges);
  return li;
}

// ───────────────────────── 三種渲染策略 ─────────────────────────

/**
 * 病變版與治療一共用這一支 —— **兩者的 DOM 完全一樣，差別只有一個 CSS class**。
 *
 * 這是本標本最重要的對照設計：`content-visibility` 的整個賣點就是
 * 「一行 CSS，不改任何結構」。實作上多做一步都會讓那個主張變得不誠實。
 */
function renderEverything(): void {
  if (!listEl) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < items.length; i++) frag.appendChild(buildRow(items[i], i));
  listEl.replaceChildren(frag);
  reportCounts(items.length);
}

/**
 * 治療二：真虛擬滾動。只渲染可視範圍 ± buffer。
 *
 * ⚠️ 誠實揭露：**虛擬滾動自己也要成本** —— 它必須掛一個 scroll listener、
 * 每次捲動算一次區間、還要維護一個撐開捲軸的 spacer。
 * 它贏在「節點數」而不是「零成本」，而且它換來了真實的複雜度：
 * 頁內搜尋（Ctrl+F）找不到沒渲染的列、無障礙樹不完整、錨點連結會失效。
 * `content-visibility` 沒有這些問題 —— 這就是為什麼兩段治療之間不排名（§4.3）。
 */
function renderWindow(): void {
  if (!listEl) return;
  const scrollTop = window.scrollY;
  const viewportHeight = document.documentElement.clientHeight;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_BUFFER);
  const last = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + VIRTUAL_BUFFER,
  );
  // 區間沒變就什麼都不做。少了這一行，每個 scroll 事件都會重建一次視窗內的列 ——
  // 那就變成標本 #6 的病（高頻重建），量到的不再是「虛擬滾動 vs 全渲染」
  if (first === renderedFrom && last === renderedTo) return;
  renderedFrom = first;
  renderedTo = last;

  const frag = document.createDocumentFragment();
  for (let i = first; i < last; i++) frag.appendChild(buildRow(items[i], i));
  listEl.replaceChildren(frag);
  reportCounts(last - first);
}

function onScrollForVirtual(): void {
  if (rafId !== 0) return;
  // 捲動處理走 rAF —— 理由與標本 #4 的治療二相同：每幀最多算一次，不是每個事件算一次
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    renderWindow();
  });
}

function reportCounts(rendered: number): void {
  // querySelectorAll('*') 掃整份文件。放在渲染後做一次，不放進任何迴圈 ——
  // 量測動作自己變成負載是陷阱 #12。
  const nodes = document.querySelectorAll('*').length;
  if (statusEl) {
    statusEl.textContent =
      `mode ${currentMode} · 資料 ${items.length} 筆 · 實際渲染 ${rendered} 列 · ` +
      `文件節點總數 ${nodes}`;
  }
  ctxRef?.emit({
    itemCount: items.length,
    renderedItems: rendered,
    domNodeCount: nodes,
    rowHeightPx: ROW_HEIGHT,
  });
}

// ───────────────────────── 生命週期 ─────────────────────────

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  listenerAbort = new AbortController();

  const virtual = currentMode === 'fixed-virtual';
  const contentVisibility = currentMode === 'fixed-content-visibility';

  root.innerHTML = `
    <style>
      /*
        ⚠️ 量測條件。列高同時是 contain-intrinsic-size 的猜測值與虛擬滾動的算式基礎，
        三個地方必須是同一個數字，否則捲軸長度會抽動（= 自己製造 CLS）。
      */
      #ll-list { margin: 0; padding: 0; list-style: none; position: relative; }
      .ll-row {
        position: absolute;
        left: 0;
        right: 0;
        height: ${ROW_HEIGHT}px;
        box-sizing: border-box;
        padding: 8px 12px;
        border-bottom: 1px solid #eee;
        font-size: 13px;
      }
      .ll-avatar {
        float: left; width: 40px; height: 40px; margin-right: 10px;
        line-height: 40px; text-align: center; border-radius: 4px;
      }
      .ll-title { font-weight: bold; }
      .ll-note { color: #666; }
      .ll-badge { display: inline-block; margin-right: 6px; padding: 0 6px; background: #eef1f5; }

      /*
        治療一 —— 就是這兩行。
        contain-intrinsic-size 的 auto 關鍵字讓瀏覽器**記住上次實際量到的尺寸**，
        比寫死一個猜測值準得多；後面的 120px 只是第一次的初值。
        少了 contain-intrinsic-size，跳過渲染的列高度會被當成 0，
        捲軸長度會隨捲動不斷抽動 —— 那不是省下渲染，那是把渲染成本換成 CLS。
      */
      .ll-cv .ll-row {
        content-visibility: auto;
        contain-intrinsic-size: auto ${ROW_HEIGHT}px;
      }
    </style>

    <h1>標本 #2 —— 長列表未虛擬化</h1>
    <p>${ITEM_COUNT} 筆裝置狀態。病變版一次全部渲染成 DOM（約 ${ITEM_COUNT * 7} 個節點）。</p>
    <p><strong>載入後請先不要動</strong>，等面板出現 LCP 之後再開始捲動 ——
       LCP 在第一次互動（點擊、按鍵、<strong>捲動也算</strong>）之後就定案，
       提早捲動會讓這個標本的主指標量不到。</p>
    <p id="ll-status">渲染中…</p>
    <ul id="ll-list" class="${contentVisibility ? 'll-cv' : ''}"></ul>
    <div id="ll-spacer"></div>
  `;

  listEl = root.querySelector<HTMLElement>('#ll-list')!;
  spacerEl = root.querySelector<HTMLElement>('#ll-spacer')!;
  statusEl = root.querySelector<HTMLElement>('#ll-status')!;

  items = buildItems();
  // 列是絕對定位的，所以捲軸長度必須由 spacer 撐出來。
  // 三個 mode 都用同一個高度 —— 捲動距離是凍結變因，不能因為 mode 不同而不同。
  spacerEl.style.height = `${items.length * ROW_HEIGHT}px`;

  if (virtual) {
    renderWindow();
    // 捲動監聽掛在 window 上是這裡的正解（捲動發生在文件層級），
    // 與標本 #4 刻意掛在容器上是兩件不同的事：那邊要避開 Chrome 對 window 的
    // 預設 passive，這裡沒有 wheel listener，不受那條規則影響。
    window.addEventListener('scroll', onScrollForVirtual, {
      signal: listenerAbort.signal,
      passive: true,
    });
  } else {
    renderEverything();
  }
}

/**
 * B 類不實作 `setMode()` —— 外殼會重載整個 iframe。
 * 這裡留一個 `reset()` 讓「重跑」不必重載：資料與 DOM 回到初始狀態就好。
 * ⚠️ 但 LCP **不會**因此重新產生（它是 document 級、且已定案），
 * 所以要拿新的 LCP 只能真的重載。
 */
function reset(): void {
  window.scrollTo(0, 0);
  renderedFrom = -1;
  renderedTo = -1;
  items = buildItems();
  if (currentMode === 'fixed-virtual') renderWindow();
  else renderEverything();
}

function destroy(): void {
  if (rafId !== 0) cancelAnimationFrame(rafId);
  rafId = 0;
  listenerAbort?.abort();
  listenerAbort = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  listEl = null;
  spacerEl = null;
  statusEl = null;
  ctxRef = null;
  items = [];
}

const mod: SpecimenModule = {
  meta: LONG_LIST_META,
  mount,
  // 刻意沒有 setMode：B 類靠重載切換（spec §3.4）
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
