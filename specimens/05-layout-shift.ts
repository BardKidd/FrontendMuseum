/**
 * 標本 #5 —— 版面位移（CLS）。**B 類，切 mode 重載。**
 *
 * 三個位移源疊加，刻意排在載入後 300ms / 900ms / 1500ms：
 *   1. `<img>` 沒有 width/height —— 載入完成時從 alt 盒的 24px 撐開成 360px，
 *      把下方的圖說推下去 336px
 *   2. 字族 metric 不合 —— 內文從 4 行變 5 行，把下方的插圖與圖說一起推下去 28px
 *   3. 1500ms 後從**上方**插入通知橫幅 —— 整頁往下跳 72px
 *
 * **四段梯度，每一段相對前一段只翻一個變因**（同標本 #4 / #6 的形狀）：
 *
 * | mode | 與前一段的唯一差別 | 還活著的位移源 |
 * |---|---|---|
 * | `broken` | —— | 一、二、三 |
 * | `fixed-image` | **只**加 `.ls-figure` 的 `aspect-ratio` | 二、三 |
 * | `fixed-font` | 再加上 `.ls-prose` 的 `min-height` | 三 |
 * | `fixed-banner` | 再加上 `.ls-banner-slot` 的 `min-height` | 無 |
 *
 * 三個 CSS 宣告是**累加**的，不是三選一 —— `fixed-banner` 同時帶著前兩段的預留，
 * 所以它就是「全部預留空間」的完整治療版。梯度的順序寫在 `GRADIENT`，
 * class 名稱與 CSS 選擇器都從那個陣列推導，**沒有第二份真相可以走鐘**。
 *
 * 登記的預期值、判準與逐筆推導見 `docs/phase2-expected-results.md` 的
 * 「2026-07-26 · 標本 #5 拆成四段梯度」修正紀錄。
 *
 * ⚠️ **文檔順序是這個實驗的一部分，不是排版偏好。**
 * layout shift 的記錄條件是「這個元素的變化推動了**它下方**的內容」；
 * 元素自己往下長高、左上角不動，一筆 entry 都不會產生。
 * 所以模板刻意排成 `內文(#ls-prose) → 插圖(#ls-figure) → 圖說(#ls-caption)`：
 * 位移源二下方有插圖與圖說，位移源一下方有圖說。**誰被搬到最後一個，誰就當場失效**，
 * 而面板上完全看不出來 —— 2026-07-25 的三輪量測就是這樣抓到位移源二整個是空操作的
 * （見 `docs/phase2-expected-results.md` 修正紀錄）。
 *
 * **間隔刻意都小於 `clsSessionGapMs`（1000ms）**，所以三次位移落進**同一個 session window**
 * 並累加（實測 entry 落點間隔 593~599ms，對 1000ms 上限有四成餘裕）。
 * 這正是本標本的教學重點：把間隔改成 1.2 秒就會變成三個 session，
 * 而 CLS 只取最大的那一個 —— 數字會小很多，**但畫面上跳動的程度一模一樣**。
 * CLS 是所有 session window 的最大值，不是總和（spec §4.5），這是最多人算錯的地方。
 *
 * ⚠️ 操作程序是「載入後靜置，不要碰畫面」。
 * 使用者互動後 500ms 內的位移會被標上 `hadRecentInput`，**依規格不算 CLS** ——
 * 提早點一下畫面就會把後續位移全部豁免掉，CLS 變 0，而面板看起來一切正常。
 * 面板的 `clsIgnoredByInput` 就是為了讓這種情況看得見（校準 C 已證實這條路徑會動）。
 */
import type { SpecimenContext, SpecimenModule } from '../src/protocol';
import { LAYOUT_SHIFT_META } from '../src/specimens';

/** 三個位移源的觸發時間。兩兩間隔 600ms，都小於 1000ms 的 session gap */
const IMAGE_AT_MS = 300;
const FONT_AT_MS = 900;
const BANNER_AT_MS = 1500;

/** 圖片的內在尺寸。治療版用這個比例預留空間 */
const FIGURE_WIDTH = 600;
const FIGURE_HEIGHT = 360;
/**
 * 橫幅自己的高度。`fixed-banner` 用同一個常數預留 slot 的 `min-height`。
 *
 * ⚠️ **整頁往下跳的是 72px，不是 64px，而那 8px 不是誤差。**
 * 空的 `.ls-banner-slot` 高度為 0，`<h1>` 的 `margin-top`（UA 樣式 0.67em × 32px
 * = 21.44px）於是穿透 slot 與 `#root`，**與 `<body>` 自己的 8px 上邊界合併**
 * （margin collapsing）—— 合併後取大的那個，body 的 border box 落在 y = 21.44。
 * 橫幅一填進 slot，slot 有了高度，h1 的邊界不再逃得出去：
 * body 回到自己的 y = 8，h1 落在 8 + 64 + 21.44 = 93.44。
 * h1 位移 = 93.44 − 21.44 = **72 = BANNER_HEIGHT(64) + body 的 8px 上邊界**。
 * 護欄計數器 `bannerPushPx` 就是在量這一格，登記值 72；量到 64 代表
 * 有人給 body 或 slot 加了邊界／padding，把邊界合併關掉了。
 */
