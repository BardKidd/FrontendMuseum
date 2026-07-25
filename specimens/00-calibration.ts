/**
 * 校準標本 —— Phase 0 的驗收工具，不是六個標本之一（spec §5.5）。
 *
 * 存在的理由只有一個：**驗收條件必須可否證**。
 * 「拿一個爛頁面塞進去看數字合不合理」抓得到「面板全空」「量級離譜」，
 * 但抓不到「分組錯了、數字卻看起來很合理」—— 而那才是真正會殺死這個專案的失敗。
 * 這一頁的每個負載都有解析解可以反推，所以量測層錯了會被當場抓到。
 *
 * Phase 0 只做按鈕 A 與 B；C（CLS）與 D（LCP）等到那兩個指標真的實作了再說。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { CALIBRATION_META } from '../src/specimens';

/**
 * 按鈕 B 的預設讀寫次數。
 * 之所以做成可調，是因為驗收第 7 條要的不是「forcedStyleAndLayout > 0」這種
 * 隨便都會過的條件，而是「隨 M 線性成長」—— 那需要至少兩個 M 才驗得起來。
 */
const DEFAULT_LAYOUT_ITERATIONS = 200;

/**
 * 版面標的裡塞幾個子元素。**這個數字是量出來的，不是猜的。**
 *
 * 驗收第 7 條要 M=200 時 specimenForcedStyleAndLayoutDuration > 50ms，
 * 而 LoAF 只回報 ≥ 50ms 的幀 —— 負載不夠大的話拿到的不是「數字很小」，
 * 是**根本沒有 entry**，這條驗收會因為負載太小而掛掉，跟量測層對不對無關。
 * 實測（Chromium 150 headless，800×600，未節流，M=200）：
 *   子元素 0 個 → 2.3ms（完全不會產生 LoAF entry，第 7 條必掛）
 *   子元素 300 個 → 47~60ms（貼著門檻，不夠安全）
 *   子元素 600 個 → 67~92ms（1x 就過關；4x 節流下還有數倍餘裕）
 * 絕對值本來就跟機器與繪製路徑有關（同一份程式在不同 headless 設定下差了 30 倍），
 * 所以 M 做成可調的：某台機器如果 M=200 量不到 50ms，把 M 調大再看線性關係，
 * 那才是按鈕 B 真正要驗的東西。
 */
const LAYOUT_TARGET_CHILDREN = 600;

/** mount 之後就固定的 DOM 參照。setMode 只改這裡面的文字，不重建任何節點 */
interface CalibrationDom {
  busyMsLabel: HTMLElement;
  busyOutput: HTMLElement;
  layoutInput: HTMLInputElement;
  layoutOutput: HTMLElement;
  layoutTarget: HTMLElement;
}

let ctxRef: SpecimenContext | null = null;
let listenerAbort: AbortController | null = null;
let rootRef: HTMLElement | null = null;
let dom: CalibrationDom | null = null;

let busyMs = 300;
let layoutIterations = DEFAULT_LAYOUT_ITERATIONS;

/** 面板讀起來要像數字不像雜訊；四捨五入到 0.1ms 不會翻轉任何一條驗收結論 */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * 直接對應 CALIBRATION_META.modes 的 id。
 * 不從字串 parseInt —— 校準件的數字必須一眼看得到，藏在解析邏輯裡就等於沒被校準。
 */
function busyMsForMode(mode: string): number {
  return mode === 'busy-30' ? 30 : 300;
}

/**
 * 按鈕 A —— 忙迴圈。
 *
 * ⚠️ 這個函式**必須直接掛在 addEventListener 上**，不准包一層匿名箭頭：
 * LoAF 的 sourceFunctionName 取的是這次 script 執行的進入點函式名，
 * 包一層之後拿到的是空字串，驗收第 7 條要的「可讀函式名」就沒了。
 * vite.config.ts 的 keepNames 保住的也是這個名字，兩邊是同一件事的兩半。
 */
