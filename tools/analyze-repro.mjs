/**
 * 把多輪量測併成一份，算出可重現性判定。
 *
 * 判準（spec §1 原則 4）：同一標本同一 mode 的三輪，**主指標**的相對離散度
 * `(max - min) / median` ≤ 0.30，且兇手段三輪一致。
 * 校準標本另用驗收第 16 條的 0.15 —— 它是拿來驗量測底座的，本來就該更嚴。
 *
 * ⚠️ 離散度算在**每輪的 median** 上，不是每輪的 max。
 * `protocol.ts:290`：「抗離群。可重現性判定用這個，不用 max」。
 * 第一版的我拿 forced 峰值跨輪比，標本 #3 算出 52% 判定不可重現；
 * 換成 median 是 9.2%。不可重現的是儀器，不是標本。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , ...files] = process.argv;
if (files.length < 2) {
  console.error('用法：node tools/analyze-repro.mjs <round1.json> <round2.json> ... <out.json>');
  process.exit(1);
}
const out = files.pop();
const rounds = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));

/** 標本 #1 第一輪用的是有缺陷的驅動器（每次點擊都等 CDP 回應 = 事件排不了隊）。
 *  不刪掉 —— 它是「驅動器保真度會翻轉結論」的證據，但不得混進正式數字。 */
const superseded = [];
const merged = new Map();
for (const [i, r] of rounds.entries()) {
  for (const rec of r.records) {
    const key = `${rec.specimenId}|${rec.mode}|${rec.run}`;
    if (merged.has(key)) superseded.push({ ...merged.get(key), supersededByRound: i + 1 });
    merged.set(key, { ...rec, round: i + 1 });
  }
}
const records = [...merged.values()];

/**
 * `floor` = 這個指標的絕對雜訊底線。
 *
 * 相對離散度 `(max-min)/median` 在 median 趨近零時會爆炸：治療版掉幀 4/1/1
 * 算出 300%，判成「不可重現」—— 但絕對差只有 3 幀，是 5 秒視窗裡約 300 幀的 1%。
 * **那是分母的問題，不是標本的問題。** 治療有效正是讓分母趨零，
 * 於是「治療越成功，越判它不可重現」，判準本身把方向搞反了。
 *
 * 底線取指標自己的量子：掉幀是 1 幀（取 5 幀當可容忍雜訊），
 * INP 是 8ms 量化（取 16ms = 兩格），CLS 取 0.01（門檻 0.1 的十分之一）。
 * 絕對全距在底線內就算可重現，不看相對離散度。
 */
const PRIMARY = {
  '00-calibration': { key: 'processing', label: 'INP processing (ms)', threshold: 0.15, floor: 16 },
  '01-main-thread-block': { key: 'statsMedian', label: 'INP median (ms)', threshold: 0.30, floor: 16 },
  '02-long-list': { key: 'lcpValue', label: 'LCP (ms)', threshold: 0.30, floor: 50 },
  '03-layout-thrashing': { key: 'forcedMedian', label: 'forced style&layout median (ms)', threshold: 0.30, floor: 16 },
  '04-unthrottled-events': { key: 'droppedFramesPeak', label: 'dropped frames peak', threshold: 0.30, floor: 5 },
  '05-layout-shift': { key: 'clsValue', label: 'CLS', threshold: 0.30, floor: 0.01 },
  '06-rerender-storm': { key: 'droppedFramesPeak', label: 'dropped frames peak', threshold: 0.30, floor: 5 },
};

/**
 * 補充指標 —— **主指標在某一對臂上飽和、表達不了差異時用**（2026-07-26 新增）。
 *
 * 目前只有標本 #6：1000 台之下，任何仍在整表重建的臂 `droppedFramesPeak`
 * 都貼在 5 秒窗的天花板上（`dropped ≈ 300 − 5000/幀距`：96ms → 248、169ms → 271，
 * **幀距差 1.76 倍只換到 1.09 倍**）。主指標照舊算、照舊報，
 * 但 `broken` 對 `fixed-batch` 那一對的判定要看這一欄。
 *
 * ⚠️ 它只取「這一幀有渲染」的幀距。對每一個 rAF callback 無條件取樣的話，
 * 背壓臂會是「少數 ~100ms 渲染幀 + 大量 16.7ms 跳過幀」，median 與 p75 都會是 16.7，
 * 與細粒度臂逐欄相同 —— 那正是已發出文章第二節在罵的那個缺陷的翻版。
 */
const EXTRA = {
  '06-rerender-storm': {
    key: 'renderFrameGapMedianMs',
    label: '有渲染的幀距 median (ms)',
    threshold: 0.30,
    // 幀距的量子是一個 vsync（60Hz ⇒ 16.7ms）。低於它的差距不是效果，是網格
    floor: 17,
  },
};