const BANNER_HEIGHT = 64;

/**
 * 內文的行高，以及治療版要預留的行數。
 * `min-height` = 28 × 6 = 168px —— 數字與註解同源，改一個地方就好。
 * 預留幾行的根據寫在下面 `.ls-fixed-font .ls-prose` 的 CSS 註解裡。
 */
const PROSE_LINE_HEIGHT = 28;
const PROSE_RESERVED_LINES = 6;

/**
 * 梯度的**唯一真相**：順序即累加順序，class 名與 CSS 選擇器都從這裡推導。
 * `STAGES[n]` 代表「打開前 n 個預留」，所以 `stageIndex() >= 1` 就是
 * 「圖片已預留」、`>= 2` 是「內文也預留了」、`>= 3` 是「橫幅也預留了」。
 *
 * ⚠️ 這個陣列必須與 `src/specimens.ts` 的 `LAYOUT_SHIFT_META.modes` 逐項同序。
 * 兩邊不同源會出現「面板顯示治療三、實際跑治療二」而完全沒有徵兆的錯。
 */
const STAGES = ['broken', 'fixed-image', 'fixed-font', 'fixed-banner'] as const;

let ctxRef: SpecimenContext | null = null;
let rootRef: HTMLElement | null = null;
let currentMode: string = STAGES[0];
let timers: number[] = [];

let figureEl: HTMLImageElement | null = null;
let proseEl: HTMLElement | null = null;
let bannerSlotEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let headingEl: HTMLElement | null = null;

let firedSources = 0;
/** 累積上報的護欄計數器。emit 是覆蓋式合併，所以自己留一份完整的 */
let guards: Record<string, number> = {};

/** 未知的 mode 退回 0（病變）—— 與 runtime 的 fallback 同方向，不要靜默掉到治療版 */
function stageIndex(): number {
  const i = (STAGES as readonly string[]).indexOf(currentMode);
  return i < 0 ? 0 : i;
}
const imageReserved = (): boolean => stageIndex() >= 1;
const fontReserved = (): boolean => stageIndex() >= 2;
const bannerReserved = (): boolean => stageIndex() >= 3;

function emitGuards(extra: Record<string, number>): void {
  guards = { ...guards, ...extra };
  ctxRef?.emit(guards);
}

/**
 * ⚠️ 這個計數器數的是**排程數，不是實際產生的 layout shift entry 數**，
 * 兩者在本標本並不相等：`broken` 排程 3 次，實測 **3 或 4 筆 entry**。
 *
 * 差額全部出在位移源一，它可能是一筆也可能是兩筆：`src` 一設，`<img>` 的 alt 盒
 * 從 24px 高塌成 0，下方內容先往**上**跳；約 20ms 後圖片解碼完成撐開 360px，再往下跳。
 * 淨位移 336px，但這兩步**有沒有落在同一幀**是不定的：
 *   - 併成一筆：0.14536 → CLS **0.24741**
 *   - 拆成兩筆：0.01109 + 0.15617 → CLS **0.26931**
 * 兩個值各自逐位可重現，兩者之間沒有中間值 —— **這是量化假象，不是雜訊**：
 * 差額 0.0219 全部來自「同一段位移被切成兩筆時，中間那個位置也被算進 impact region」。
 * `sessionCount` 不受影響，兩個值都落在登記區間內，判定不翻轉。
 *
 * ⚠️ **出現頻率不要憑印象寫。** 2026-07-25 的交付曾寫「八次量測只出現這兩個數」，
 * 而同批的變更摘要寫「九次」—— 同一份證據兩個數字，且沒有任何存檔的原始紀錄
 * 可以回推是幾次。那個宣稱已作廢。現行登記的樣本數與逐輪落點見
 * `docs/phase2-expected-results.md`，**引用時引那份，不要引記憶**。
 *
 * （2026-07-25 之前這個落差另有原因 —— 位移源二在結構上根本不產生 entry。
 * 那個缺陷已修，見檔頭關於文檔順序的說明。**落差還在，但原因換了**，
 * 不要看到 `3` 對不上 entry 數就以為舊缺陷復發。）
 *
 * 所以這個欄位不能拿來交叉檢查「位移有沒有真的發生」——
 * 要檢查的是 `cls.sessionCount` 與下面那組護欄計數器。
 */
