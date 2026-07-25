/**
 * 指標面板 —— **整個面板就是 `<pre>` 純文字，零 CSS**。
 *
 * 這是 Phase 0 的明文規定（spec §5.3）：「面板的視覺設計、圖表、動畫、三段堆疊條」
 * 全部延後到 Phase 3。這裡是整個專案最容易失控的地方 —— 一旦開始排版，
 * 一個週末就沒了，而標本一個都還沒做出來。
 *
 * 所以這個檔案的作法是：把所有數字組成一大段文字，丟進 `<pre>`。
 * 等寬字型自帶對齊，截圖也好看，而且不可能長出 CSS。
 */
import { MEASURE_CONFIG, PROTOCOL_VERSION } from '../protocol';
import { computeRunStats } from '../measure/metrics';
import type {
  LoafSample,
  RunConditions,
  RunResult,
  SpecimenMeta,
  SpecimenMetrics,
  SpecimenReady,
} from '../protocol';

export interface PanelProps {
  meta: SpecimenMeta;
  mode: string;
  runId: string;
  conditions: RunConditions;
  ready: SpecimenReady | null;
  metrics: SpecimenMetrics | null;
  loaf: LoafSample[];
  loafSupported: boolean;
  history: RunResult[];
  notes: string[];
}

// ───────────────────────── 排版小工具 ─────────────────────────
// 等寬字型下 CJK 與全形符號佔兩格。只影響截圖好不好看，不影響任何數字。

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 韓文字母
    (cp >= 0x2e80 && cp <= 0xa4cf) || // 部首、注音、CJK 統一表意文字
    (cp >= 0xac00 && cp <= 0xd7a3) || // 韓文音節
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 相容表意文字
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK 相容形式（全形括號等）
    (cp >= 0xff00 && cp <= 0xff60) || // 全形 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) //   全形貨幣符號
  );
}

function cols(s: string): number {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return w;
}

