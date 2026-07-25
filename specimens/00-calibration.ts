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

// ───────────────────────── 按鈕 C（CLS）的解析解參數 ─────────────────────────

/**
 * 位移標的的高度與位移距離。兩者都進解析解，改了要一起改預期。
 *
 * ⚠️ **這一組刻意全部是 in-flow 元素，一個 `position: fixed` 都沒有。**
 * 第一版把位移標的與 LCP 標的都做成 fixed 覆蓋層（理由是「幾何確定、不推動文件流」），
 * 結果**把按鈕 B 的校準毀了**：同一顆瀏覽器、同一支探針，
 * 原始頁面 200 次強制版面是 **64.8ms**，加了兩個 fixed 元素之後變成 **1967ms —— 30 倍**。
 * 原因是 LayoutView 底下一旦有 out-of-flow fixed 盒子，Blink 就不能把
 * 「只有標的的寬度變髒」localize 成一個小的 layout root，每次強制結算都變成整份文件重排。
 *
 * 也就是說：**校準件的一個角落改壞了，另一個角落的解析解就跟著失真。**
 * 錨點 B 是標本 #3 的 N=800 的推導基礎，這種污染會一路傳到標本的設計參數上。
 */
const SHIFT_TARGET_HEIGHT = 60;
const SHIFT_DISTANCE = 30;
/**
 * 位移舞台的高度。**必須 ≥ 標的高度 + 位移距離**（60 + 30 = 90），
 * 這樣標的往下移的時候舞台自己不會被撐高，舞台以外的東西就一動也不動。
 * 刻意不用 `overflow: hidden` 去硬切：被裁掉的部分不算 impact，
 * 那會讓解析解多一個要考慮的邊界條件。留 10px 餘裕比裁切乾淨。
 */
const SHIFT_STAGE_HEIGHT = 100;

/**
 * 點下按鈕到位移真的發生之間的延遲。**800ms 不是隨手填的，它是這顆按鈕能運作的前提。**
 *
 * 使用者互動後 500ms 內發生的位移會被瀏覽器標上 `hadRecentInput`，**依規格不算 CLS**。
 * 所以「點按鈕 → 立刻位移」這種直覺寫法量到的永遠是 0，而且面板看起來一切正常。
 * 延遲必須大於 500ms 的豁免窗，同時最好小於 1000ms 的 session gap 以外 ——
 * 這裡取 800ms：豁免窗已過，而連點兩次的間隔通常大於 1000ms，兩次位移會落進不同 session。
 * 這正是標本 #5 動工前必須先懂的那件事（spec §4.5）。
 */
const SHIFT_DELAY_MS = 800;

// ───────────────────────── 按鈕 D（LCP）的解析解參數 ─────────────────────────

/**
 * LCP 標的出現的時間。預期 LCP ≈ 這個數字（加上一幀的繪製時間）。
 *
 * ⚠️ **D 刻意不是按鈕。** LCP 在第一次使用者互動（點擊／按鍵／捲動）之後就定案，
 * 瀏覽器不再派送新的 candidate —— 做成按鈕的話，按下去的那一刻 LCP 已經凍結了，
 * 這個校準永遠量不到東西。所以它只能是「載入後自動發生」，
 * 而且**校準 D 必須在碰任何按鈕之前讀**。這條限制本身就是 B 類標本要教的東西。
 */
const LCP_TARGET_DELAY_MS = 1500;
/**
 * 標的高度。要比頁面上任何既有的文字區塊都大，否則它不會成為 LCP candidate。
 * 位置槽在 mount 就以 in-flow 方式佔好這個高度 —— 標的出現時不推動任何東西，
 * 校準 D 因此不會污染校準 C（也不必動用 fixed，理由見 SHIFT_TARGET_HEIGHT 上方）。
 */
const LCP_TARGET_HEIGHT = 150;