function calibrationBusyLoop(): void {
  const target = busyMs;
  ctxRef?.mark(`calibration:busy-${target}`);

  const t0 = performance.now();
  // ✅ wall clock：換一台機器仍然是 N 毫秒。
  // ❌ 迭代次數（for (let i = 0; i < 50000; i++) {}）：換機器結果就不同，
  //    校準件自己就沒有被校準，那整個驗收程序都失去意義（spec §5.5）。
  while (performance.now() - t0 < target) {
    /* 空轉 */
  }
  const elapsed = performance.now() - t0;

  if (dom) {
    dom.busyOutput.textContent = `目標 ${target}ms · 實測 ${round1(elapsed)}ms`;
  }
  // 同時上報「設定值」與「實測值」：兩者對不上代表是這支迴圈自己跑過頭，
  // 對得上但面板的 processing 對不上，才輪得到量測層背鍋。分開才有得歸因。
  ctxRef?.emit({ busyLoopMs: target, lastBusyElapsedMs: round1(elapsed) });
}

/**
 * 按鈕 B —— 強制同步版面重排（forced synchronous layout）。
 *
 * 讀 offsetHeight 會逼瀏覽器把上一輪的 style 寫入立刻結算成 layout，
 * 所以「讀→寫→讀→寫」M 次 = M 次強制同步版面。
 * 名字同樣要活著進 build，理由見 calibrationBusyLoop。
 *
 * ⚠️ 寫的是 width 不是 height，而且標的裡面塞了一整段文字 —— 這不是裝飾。
 * 只改 height 的話，這一頁 DOM 太乾淨，每次強制結算都便宜到接近 0，
 * 驗收第 7 條的「> 50ms」會因為負載太小而掛掉，而不是因為量測層有問題。
 * 改 width 會逼裡面的文字重新斷行，每一輪都是貨真價實的版面計算；
 * 而且 offsetHeight 真的會隨 width 改變 —— 讀值確實相依於上一輪的寫入。
 */
function calibrationForcedLayout(): void {
  if (!dom) return;
  const target = dom.layoutTarget;
  const m = layoutIterations;
  ctxRef?.mark(`calibration:forced-layout-${m}`);

  const t0 = performance.now();
  let readSum = 0;
  for (let i = 0; i < m; i++) {
    readSum += target.offsetHeight;
    // 寫入的值每輪都要不同：寫成同一個值瀏覽器可以判定沒變、不弄髒 layout，
    // 下一輪的讀就不會強制結算，M 次讀寫實際只發生一次重排。
    target.style.width = `${280 + (i % 40) * 6}px`;
  }
  const elapsed = performance.now() - t0;

  // readSum 一定要被用掉。丟著不用，引擎有權把整段讀取視為無副作用而優化掉。
  dom.layoutOutput.textContent =
    `M=${m} · 實測 ${round1(elapsed)}ms · offsetHeight 累計 ${readSum}`;
  ctxRef?.emit({ layoutIterations: m, lastForcedLayoutMs: round1(elapsed) });
}

/**
 * 在 mount 時一次建好版面標的的內容。
 * 每個子元素都是一個要參與斷行的 inline box，數量就是單次強制版面的成本 ——
 * 見 LAYOUT_TARGET_CHILDREN 的實測數字。字串內容本身無所謂，長度均勻就好。
 */
function buildLayoutTarget(target: HTMLElement): void {
  const words = ['訂單', '區域', '金額', '優先', '建立', '客戶', '彙總', '排序', '標本', '量測'];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < LAYOUT_TARGET_CHILDREN; i++) {
    const span = document.createElement('span');
    span.textContent = `${words[i % words.length]}${i} `;
    frag.appendChild(span);
  }
  target.replaceChildren(frag);
}

