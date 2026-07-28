/**
 * B 類隔離回歸測試 —— 「同一個 mode，量兩次，數字該一樣」。
 *
 * 這條測試存在的理由（2026-07-26 實測查出）：
 *
 * B 類切 mode 會重載 iframe 的 document，但 iframe 與外殼共用同一條 renderer 主執行緒。
 * 前一份 document 的拆除與殘留工作落在**新 document 的時鐘之內**，而 LCP 取的是
 * `entry.startTime`（以新 document 的 timeOrigin 起算）—— 於是 LCP 帶著一個
 * 由「前導 mode 有多重」決定的加項，**而那個加項比標本本身還大**。
 *
 * 最惡劣的地方是它沒有症狀：舊的量測順序讓每個 mode 的前導永遠相同，
 * 污染因此是常數，三輪離散度看起來漂亮，而它靜靜地烙進臂間比值裡。
 *
 * 兩條路徑各量同一個 mode，直接對照：
 *   路徑 A　連續切換（前導不同）　　 —— 修好之前的量測方式
 *   路徑 B　deep-link 全新導覽　　　 —— 目標 mode 就是首載 document，前導成本歸零
 *
 * 判定：路徑 B 的全距必須落在雜訊底線內。路徑 A 只印出來作對照，不參與判定 ——
 * 它本來就是壞的，留著是為了讓「修好了多少」看得見。
 *
 * 用法：node tools/b-class-isolation.mjs [02|05]
 */
import { spawn } from 'node:child_process';

const CHROME = '/opt/brave.com/brave/brave';
const PORT = 9336;
const URL_SHELL = 'http://localhost:4173/measure.html';
/**
 * 開場一律走 `?specimen=00-calibration` 的深連結，**不靠外殼的預設標本**。
 *
 * 2026-07-28：外殼的預設從 `SPECIMENS[0]`（校準件）改成標本 #1 —— 校準件不是六個標本
 * 之一，讓訪客落在它上面是 IA 錯誤。這三支工具當時全部假設「開 measure.html 就會是校準件」，
 * 於是一改就整批掛在「specimen never mounted」。
 *
 * 那個假設從來不是契約，是舊預設值的巧合。工具該明講自己要量什麼 ——
 * 深連結參數本來就存在（App.tsx 的 initialFromUrl），這裡只是開始用它。
 */
const URL_SHELL_CAL = `${URL_SHELL}?specimen=00-calibration`;
const PROFILE = '/tmp/perf-museum-isolation-profile';
const THROTTLE_RATE = 4;
const THROTTLE_LABEL = '4x';

/** LCP 的雜訊底線，與 tools/analyze-repro.mjs 的 PRIMARY['02-long-list'].floor 同源 */
const LCP_FLOOR_MS = 50;

const SPECS = {
  '02': {
    id: '02-long-list', button: '02-long-list', readyMark: '#ll-list',
    trigger: '#ll-list', action: 'scroll', reps: 10, intervalMs: 500, quietMs: 12000,
    /** 受測的 mode，以及路徑 A 要拿來當前導的兩個 mode（一輕一重） */
    target: { id: 'fixed-virtual', label: '治療二：虛擬滾動' },
    predecessors: [
      { id: 'broken', label: '病變：全部渲染' },
      { id: 'fixed-content-visibility', label: '治療一' },
    ],
    metric: (snap) => snap?.metrics?.lcp?.value ?? null,
    metricLabel: 'LCP (ms)',
    floor: LCP_FLOOR_MS,
    /** 路徑 B 的靜置從導覽起算，要蓋住外殼自己在 4x 底下的開機。與 reproducibility.mjs 同值 */
    navQuietMs: 20000,
  },
  '05': {
    id: '05-layout-shift', button: '05-layout-shift', readyMark: '#ls-figure',
    trigger: null, action: 'idle', idleMs: 4000, quietMs: 6000,
    target: { id: 'fixed-image', label: '治療一' },
    predecessors: [
      { id: 'broken', label: '病變' },
      { id: 'fixed-banner', label: '治療三' },
    ],
    metric: (snap) => snap?.metrics?.cls?.value ?? null,
    metricLabel: 'CLS',
    floor: 0.01,
    navQuietMs: 14000,
  },
};