/** 有取樣但一筆強制版面都沒有 = 0，不是「沒量到」。
 *  這兩者的差別就是標本 #3 治療版的全部結論 —— 判成 null 會變成「樣本不足」。*/
const SAMPLED_FORCED = new Set(['00-calibration', '03-layout-thrashing']);

function pick(rec, key) {
  switch (key) {
    case 'statsMedian': return rec.stats ? rec.stats.median : null;
    case 'lcpValue': return rec.lcp ? rec.lcp.value : null;
    /*
     * `rec.cls` 為 null 有三種來源，先前一律當成 0：
     *   (a) 真的零位移（vitals.ts 的 ClsCollector 沒有任何 entry）
     *   (b) 瀏覽器不支援 layout-shift entryType，observer 靜默沒啟動
     *   (c) metrics 訊息根本沒到（逾時 / 掛載失敗）
     * 三者併成 0，**方向永遠偏向「治療完美」**。同檔的 SAMPLED_FORCED 正是為了擋
     * 這種錯而存在，CLS 先前沒有等價防線。
     *
     * 判別依據：標本有跑起來就一定 emit 過 shiftSourcesScheduled（或舊名
     * shiftSourcesFired）。有那個欄位就代表觀測管線活著、CLS 真的是 0；
     * 沒有就是沒量到，回 null 讓上游判成 insufficient-runs。
     */
    case 'clsValue': {
      if (rec.cls) return rec.cls.value;
      const ran = rec.custom
        && (rec.custom.shiftSourcesScheduled !== undefined || rec.custom.shiftSourcesFired !== undefined);
      return ran ? 0 : null;
    }
    case 'droppedFramesPeak': return rec.custom?.droppedFramesPeak ?? null;
    case 'renderFrameGapMedianMs': return rec.custom?.renderFrameGapMedianMs ?? null;
    case 'forcedMedian':
      if (rec.forcedMedian !== null && rec.forcedMedian !== undefined) return rec.forcedMedian;
      return SAMPLED_FORCED.has(rec.specimenId) ? 0 : null;
    default: return rec[key] ?? null;
  }
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}