function note(text: string): void {
  firedSources += 1;
  if (statusEl) statusEl.textContent = `${firedSources}/3 排程 · ${text}`;
  emitGuards({ shiftSourcesScheduled: firedSources });
}

/**
 * 位移源一 —— 沒有尺寸的圖片。
 *
 * `src` 刻意等到 300ms 才設：圖片在 DOM 裡但還沒有內容時只有 alt 盒的 24px 高，
 * 載入完成的那一刻它撐開成 360px，下方的圖說一次被推下去 336px。
 * 這就是「`<img>` 沒寫 width/height」在真實網站上發生的事，只是時間點被我們釘死了。
 *
 * ⚠️ 它下方**必須**有內容 —— 這裡是 `#ls-caption`。圖說一旦被刪掉或搬走，
 * 圖片就變成模板最後一個元素，撐開時左上角不動、不產生 entry（同 `fireFontShift`）。
 *
 * **cache buster 是必要的，不是保險**：沒有它，第二次載入命中快取、
 * 圖片在第一幀就有尺寸、位移消失 —— 而面板上看起來像治療生效了（spec:1126）。
 *
 * ⚠️ **這裡刻意一行 DOM 量測都不做。** 讀 `offsetHeight` 會強制一次同步版面，
 * 而上面那個「兩步併不併成同一幀」的量化假象就發生在這 20ms 裡 ——
 * 在這條路徑上插入強制版面等於用觀測動作去撥動被觀測的東西。
 * 圖片到底有沒有撐開，由 900ms 那一刀的 `figureHeightAtFontShiftPx` 回答。
 */
function fireImageShift(): void {
  if (!figureEl) return;
  ctxRef?.mark('layout-shift:image');
  figureEl.src = `/specimen-05-figure.svg?t=${Date.now()}`;
  note(imageReserved() ? '圖片載入（已用 aspect-ratio 預留空間，不位移）' : '圖片載入 → 撐開 360px');
}

/**
 * 位移源二 —— 字族 metric 不合造成文字重排。
 *
 * ⚠️ **結構前提：`#ls-prose` 必須排在插圖與圖說上方。**
 * 這裡只改 `#ls-prose` 自己的 `fontFamily` / `fontSize`，位移是靠它長高之後
 * **把下方的元素推下去**才產生的。它一旦被搬成模板的最後一個元素，就只是自己往下長、
 * 左上角不動 —— 一筆 entry 都沒有，而 `shiftSourcesScheduled` 照樣數到 3，
 * 面板上完全看不出來。這就是 2026-07-25 三輪量測抓到的缺陷
 * （見 `docs/phase2-expected-results.md` 修正紀錄）。
 *
 * ⚠️ **這一筆同時是把兩個 session window 黏成一個的那座橋。**
 * 抽掉它（`broken` 的文案長度掉出可用區間、或換一台機器 `monospace` 解析到別的字族），
 * 頭尾就相隔 1200ms，窗被切成兩個 —— `sessionCount` 跳回 2、CLS 掉到
 * 只剩位移源一那一筆（實測 0.14536 / 拆兩筆時 0.16726）。
 * **正式量測若 `sessionCount ≠ 1`，第一件事是看護欄計數器
 * `proseHeightBeforePx` / `proseHeightAfterPx`**（`broken` 與 `fixed-image` 應為
 * 112 → 140，`fixed-font` 與 `fixed-banner` 應為 168 → 168），**不是**回頭改預期。
 *
 * ⚠️ **這一筆的分數由位移源一的結果決定，這是登記在案的混淆變因。**
 * 被推下去的是插圖（`#ls-figure`）—— 它在 900ms 時的高度是圖片載入後的 360px，
 * 而 entry 的 source rect 是**被摺線裁掉後**的值（600 × 295.125，見檔尾推導）。
 * 圖片若 404、若命中快取而在第一幀就有尺寸、若換一張別的內在尺寸，
 * 位移源二的分數會變成另一個數，**而它自己一行程式都沒改**。
 * 所以 `figureHeightAtFontShiftPx`（登記值 360）與 `figureNaturalHeightPx`（登記值 360）
 * 兩個護欄計數器就在這裡量：兩者任一不是 360，位移源二的數字不得引用。
 * 這個相依是幾何上拆不掉的（兩者垂直相疊），只能登記 + 上報，不能宣稱不存在。
 *
 * ⚠️ **誠實揭露：這不是真的 web font swap。**
 * spec 要求字型自架（CDN 會被快取，第二次就不位移），但這個 repo 裡沒有任何字型檔，
 * 所以這裡改用「換成 metric 明顯不同的系統字族」來觸發同一個機制：
 * 字寬改變 → 換行位置改變 → 區塊高度改變 → 下方內容位移。
 *
 * **機制是真的，故事不完整。** 要補完需要自架 .woff2、用 `font-display: swap`，
 * 治療版用 `size-adjust` / `ascent-override` 把 fallback 的 metric 對齊到實際字型。
 * 這件事登記為已知缺口（`docs/phase2-expected-results.md`），
 * 補上之前，文章不得宣稱示範了完整的字型位移。
 */