function padR(s: string, w: number): string {
  const gap = w - cols(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

function padL(s: string, w: number): string {
  const gap = w - cols(s);
  return gap > 0 ? ' '.repeat(gap) + s : s;
}

function ms(v: number, digits = 1): string {
  return `${v.toFixed(digits)}ms`;
}

const RULE = '─'.repeat(64);

// ───────────────────────── 各段落 ─────────────────────────

function headerLines(p: PanelProps): string[] {
  const modeDef = p.meta.modes.find((m) => m.id === p.mode);
  const kind = modeDef ? (modeDef.kind === 'pathological' ? '病變' : '治療') : '未知';
  const dev = p.conditions.device;
  const hz = dev.refreshHz > 0 ? `${dev.refreshHz}Hz` : '—Hz（量測中）';
  const L = [
    `═══ 前端效能病理標本館 · Phase 0 面板 ═══`,
    `標本   ${p.meta.id} · ${p.meta.title}`,
    `       ${p.meta.subtitle}`,
    `mode   ${p.mode} · ${modeDef?.label ?? '?'}（${kind}）`,
    `run    ${p.runId} · CPU throttle ${dev.cpuThrottle} · ${hz} · viewport ${p.conditions.viewport.width}×${p.conditions.viewport.height}`,
    `build  ${p.conditions.buildId} · protocol v${p.conditions.protocolVersion} · warmup ${p.conditions.measure.warmupMs}ms`,
  ];
  if (dev.cpuThrottle === 'unknown') {
    // JS 偵測不到 DevTools 的 throttling，只能宣告。沒宣告的截圖，三個月後自己也看不懂（spec §2）
    L.push(`⚠ CPU throttle 還沒宣告 —— 現在截圖，之後沒有人知道這是幾倍速，等同作廢`);
  }
  return L;
}

/**
 * CWV 的官方門檻。**只用來標區間，不用來判定好壞。**
 *
 * 本站比的是「同一台機器上病變 vs 治療」，不是「這個網站合不合格」——
 * 4x 節流下的絕對值本來就過不了門檻，那不代表標本壞了。
 * 區間標籤存在的理由只有一個：讓讀者知道自己看的數字在真實世界的哪個位置。
 */
function rate(value: number, good: number, poor: number): string {
  if (value <= good) return '良好';
  return value <= poor ? '需改善' : '差';
}

/**
 * LCP / CLS 段。Phase 0 這兩欄一律是 `—`，Phase 2 補上 observer 之後才有數字。
 *
 * 「沒有 entry」與「數值是 0」必須看得出差別 —— 這是 spec 一路強調的事，
 * 而 CLS 特別容易踩：`value: 0` 是「量到了，沒有位移」，`null` 是「還沒收到任何位移」。
 * 前者是治療成功，後者可能是 observer 根本沒註冊起來。
 */
function loadMetricLines(p: PanelProps, m: SpecimenMetrics): string[] {
  const L: string[] = [];
  const lcpCulprit = p.meta.culprit === 'lcp' ? '   ← 兇手在這' : '';
  const clsCulprit = p.meta.culprit === 'cls' ? '   ← 兇手在這' : '';

  if (m.lcp) {
    const v = m.lcp.value;
    L.push(`LCP    ${padL(String(Math.round(v)), 6)}ms   ${rate(v, 2500, 4000)}（門檻 2500 / 4000）${lcpCulprit}`);
    L.push(`         標的 ${m.lcp.elementDescriptor}${m.lcp.url ? ` · ${m.lcp.url}` : '（文字型，無 url）'}`);
    // renderTime 在跨來源資源上會被遮蔽而退回 loadTime，兩個都列出來才看得出是哪一種
    L.push(`         renderTime ${ms(m.lcp.renderTime)} · loadTime ${ms(m.lcp.loadTime)} · 相對 iframe 自己的 timeOrigin`);
    L.push(`         LCP 在第一次互動後就定案 —— 這就是 B 類標本切 mode 必須整份重載的原因`);
  } else {
    L.push(`LCP    —      還沒有 candidate（B 類標本要等資源載入；A 類多半沒有意義）`);
  }

  if (m.cls) {
    const v = m.cls.value;
    L.push(`CLS    ${padL(v.toFixed(4), 8)}   ${rate(v, 0.1, 0.25)}（門檻 0.1 / 0.25）${clsCulprit}`);
    L.push(`         ${m.cls.sessionCount} 個 session window · 回報的是**所有 window 的最大值，不是總和**（spec §4.5）`);
    if (m.cls.largestShift) {
      const s = m.cls.largestShift;
      L.push(`         最大單筆位移 ${s.value.toFixed(4)} · 來源 ${s.sourceDescriptors.join(' , ') || '(無 sources)'}`);
    }
  } else {
    L.push(`CLS    —      還沒收到任何 layout-shift entry（「沒有 entry」≠「值是 0」）`);
  }

  const ignored = m.custom.clsIgnoredByInput;
  if (typeof ignored === 'number' && ignored > 0) {
    L.push(`         ⚠ 有 ${ignored} 筆位移被 hadRecentInput 豁免（互動後 500ms 內的位移不算 CLS）。`);
    L.push(`            病變版整批被豁免時面板會顯示 CLS 很小 —— 那是操作程序太早碰畫面，不是標本沒病`);
  }
  return L;
}

function inpLines(p: PanelProps): string[] {
  const m = p.metrics;
  if (!m || !m.inp || m.inp.value === null || !m.inp.representative) {
    return [
      `n=${m?.totalInteractions ?? 0} · 尚無有效互動樣本`,
      `INP    —   （照下方操作程序做完 ${p.meta.protocol.repetitions} 次，數字才會出現）`,
    ];
  }

  const inpValue = m.inp.value;
  const r = m.inp.representative;
  // 十次點擊與一百次點擊不會產生同一個統計量。n<50 時算出來的是 max，
  // 把它叫做 p98 就是說謊（spec §4.2 / 驗收第 4 條）。
  const stat = m.inp.isMaxNotP98 ? 'max（樣本不足 50，非 p98）' : 'p98';
  const L = [
    `n=${m.totalInteractions} · ${stat} · 代表互動 ${r.eventType}（底下 ${r.entryCount} 筆 entry）`,
    ``,
    `INP    ${padL(String(Math.round(inpValue)), 6)}ms   ← 主打指標 ${p.meta.primaryMetric}`,
  ];

  const seg = (mark: string, name: string, value: number, culprit: string, extra = ''): string =>
    `  ${mark} ${padR(name, 14)}${padL(ms(value), 9)}${extra}` +
    (p.meta.culprit === culprit ? '   ← 兇手在這' : '');

  L.push(seg('├', 'input delay', r.inputDelay, 'inputDelay'));
  L.push(seg('├', 'processing', r.processing, 'processing'));
  // duration < 32ms 時 presentation 落在 8ms 網格上，標 ±8ms（spec §4.3 作法第 1 條）
  L.push(seg('└', 'presentation', r.presentation, 'presentation', r.duration < 32 ? '  ±8ms' : ''));

  if (r.duration < 32) {
    L.push(`     ±8ms：duration 已被四捨五入到 8ms 網格，這一段繼承了那個量化`);
  }
  if (r.presentationClamped) {
    L.push(
      `     ⚠ presentation 被 clamp 到 0：量化算出負值，代表真實值低於 8ms 網格的解析度。`,
    );
    L.push(
      `        通常是好消息（快到量不出來），但它終究是量化假影 —— 不要拿它當「0ms」宣傳（spec §4.3）`,
    );
  }

  L.push(``);
  L.push(...loadMetricLines(p, m));

  const custom = Object.entries(m.custom);
  if (custom.length > 0) {
    L.push(`custom      ${custom.map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  }
  if (m.crossCheck) {
    const c = m.crossCheck;
    const fmt = (v: number | null, d = 1): string => (v === null ? '—' : v.toFixed(d));
    // 容差一律是**結論級不是數值級**：目的是確認手刻實作沒有錯得離譜，
    // 不是證明它完全正確（spec §5.6 第 8 條）。三條容差各自寫在後面。
    L.push(`crossCheck（web-vitals 對帳；容差走結論級，不是數值級）`);
    L.push(`  inp  手刻 ${fmt(m.inp?.value ?? null, 0)} · lib ${fmt(c.inp, 0)} · Δ ${fmt(c.deltaInp)}   容差 max(24ms, 10%) 且同一 CWV 區間`);
    L.push(`  lcp  手刻 ${fmt(m.lcp?.value ?? null, 0)} · lib ${fmt(c.lcp, 0)} · Δ ${fmt(c.deltaLcp)}   容差 50ms **且兩邊選到同一個 elementDescriptor**`);
    L.push(`  cls  手刻 ${fmt(m.cls?.value ?? null, 4)} · lib ${fmt(c.cls, 4)} · Δ ${fmt(c.deltaCls, 4)}   容差 0.02 或相對 10%，且落在同一門檻區間`);
    L.push(`  對不上時先懷疑比對範圍：手刻側只算本輪，web-vitals 算整個 document 生命週期`);
  }
  return L;
}

/**
 * 挑出要細看的那一幀。
 *
 * 用 blockingDuration 挑是錯的：blockingDuration 是**整幀**的，外殼自己一次
 * 慢渲染就能贏過標本的 300ms 忙迴圈，於是面板細看的變成外殼那一幀，
 * 標本 script 顯示 0.0ms —— 驗收第 5 條要看的數字直接被蓋掉。
 * 本站宣稱的是標本做了多少工，所以先挑標本 script 最久的那一幀；
 * 完全沒有標本 script 時（例如驗收第 6 條的反向歸因）才退回整幀最久的那一幀。
 */
function pickFrame(loaf: LoafSample[]): LoafSample {
  const withSpecimen = loaf.filter((s) => s.specimenScriptDuration > 0);
  const pool = withSpecimen.length > 0 ? withSpecimen : loaf;
  return withSpecimen.length > 0
    ? pool.reduce((a, b) => (b.specimenScriptDuration > a.specimenScriptDuration ? b : a))
    : pool.reduce((a, b) => (b.blockingDuration > a.blockingDuration ? b : a));
}

function loafLines(p: PanelProps): string[] {
  if (!p.loafSupported) {
    return [
      `LoAF   ⚠ 這個瀏覽器沒有 long-animation-frame，LoAF 全欄空白。`,
      `       本站宣告 Chromium-only，不寫 fallback（spec §5.3）。`,
    ];
  }
  if (p.loaf.length === 0) {
    return [`LoAF   本輪還沒有 long animation frame（外殼觀測，頁面級，iframe 不隔離）`];
  }

  const worst = pickFrame(p.loaf);
  const pickedBy =
    worst.specimenScriptDuration > 0 ? '依標本 script 最久' : '依 blockingDuration 最久';
  const isCulprit = p.meta.culprit === 'loaf' ? '   ← 兇手在這' : '';
  const L = [
    `LoAF（外殼觀測；頁面級，iframe 完全不隔離）本輪 ${p.loaf.length} 幀${isCulprit}`,
    `  代表幀（${pickedBy}）：`,
    `    ${padR('整幀 blockingDuration', 26)}${padL(ms(worst.blockingDuration), 9)}   整幀（含外殼）—— 規格上無法拆到單一 script`,
    `    ${padR('標本 script', 26)}${padL(ms(worst.specimenScriptDuration), 9)}   可拆`,
    `    ${padR('標本 forced layout', 26)}${padL(ms(worst.specimenForcedStyleAndLayoutDuration), 9)}   可拆（逐 script，標本 #3 主指標）`,
    `    ${padR('外殼 script', 26)}${padL(ms(worst.shellScriptDuration), 9)}   不算在標本頭上`,
    `    ${padR('歸因 attribution', 26)}${padL(worst.attribution, 9)}`,
    `    top scripts（依 duration 取前 5）：`,
  ];

  worst.topScripts.forEach((s, i) => {
    const name = s.sourceFunctionName.length > 0 ? `${s.sourceFunctionName}()` : '(匿名)';
    L.push(`      ${i + 1}. [${s.origin}] ${padL(ms(s.duration), 9)}  forced ${ms(s.forcedStyleAndLayoutDuration)}  ${name}`);
    L.push(`         ${s.sourceURL || '(無 sourceURL)'} @ ${s.sourceCharPosition}  ← ${s.invoker || '?'}（${s.invokerType}）`);
  });

  // LoAF 最大的賣點就是「哪個函式、在哪個字元」。名字變成 n / t 代表 mangle 沒關掉，
  // 標本 #3 的核心證據直接報廢（陷阱 #2 / 驗收第 7 條）。
  const mangled = worst.topScripts.some(
    (s) => s.origin === 'specimen' && s.duration > 8 && s.sourceFunctionName.length <= 2,
  );
  if (mangled) {
    L.push(`    ⚠ 標本的 sourceFunctionName 短到像被 mangle —— 檢查 vite.config 的 keepNames（陷阱 #2）`);
  }

  // 近況：看得出這一輪的節奏，也看得出外殼有沒有在互動期間亂動
  L.push(`  最近幾幀：`);
  for (const s of p.loaf.slice(-6)) {
    L.push(
      `    blocking ${padL(ms(s.blockingDuration), 8)} · 標本 ${padL(ms(s.specimenScriptDuration), 8)} · 外殼 ${padL(ms(s.shellScriptDuration), 8)} · ${s.attribution}`,
    );
  }
  return L;
}

/**
 * 一輪要拿哪個數字去跨輪比較 —— **由標本的主指標決定，不是一律用 INP**。
 *
 * 這條分派是 Phase 2 才需要的：標本 #4／#6 的主指標是 `custom.droppedFrames`，
 * 而捲動不產生 `interactionId`，它們的 `stats.median` 恆為 0。
 * 一律看 median 的話，那兩個標本的三輪永遠是「0 / 0 / 0，離散度 0%」——
 * 一個看起來完美、實際上什麼都沒判定的結果。那比沒有判定更危險。
 */
function runValue(meta: SpecimenMeta, r: RunResult): number | null {
  const key = meta.primaryMetric;
  if (key.startsWith('inp')) return r.stats.median;
  if (key === 'lcp') return r.lcpFinal?.value ?? null;
  if (key === 'cls') return r.clsFinal?.value ?? null;
  if (key.startsWith('custom.')) return r.customFinal?.[key.slice('custom.'.length)] ?? null;
  // loaf.* 沒有進 RunResult（LoAF 是外殼側的、頁面級的，不屬於某一輪）。
  // 主指標是 LoAF 的標本要靠 custom 自報一個代理值，否則這裡回 null。
  return null;
}

/** 主指標的小數位數。CLS 是無單位小數，其餘是毫秒或次數 */
function runDigits(meta: SpecimenMeta): number {
  return meta.primaryMetric === 'cls' ? 4 : 0;
}

function historyLines(p: PanelProps): string[] {
  const inpBased = p.meta.primaryMetric.startsWith('inp');
  const L = [
    `歷次 run（同一標本、同一 mode、同一組 conditions 之間才可比）`,
    `  跨輪比較的是主指標 ${p.meta.primaryMetric}${inpBased ? ' 的每輪 median' : ' 的每輪終值'}`,
  ];
  const modes = [...p.meta.modes].sort((a, b) => a.order - b.order);
  const digits = runDigits(p.meta);

  // 進行中那一輪的值也列出來，但標清楚 —— 它還沒入帳，也不進 median
  const liveRaw = inpBased
    ? (p.metrics?.inp?.value ?? null)
    : p.meta.primaryMetric === 'lcp'
      ? (p.metrics?.lcp?.value ?? null)
      : p.meta.primaryMetric === 'cls'
        ? (p.metrics?.cls?.value ?? null)
        : (p.metrics?.custom[p.meta.primaryMetric.replace('custom.', '')] ?? null);
  const live = liveRaw == null ? null : Number(liveRaw.toFixed(digits));

  for (const m of modes) {
    const runs = p.history.filter((r) => r.specimenId === p.meta.id && r.mode === m.id);
    const pendingHere = m.id === p.mode ? live : null;

    if (runs.length === 0) {
      const pending =
        pendingHere === null ? '（還沒有完成的 run）' : `（進行中 ${pendingHere}，按「重跑」才入帳）`;
      L.push(`  ${padR(m.label, 22)}${pending}`);
      continue;
    }

    // ⚠️ 跨輪比較用每一輪的 **median**，不是 max。
    // 面板頂端報的 INP 是 max（n<50 時 p98 公式退化成 max），但 max 天生抗離群為零 ——
    // 拿它做可重現性判定會製造假警報：三輪的 max 各差 30% 完全可能只是一筆離群值，
    // 三輪的 median 各差 30% 才真的代表有變因沒凍住。protocol.ts 的 RunStats 也是這樣定義的：
    // 「median：抗離群。可重現性判定用這個，不用 max」。
    const raw = runs.map((r) => runValue(p.meta, r)).filter((v): v is number => v !== null);
    if (raw.length === 0) {
      L.push(`  ${padR(m.label, 22)}（${runs.length} 輪都沒有 ${p.meta.primaryMetric} 的值）`);
      continue;
    }
    const values = raw.map((v) => Number(v.toFixed(digits)));
    const fmt = (v: number): string => v.toFixed(digits);
    const w = Math.max(...values.map((v) => fmt(v).length));
    const listed = values.map((v) => padL(fmt(v), w)).join(' / ');
    // 跟輪內統計用同一支 computeRunStats。全站只准有一份 median / spread 定義。
    const across = computeRunStats(values);
    const med = across.median;
    const spread = across.spread;
    const tail = pendingHere === null ? '' : `   (+ 進行中 ${fmt(pendingHere)})`;
    L.push(
      `  ${padR(m.label, 22)}${listed} · median ${fmt(med)} · ±${Math.round(spread * 100)}%${tail}`,
    );
    if (inpBased) {
      // max 仍然列出來，因為那才是面板頂端報的那個數字 —— 只是不拿它判定可重現。
      L.push(`  ${padR('', 22)}（各輪回報值 max：${runs.map((r) => Math.round(r.stats.max)).join(' / ')}）`);
    }

    // 門檻是 15% 不是 30%：30% 是 protocol.ts 給**輪內** spread 的提示線，
    // 這裡是**跨輪**離散度，驗收第 16 條的及格線寫的是「三輪 median 相對離散度 ≤ 15%」。
    // 用 30% 的話，一組 20% 的資料會通不過驗收卻在面板上一片安靜。
    if (spread > 0.15) {
      // 沒過不代表數字不可信，代表有一個變因沒凍住。修變因，不修結論（spec §1 原則 4）
      L.push(`    ⚠ 跨輪離散度 ${Math.round(spread * 100)}% > 15% —— 檢查其他分頁、背景下載、throttle 設定`);
    }
    if (runs.length < MEASURE_CONFIG.runsForReproducibility) {
      L.push(
        `    （只有 ${runs.length} 輪。可重現是重跑出來的，不是宣告出來的 —— 至少 ${MEASURE_CONFIG.runsForReproducibility} 輪）`,
      );
    }
  }

  // 這一行是立場，不是註解：best-of 是挑櫻桃，而且對病變版本來說「最佳」的意思還是反的
  L.push(`  （只列歷次與中位數，不列最佳值 —— best-of 是挑櫻桃，跟本站定位正好相反）`);
  return L;
}

const FLOOR_LINES = [
  `─── 三個已知的解析度下限（是「下限」，不是「數字不可信」；spec §1 誠實原則）───`,
  `  1. durationThreshold 最低 16ms     低於 16ms 的互動不會被回報。治療版本可能「快到看不見」`,
  `  2. duration 四捨五入到 8ms         無法分辨 20ms 與 24ms。分辨 412ms 與 40ms 完全沒問題（§4.3）`,
  `  3. LoAF blockingDuration 是整幀的  無法拆到單一 script，但 forcedStyleAndLayoutDuration 可以（§3.3）`,
  `  三個都寫在這裡，因為誠實標註本身就是教學內容。標明限制之後，就大方地下結論。`,
];

function buildText(p: PanelProps): string {
  const L: string[] = [];
  L.push(...headerLines(p), RULE);
  L.push(...inpLines(p), RULE);
  L.push(...loafLines(p), RULE);
  L.push(...historyLines(p), RULE);
  if (p.notes.length > 0) {
    L.push(`診斷訊息（最新在最下面）`);
    for (const n of p.notes) L.push(`  ${n}`);
    L.push(RULE);
  }
  L.push(...FLOOR_LINES);
  return L.join('\n');
}

export function Panel(p: PanelProps) {
  // 原始傾印：除錯用。LoAF 一輪可能上百幀，全丟進來只會讓 JSON 沒法讀，
  // 所以只留最嚴重的一幀與最近三幀 —— 這是唯一會影響結論的兩種樣本。
  const worst = p.loaf.length > 0 ? pickFrame(p.loaf) : null;
  const snapshot = {
    protocolVersion: PROTOCOL_VERSION,
    specimenId: p.meta.id,
    mode: p.mode,
    runId: p.runId,
    conditions: p.conditions,
    ready: p.ready,
    metrics: p.metrics,
    loafFrames: p.loaf.length,
    loafWorst: worst,
    /*
     * 最近 6 幀，不是 3 幀。
     *
     * Phase 2 把面板文字加長（LCP / CLS / crossCheck 三段）之後，外殼自己的 render
     * 產生的 LoAF 幀變多了 —— 於是驗收第 6 條（反向歸因）開始間歇性失敗：
     * 它要找的那個「外殼 200ms 忙迴圈」幀，會被後續幾個外殼 render 幀擠出最後 3 幀的視窗。
     * **那不是歸因錯了，是取樣窗太窄。** 放寬到 6 幀；第 12 條（destroy 無殘留）
     * 看的是同一份陣列，窗變寬只會讓它更嚴格，不會放水。
     */
    loafRecent: p.loaf.slice(-6),
    history: p.history.map((r) => ({
      runId: r.runId,
      mode: r.mode,
      startedAt: r.startedAt,
      stats: r.stats,
      cpuThrottle: r.conditions.device.cpuThrottle,
    })),
    notes: p.notes,
  };

  return (
    <>
      <pre>{buildText(p)}</pre>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
    </>
  );
}