/*
 * ⚠️ **標的是文字不是圖片，這是實測改出來的，不是偏好。**
 *
 * 第一版用 760×300 的 SVG data URI，結果 LCP 選到頁首的一個 <p>（128ms），
 * 那張圖從頭到尾沒有成為 candidate。原因是 Chrome 的**低熵圖片排除規則**：
 * 每像素位元數低於 0.05 bpp 的圖片一律不列入 LCP —— 那是為了擋掉純色佔位圖。
 * 一張約 200 bytes 的 SVG 攤在 228,000 px 上約 0.007 bpp，遠低於門檻。
 *
 * 這正是校準件存在的理由：這種錯不會有任何錯誤訊息，面板上只會安靜地
 * 顯示一個「看起來也還算合理」的 LCP 值（128ms），而它量的根本不是我以為的東西。
 * 換成文字標的沒有熵的問題；真要用圖片，標本 #2／加碼 #7 得自架一張真的照片。
 */
/*
 * ⚠️ **文字要長到能滿版換行，這也是量出來的。**
 *
 * 第二版只寫「LCP 校準標的」六個字，結果 LCP 還是選了頁面下方一個 `<p>`。
 * 原因是 **LCP 對文字算的是文字本身的 bounding box，不是容器的**：
 * 六個 44px 的字大約 264×60 ≈ 15,800 px²，而一個滿版換行的段落是 769×48 ≈ 36,900 px² ——
 * 容器再大也沒用，沒被字蓋住的部分不算面積。
 * 加長到能換兩行之後是 769×120 ≈ 92,000 px²，才穩定贏過頁面上其他文字。
 */
const LCP_TARGET_TEXT = 'LCP 校準標的：載入後定時出現的大面積文字區塊';

/** mount 之後就固定的 DOM 參照。setMode 只改這裡面的文字，不重建任何節點 */
interface CalibrationDom {
  busyMsLabel: HTMLElement;
  busyOutput: HTMLElement;
  layoutInput: HTMLInputElement;
  layoutOutput: HTMLElement;
  layoutTarget: HTMLElement;
  /** 位移舞台裡的推擠塊。高度 0 → SHIFT_DISTANCE 就是位移的來源 */
  shiftSpacer: HTMLElement;
  shiftTarget: HTMLElement;
  shiftOutput: HTMLElement;
  lcpSlot: HTMLElement;
  lcpOutput: HTMLElement;
}

let ctxRef: SpecimenContext | null = null;
let listenerAbort: AbortController | null = null;
let rootRef: HTMLElement | null = null;
let dom: CalibrationDom | null = null;

let busyMs = 300;
let layoutIterations = DEFAULT_LAYOUT_ITERATIONS;

/** 位移標的目前在上面還是下面。每次按 C 翻一次，兩個方向的位移分數相同 */
let shifted = false;
/** 待觸發的計時器。**destroy 必須清掉**，否則驗收第 12 條會掛在校準件自己手上 */
let shiftTimer = 0;
let lcpTimer = 0;

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

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * 按鈕 C —— 版面位移（CLS），有解析解。
 *
 * CLS 分數 = **impact fraction × distance fraction**（spec §4.5）：
 *   impact   = (位移前後兩個矩形的聯集 ∩ viewport) / viewport 面積
 *   distance = 最大位移距離 / viewport 的較長邊
 *
 * 標的是 `position: fixed`、寬度滿版、高 100px、固定在 top: 400px。
 * 往下移 50px 之後佔 450~550，兩者重疊所以聯集是連續的 400~550 共 150px 高：
 *   impact   = 150 / viewport 高
 *   distance = 50 / max(viewport 寬, 高)
 *
 * ⚠️ **不寫死 800×600 去算預期值。** iframe 內容溢出時會出現捲軸，
 * 實際的 `clientWidth` 就不是 800 了 —— 寫死的話這個「解析解」會系統性地偏一點點，
 * 而偏差小到看起來像量測誤差。所以現場讀 clientWidth/clientHeight 算，
 * 把預期值跟實測值一起上報，讓兩個數字自己對帳。
 */
function calibrationScheduleShift(): void {
  if (!dom) return;
  ctxRef?.mark('calibration:schedule-shift');
  window.clearTimeout(shiftTimer);
  dom.shiftOutput.textContent = `已排程：${SHIFT_DELAY_MS}ms 後位移（避開 hadRecentInput 的 500ms 豁免窗）`;
  shiftTimer = window.setTimeout(calibrationApplyShift, SHIFT_DELAY_MS);
}