function fireFontShift(): void {
  if (!proseEl) return;
  ctxRef?.mark('layout-shift:font');
  const before = proseEl.offsetHeight;
  proseEl.style.fontFamily = 'monospace';
  proseEl.style.fontSize = '19px';
  const after = proseEl.offsetHeight;
  emitGuards({
    proseHeightBeforePx: before,
    proseHeightAfterPx: after,
    figureHeightAtFontShiftPx: figureEl ? figureEl.offsetHeight : -1,
    figureNaturalHeightPx: figureEl ? figureEl.naturalHeight : -1,
  });
  note(fontReserved() ? '字族換入（已預留高度，不位移）' : '字族換入 → 文字重排');
}

/**
 * 位移源三 —— 從上方插入通知橫幅。
 *
 * 治療版不是「不插橫幅」，而是**預留空間**：
 * 位置一開始就佔著，橫幅出現時填進去，下方一動也不動。
 * 另一個等價作法是 `position: fixed` 疊在內容上方（不進文檔流），
 * 那在通知類 UI 上更常見，代價是會遮住內容。
 *
 * `bannerPushPx` 量的是 `<h1>` 的頂端被推了多遠：`broken` / `fixed-image` /
 * `fixed-font` 應為 **72**（= 64 + body 的 8px 上邊界，理由見 `BANNER_HEIGHT`），
 * `fixed-banner` 應為 **0**。
 */
function fireBannerShift(): void {
  if (!bannerSlotEl) return;
  ctxRef?.mark('layout-shift:banner');
  const beforeTop = headingEl ? headingEl.getBoundingClientRect().top : 0;
  const banner = document.createElement('div');
  banner.className = 'ls-banner';
  banner.textContent = '⚠ 系統將於今晚 23:00 進行維護，屆時服務將短暫中斷。';
  bannerSlotEl.replaceChildren(banner);
  const afterTop = headingEl ? headingEl.getBoundingClientRect().top : 0;
  emitGuards({ bannerPushPx: Math.round((afterTop - beforeTop) * 100) / 100 });
  note(bannerReserved() ? '橫幅插入（空間已預留，不位移）' : '橫幅插入 → 整頁往下跳');
}