/** 兇手段 = INP 三段裡最大的那一段。三輪都指同一段才算穩定 */
function culpritOf(rec) {
  const parts = { inputDelay: rec.inputDelay, processing: rec.processing, presentation: rec.presentation };
  const known = Object.entries(parts).filter(([, v]) => typeof v === 'number');
  if (!known.length) return null;
  return known.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

const bySpec = new Map();
for (const rec of records) {
  const k = `${rec.specimenId}|${rec.mode}`;
  if (!bySpec.has(k)) bySpec.set(k, []);
  bySpec.get(k).push(rec);
}

const report = [];
for (const [k, recs] of bySpec) {
  const [specimenId, mode] = k.split('|');
  const cfg = PRIMARY[specimenId];
  recs.sort((a, b) => a.run - b.run);
  const vals = recs.map((r) => pick(r, cfg.key)).filter((v) => v !== null);
  const med = vals.length ? median(vals) : null;
  const range = vals.length ? Math.max(...vals) - Math.min(...vals) : null;
  const dispersion = med && med !== 0 ? range / med : (vals.every((v) => v === 0) ? 0 : null);
  const atFloor = range !== null && range <= cfg.floor;
  const culprits = recs.map(culpritOf).filter(Boolean);
  const culpritStable = culprits.length ? culprits.every((c) => c === culprits[0]) : null;

  // 補充指標。沒有登記補充指標的標本一律是 null，**不是 0** ——
  // 0 會被讀成「量到了而且是零」，那正是本檔 clsValue 那條註解在防的錯
  const ex = EXTRA[specimenId] ?? null;
  const exVals = ex ? recs.map((r) => pick(r, ex.key)).filter((v) => v !== null) : [];
  const exMed = exVals.length ? median(exVals) : null;
  const exRange = exVals.length ? Math.max(...exVals) - Math.min(...exVals) : null;

  report.push({
    specimenId, mode,
    metric: cfg.label,
    values: vals,
    median: med,
    range,
    dispersion,
    threshold: cfg.threshold,
    floor: cfg.floor,
    atFloor,
    verdict: vals.length < 3 ? 'insufficient-runs'
      // 絕對全距在雜訊底線內就算可重現。治療有效會把 median 推向零，
      // 只看相對離散度的話「越有效越判不可重現」
      : atFloor ? 'reproducible'
      : dispersion === null ? 'unknown'
      : dispersion <= cfg.threshold ? 'reproducible' : 'unstable',
    culprits,
    culpritStable,
    extraMetric: ex ? ex.label : null,
    extraValues: ex ? exVals : null,
    extraMedian: exMed,
    extraRange: exRange,
    extraAtFloor: ex && exRange !== null ? exRange <= ex.floor : null,
    droppedFramesPeak: recs.map((r) => r.custom?.droppedFramesPeak ?? null),
    sortMs: recs.map((r) => r.custom?.sortMs ?? null).filter((v) => v !== null),
    lcpElement: recs.map((r) => r.lcp?.el ?? null).filter(Boolean)[0] ?? null,
    clsSessionCount: recs.map((r) => r.cls?.sessionCount ?? null).filter((v) => v !== null),
  });
}

report.sort((a, b) => a.specimenId.localeCompare(b.specimenId) || a.mode.localeCompare(b.mode));

// 病變 vs 治療的比值。病變版一律是每個標本的第一個 mode
const ratios = [];
for (const specimenId of new Set(report.map((r) => r.specimenId))) {
  const rows = report.filter((r) => r.specimenId === specimenId);
  const broken = rows.find((r) => r.mode === 'broken' || r.mode === 'busy-300');
  if (!broken || broken.median === null) continue;
  for (const row of rows) {
    if (row === broken) continue;
    // 治療版落在雜訊底線內時不報比值。broken 716ms ÷ 單一 0.1ms 樣本 = 7163×，
    // 那個數字只是在描述除數多小，不是在描述治療多有效 ——
    // 誠實的說法是「治療版該指標為零」
    const treatedAtFloor = row.atFloor && (row.median === null || row.median <= row.floor);
    ratios.push({
      specimenId, treatment: row.mode, metric: row.metric,
      broken: broken.median, treated: row.median,
      treatedAtFloor,
      ratio: row.median === null ? null
        : row.median === 0 || treatedAtFloor ? Infinity
        : broken.median / row.median,
      // 補充指標的比值。主指標飽和時（標本 #6 的 broken vs fixed-batch）
      // 要看這一欄才判得出差異，見 EXTRA 的說明
      extraMetric: row.extraMetric,
      extraBroken: broken.extraMedian,
      extraTreated: row.extraMedian,
      extraRatio: (broken.extraMedian && row.extraMedian)
        ? broken.extraMedian / row.extraMedian : null,
    });
  }
}

/*
 * `Infinity` 經 JSON.stringify 會變成 `null`。輸出檔裡於是出現
 * `"ratio": null, "treated": 0, "treatedAtFloor": true` —— 只讀 JSON 不看 console 的人
 * 會把「治療版該指標為零」誤讀成「比值算不出來」。console 分支有處理，寫檔路徑先前沒有。
 * 改成寫一個明說的字串，並保留 `ratioIsFinite` 讓程式端好判斷。
 */
for (const r of ratios) {
  r.ratioIsFinite = Number.isFinite(r.ratio);
  if (r.ratio === Infinity) r.ratio = 'treatment-at-or-below-noise-floor';
}

writeFileSync(out, JSON.stringify({
  mergedFrom: files,
  measuredAt: rounds[0].measuredAt,
  cpuThrottle: rounds[0].cpuThrottle,
  driver: rounds[0].driver,
  runsPerMode: rounds[0].runsPerMode,
  report, ratios, records, superseded,
}, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('標本', 24) + pad('mode', 26) + pad('三輪主指標', 30) + pad('離散度', 10) + pad('判定', 14) + '兇手');
console.log('─'.repeat(120));
for (const r of report) {
  const vals = r.values.map((v) => (typeof v === 'number' ? (v < 1 ? v.toFixed(4) : v.toFixed(0)) : '—')).join(' / ');
  const disp = r.dispersion === null ? "—" : (r.dispersion * 100).toFixed(1) + "%" + (r.atFloor ? "▽" : "");
  const mark = r.verdict === 'reproducible' ? '✅' : r.verdict === 'unstable' ? '❌' : '⚠';
  const cul = r.culpritStable === null ? '—' : `${r.culprits[0]}${r.culpritStable ? '' : ' ⚠不一致 ' + r.culprits.join(',')}`;
  console.log(pad(r.specimenId, 24) + pad(r.mode, 26) + pad(vals, 30) + pad(disp, 10) + pad(mark + r.verdict, 14) + cul);
}
console.log('\n病變 vs 治療');
console.log('─'.repeat(120));
for (const r of ratios) {
  const rt = r.ratio === null ? '—'
    : !r.ratioIsFinite
      ? (r.treated ? `≫（治療版 ${fmtN(r.treated)}，在雜訊底線內）` : '∞（治療版該指標為零）')
      : r.ratio.toFixed(1) + '×';
  console.log(pad(r.specimenId, 24) + pad(r.treatment, 26) + pad(`${fmtN(r.broken)} → ${fmtN(r.treated)}`, 30) + rt);
}
function fmtN(v) { return v === null ? '—' : v < 1 ? v.toFixed(4) : v.toFixed(0); }
console.log(`\n寫入 ${out}（正式 ${records.length} 筆，被取代 ${superseded.length} 筆）`);
