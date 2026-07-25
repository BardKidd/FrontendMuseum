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
  L.push(`LCP / CLS   —（Phase 0 不實作，欄位先存在，補上時不動協定、舊數字不作廢）`);

  const custom = Object.entries(m.custom);
  if (custom.length > 0) {
    L.push(`custom      ${custom.map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  }
  if (m.crossCheck) {
    const c = m.crossCheck;
    L.push(
      `crossCheck  web-vitals inp=${c.inp ?? '—'} Δ=${c.deltaInp ?? '—'}（容差走結論級：max(24ms, 10%) 且同一 CWV 區間）`,
    );
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

function historyLines(p: PanelProps): string[] {
  const L = [`歷次 run（同一標本、同一 mode、同一組 conditions 之間才可比）`];
  const modes = [...p.meta.modes].sort((a, b) => a.order - b.order);

  // 進行中那一輪的值也列出來，但標清楚 —— 它還沒入帳，也不進 median
  const liveValue = p.metrics?.inp?.value;
  const live = liveValue == null ? null : Math.round(liveValue);

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
    const values = runs.map((r) => Math.round(r.stats.median));
    const w = Math.max(...values.map((v) => String(v).length));
    const listed = values.map((v) => padL(String(v), w)).join(' / ');
    // 跟輪內統計用同一支 computeRunStats。全站只准有一份 median / spread 定義。
    const across = computeRunStats(values);
    const med = Math.round(across.median);
    const spread = across.spread;
    const maxes = runs.map((r) => Math.round(r.stats.max)).join(' / ');
    const tail = pendingHere === null ? '' : `   (+ 進行中 ${pendingHere})`;
    L.push(
      `  ${padR(m.label, 22)}${listed} · median ${med} · ±${Math.round(spread * 100)}%${tail}`,
    );
    // max 仍然列出來，因為那才是面板頂端報的那個數字 —— 只是不拿它判定可重現。
    L.push(`  ${padR('', 22)}（各輪回報值 max：${maxes}）`);

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
    loafRecent: p.loaf.slice(-3),
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