/** 折疊空白後的字數 —— 這就是 HTML 實際拿去排版的那個長度 */
function collapsedLength(el: HTMLElement | null): number {
  return el ? el.textContent!.replace(/\s+/g, ' ').trim().length : -1;
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  /** 累加式：治療 n 帶著治療 1..n 的全部預留 */
  const stageClasses = STAGES.slice(1, stageIndex() + 1).map((s) => `ls-${s}`).join(' ');

  root.innerHTML = `
    <style>
      /*
        ⚠️ 這一段就是四個 mode 的**全部差異**。
        HTML 結構、時序、文字內容逐字相同，差別只有根節點掛了幾個 ls-fixed-* class ——
        對照乾淨到可以直接貼進文章。

        ⚠️ **但「結構相同」不等於「排版條件相同」，這一點 2026-07-25 那版寫錯了。**
        先前 \`broken\` 在圖片載入前文件只有 574.9px 高、沒有捲軸，內容寬 **784px**；
        載入後跳到 1003px、捲軸出現，寬度變 **769px**。治療臂則從第一幀就有捲軸。
        於是兩臂在前約 370ms 的**排版寬度不同**，而本標本新增的兩段文字，
        行數正好是寬度敏感的 —— 內文在 769px 下 209 字是 4 行、210 字就是 5 行，
        在 784px 下要到 216 字才翻。實測過一次：把內文加到 210 字，
        病變臂會在圖片載入的那一幀「順便」把內文從 4 行擠成 5 行，
        位移源二在 900ms 就沒事可做了，\`sessionCount\` 掉回 2 —— 而那不是治療，是捲軸。

        所以下面第一條規則把量測寬度**凍結**成 769px：\`overflow-y: scroll\` 讓捲軸
        從第一幀就佔著位置，四個 mode 從第一幀起寬度完全相同。
        它是**舞台常數，不是治療變因** —— 四臂都吃到，所以不可能製造出臂間差異。
      */

      /* ⚠️ 凍結量測寬度。刪掉它，上面那段描述的混淆變因會原地長回來。 */
      html { overflow-y: scroll; }

      /* 位移源一：治療版用 aspect-ratio 保留空間。
         寬度已知、比例已知，瀏覽器在圖片還沒下載完就能算出高度。 */
      .ls-figure { display: block; width: ${FIGURE_WIDTH}px; max-width: 100%; }
      .ls-fixed-image .ls-figure { aspect-ratio: ${FIGURE_WIDTH} / ${FIGURE_HEIGHT}; }

      /* 位移源二：治療版預留足夠高度，字族換入時區塊高度不變。
         實測（800×600、量測寬度 769px、本機）：serif 17px 排成 4 行 = 112px，
         monospace 19px 換入後排成 5 行 = 140px。
         ⚠️ **這兩個行數是在 769px 下量的**，而字族換入發生在 900ms ——
         那時圖片早已載入、捲軸已在（凍結後更是從第一幀就在），寬度必定是 769px。
         預留 ${PROSE_RESERVED_LINES} 行 = ${PROSE_LINE_HEIGHT * PROSE_RESERVED_LINES}px，
         **比實測多留一行**：monospace 解析到哪個字族由平台決定，
         換一台機器多出一行，治療版就會自己產生位移 —— 而面板上只會多出一個小小的
         非零 CLS，很容易被當成雜訊。**治療版靜默失效是本站最怕的錯。**
         多留這一行的代價只是治療版下方多 28px 空白。
         ⚠️ 這是替代作法 —— 真正的解是 size-adjust / ascent-override 把 fallback
         的 metric 對齊實際字型，那需要一個自架的字型檔（見 fireFontShift 的說明）。 */
      .ls-prose { font-family: serif; font-size: 17px; line-height: ${PROSE_LINE_HEIGHT}px; }
      .ls-fixed-font .ls-prose { min-height: ${PROSE_LINE_HEIGHT * PROSE_RESERVED_LINES}px; }

      /* 圖說。它**不是**位移源，是被推的那一方 —— 所以沒有對應的 .ls-fixed-* 規則。
         它存在的理由是給位移源一一個「下方的內容」，沒有它，圖片撐開就不算位移。 */
      .ls-caption { font-size: 15px; line-height: 26px; color: #444; }

      /* 位移源三：治療版一開始就佔著橫幅的高度 */
      .ls-banner-slot { min-height: 0; }
      .ls-fixed-banner .ls-banner-slot { min-height: ${BANNER_HEIGHT}px; }
      .ls-banner {
        height: ${BANNER_HEIGHT}px;
        line-height: ${BANNER_HEIGHT}px;
        background: #fde68a;
        padding: 0 12px;
        box-sizing: border-box;
      }
    </style>

    <div class="${stageClasses}">
      <div class="ls-banner-slot" id="ls-banner-slot"></div>

      <h1 id="ls-heading">標本 #5 —— 版面位移（CLS）</h1>
      <p id="ls-status">載入中 · 三個位移源將於 ${IMAGE_AT_MS} / ${FONT_AT_MS} / ${BANNER_AT_MS}ms 觸發</p>
      <p><strong>請載入後靜置三秒，不要碰畫面。</strong>
         使用者互動後 500ms 內的位移會被 <code>hadRecentInput</code> 豁免、不算 CLS ——
         提早點一下，這個標本的數字就會變成 0，而且看起來很正常。</p>

      <!-- ⚠️ 這段文字的**長度是實驗參數，不是文案**：它決定字族換入時內文長高幾行，
           也就是位移源二把下方的插圖與圖說推下去多少距離（4 行 → 5 行 = 28px）。
           增刪字數等於改 CLS，而面板上看不出任何異常 —— 所以字數本身被上報成
           護欄計數器 \`proseCharsCollapsed\`（登記值 202）。

           **實測可用區間（折疊空白後字數，量測寬度 769px）：188 ~ 209。**
           低於 188，monospace 也只有 4 行、位移源二整個消失；
           高於 209，serif 在 769px 下就已經是 5 行，換入後不再長高。
           這個區間是**端對端量出來的**，不是排版試算：逐個字數重載整頁、看
           \`sessionCount\` 與 entry 數 —— 187 字 → 只有 2 筆 entry、窗斷成 2；
           188 / 191 / 197 / 202 / 205 / 208 / 209 字 → 3 筆 entry、\`sessionCount\` 1；
           210 / 212 / 215 字 → 位移源二消失。
           （下界是純截斷本文量的，沒有外推成分；上界超過本文 202 字的部分是用
           同性質中文字外推，換別的字可能 ±2。）

           ⚠️ **這裡沒有「取正中間」這種餘裕。** 目前 202 字距下界 14 字、距上界 7 字，
           而區間全長只有 22 字 —— 因為它是兩個量化門檻的交集（monospace 要夠長才滿 5 行、
           serif 要夠短才停在 4 行），不是可以靠潤稿加寬的東西。
           所以處置不是「把字數挪到中間」，是**讓越界當場現形**：
           \`proseCharsCollapsed\` 與 \`proseHeightBeforePx\` / \`proseHeightAfterPx\`
           三個護欄計數器印在面板上，越界時 112 → 140 這一格立刻對不上。
           改字要連 min-height 一起重新量。 -->
      <div class="ls-prose" id="ls-prose">
        三個位移源的排程間隔都是 600ms，實測落點間隔約 590ms，都小於 CLS session window
        的 1000ms 上限，所以它們落進同一個 session 並累加。中間那一筆（字族換入）
        是把兩端黏起來的關鍵：抽掉它，頭尾就相隔 1200ms，窗被切成兩個，
        而 CLS 只取最大的那一個 —— 數字會小很多，但畫面上跳動的程度一模一樣。
        把位移拆散到不同的窗不是治療，只是把分數藏起來。
      </div>

      <img class="ls-figure" id="ls-figure" alt="位移來源一：沒有尺寸的圖片">

      <!-- ⚠️ 這段文字的**長度也是實驗參數**：它是位移源一唯一的「下方內容」，
           它的高度直接決定圖片撐開時的 impact fraction。字數同樣上報成護欄計數器
           \`captionCharsCollapsed\`（登記值 444）。
           **實測可用區間（折疊空白後字數，量測寬度 769px）：420 ~ 472**
           —— 在這個區間內都是 8 行 = 208px。目前 444 字，距下界 24 字、距上界 28 字。
           ⚠️ **有天花板**：摺線（600px）以下的位移不計分，而圖說頂端在 y = 343.875，
           所以它的可見高度最多 256.125px（9.85 行）—— 再加長不會讓分數更高。
           8 行（208px）時圖說整段在摺線以上（343.875 + 208 = 551.875 < 600），
           位移前的那一格完全進帳。 -->
      <p class="ls-caption" id="ls-caption">
        每一筆位移的分數 = impact fraction × distance fraction：前者是「移動前後兩個位置
        聯集的面積 ÷ 視窗面積」，後者是「最大移動距離 ÷ 視窗較長的那一邊」。兩個都是視窗
        相對量，所以視窗尺寸必須凍結，否則同一份位移換個視窗就換一個分數。逐筆算完之後
        再依 session window 聚合：相鄰兩筆間隔超過 1 秒開一個新窗，單一窗跨度超過 5 秒
        也開新窗；最後 CLS 取所有窗裡最大的那一個累加值 —— 不是總和，不是最後一個窗，
        也不是平均。所以「把位移拆散到不同的窗」會讓分數變好看，但畫面上跳動的程度
        一點都沒變 —— 這是這個標本唯一真正想講的事。反過來說，同一份位移只要全部擠進
        同一個窗，分數就會難看到底 —— 這個標本的三個位移源就是這樣排出來的：
        300ms、900ms、1500ms，兩兩相隔 600ms，剛好都塞得進 1000ms 的間隔上限。
        另外，摺線以下的位移不算分：同一次跳動在第一屏和在頁尾，
        CLS 完全不同。
      </p>
    </div>
  `;

  figureEl = root.querySelector<HTMLImageElement>('#ls-figure')!;
  proseEl = root.querySelector<HTMLElement>('#ls-prose')!;
  bannerSlotEl = root.querySelector<HTMLElement>('#ls-banner-slot')!;
  statusEl = root.querySelector<HTMLElement>('#ls-status')!;
  headingEl = root.querySelector<HTMLElement>('#ls-heading')!;

  timers = [
    window.setTimeout(fireImageShift, IMAGE_AT_MS),
    window.setTimeout(fireFontShift, FONT_AT_MS),
    window.setTimeout(fireBannerShift, BANNER_AT_MS),
  ];

  /*
   * 掛載時的幾何快照 —— 這一組取代了原本登記在案、但幾何上不可能成立的那條條件
   * 「三個位移源都必須落在 800×600 的第一屏內」（見 docs 修正紀錄的作廢清單）。
   *
   * 為什麼不可能：位移源一把圖說推下去 336px，而圖說要夠高（8 行 208px）
   * 才撐得起登記的 0.05~0.20 貢獻區間；圖說頂端在 y = 343.875，
   * 343.875 + 336 + 208 = 887.875 —— 位移後整段在摺線下，這是算式，不是沒調好。
   * 真正該登記的是「**被摺線裁掉多少**」，所以改成量 `captionTopPx` 與
   * `captionVisibleBeforePx`（位移前圖說在第一屏內的高度）並上報。
   *
   * 讀 `getBoundingClientRect()` 會強制一次同步版面，但這裡是掛載後、
   * 第一個位移源（300ms）之前的空檔，不落在任何一筆待量的 entry 上。
   */
  const capRect = root.querySelector<HTMLElement>('#ls-caption')!.getBoundingClientRect();
  const viewportH = document.documentElement.clientHeight;
  emitGuards({
    shiftSourcesScheduled: firedSources,
    imageAtMs: IMAGE_AT_MS,
    fontAtMs: FONT_AT_MS,
    bannerAtMs: BANNER_AT_MS,
    contentWidthPx: proseEl.offsetWidth,
    proseCharsCollapsed: collapsedLength(proseEl),
    captionCharsCollapsed: collapsedLength(root.querySelector<HTMLElement>('#ls-caption')),
    captionTopPx: Math.round(capRect.top * 1000) / 1000,
    captionVisibleBeforePx:
      Math.round(Math.max(0, Math.min(capRect.bottom, viewportH) - Math.max(capRect.top, 0)) * 1000) / 1000,
  });
}

