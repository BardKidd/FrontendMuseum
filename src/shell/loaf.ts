/**
 * LoAF 觀測 —— **一律在外殼做，不在 iframe 裡做**。
 *
 * 這不是偷懶，是規格決定的（spec §3.2 / §3.3）：LoAF 是頁面級的，同源 iframe 的
 * frame timing 沿用最近的同源 root，top level page 內**所有** observer 收到同一批 entry。
 * 也就是說在 iframe 裡再註冊一次 observer，拿到的是一模一樣的東西，只是多一份開銷、
 * 多一段 postMessage 協定。
 *
 * iframe 替我們買到的是 LCP/CLS 的 per-document 隔離與 DOM/樣式作用域，
 * **它對 LoAF 一點忙都幫不上**。所以歸因必須自己做（見 classifyScript）。
 */
import type { LoafOrigin, LoafSample, LoafScriptSample } from '../protocol';

/**
 * 「非平凡貢獻」的門檻，用來決定 attribution 要不要標成 'mixed'。
 *
 * 只設絕對門檻是不夠的：外殼一次 React commit 幾 ms，放在 300ms 忙迴圈旁邊也會超過 1ms，
 * 於是每一幀都變成 'mixed'，驗收第 5 條（attribution === 'specimen'）永遠不會過 ——
 * 但那一幀的結論明明就是「兇手是標本」。所以再加一條佔比門檻。
 *
 * 門檻的目的是讓標籤說出正確的**結論**，不是精確描述每一微秒（spec §1 原則 2）。
 */
const NON_TRIVIAL_MS = 1;
const NON_TRIVIAL_SHARE = 0.1;

// W3C LoAF 規格的完整列舉，只有這五個值：
//   enum ScriptWindowAttribution { "self", "descendant", "ancestor", "same-page", "other" };
// 不存在 'same-origin-descendant' / 'other-origin-descendant' 之類的值，別自己加。
/**
 * 歸因規則（凍結），優先序由可靠到不可靠 —— 順序照抄 spec §3.3，不要重排。
 *
 * 前兩條是「規格保證」，第三條是「路徑巧合」。最小可行版其實只靠第三條就夠用
 * （外殼與標本的 sourceURL 本來就不同），前兩條放在前面是因為它們更可靠，
 * 而不是因為我們依賴它們 —— Chrome 哪天沒照規格回傳 window，退回第三條就好。
 */
export function classifyScript(s: PerformanceScriptTiming, iframeWin: Window | null): LoafOrigin {
  // 1. 最可靠：same-origin 下 script.window 直接是 Window 物件
  if (iframeWin && s.window === iframeWin) return 'specimen';
  // 2. 次選：從外殼看，iframe 內的 script 是 'descendant'
  if (s.windowAttribution === 'descendant') return 'specimen';
  if (s.windowAttribution === 'self') return 'shell';
  // 3. Fallback：路徑前綴。最小可行版只用這一條就夠
  if (typeof s.sourceURL === 'string' && s.sourceURL.includes('/specimens/')) return 'specimen';
  if (typeof s.sourceURL === 'string' && s.sourceURL.length > 0) return 'shell';
  return 'unknown';
}

function attribute(specimen: number, shell: number): LoafOrigin | 'mixed' {
  const total = specimen + shell;
  // 這一幀沒有任何可歸因的 script（純 render / 純 layout / 全部 unknown）
  if (total === 0) return 'unknown';

  const specimenMatters = specimen >= NON_TRIVIAL_MS && specimen / total >= NON_TRIVIAL_SHARE;
  const shellMatters = shell >= NON_TRIVIAL_MS && shell / total >= NON_TRIVIAL_SHARE;
  if (specimenMatters && shellMatters) return 'mixed';
  return specimen >= shell ? 'specimen' : 'shell';
}

function buildSample(
  entry: PerformanceLongAnimationFrameTiming,
  iframeWin: Window | null,
): LoafSample {
  let specimenScriptDuration = 0;
  let shellScriptDuration = 0;
  let specimenForcedStyleAndLayoutDuration = 0;
  const scripts: LoafScriptSample[] = [];

  for (const s of entry.scripts) {
    const origin = classifyScript(s, iframeWin);
    if (origin === 'specimen') {
      specimenScriptDuration += s.duration;
      // 只加總 specimen 的那一份 —— forcedStyleAndLayoutDuration 是逐 script 的，
      // 所以它是整包 LoAF 裡**唯一**能乾淨切開外殼與標本的數字，也是標本 #3 的核心指標。
      specimenForcedStyleAndLayoutDuration += s.forcedStyleAndLayoutDuration;
    } else if (origin === 'shell') {
      shellScriptDuration += s.duration;
    }
    scripts.push({
      sourceURL: s.sourceURL,
      sourceFunctionName: s.sourceFunctionName,
      sourceCharPosition: s.sourceCharPosition,
      duration: s.duration,
      forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration,
      invoker: s.invoker,
      invokerType: s.invokerType,
      origin,
    });
  }

  // styleAndLayoutStart 為 0 代表這一幀沒進到 style/layout 階段。
  // lib.dom 沒有現成的 styleAndLayoutDuration 欄位，照規格自己相減。
  const styleAndLayoutDuration =
    entry.styleAndLayoutStart > 0
      ? Math.max(0, entry.startTime + entry.duration - entry.styleAndLayoutStart)
      : 0;

  return {
    // 換算成 epoch ms，才跟 iframe 回報的 startTime 在同一條時間軸上（spec §5.2 第 19 項）
    start: performance.timeOrigin + entry.startTime,
    duration: entry.duration,
    // 整幀的值，規格上無法拆到單一 script。面板必須標「含外殼」
    blockingDuration: entry.blockingDuration,
    styleAndLayoutDuration,
    specimenScriptDuration,
    shellScriptDuration,
    specimenForcedStyleAndLayoutDuration,
    attribution: attribute(specimenScriptDuration, shellScriptDuration),
    topScripts: scripts.sort((a, b) => b.duration - a.duration).slice(0, 5),
  };
}

/**
 * 註冊 LoAF observer，回傳 disconnect。
 *
 * getSpecimenWindow 用 callback 而不是直接吃 Window：iframe 每次重載、每次換標本
 * contentWindow 都會換一個物件，抓一次存起來的話第一條歸因規則就永遠對不上。
 */
export function startLoafObserver(opts: {
  getSpecimenWindow: () => Window | null;
  onSample: (s: LoafSample) => void;
}): () => void {
  // 偵測不到就回 no-op disconnect，讓面板自己顯示警告。
  // 跨瀏覽器 fallback 已宣告不做，這裡三行為止（spec §5.3）。
  if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
    return () => {};
  }

  const po = new PerformanceObserver((list) => {
    // observer callback 裡不准碰 DOM（spec §4.8）。這裡只做純計算 + 交給上層寫進 ref。
    for (const e of list.getEntries()) {
      opts.onSample(buildSample(e as PerformanceLongAnimationFrameTiming, opts.getSpecimenWindow()));
    }
  });

  // buffered: true —— 註冊之前發生的那幾幀也要拿到（陷阱 #13），buffer 上限 200 筆
  po.observe({ type: 'long-animation-frame', buffered: true });
  return () => po.disconnect();
}