const which = process.argv[2] ?? '02';
const SPEC = SPECS[which];
if (!SPEC) { console.error(`不認得的標本：${which}（可用：${Object.keys(SPECS).join(' / ')}）`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--disable-gpu',
  '--window-size=1400,1600', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d.toString(); });

async function browserWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 還沒起來 */ }
    await sleep(250);
  }
  throw new Error('chrome never came up\n' + stderr);
}

const ws = new WebSocket(await browserWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === undefined) return;
  const p = pending.get(m.id); pending.delete(m.id);
  if (!p) return;
  m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable');
await S('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 120));
  return r.result.value;
}
const ptShell = (text) => evaluate(`(() => {
  const el = [...document.querySelectorAll('button')]
    .find(e => e.textContent.includes(${JSON.stringify(text)}) && !e.disabled);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
})()`);
const ptIn = (sel) => evaluate(`(() => {
  const f = document.querySelector('iframe');
  const el = f && f.contentDocument && f.contentDocument.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const fr = f.getBoundingClientRect(); const b = el.getBoundingClientRect();
  return { x: fr.left + b.left + b.width / 2, y: fr.top + b.top + b.height / 2 };
})()`);
const snap = () => evaluate(`(() => {
  const pres = [...document.querySelectorAll('pre')];
  try { return JSON.parse(pres[pres.length - 1].textContent); } catch { return null; }
})()`);
async function realClick(pt) {
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function clickShell(text) {
  const pt = await ptShell(text);
  if (!pt) throw new Error(`外殼按鈕找不到或已 disabled：「${text}」`);
  await realClick(pt);
}
/** 外殼首載的是 00-calibration，掛載標記跟受測標本不同 */
async function waitMounted0() {
  for (let i = 0; i < 160; i++) {
    const ok = await evaluate(`(() => { const f = document.querySelector('iframe');
      return !!(f && f.contentDocument && f.contentDocument.querySelector('#cal-busy-btn')); })()`).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
async function waitMounted() {
  for (let i = 0; i < 160; i++) {
    const ok = await evaluate(`(() => { const f = document.querySelector('iframe');
      return !!(f && f.contentDocument && f.contentDocument.querySelector(${JSON.stringify(SPEC.readyMark)})); })()`).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

/** 宣告 + 真的節流。兩半都要做（protocol.ts:55「CPU throttle 無法從 JS 偵測」） */
async function declareThrottle() {
  await evaluate(`(() => {
    const sel = document.querySelector('select');
    sel.value = ${JSON.stringify(THROTTLE_LABEL)};
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await S('Emulation.setCPUThrottlingRate', { rate: THROTTLE_RATE });
}

/** 靜置 → 跑 protocol → 靜置 → 讀面板。B 類的載入期指標就是在第一段靜置裡定案的 */
async function sampleHere() {
  await sleep(SPEC.quietMs);
  return sampleHereAfterQuiet();
}

/** 靜置已經在外面做完了（路徑 B 的靜置從導覽起算，要蓋住外殼開機） */
async function sampleHereAfterQuiet() {
  if (SPEC.action === 'scroll') {
    let pt = null;
    for (let k = 0; k < 40 && !pt; k++) { pt = await ptIn(SPEC.trigger); if (!pt) await sleep(250); }
    if (!pt) throw new Error(`找不到觸發元素 ${SPEC.trigger}`);
    for (let k = 0; k < SPEC.reps; k++) {
      await S('Input.dispatchMouseEvent', { type: 'mouseWheel', x: pt.x, y: pt.y, deltaX: 0, deltaY: 120, pointerType: 'mouse' });
      await sleep(SPEC.intervalMs);
    }
  } else {
    await sleep(SPEC.idleMs);
  }
  await sleep(1500);
  const s = await snap();
  return { value: SPEC.metric(s), mode: s?.mode ?? null, cpu: s?.conditions?.device?.cpuThrottle ?? null };
}

// ── 路徑 A：連續切換（修好之前的量測方式）────────────────────────────
log(`\n━━ ${SPEC.id} ━━ 受測 mode：${SPEC.target.id}　指標：${SPEC.metricLabel}\n`);
log('路徑 A —— 連續切換，前導不同（對照組，不參與判定）');
const pathA = [];
for (const pred of SPEC.predecessors) {
  await S('Emulation.setCPUThrottlingRate', { rate: 1 });
  await S('Page.navigate', { url: URL_SHELL_CAL });
  if (!await waitMounted0()) throw new Error('外殼沒有掛載');
  await sleep(1500);
  await declareThrottle();
  await sleep(500);
  await clickShell(SPEC.button);
  if (!await waitMounted()) throw new Error('標本沒有掛載');

  // 先把前導 mode 完整量一遍 —— 前導的「重量」必須真的發生，不能只是載進來
  if (pred.id !== 'broken') await clickShell(pred.label);
  await sampleHere();

  await clickShell(SPEC.target.label);
  const got = await sampleHere();
  pathA.push({ pred: pred.id, ...got });
  log(`  前導 ${pred.id.padEnd(26)} ${SPEC.metricLabel} = ${got.value}   （snapshot.mode=${got.mode}）`);
}

// ── 路徑 B：deep-link 全新導覽（修好之後的量測方式）──────────────────
// 走的必須跟 tools/reproducibility.mjs 的 B 類分支同一條路，否則測到的不是正式量測路徑：
// 節流在導覽之前打開、用 `cpu=` 宣告不按選單、靜置期間不輪詢掛載
log('\n路徑 B —— deep-link 全新導覽，目標 mode 就是首載 document');
const pathB = [];
for (let i = 0; i < 3; i++) {
  await S('Emulation.setCPUThrottlingRate', { rate: THROTTLE_RATE });
  const url = `${URL_SHELL}?specimen=${encodeURIComponent(SPEC.id)}`
    + `&mode=${encodeURIComponent(SPEC.target.id)}&cpu=${encodeURIComponent(THROTTLE_LABEL)}`;
  await S('Page.navigate', { url });
  await sleep(SPEC.navQuietMs);
  if (!await evaluate(`(() => { const f = document.querySelector('iframe');
    return !!(f && f.contentDocument && f.contentDocument.querySelector(${JSON.stringify(SPEC.readyMark)})); })()`)) {
    throw new Error(`deep-link 靜置 ${SPEC.navQuietMs}ms 後仍未掛載`);
  }
  const got = await sampleHereAfterQuiet();
  pathB.push(got);
  log(`  第 ${i + 1} 次　　　　　　　　　　　　　 ${SPEC.metricLabel} = ${got.value}   （snapshot.mode=${got.mode}, cpu=${got.cpu}）`);
}

// ── 判定 ──────────────────────────────────────────────────────────────
const vals = pathB.map((r) => r.value).filter((v) => v !== null);
const wrongMode = pathB.filter((r) => r.mode !== SPEC.target.id);
const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : null;
const aVals = pathA.map((r) => r.value).filter((v) => v !== null);
const aSpread = aVals.length === 2 ? Math.abs(aVals[0] - aVals[1]) : null;

log('\n──────────────────────────────────────────────');
log(`路徑 A 前導造成的差距　${aSpread === null ? '—' : aSpread.toFixed(aSpread < 1 ? 4 : 0)}`);
log(`路徑 B 三次的全距　　　${spread === null ? '—' : spread.toFixed(spread < 1 ? 4 : 0)}　（雜訊底線 ${SPEC.floor}）`);

const failures = [];
if (vals.length < 3) failures.push(`路徑 B 只取到 ${vals.length} / 3 筆有效樣本`);
if (wrongMode.length > 0) failures.push(`deep-link 沒有載到目標 mode：${wrongMode.map((r) => r.mode).join(', ')}`);
if (spread !== null && spread > SPEC.floor) failures.push(`路徑 B 全距 ${spread} 超過雜訊底線 ${SPEC.floor}`);

if (failures.length === 0) {
  log('\n✅ 通過 —— 同一個 mode 量三次，全距在雜訊底線內，前導不再影響數字');
} else {
  log('\n❌ 未通過');
  for (const f of failures) log(`   · ${f}`);
}
ws.close(); chrome.kill();
process.exit(failures.length === 0 ? 0 : 1);