/**
 * ⚠️ 「重跑」對這個標本**幫不上忙**：CLS 是 document 級的累計值，
 * 位移已經發生過了，清 DOM 不會讓它歸零（`vitals.ts` 的 ClsCollector 刻意不清累計值）。
 * 要重新量一輪 CLS 只能真的重載 —— 那就是 B 類的意思。
 * 這裡只把畫面還原，並在狀態列說清楚這件事，免得有人按了重跑以為數字會重來。
 */
function reset(): void {
  if (statusEl) {
    statusEl.textContent =
      '⚠ CLS 是 document 級累計值，「重跑」不會讓它歸零 —— 要重新量一輪請切換 mode 或重載頁面';
  }
}

function destroy(): void {
  for (const t of timers) window.clearTimeout(t);
  timers = [];
  if (rootRef) rootRef.innerHTML = '';
  rootRef = null;
  figureEl = null;
  proseEl = null;
  bannerSlotEl = null;
  statusEl = null;
  headingEl = null;
  ctxRef = null;
}

const mod: SpecimenModule = {
  meta: LAYOUT_SHIFT_META,
  mount,
  // 刻意沒有 setMode：B 類靠重載切換
  reset,
  destroy,
};

import { bootstrapSpecimen } from '../src/measure/runtime';
bootstrapSpecimen(mod);

