/**
 * Phase 0 完整驗收（spec §5.6）—— 走 CDP 派送真實輸入。
 * el.click() 不會產生 interactionId，合成事件在這裡等於什麼都沒量到。
 */
import { spawn } from 'node:child_process';

const CHROME = '/usr/bin/brave-browser';
const PORT = 9334;
// 2026-07-26：外殼從 `/` 搬到 `/measure.html`（`/` 現在是首頁／標本索引）
const URL_SHELL = 'http://localhost:4173/measure.html';
const PROFILE = '/tmp/perf-museum-acceptance-profile';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(id, title, ok, detail) {
  results.push({ id, title, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  #${id}  ${title}\n        ${detail}`);
}

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--disable-gpu',
  '--window-size=1400,1600', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d.toString(); });

async function browserWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome never came up\n' + stderr);
}

const ws = new WebSocket(await browserWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id !== undefined) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else events.push(m);
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
await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
await S('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 100));
  return r.result.value;
}
async function realClick(pt) {
  await S('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
}
/** 標本按鈕（在 iframe 內，同源所以可以穿過去算座標） */
const ptIn = (sel) => evaluate(`(() => {
  const f = document.querySelector('iframe');
  const fr = f.getBoundingClientRect();
  const b = f.contentDocument.querySelector('${sel}').getBoundingClientRect();
  f.contentWindow.scrollTo(0, 0);
  return { x: fr.left + b.left + b.width/2, y: fr.top + b.top + b.height/2 };
})()`);
/** 外殼按鈕，用文字找 */
const ptShell = (text) => evaluate(`(() => {
  const el = [...document.querySelectorAll('button, select')]
    .find(e => e.textContent.includes(${JSON.stringify(text)}));
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width/2, y: b.top + b.height/2 };
})()`);
const snap = () => evaluate(`(() => {
  const pres = [...document.querySelectorAll('pre')];
  try { return JSON.parse(pres[pres.length - 1].textContent); } catch { return null; }
})()`);
const panelText = () => evaluate(`[...document.querySelectorAll('pre')][0].textContent`);

// ── 開場 ──────────────────────────────────────────────────────────────
await S('Page.navigate', { url: URL_SHELL });
let ready = false;
for (let i = 0; i < 80 && !ready; i++) {
  await sleep(250);
  try {
    ready = await evaluate(`(() => { const f = document.querySelector('iframe');
      return !!(f && f.contentDocument && f.contentDocument.querySelector('#cal-busy-btn')); })()`);
  } catch {}
}
if (!ready) throw new Error('specimen never mounted');
await sleep(1500); // 過 warmup

const busyBtn = await ptIn('#cal-busy-btn');
const layoutBtn = await ptIn('#cal-layout-btn');

async function runProtocol(n = 10, gap = 1000) {
  for (let i = 0; i < n; i++) { await realClick(busyBtn); await sleep(gap); }
  await sleep(1200);
}

// ── run 1：busy-300 × 10 ───────────────────────────────────────────────
const t0 = Date.now();
await runProtocol();
const s1 = await snap();
const txt1 = await panelText();
const inp1 = s1.metrics.inp;
const rep1 = inp1.representative;

check(1, '面板出數字', inp1.value !== null, `INP=${Math.round(inp1.value)}ms`);
check(2, '已知負載反推 processing 270~330ms',
  rep1.processing >= 270 && rep1.processing <= 330,
  `processing=${rep1.processing.toFixed(1)}ms（忙迴圈設定 300ms）`);
check(3, 'INP 分組正確 totalInteractions === 10',
  s1.metrics.totalInteractions === 10,
  `totalInteractions=${s1.metrics.totalInteractions}（不分組會是 20~30）`);
check(4, '統計量標註 max 非 p98',
  txt1.includes('max（樣本不足 50，非 p98）') && txt1.includes('n=10'),
  `面板字串：${(txt1.match(/n=\d+ · [^\n·]*/) || [''])[0]}`);
const worst = s1.loafWorst;
check(5, 'LoAF 歸因 specimen 且 script ≈ 300ms',
  worst && worst.attribution === 'specimen' && Math.abs(worst.specimenScriptDuration - 300) < 40,
  `attribution=${worst && worst.attribution} specimenScript=${worst && worst.specimenScriptDuration.toFixed(1)}ms shellScript=${worst && worst.shellScriptDuration.toFixed(1)}ms`);
const seqRate = s1.metrics.seq / ((Date.now() - t0) / 1000);
check(9, 'flush 節流（換算 5 秒 ≤ 25 次）',
  seqRate * 5 <= 25,
  `seq=${s1.metrics.seq}，經過 ${((Date.now() - t0) / 1000).toFixed(1)}s → 5 秒約 ${(seqRate * 5).toFixed(1)} 次`);

// ── #7 按鈕 B：強制同步版面重排 ────────────────────────────────────────
await realClick(layoutBtn);
await sleep(1500);
const s7 = await snap();
const forcedFrame = [...(s7.loafRecent || []), s7.loafWorst]
  .filter(Boolean)
  .sort((a, b) => b.specimenForcedStyleAndLayoutDuration - a.specimenForcedStyleAndLayoutDuration)[0];
const forcedScript = forcedFrame && forcedFrame.topScripts.find((x) => x.forcedStyleAndLayoutDuration > 0);
check(7, 'forced layout > 50ms 且函式名可讀',
  !!forcedFrame && forcedFrame.specimenForcedStyleAndLayoutDuration > 50 &&
  !!forcedScript && /^calibration/.test(forcedScript.sourceFunctionName),
  `forced=${forcedFrame ? forcedFrame.specimenForcedStyleAndLayoutDuration.toFixed(1) : '?'}ms sourceFunctionName=${forcedScript ? forcedScript.sourceFunctionName : '(none)'}`);

// ── #6 反向歸因：外殼自己跑 200ms 忙迴圈 ───────────────────────────────
// ⚠️ 不能用 CDP Runtime.evaluate 直接跑忙迴圈：LoAF 的 scripts[] 需要一個可辨識的
// invoker，CDP eval 沒有，於是量到的幀 shellScriptDuration 是 0，看起來像沒發生。
// 要掛一個真的 click listener 再派送真實輸入，那才是「外殼自己在做事」的情境。
const noisePt = await evaluate(`(() => {
  const b = document.createElement('button');
  b.textContent = 'SHELL NOISE 200ms';
  b.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
  function shellSideBusyLoop() { const t = performance.now(); while (performance.now() - t < 200) {} }
  b.addEventListener('click', shellSideBusyLoop);
  document.body.appendChild(b);
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
})()`);
await realClick(noisePt);
await sleep(1500);
const s6 = await snap();
const shellFrames = (s6.loafRecent || []).filter((f) => f.shellScriptDuration > 100);
const specimenPolluted = shellFrames.some((f) => f.specimenScriptDuration > 50);
check(6, '反向歸因：外殼的工作不算在標本頭上',
  shellFrames.length > 0 && !specimenPolluted,
  shellFrames.length
    ? `找到 ${shellFrames.length} 幀 shellScript>100ms，attribution=${shellFrames.map((f) => f.attribution).join(',')}，其中 specimenScript 最大 ${Math.max(...shellFrames.map((f) => f.specimenScriptDuration)).toFixed(1)}ms`
    : `外殼 200ms 忙迴圈沒產生可辨識的 LoAF 幀（loafRecent=${(s6.loafRecent || []).length} 幀，shellScript 最大 ${Math.max(0, ...(s6.loafRecent || []).map((f) => f.shellScriptDuration)).toFixed(1)}ms）`);

// ── #10 + #3b：切 mode，暖機期那一下不得入帳 ──────────────────────────
const modeBtn = await ptShell('忙迴圈 30ms');
await realClick(modeBtn);
await realClick(busyBtn);           // 切完立刻點 —— 落在 500ms 暖機窗內
await sleep(300);
const sWarm = await snap();
check('3b', 'warmup 期間的互動不入帳',
  sWarm.metrics.totalInteractions === 0,
  `切 mode 後立刻點一下，totalInteractions=${sWarm.metrics.totalInteractions}（應為 0）`);

await sleep(1200);
await runProtocol(10, 700);
const s10 = await snap();
const inp10 = s10.metrics.inp.value;
check(10, 'A 類 live 切換：舊 mode 樣本不混入',
  s10.metrics.totalInteractions === 10 && inp10 < 150,
  `新 mode（30ms）INP=${Math.round(inp10)}ms n=${s10.metrics.totalInteractions}；混入舊 mode 的話會是 300 級`);

// ── #16 可重現性：同一 mode 連跑三輪 ──────────────────────────────────
const back = await ptShell('忙迴圈 300ms');
await realClick(back);
await sleep(1200);
for (let r = 0; r < 3; r++) {
  await runProtocol(10, 700);
  const rerunBtn = await ptShell('重跑');
  await realClick(rerunBtn);
  await sleep(600);
}
const s16 = await snap();
const runs300 = s16.history.filter((h) => h.mode === 'busy-300');
const meds = runs300.map((h) => h.stats.median);
const sortedMeds = [...meds].sort((a, b) => a - b);
const medOfMeds = sortedMeds.length % 2 ? sortedMeds[(sortedMeds.length - 1) / 2]
  : (sortedMeds[sortedMeds.length / 2 - 1] + sortedMeds[sortedMeds.length / 2]) / 2;
const dispersion = medOfMeds > 0 ? (sortedMeds[sortedMeds.length - 1] - sortedMeds[0]) / medOfMeds : 1;
check(16, '可重現性：三輪 median 相對離散度 ≤ 15%',
  runs300.length >= 3 && dispersion <= 0.15,
  `三輪 median=${meds.map((m) => Math.round(m)).join(' / ')} → 離散度 ${(dispersion * 100).toFixed(1)}%`);

// ── #12 destroy 無殘留：換標本後靜置 5 秒 ─────────────────────────────
const sw = await ptShell('主執行緒阻塞');
if (sw) await realClick(sw);
await sleep(2000);
const markT = (await snap()) && Date.now();
await sleep(5000);
const s12 = await snap();
const strays = (s12.loafRecent || []).filter((f) => f.attribution === 'specimen' && f.start > markT);
check(12, 'destroy 無殘留：換標本後靜置 5 秒無新的 specimen LoAF',
  strays.length === 0,
  `靜置期間新的 specimen LoAF 幀數 = ${strays.length}`);

// ── #15 throttle 宣告寫進 snapshot ────────────────────────────────────
await evaluate(`(() => {
  const sel = document.querySelector('select');
  sel.value = '4x';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(600);
const s15 = await snap();
check(15, 'CPU throttle 宣告寫進 snapshot',
  s15.conditions.device.cpuThrottle === '4x',
  `conditions.device.cpuThrottle=${s15.conditions.device.cpuThrottle}`);

// ── 收尾 ──────────────────────────────────────────────────────────────
const errs = events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map((e) => e.params.entry.text);
console.log('\n================ 總結 ================');
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} / ${results.length} 通過`);
if (failed.length) console.log('未通過：' + failed.map((f) => '#' + f.id).join(', '));
if (errs.length) console.log('\nconsole errors:\n' + [...new Set(errs)].join('\n'));
chrome.kill();
process.exit(failed.length ? 1 : 0);