/** 具名函式：它會出現在 LoAF 的 sourceFunctionName，匿名的話面板上看不出這一幀是誰造成的 */
function calibrationApplyShift(): void {
  if (!dom) return;
  shifted = !shifted;
  // in-flow 推擠：舞台的高度固定且 overflow: hidden，所以標的在舞台裡上下移動時，
  // **舞台以外的東西一動也不動** —— 位移源只有一個，解析解才算得出來。
  dom.shiftSpacer.style.height = `${shifted ? SHIFT_DISTANCE : 0}px`;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  // 聯集高度：位移距離小於標的高度，所以兩個矩形重疊，聯集是連續的一塊。
  // 仍然 clamp 到 viewport 高 —— 標的被推出視窗時，露在外面的部分不算 impact。
  const unionHeight = Math.min(vh, SHIFT_TARGET_HEIGHT + SHIFT_DISTANCE);
  const impact = unionHeight / vh;
  const distance = SHIFT_DISTANCE / Math.max(vw, vh);
  const expected = impact * distance;

  dom.shiftOutput.textContent =
    `已位移 ${SHIFT_DISTANCE}px · viewport ${vw}×${vh} · ` +
    `解析解 impact ${round4(impact)} × distance ${round4(distance)} = ${round4(expected)}`;
  ctxRef?.emit({
    clsExpectedScore: round4(expected),
    clsShiftDistancePx: SHIFT_DISTANCE,
    clsViewportWidth: vw,
    clsViewportHeight: vh,
  });
}

/**
 * 校準 D —— LCP，有解析解。載入後 LCP_TARGET_DELAY_MS 自動發生，不是按鈕（見常數上方說明）。
 *
 * 位置槽的高度**在 mount 就預留好**，圖片出現時不推動任何東西 ——
 * 否則 D 會製造一次版面位移，把 C 的 CLS 校準污染掉，
 * 兩個校準互相干擾就都不能用了。順帶示範「預留空間可以消掉這種位移」。
 */
