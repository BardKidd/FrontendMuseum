/**
 * 標本 #5 —— 版面位移（CLS）。**B 類，切 mode 重載。**
 *
 * 三個位移源疊加，刻意排在載入後 300ms / 900ms / 1500ms：
 *   1. `<img>` 沒有 width/height —— 載入完成時從 0 高撐開，把下方內容整個推下去
 *   2. 字族 metric 不合 —— 文字重排，區塊高度改變
 *   3. 1500ms 後從**上方**插入通知橫幅 —— 整頁往下跳
 *
 * **間隔刻意都小於 `clsSessionGapMs`（1000ms）**，所以三次位移落進**同一個 session window**
 * 並累加。這正是本標本的教學重點：把間隔改成 1.2 秒就會變成三個 session，
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
/** 橫幅高度。治療版預留同樣的高度 */
const BANNER_HEIGHT = 64;

let ctxRef: SpecimenContext | null = null;
let rootRef: HTMLElement | null = null;
let currentMode = 'broken';
let timers: number[] = [];

let figureEl: HTMLImageElement | null = null;
let proseEl: HTMLElement | null = null;
let bannerSlotEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;

let firedSources = 0;

function isFixed(): boolean {
  return currentMode === 'fixed';
}

function note(text: string): void {
  firedSources += 1;
  if (statusEl) statusEl.textContent = `${firedSources}/3 · ${text}`;
  ctxRef?.emit({
    shiftSourcesFired: firedSources,
    imageAtMs: IMAGE_AT_MS,
    fontAtMs: FONT_AT_MS,
    bannerAtMs: BANNER_AT_MS,
  });
}

/**
 * 位移源一 —— 沒有尺寸的圖片。
 *
 * `src` 刻意等到 300ms 才設：圖片在 DOM 裡但還沒有內容時高度是 0，
 * 載入完成的那一刻它撐開成 360px，下方所有內容一次被推下去。
 * 這就是「`<img>` 沒寫 width/height」在真實網站上發生的事，只是時間點被我們釘死了。
 *
 * **cache buster 是必要的，不是保險**：沒有它，第二次載入命中快取、
 * 圖片在第一幀就有尺寸、位移消失 —— 而面板上看起來像治療生效了（spec:1126）。
 */
function fireImageShift(): void {
  if (!figureEl) return;
  ctxRef?.mark('layout-shift:image');
  figureEl.src = `/specimen-05-figure.svg?t=${Date.now()}`;
  note(isFixed() ? '圖片載入（已用 aspect-ratio 預留空間，不位移）' : '圖片載入 → 撐開 360px');
}

/**
 * 位移源二 —— 字族 metric 不合造成文字重排。
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
  proseEl.style.fontFamily = 'monospace';
  proseEl.style.fontSize = '19px';
  note(isFixed() ? '字族換入（已預留高度，不位移）' : '字族換入 → 文字重排');
}

/**
 * 位移源三 —— 從上方插入通知橫幅。
 *
 * 治療版不是「不插橫幅」，而是**預留空間**：
 * 位置一開始就佔著，橫幅出現時填進去，下方一動也不動。
 * 另一個等價作法是 `position: fixed` 疊在內容上方（不進文檔流），
 * 那在通知類 UI 上更常見，代價是會遮住內容。
 */
function fireBannerShift(): void {
  if (!bannerSlotEl) return;
  ctxRef?.mark('layout-shift:banner');
  const banner = document.createElement('div');
  banner.className = 'ls-banner';
  banner.textContent = '⚠ 系統將於今晚 23:00 進行維護，屆時服務將短暫中斷。';
  bannerSlotEl.replaceChildren(banner);
  note(isFixed() ? '橫幅插入（空間已預留，不位移）' : '橫幅插入 → 整頁往下跳');
}

function mount(root: HTMLElement, ctx: SpecimenContext): void {
  ctxRef = ctx;
  rootRef = root;
  currentMode = ctx.mode;
  const fixed = isFixed();

  root.innerHTML = `
    <style>
      /*
        ⚠️ 這一段就是病變與治療的**全部差異**。
        兩個 mode 的 HTML 結構、時序、內容完全相同，只有這幾條規則不同 ——
        對照乾淨到可以直接貼進文章。
      */

      /* 位移源一：治療版用 aspect-ratio 保留空間。
         寬度已知、比例已知，瀏覽器在圖片還沒下載完就能算出高度。 */
      .ls-figure { display: block; width: ${FIGURE_WIDTH}px; max-width: 100%; }
      .ls-fixed .ls-figure { aspect-ratio: ${FIGURE_WIDTH} / ${FIGURE_HEIGHT}; }

      /* 位移源二：治療版預留足夠高度，字族換入時區塊高度不變。
         ⚠️ 這是替代作法 —— 真正的解是 size-adjust / ascent-override 把 fallback
         的 metric 對齊實際字型，那需要一個自架的字型檔（見 fireFontShift 的說明）。 */
      .ls-prose { font-family: serif; font-size: 17px; line-height: 28px; }
      .ls-fixed .ls-prose { min-height: 168px; }

      /* 位移源三：治療版一開始就佔著橫幅的高度 */
      .ls-banner-slot { min-height: 0; }
      .ls-fixed .ls-banner-slot { min-height: ${BANNER_HEIGHT}px; }
      .ls-banner {
        height: ${BANNER_HEIGHT}px;
        line-height: ${BANNER_HEIGHT}px;
        background: #fde68a;
        padding: 0 12px;
        box-sizing: border-box;
      }
    </style>

    <div class="${fixed ? 'ls-fixed' : ''}">
      <div class="ls-banner-slot" id="ls-banner-slot"></div>

      <h1>標本 #5 —— 版面位移（CLS）</h1>
      <p id="ls-status">載入中 · 三個位移源將於 ${IMAGE_AT_MS} / ${FONT_AT_MS} / ${BANNER_AT_MS}ms 觸發</p>
      <p><strong>請載入後靜置三秒，不要碰畫面。</strong>
         使用者互動後 500ms 內的位移會被 <code>hadRecentInput</code> 豁免、不算 CLS ——
         提早點一下，這個標本的數字就會變成 0，而且看起來很正常。</p>

      <img class="ls-figure" id="ls-figure" alt="位移來源一：沒有尺寸的圖片">

      <div class="ls-prose" id="ls-prose">
        三次位移的間隔都是 600ms，小於 CLS session window 的 1000ms 間隔上限，
        所以它們會落進同一個 session 並累加。把間隔拉到 1.2 秒，同樣的三次位移會變成
        三個獨立的 session，而 CLS 只取最大的那一個 —— 數字會小很多，
        但畫面上跳動的程度一模一樣。這就是為什麼「CLS 是最大值不是總和」這件事
        必須先講清楚，否則讀者會以為把位移拆散就等於修好了。
      </div>
    </div>
  `;

  figureEl = root.querySelector<HTMLImageElement>('#ls-figure')!;
  proseEl = root.querySelector<HTMLElement>('#ls-prose')!;
  bannerSlotEl = root.querySelector<HTMLElement>('#ls-banner-slot')!;
  statusEl = root.querySelector<HTMLElement>('#ls-status')!;

  timers = [
    window.setTimeout(fireImageShift, IMAGE_AT_MS),
    window.setTimeout(fireFontShift, FONT_AT_MS),
    window.setTimeout(fireBannerShift, BANNER_AT_MS),
  ];

  ctx.emit({
    shiftSourcesFired: firedSources,
    imageAtMs: IMAGE_AT_MS,
    fontAtMs: FONT_AT_MS,
    bannerAtMs: BANNER_AT_MS,
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