/** 輸入框改變只更新數字，不重跑 —— 什麼時候製造負載必須由操作者決定 */
function readLayoutIterations(): void {
  if (!dom) return;
  const parsed = Number.parseInt(dom.layoutInput.value, 10);
  layoutIterations = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LAYOUT_ITERATIONS;
  ctxRef?.emit({ layoutIterations });
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  busyMs = busyMsForMode(ctx.mode);
  layoutIterations = DEFAULT_LAYOUT_ITERATIONS;
  listenerAbort = new AbortController();
  const { signal } = listenerAbort;

  root.innerHTML = `
    <h1>校準標本</h1>
    <p>每個負載都有解析解可以反推 —— 這一頁是用來證明量測層本身是對的。</p>

    <section>
      <h2>按鈕 A —— 忙迴圈（wall clock）</h2>
      <button id="cal-busy-btn" type="button">忙迴圈 <span id="cal-busy-ms">300</span> ms</button>
      <p>預期 inp.processing ≈ 按鈕上的毫秒數 ±10%（驗收第 2 條）；
         LoAF 的 sourceFunctionName 應為 calibrationBusyLoop。</p>
      <pre id="cal-busy-out">尚未執行</pre>
    </section>

    <section>
      <h2>按鈕 B —— 強制同步版面重排</h2>
      <label>讀寫交替次數 M
        <input id="cal-layout-m" type="number" min="1" step="50" value="${DEFAULT_LAYOUT_ITERATIONS}">
      </label>
      <button id="cal-layout-btn" type="button">強制 layout M 次</button>
      <p>預期 loaf.forcedStyleAndLayout &gt; 0 且隨 M 線性成長（驗收第 7 條）；
         sourceFunctionName 應為 calibrationForcedLayout。</p>
      <pre id="cal-layout-out">尚未執行</pre>
      <p>下面這塊是量測標的，內容由程式產生 —— 它的節點數是負載大小，不是排版，不要為了好看去動它。</p>
      <div id="cal-layout-target"></div>
    </section>
  `;

  const busyButton = root.querySelector<HTMLButtonElement>('#cal-busy-btn')!;
  const layoutButton = root.querySelector<HTMLButtonElement>('#cal-layout-btn')!;
  dom = {
    busyMsLabel: root.querySelector<HTMLElement>('#cal-busy-ms')!,
    busyOutput: root.querySelector<HTMLElement>('#cal-busy-out')!,
    layoutInput: root.querySelector<HTMLInputElement>('#cal-layout-m')!,
    layoutOutput: root.querySelector<HTMLElement>('#cal-layout-out')!,
    layoutTarget: root.querySelector<HTMLElement>('#cal-layout-target')!,
  };
  dom.busyMsLabel.textContent = String(busyMs);
  buildLayoutTarget(dom.layoutTarget);

  busyButton.addEventListener('click', calibrationBusyLoop, { signal });
  layoutButton.addEventListener('click', calibrationForcedLayout, { signal });
  dom.layoutInput.addEventListener('input', readLayoutIterations, { signal });

  // 一顆都還沒按之前，面板就該看得到這一輪的設定值 —— 條件先於數字出現
  ctx.emit({ busyLoopMs: busyMs, layoutIterations });
}

/**
 * A 類的 live 切換：只換忙迴圈的毫秒數。
 * 不重建 DOM 是硬性要求 —— 重建等於換掉了受測元素，
 * 那 300ms 與 30ms 之間就不只差了「忙迴圈時間」這一個變因。
 */
function setMode(mode: string): void {
  busyMs = busyMsForMode(mode);
  if (dom) dom.busyMsLabel.textContent = String(busyMs);
  ctxRef?.emit({ busyLoopMs: busyMs, layoutIterations });
}

function reset(): void {
  if (!dom) return;
  layoutIterations = DEFAULT_LAYOUT_ITERATIONS;
  dom.layoutInput.value = String(DEFAULT_LAYOUT_ITERATIONS);
  dom.busyOutput.textContent = '尚未執行';
  dom.layoutOutput.textContent = '尚未執行';
  // 寬度是上一輪寫進去的殘留物，不清掉就不是「初始狀態」
  dom.layoutTarget.style.removeProperty('width');
  ctxRef?.emit({ busyLoopMs: busyMs, layoutIterations });
}

/**
 * 驗收第 12 條：切走之後靜置五秒，不得再出現 origin === 'specimen' 的 LoAF entry。
 * 這一頁沒有 timer、沒有 rAF、沒有 worker，所以拆掉 listener 與 DOM 就真的乾淨了。
 */
function destroy(): void {
  listenerAbort?.abort();
  listenerAbort = null;
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  dom = null;
  ctxRef = null;
}

const mod: SpecimenModule = {
  meta: CALIBRATION_META,
  mount,
  setMode,
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);