function calibrationShowLcpTarget(): void {
  if (!dom) return;
  const block = document.createElement('div');
  block.className = 'cal-lcp-text';
  block.textContent = LCP_TARGET_TEXT;
  dom.lcpSlot.replaceChildren(block);

  const shownAt = Math.round(performance.now());
  dom.lcpOutput.textContent =
    `標的已出現於 ${shownAt}ms（排程 ${LCP_TARGET_DELAY_MS}ms）· 預期 LCP ≈ 這個數字`;
  ctxRef?.emit({ lcpExpectedMs: LCP_TARGET_DELAY_MS, lcpTargetShownAtMs: shownAt });
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
    <style>
      /*
        ⚠️ 這段是校準負載的幾何定義，不是排版（同標本 #1／#3 的例外）。
        位移標的的尺寸與位置直接進 CLS 的解析解，改了等於改預期值。
      */
      /*
        位移舞台：**固定高度 + overflow: hidden**。
        標的在舞台裡上下移動，舞台外的東西一動也不動 —— 位移源只有一個，解析解才成立。

        ⚠️ **全部是 in-flow，一個 position: fixed 都沒有，這是量出來的教訓。**
        第一版把標的做成滿版 fixed 覆蓋層，結果按鈕 B 的 200 次強制版面
        從 64.8ms 變成 1967ms（30 倍）—— LayoutView 底下有 out-of-flow fixed 盒子時，
        Blink 無法把「只有標的變髒」localize 成小的 layout root。
        校準件的一角改壞，另一角的解析解就跟著失真。
      */
      #cal-cls-stage {
        height: ${SHIFT_STAGE_HEIGHT}px;
        border: 1px solid #ccc;
        box-sizing: border-box;
      }
      /*
        ⚠️ 版面預算：整個第一屏只有 600px，而**四個校準都必須落在裡面**。
        C 的標的在視窗外就不算位移、D 的標的在視窗外就不會成為 LCP candidate ——
        兩者都會安靜地量到 null。所以 A~D 一律不放 h2 與說明段落，
        文字全部搬到量測標的下面（反正那裡本來就在摺線以下）。
        h2 與段落總共只值幾十像素，但那幾十像素正好是這一頁能不能校準的差別。
      */
      section { margin: 6px 0; }
      pre { margin: 4px 0; }
      #cal-cls-spacer { height: 0; }
      #cal-cls-target {
        height: ${SHIFT_TARGET_HEIGHT}px;
        /*
          ⚠️ border-box 是解析解的一部分。第一版沒寫，1px 的虛線邊框讓實際高度
          變成 102px，量到的 CLS 就比解析解高 1.3% —— 小到看起來像量測雜訊，
          其實是幾何算錯了。校準件的意義就是抓得到這種等級的偏差。
        */
        box-sizing: border-box;
        background: rgba(32, 64, 96, 0.22);
        border: 1px dashed #204060;
      }
      /*
        LCP 標的的位置槽：高度在 mount 就佔好，標的出現時不推動任何東西
        —— 校準 D 因此不會製造位移去污染校準 C。同樣是 in-flow。
        位置排在按鈕 A/B 之後、量測標的之前，這樣它落在 600px 視窗內
        （LCP 只算視窗內的可見面積），而且按鈕座標完全不受影響。
      */
      #cal-lcp-slot { height: ${LCP_TARGET_HEIGHT}px; background: #eef1f5; overflow: hidden; }
      /* 字級決定文字的 bounding box，而那就是 LCP 認定的面積 —— 這是負載參數不是排版 */
      .cal-lcp-text { font-size: 44px; line-height: 60px; padding: 4px; color: #204060; }
    </style>

    <section>
      <button id="cal-busy-btn" type="button">A · 忙迴圈 <span id="cal-busy-ms">300</span> ms</button>
      <pre id="cal-busy-out">尚未執行</pre>
    </section>

    <section>
      <label>M <input id="cal-layout-m" type="number" min="1" step="50" value="${DEFAULT_LAYOUT_ITERATIONS}"></label>
      <button id="cal-layout-btn" type="button">B · 強制 layout M 次</button>
      <pre id="cal-layout-out">尚未執行</pre>
    </section>

    <section>
      <button id="cal-cls-btn" type="button">C · ${SHIFT_DELAY_MS}ms 後位移 ${SHIFT_DISTANCE}px</button>
      <pre id="cal-cls-out">尚未位移</pre>
      <div id="cal-cls-stage">
        <div id="cal-cls-spacer"></div>
        <div id="cal-cls-target"></div>
      </div>
    </section>

    <section>
      <pre id="cal-lcp-out">D · 等待標的出現</pre>
      <div id="cal-lcp-slot"></div>
    </section>

    <section>
      <h2>校準標本</h2>
      <p>每個負載都有解析解可以反推 —— 這一頁是用來證明量測層本身是對的。
         上面四塊由上而下是 A（忙迴圈）／B（強制版面）／C（版面位移）／D（LCP 標的）。</p>
      <p>下面這塊是按鈕 B 的量測標的，內容由程式產生 ——
         它的節點數是負載大小，不是排版，不要為了好看去動它。</p>
      <div id="cal-layout-target"></div>
    </section>

    <section>
      <h2>各按鈕的預期（說明一律放在摺線以下，免得把 C／D 的標的擠出視窗）</h2>
      <p><strong>按鈕 A</strong>：預期 <code>inp.processing</code> ≈ 按鈕上的毫秒數 ±10%（驗收第 2 條）；
         LoAF 的 <code>sourceFunctionName</code> 應為 <code>calibrationBusyLoop</code>。</p>
      <p><strong>按鈕 B</strong>：預期 <code>loaf.forcedStyleAndLayout</code> &gt; 0 且隨 M 線性成長
         （驗收第 7 條）；<code>sourceFunctionName</code> 應為 <code>calibrationForcedLayout</code>。</p>
      <p><strong>按鈕 C</strong>：解析解 = impact fraction × distance fraction。
         標的高 ${SHIFT_TARGET_HEIGHT}px，在一個固定高 ${SHIFT_STAGE_HEIGHT}px、
         <code>overflow: hidden</code> 的舞台裡往下移 ${SHIFT_DISTANCE}px ——
         舞台外的東西一動也不動，所以位移源只有一個。
         <strong>位移刻意延遲 ${SHIFT_DELAY_MS}ms</strong>：互動後 500ms 內的位移會被
         <code>hadRecentInput</code> 豁免、不算 CLS，立刻位移的話永遠量到 0。</p>
      <p><strong>校準 D</strong>：載入後 ${LCP_TARGET_DELAY_MS}ms，上面那塊
         ${LCP_TARGET_HEIGHT}px 高的灰色區域會出現大字，預期 LCP ≈ 該時間。
         <strong>它不能做成按鈕</strong>：LCP 在第一次互動之後就定案，
         按下去的那一刻已經凍結了 —— 這一項必須在碰任何按鈕之前讀。</p>
      <p>標的是<strong>文字不是圖片</strong>：Chrome 會把每像素位元數低於 0.05 bpp 的圖片
         排除在 LCP 之外（擋純色佔位圖用的），第一版的 SVG data URI 就是這樣被靜默忽略的。
         也不用 CDN 圖片 —— 網路時間會進 LCP，而第二次載入命中快取就變成另一個數字。</p>
      <p><strong>C 與 D 都是 in-flow，沒有任何 <code>position: fixed</code>。</strong>
         第一版用 fixed 覆蓋層，把按鈕 B 的 200 次強制版面從 64.8ms 推到 1967ms（30 倍）——
         校準件的一角改壞，另一角的解析解就跟著失真。</p>
    </section>
  `;

  const busyButton = root.querySelector<HTMLButtonElement>('#cal-busy-btn')!;
  const layoutButton = root.querySelector<HTMLButtonElement>('#cal-layout-btn')!;
  const clsButton = root.querySelector<HTMLButtonElement>('#cal-cls-btn')!;
  dom = {
    busyMsLabel: root.querySelector<HTMLElement>('#cal-busy-ms')!,
    busyOutput: root.querySelector<HTMLElement>('#cal-busy-out')!,
    layoutInput: root.querySelector<HTMLInputElement>('#cal-layout-m')!,
    layoutOutput: root.querySelector<HTMLElement>('#cal-layout-out')!,
    layoutTarget: root.querySelector<HTMLElement>('#cal-layout-target')!,
    shiftSpacer: root.querySelector<HTMLElement>('#cal-cls-spacer')!,
    shiftTarget: root.querySelector<HTMLElement>('#cal-cls-target')!,
    shiftOutput: root.querySelector<HTMLElement>('#cal-cls-out')!,
    lcpSlot: root.querySelector<HTMLElement>('#cal-lcp-slot')!,
    lcpOutput: root.querySelector<HTMLElement>('#cal-lcp-out')!,
  };
  dom.busyMsLabel.textContent = String(busyMs);
  buildLayoutTarget(dom.layoutTarget);

  busyButton.addEventListener('click', calibrationBusyLoop, { signal });
  layoutButton.addEventListener('click', calibrationForcedLayout, { signal });
  clsButton.addEventListener('click', calibrationScheduleShift, { signal });
  dom.layoutInput.addEventListener('input', readLayoutIterations, { signal });

  // 校準 D 從 mount 起算，不等任何互動 —— 見 LCP_TARGET_DELAY_MS 上方的說明
  lcpTimer = window.setTimeout(calibrationShowLcpTarget, LCP_TARGET_DELAY_MS);

  // 一顆都還沒按之前，面板就該看得到這一輪的設定值 —— 條件先於數字出現
  ctx.emit({ busyLoopMs: busyMs, layoutIterations, lcpExpectedMs: LCP_TARGET_DELAY_MS });
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

  // 排程中的位移屬於上一輪，讓它在新一輪落地就是把兩輪的樣本混在一起
  window.clearTimeout(shiftTimer);
  shiftTimer = 0;
  shifted = false;
  dom.shiftSpacer.style.height = '0px';
  dom.shiftOutput.textContent = '尚未位移';
  // ⚠️ LCP 標的**不收回**：它已經是這份 document 的 LCP，移除它不會讓 LCP 歸零
  //（LCP 一旦定案就不再更新），只會讓畫面與數字對不起來。要新的 LCP 只能 reload。
  ctxRef?.emit({ busyLoopMs: busyMs, layoutIterations });
}

/**
 * 驗收第 12 條：切走之後靜置五秒，不得再出現 origin === 'specimen' 的 LoAF entry。
 *
 * 這一頁本來沒有任何 timer，補上校準 C/D 之後有兩個了 ——
 * 而它們正好都是「延遲觸發」的，也就是最容易活過 destroy 的那一種。
 * 清 timer 不是禮貌，是驗收條件。
 */
function destroy(): void {
  window.clearTimeout(shiftTimer);
  window.clearTimeout(lcpTimer);
  shiftTimer = 0;
  lcpTimer = 0;
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