/*
 * ───────────────────────── 逐筆推導（2026-07-26 重算）─────────────────────────
 *
 * 先修掉一條錯的算式。2026-07-25 那版寫：
 *   「8 行 = 208px、寬 784px → 208 × 784 / 480000 = 0.340」
 * 這個 0.340 乘上距離分數得 0.153（或 0.1428），與實測 0.14687 差 3%，而差額沒交代。
 * 錯在兩處：**視窗面積不是 800 × 600**，而且**寬度不是 784**。
 *
 * Blink 的算式（`LayoutShiftTracker`）用的是 `VisibleContentRect()`，
 * 也就是**扣掉捲軸之後**的版面視窗：`documentElement.clientWidth × clientHeight`
 *   = 785 × 600 = 471,000（不是 800 × 600 = 480,000）
 * 距離分數的分母同樣是這個視窗的長邊：**785**（不是 800）。
 *   value = (裁切後聯集面積 / 471000) × (最大移動距離 / 785)
 *
 * 三筆 entry 用這條式子逐位對得上（凍結寬度前的實測，寬度 769／舊 784 混用時）：
 *
 *   位移源一（併成一筆）：圖說 prev [8, 343.875, 777, 208] → cur 完全出視窗
 *     面積 777 × 208 = 161,616 → impact 0.343134
 *     距離 336 → 336 / 785 = 0.428025
 *     0.343134 × 0.428025 = **0.146856**，實測 0.14687（差 0.01%）
 *
 *   位移源二：插圖 prev [8, 304.875, 600, 295.125] → cur [8, 332.875, 600, 267.125]
 *     （兩個 rect 都已被摺線裁過 —— 插圖實高 360px，摺線以下的 65px 不進帳）
 *     聯集 y 304.875~600、x 8~608 → 600 × 295.125 = 177,075 → impact 0.375955
 *     距離 28 → 28 / 785 = 0.035669
 *     0.375955 × 0.035669 = **0.013409**，實測 0.01340（差 0.07%）
 *
 *   位移源三：body prev [8, 21.4375, 769, 578.5625] → cur [8, 8, 769, 592]
 *     聯集 y 8~600、x 8~777 → 769 × 592 = 455,248 → impact 0.966556
 *     距離 72 → 72 / 785 = 0.091720
 *     0.966556 × 0.091720 = **0.088652**，實測 0.08865（差 0.002%）
 *
 *   合計 0.146856 + 0.013409 + 0.088652 = 0.248917，實測 CLS 0.24893。
 *
 * ⚠️ 兩個容易踩的細節：
 *   (a) `sources` 只列出 BODY，但距離用的是 72px —— 那是 body **內容**移動的距離
 *       （h1 從 21.44 移到 93.44），不是 body 自己 border box 的 13.44px。
 *       這條等式我是用數值反推驗證的，不是從 Blink 原始碼抄的。
 *   (b) 位移源一的 prev rect 寬 777 而不是 784：位移發生的那一幀捲軸已經出現、
 *       視窗只剩 785 寬，而位移前的圖說是在 800 寬的版面下排的（x 8 起、寬 784、
 *       右緣 792），超出 785 的 7px 被裁掉。**這正是被凍結掉的那個混淆變因**：
 *       改成 `overflow-y: scroll` 之後 prev rect 是 [8, 343.875, 769, 208]，
 *       面積 159,952 → impact 0.339601 → 位移源一 = **0.145365**，
 *       三筆合計 **0.247426**。現行登記值以凍結後為準。
 *
 * ───────────────────────── LCP：登記元素對，機制改寫 ─────────────────────────
 *
 * `secondaryMetrics` 有 LCP，而各臂的 LCP 標的不同。
 *
 * ⚠️ 2026-07-26 更正（規矩 4）：本段機制分析寫於梯度拆臂**之前**的兩臂設計，
 * 原句「`fixed-*` → `img#ls-figure`，約 375~410ms」在拆成三段治療臂後只對
 * 「預留全開」的臂成立。正典 JSON（2026-07-26-reproducibility-4x-5.json）的逐臂實錄：
 *   `broken`       → `p#ls-caption`（72~108ms），size 159,152
 *   `fixed-image`  → `div#ls-prose`（76~84ms）—— 只預留圖片時當選的是內文，
 *                    不是圖片；此臂為何不是圖片（bpp 排除還是摺線裁切）**未反推**，僅實錄
 *   `fixed-font` / `fixed-banner` → `img#ls-figure`（376~404ms），與下述 bpp 機制一致
 * 絕對毫秒數屬該 session，跨 session 不可比；下述數值反推對應的是預留全開的臂。
 *
 * 2026-07-25 的草稿把這個差別解釋成「`aspect-ratio` 把空間預留出來之後，
 * 圖片才有資格當 LCP 標的」。**那句話沒有證據，而且方向是反的** ——
 * `broken` 臂的圖片載入後有 295px 在摺線以上、可見面積 177,000 px²，
 * 比當選的圖說（159,152）還大，卻**一筆 LCP candidate 都沒被記過**。
 *
 * 真正的機制是 Chrome 的**低熵圖片規則**（校準 D 已經登記過這條，見
 * `docs/phase2-expected-results.md` 開頭）：每像素位元數低於 **0.05 bpp** 的圖片
 * 不得成為 LCP candidate。而那個分母是**視窗裁切後的可見面積**，不是內在尺寸：
 *   `/specimen-05-figure.svg` = 921 bytes = 7,368 bits
 *   broken   可見 600 × 295 = 177,000 px² → 7368 / 177000 = **0.0416 bpp** → 排除
 *   fixed-*  可見 600 × 167 = 100,200 px² → 7368 / 100200 = **0.0735 bpp** → 錄取
 *
 * **圖片在病變版沒被記成 LCP，正是因為它在畫面上比較大。**
 * 兩點證偽（同一張圖，只加註解位元組，其餘一律不動）：
 *   998 bytes → 0.0451 bpp（< 0.05）→ broken 仍然只有 `p#ls-caption` 一筆 candidate
 *   1198 bytes → 0.0541 bpp（> 0.05）→ broken 立刻多出 `img#ls-figure`，
 *                size 177,000、t = 408ms
 * 門檻就卡在這兩點之間，位置與規則一致。
 *
 * 至於治療版的 LCP 為什麼**比較慢**（約 380ms vs 約 130ms）：
 * 治療版把圖說推到 y = 807.9，整段出摺線 → 圖說從頭到尾不是 candidate；
 * 剩下的 candidate 是內文（83,385）與圖片（100,200），而圖片要等下載完才畫得出來。
 * 病變版的 LCP 是**第一次繪製就定案的文字**，治療版的 LCP 是**要等網路的圖片** ——
 * 這是元素換人造成的，不是「治療讓頁面變慢」。文章若要引用這一格，必須連
 * 「LCP 標的換人」一起講，否則就是把兩個不同的東西放在同一欄比較。
 */
