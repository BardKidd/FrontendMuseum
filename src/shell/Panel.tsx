/**
 * 指標面板 —— 檢驗報告。
 *
 * Phase 0 這裡明文規定是零 CSS 的 `<pre>`（spec §5.3）。那條規定不是美學立場，是排程：
 * 一旦開始排版，一個週末就沒了，而那時標本一個都還沒做出來。六個標本做完之後
 * 那條規定的任務結束了 —— 2026-07-26 依 Phase 3 的視覺工作線改成 DOM 報告。
 *
 * 設計沿用首頁 `/` 已定案的 Hallmark / Almanac 系統（CLAUDE.md「視覺設計系統」一節），
 * 不另挑一套；token 來自根目錄 `tokens.css`，樣式在 `./panel.css`。
 *
 * ⚠️ 這個面板是量測儀器的一部分，不是一般網頁。三條約束：
 *
 *   1. iframe 不隔離 INP 的 presentation 段（spec §3.2）。面板的 style / layout 成本
 *      會落在互動的同一幀 —— panel.css 的禁令清單就是為此存在的，不是風格偏好。
 *   2. 面板每 250ms 由 App.tsx 的節流閘門重繪一次。任何「讀 offsetHeight 之後又寫樣式」
 *      的寫法在這裡是缺陷等級 —— 本館有一整個標本（#3）在講這件事。
 *      這個檔案一次都沒有讀過版面：所有百分比都由已知的數值算出來，交給 CSS 去排。
 *   3. 誠實揭露的欄位一個都不准為了版面消失。具體是：解析度下限三條、未宣告的
 *      CPU throttle、「沒有 entry」與「值是 0」的區別、`max` 不是 `p98`、
 *      hadRecentInput 豁免筆數、量化 clamp、跨輪離散度、輪數不足。
 *      **「未量測」與「量到 0」在視覺上必須分得開**（`NoData` vs `.rep-seg--tick`）——
 *      標本 #3 治療版的全部結論建立在這個區別上。
 *
 * ⚠️ 最後一個 `<pre>`（原始檢體）是驗收契約，不是除錯便利：
 * `tools/acceptance.mjs`、`tools/reproducibility.mjs`、`tools/b-class-isolation.mjs`
 * 都用 `[...document.querySelectorAll('pre')].at(-1)` 抓它 parse JSON。
 * 在它後面再加任何 `<pre>` 就會同時打斷三支工具。
 */
import './panel.css';
import { Fragment } from 'react';
import { MEASURE_CONFIG, PROTOCOL_VERSION } from '../protocol';
import { computeRunStats } from '../measure/metrics';
import type { CSSProperties, ReactNode } from 'react';
import type {
  InteractionSample,
  LoafSample,
  RunConditions,
  RunResult,
  RunStats,
  SpecimenMeta,
  SpecimenMetrics,
  SpecimenModeDef,
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

// ───────────────────────── 小工具 ─────────────────────────

function ms(v: number, digits = 1): string {
  return `${v.toFixed(digits)}ms`;
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
 * 堆疊條一段的寬度百分比。分母是代表互動的 duration。
 *
 * **三段之和可能不等於 duration**（8ms 網格量化造成）。不重新正規化 ——
 * 條不填滿本身就是量化誤差的視覺呈現，湊到 100% 是把誤差藏起來。
 */
function segmentPct(segment: number, duration: number): number {
  if (duration <= 0) return 0;
  const pct = (segment / duration) * 100;
  if (pct < 0) return 0;
  return pct > 100 ? 100 : pct;
}

/**
 * 「還沒量到」的排版。**不准跟「量到 0」共用同一個視覺。**
 *
 * `cls.value === 0` 是「量到了，沒有位移」（治療成功）；`cls === null` 是
 * 「還沒收到任何位移」（可能 observer 根本沒註冊起來）。兩者在面板上長得一樣的話，
 * 標本 #3 與 #5 的治療版就沒有辦法舉證。
 */
function NoData({ children }: { children: ReactNode }) {
  return (
    <span className="rep-nodata">
      <span className="rep-nodata__mark">—</span> {children}
    </span>
  );
}

/**
 * 主打指標落在哪一段。`primaryMetric` 的前綴就是段名
 *（`inp.presentation` / `lcp` / `cls` / `loaf.forcedStyleAndLayout` / `custom.droppedFramesPeak`）。
 *
 * 標記刻意只出現一次：標在兩個地方等於沒標。舊面板一律把 INP 當主打，
 * 於是標本 #2／#4／#5／#6 的面板上，「← 主打指標」指著一個永遠空白的欄位。
 */
function primaryIn(meta: SpecimenMeta, section: 'inp' | 'lcp' | 'cls' | 'loaf' | 'custom'): boolean {
  return meta.primaryMetric.startsWith(section);
}

function PrimaryTag({ meta, section }: { meta: SpecimenMeta; section: Parameters<typeof primaryIn>[1] }) {
  if (!primaryIn(meta, section)) return null;
  return <span className="rep-tag">主打指標 {meta.primaryMetric}</span>;
}

// ───────────────────────── 凍結條件 ─────────────────────────

function Conditions({ p }: { p: PanelProps }) {
  const modeDef = p.meta.modes.find((m) => m.id === p.mode);
  const lesion = modeDef?.kind === 'pathological';
  const dev = p.conditions.device;

  return (
    <section className="rep-sec">
      <h3 className="rep-h">凍結條件 —— 可重現的宣稱只在同一組 conditions 之間成立</h3>
      <p>
        <span className="rep-no">{p.meta.id}</span>
        <span className="rep-name">{p.meta.title}</span>
      </p>
      <p className="rep-sub">{p.meta.subtitle}</p>

      <dl className="rep-kv">
        <dt>mode</dt>
        <dd className={lesion ? 'is-culprit' : undefined}>
          {modeDef?.label ?? '?'}（{modeDef ? (lesion ? '病變' : '治療') : '未知'}）
        </dd>

        <dt>run</dt>
        <dd className="rep-val">{p.runId}</dd>

        <dt>裝置</dt>
        <dd>
          CPU throttle <span className="rep-val">{dev.cpuThrottle}</span> ·{' '}
          <span className="rep-val">
            {dev.refreshHz > 0 ? `${dev.refreshHz}Hz` : '—Hz（量測中）'}
          </span>{' '}
          · viewport{' '}
          <span className="rep-val">
            {p.conditions.viewport.width}×{p.conditions.viewport.height}
          </span>
        </dd>

        <dt>產物</dt>
        <dd>
          build <span className="rep-val">{p.conditions.buildId}</span> · protocol v
          {p.conditions.protocolVersion} · warmup {p.conditions.measure.warmupMs}ms
        </dd>
      </dl>

      {/* JS 偵測不到 DevTools 的 throttling，只能宣告。沒宣告的截圖，三個月後自己也看不懂（spec §2） */}
      {dev.cpuThrottle === 'unknown' && (
        <p className="rep-alert">
          ⚠ CPU throttle 還沒宣告 —— 現在截圖，之後沒有人知道這是幾倍速，等同作廢
        </p>
      )}
    </section>
  );
}

// ───────────────────────── 互動期指標 ─────────────────────────

type SegKey = 'inputDelay' | 'processing' | 'presentation';

/**
 * input delay 與 presentation 永不相鄰（processing 夾在中間），所以交替兩個中性色
 * 就足以讓每一組相鄰段都不同色。第三個顏色留給兇手段 —— accent 稀有才有重量。
 */
const SEGMENTS: ReadonlyArray<{ key: SegKey; name: string; tone: 'a' | 'b' }> = [
  { key: 'inputDelay', name: 'input delay', tone: 'a' },
  { key: 'processing', name: 'processing', tone: 'b' },
  { key: 'presentation', name: 'presentation', tone: 'a' },
];

function InpSection({ p }: { p: PanelProps }) {
  const m = p.metrics;
  const inp = m?.inp ?? null;
  const r: InteractionSample | null = inp?.representative ?? null;
  const head = (
    <h3 className="rep-h">
      互動期指標 · INP
      <PrimaryTag meta={p.meta} section="inp" />
    </h3>
  );

  if (!m || !inp || inp.value === null || r === null) {
    return (
      <section className="rep-sec">
        {head}
        <p className="rep-figure">
          <span className="rep-nodata__mark">—</span>
        </p>
        <div className="rep-bar rep-bar--empty" />
        <p className="rep-note">
          n={m?.totalInteractions ?? 0} · 尚無有效互動樣本。 照操作程序做完{' '}
          {p.meta.protocol.repetitions} 次，數字才會出現。
        </p>
        {/* 捲動與 wheel 依規格不產生 interactionId（INP 明文排除捲動）。
            不標的話，這一欄的空白會被讀成「量測壞了」，而它其實是規格如此。 */}
        {p.meta.protocol.action === 'scroll' && (
          <p className="rep-note">
            這個標本的操作是捲動，而捲動依規格不產生 interactionId —— INP 欄空白是規格如此，
            不是壞掉。跨輪比較請看下方主打指標 {p.meta.primaryMetric}。
          </p>
        )}
      </section>
    );
  }

  // 十次點擊與一百次點擊不會產生同一個統計量。n<50 時算出來的是 max，
  // 把它叫做 p98 就是說謊（spec §4.2 / 驗收第 4 條）。
  const stat = inp.isMaxNotP98 ? 'max（樣本不足 50，非 p98）' : 'p98';
  // duration < 32ms 時 presentation 落在 8ms 網格上，標 ±8ms（spec §4.3 作法第 1 條）
  const coarse = r.duration < 32;

  return (
    <section className="rep-sec">
      {head}

      <p className="rep-figure">
        {Math.round(inp.value)}
        <span className="unit">ms</span>
      </p>
      <p className="rep-note">
        n={m.totalInteractions} · {stat} · 代表互動 {r.eventType}（底下 {r.entryCount} 筆 entry）
      </p>

      <div className={inp.isMaxNotP98 ? 'rep-bar rep-bar--coarse' : 'rep-bar'}>
        {SEGMENTS.map((s) => {
          const pct = segmentPct(r[s.key], r.duration);
          const culprit = p.meta.culprit === s.key;
          const cls = [
            'rep-seg',
            culprit ? 'rep-seg--culprit' : `rep-seg--${s.tone}`,
            // 段為 0（含 presentation 被 clamp）時不讓它消失：改畫 2px 刻度。
            // 消失的話讀者分不出「這段是 0」與「這段沒量到」。
            pct === 0 ? 'rep-seg--tick' : '',
            s.key === 'presentation' && coarse ? 'rep-seg--quantized' : '',
          ]
            .filter(Boolean)
            .join(' ');
          // 沒有 title 屬性 —— 那是原生 tooltip，滑鼠才有的資訊等於沒有。
          // 段名與數字寫在底下的 legend，任何時候都看得到。
          return <div key={s.key} className={cls} style={{ '--pct': String(pct) } as CSSProperties} />;
        })}
      </div>

      <dl className="rep-legend">
        {SEGMENTS.map((s) => {
          const culprit = p.meta.culprit === s.key;
          return (
            <div
              key={s.key}
              className={culprit ? 'rep-legend__row rep-legend__row--culprit' : 'rep-legend__row'}
            >
              <dt>
                {s.name}
                {culprit ? ' ← 兇手在這' : ''}
              </dt>
              <dd>
                {ms(r[s.key])}
                {s.key === 'presentation' && coarse ? ' ±8ms' : ''}
              </dd>
            </div>
          );
        })}
      </dl>

      {coarse && (
        <p className="rep-note">±8ms：duration 已被四捨五入到 8ms 網格，這一段繼承了那個量化</p>
      )}

      {r.presentationClamped && (
        <p className="rep-alert">
          ⚠ presentation 被 clamp 到 0：量化算出負值，代表真實值低於 8ms 網格的解析度。
          通常是好消息（快到量不出來），但它終究是量化假影 ——
          不要拿它當「0ms」宣傳（spec §4.3）
        </p>
      )}
    </section>
  );
}

// ───────────────────────── 載入期指標 ─────────────────────────

/**
 * LCP / CLS。
 *
 * ⚠️ 這一段**不掛在 INP 底下**。舊面板把它寫在「有代表互動」那條分支裡，於是
 * 捲動（#2 / #4）與靜置（#5 / #6）類的標本永遠走不到 —— 主打指標是 LCP 的標本，
 * 面板上一次都沒印出過 LCP。那不是資料沒有，是排版把它擋掉了。
 */
function LoadSection({ p }: { p: PanelProps }) {
  const m = p.metrics;
  const lcp = m?.lcp ?? null;
  const cls = m?.cls ?? null;
  const ignored = m?.custom.clsIgnoredByInput;

  return (
    <section className="rep-sec">
      <h3 className="rep-h">
        載入期指標 · LCP / CLS
        <PrimaryTag meta={p.meta} section="lcp" />
        <PrimaryTag meta={p.meta} section="cls" />
      </h3>

      <dl className="rep-rows">
        <dt className={p.meta.culprit === 'lcp' ? 'is-culprit' : undefined}>
          LCP{p.meta.culprit === 'lcp' ? ' ← 兇手在這' : ''}
        </dt>
        <dd>
          {lcp === null ? (
            <NoData>還沒有 candidate（B 類標本要等資源載入；A 類多半沒有意義）</NoData>
          ) : (
            <>
              <span className="rep-val">{Math.round(lcp.value)}ms</span>
              <span className="rep-band">
                {rate(lcp.value, 2500, 4000)}（門檻 2500 / 4000）
              </span>
              <p className="rep-note rep-break">
                標的 {lcp.elementDescriptor}
                {lcp.url ? ` · ${lcp.url}` : '（文字型，無 url）'}
              </p>
              {/* renderTime 在跨來源資源上會被遮蔽而退回 loadTime，兩個都列才看得出是哪一種 */}
              <p className="rep-note">
                renderTime {ms(lcp.renderTime)} · loadTime {ms(lcp.loadTime)} · 相對 iframe
                自己的 timeOrigin
              </p>
              <p className="rep-note">
                LCP 在第一次互動後就定案 —— 這就是 B 類標本切 mode 必須整份重載的原因
              </p>
            </>
          )}
        </dd>

        <dt className={p.meta.culprit === 'cls' ? 'is-culprit' : undefined}>
          CLS{p.meta.culprit === 'cls' ? ' ← 兇手在這' : ''}
        </dt>
        <dd>
          {cls === null ? (
            <NoData>還沒收到任何 layout-shift entry（「沒有 entry」≠「值是 0」）</NoData>
          ) : (
            <>
              <span className="rep-val">{cls.value.toFixed(4)}</span>
              <span className="rep-band">{rate(cls.value, 0.1, 0.25)}（門檻 0.1 / 0.25）</span>
              <p className="rep-note">
                {cls.sessionCount} 個 session window ·
                回報的是<b>所有 window 的最大值，不是總和</b>（spec §4.5）
              </p>
              {cls.largestShift && (
                <p className="rep-note rep-break">
                  最大單筆位移 {cls.largestShift.value.toFixed(4)} · 來源{' '}
                  {cls.largestShift.sourceDescriptors.join(' , ') || '(無 sources)'}
                </p>
              )}
            </>
          )}
        </dd>
      </dl>

      {typeof ignored === 'number' && ignored > 0 && (
        <p className="rep-alert">
          ⚠ 有 {ignored} 筆位移被 hadRecentInput 豁免（互動後 500ms 內的位移不算 CLS）。
          病變版整批被豁免時面板會顯示 CLS 很小 —— 那是操作程序太早碰畫面，不是標本沒病
        </p>
      )}
    </section>
  );
}

// ───────────────────────── 標本自報欄位 ─────────────────────────

function CustomSection({ p }: { p: PanelProps }) {
  const entries = Object.entries(p.metrics?.custom ?? {});
  if (entries.length === 0) return null;
  const primaryKey = p.meta.primaryMetric.startsWith('custom.')
    ? p.meta.primaryMetric.slice('custom.'.length)
    : null;

  return (
    <section className="rep-sec">
      <h3 className="rep-h">
        標本自報欄位 · custom
        <PrimaryTag meta={p.meta} section="custom" />
      </h3>
      <dl className="rep-rows">
        {entries.map(([k, v]) => (
          <Fragment key={k}>
            <dt className={k === primaryKey ? 'is-culprit' : undefined}>
              {k}
              {k === primaryKey ? ' ← 主打' : ''}
            </dt>
            <dd className="rep-val">{v}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

// ───────────────────────── web-vitals 對帳 ─────────────────────────

function CrossCheckSection({ p }: { p: PanelProps }) {
  const c = p.metrics?.crossCheck;
  if (!c) return null;
  const fmt = (v: number | null, d = 1): string => (v === null ? '—' : v.toFixed(d));

  // 容差一律是**結論級不是數值級**：目的是確認手刻實作沒有錯得離譜，
  // 不是證明它完全正確（spec §5.6 第 8 條）。三條容差各自列在最後一欄。
  const rows: Array<{ name: string; mine: string; lib: string; delta: string; tol: string }> = [
    {
      name: 'inp',
      mine: fmt(p.metrics?.inp?.value ?? null, 0),
      lib: fmt(c.inp, 0),
      delta: fmt(c.deltaInp),
      tol: 'max(24ms, 10%) 且同一 CWV 區間',
    },
    {
      name: 'lcp',
      mine: fmt(p.metrics?.lcp?.value ?? null, 0),
      lib: fmt(c.lcp, 0),
      delta: fmt(c.deltaLcp),
      tol: '50ms 且兩邊選到同一個 elementDescriptor',
    },
    {
      name: 'cls',
      mine: fmt(p.metrics?.cls?.value ?? null, 4),
      lib: fmt(c.cls, 4),
      delta: fmt(c.deltaCls, 4),
      tol: '0.02 或相對 10%，且落在同一門檻區間',
    },
  ];

  return (
    <section className="rep-sec">
      <h3 className="rep-h">web-vitals 對帳 —— 容差走結論級，不是數值級</h3>
      <div className="rep-table-scroll">
        <table className="rep-table">
          <thead>
            <tr>
              <th>指標</th>
              <th>手刻</th>
              <th>web-vitals</th>
              <th>Δ</th>
              <th>容差</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td className="num">{row.mine}</td>
                <td className="num">{row.lib}</td>
                <td className="num">{row.delta}</td>
                <td>{row.tol}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rep-note">
        對不上時先懷疑比對範圍：手刻側只算本輪，web-vitals 算整個 document 生命週期。
      </p>
    </section>
  );
}

// ───────────────────────── LoAF ─────────────────────────

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

function LoafSection({ p }: { p: PanelProps }) {
  const head = (
    <h3 className="rep-h">
      LoAF · 外殼觀測，頁面級，iframe 完全不隔離
      <PrimaryTag meta={p.meta} section="loaf" />
    </h3>
  );

  if (!p.loafSupported) {
    return (
      <section className="rep-sec">
        {head}
        <p className="rep-alert">
          ⚠ 這個瀏覽器沒有 long-animation-frame，LoAF 全欄空白。
          本站宣告 Chromium-only，不寫 fallback（spec §5.3）。
        </p>
      </section>
    );
  }

  if (p.loaf.length === 0) {
    return (
      <section className="rep-sec">
        {head}
        <p className="rep-note">
          <NoData>本輪還沒有 long animation frame</NoData>
        </p>
      </section>
    );
  }

  const worst = pickFrame(p.loaf);
  const pickedBy =
    worst.specimenScriptDuration > 0 ? '依標本 script 最久' : '依 blockingDuration 最久';
  const culprit = p.meta.culprit === 'loaf';

  // LoAF 最大的賣點就是「哪個函式、在哪個字元」。名字變成 n / t 代表 mangle 沒關掉，
  // 標本 #3 的核心證據直接報廢（陷阱 #2 / 驗收第 7 條）。
  const mangled = worst.topScripts.some(
    (s) => s.origin === 'specimen' && s.duration > 8 && s.sourceFunctionName.length <= 2,
  );

  return (
    <section className="rep-sec">
      {head}
      <p className={culprit ? 'rep-note is-culprit' : 'rep-note'}>
        本輪 {p.loaf.length} 幀，代表幀{pickedBy}
        {culprit ? ' ← 兇手在這' : ''}
      </p>

      <dl className="rep-rows">
        <dt>整幀 blockingDuration</dt>
        <dd>
          <span className="rep-val">{ms(worst.blockingDuration)}</span>
          <span className="rep-band">整幀（含外殼）—— 規格上無法拆到單一 script</span>
        </dd>

        <dt>標本 script</dt>
        <dd>
          <span className="rep-val">{ms(worst.specimenScriptDuration)}</span>
          <span className="rep-band">可拆</span>
        </dd>

        <dt>標本 forced layout</dt>
        <dd>
          <span className="rep-val">{ms(worst.specimenForcedStyleAndLayoutDuration)}</span>
          <span className="rep-band">可拆（逐 script，標本 #3 主指標）</span>
        </dd>

        <dt>歸因 attribution</dt>
        <dd className="rep-val">{worst.attribution}</dd>
      </dl>

      {/* 外殼自白 —— 本館的展場承認自己污染了展品。
          改動外殼視覺時的閘門就是盯這個數字（docs/superpowers/plans/baseline-shell-cost.md）。 */}
      <p className="rep-confession">
        外殼在這一幀貢獻 <b>{ms(worst.shellScriptDuration)}</b> —— 本館展場自身的污染，
        不算在標本頭上（spec §3.2）
      </p>

      <p className="rep-note">top scripts（依 duration 取前 5）</p>
      <ol className="rep-list rep-list--scroll">
        {worst.topScripts.map((s, i) => (
          <li key={`${i}-${s.sourceURL}-${s.sourceCharPosition}`}>
            <span>
              [{s.origin}] {ms(s.duration)} · forced {ms(s.forcedStyleAndLayoutDuration)} ·{' '}
              {s.sourceFunctionName.length > 0 ? `${s.sourceFunctionName}()` : '(匿名)'}
            </span>
            <span className="rep-note rep-break">
              {s.sourceURL || '(無 sourceURL)'} @ {s.sourceCharPosition} ← {s.invoker || '?'}（
              {s.invokerType}）
            </span>
          </li>
        ))}
      </ol>

      {mangled && (
        <p className="rep-alert">
          ⚠ 標本的 sourceFunctionName 短到像被 mangle —— 檢查 vite.config 的 keepNames（陷阱 #2）
        </p>
      )}

      {/* 近況：看得出這一輪的節奏，也看得出外殼有沒有在互動期間亂動 */}
      <p className="rep-note">最近幾幀</p>
      <ul className="rep-list rep-list--scroll">
        {p.loaf.slice(-6).map((s, i) => (
          <li key={`${i}-${s.start}`}>
            blocking {ms(s.blockingDuration)} · 標本 {ms(s.specimenScriptDuration)} · 外殼{' '}
            {ms(s.shellScriptDuration)} · {s.attribution}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────────────────── 歷次 run ─────────────────────────

/**
 * 跨輪離散度的及格線。
 *
 * 15% 不是 30%：30% 是 protocol.ts 給**輪內** spread 的提示線，這裡是**跨輪**離散度，
 * 驗收第 16 條的及格線寫的是「三輪 median 相對離散度 ≤ 15%」。
 * 用 30% 的話，一組 20% 的資料會通不過驗收卻在面板上一片安靜。
 */
const REPRODUCIBLE_SPREAD_MAX = 0.15;

/**
 * 一輪要拿哪個數字去跨輪比較 —— **由標本的主指標決定，不是一律用 INP**。
 *
 * 標本 #4／#6 的主指標是 `custom.droppedFramesPeak`，而捲動不產生 `interactionId`，
 * 它們的 `stats.median` 恆為 0。一律看 median 的話，那兩個標本的三輪永遠是
 * 「0 / 0 / 0，離散度 0%」—— 一個看起來完美、實際上什麼都沒判定的結果。
 * 那比沒有判定更危險。
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

interface HistoryRow {
  mode: SpecimenModeDef;
  /** 這個 mode 完成的輪數（含沒有主指標值的那些） */
  runs: number;
  /** 有主指標值的那幾輪，已四捨五入到 runDigits */
  values: number[];
  /** 跨輪統計。values 為空時是 null */
  across: RunStats | null;
  /** 進行中那一輪的值。還沒入帳，也不進 median */
  pending: number | null;
  /** 各輪回報的 max。只有 INP 系的標本有意義 —— 那才是面板頂端報的那個數字 */
  maxes: number[];
}

function HistorySection({ p }: { p: PanelProps }) {
  const inpBased = p.meta.primaryMetric.startsWith('inp');
  const digits = runDigits(p.meta);
  const fmt = (v: number): string => v.toFixed(digits);

  // 進行中那一輪的值也列出來，但標清楚 —— 它還沒入帳，也不進 median
  const liveRaw = inpBased
    ? (p.metrics?.inp?.value ?? null)
    : p.meta.primaryMetric === 'lcp'
      ? (p.metrics?.lcp?.value ?? null)
      : p.meta.primaryMetric === 'cls'
        ? (p.metrics?.cls?.value ?? null)
        : (p.metrics?.custom[p.meta.primaryMetric.replace('custom.', '')] ?? null);
  const live = liveRaw == null ? null : Number(liveRaw.toFixed(digits));

  const rows: HistoryRow[] = [...p.meta.modes]
    .sort((a, b) => a.order - b.order)
    .map((m) => {
      const runs = p.history.filter((r) => r.specimenId === p.meta.id && r.mode === m.id);
      const raw = runs.map((r) => runValue(p.meta, r)).filter((v): v is number => v !== null);
      const values = raw.map((v) => Number(v.toFixed(digits)));
      return {
        mode: m,
        runs: runs.length,
        values,
        // 跟輪內統計用同一支 computeRunStats。全站只准有一份 median / spread 定義。
        across: values.length > 0 ? computeRunStats(values) : null,
        pending: m.id === p.mode ? live : null,
        // max 仍然列出來，因為那才是面板頂端報的那個數字 —— 只是不拿它判定可重現。
        maxes: inpBased ? runs.map((r) => Math.round(r.stats.max)) : [],
      };
    });

  // modes[0] 依協定必須是病變版本（spec §2），比值的分子取它
  const lesionMedian = rows[0]?.across?.median ?? null;

  /**
   * 可重現徽章。**刻意由上面那組 rows 直接推導，不另算一遍。**
   *
   * 徽章是會被引用到文章裡的結論，而它跟表格用同一組樣本 ——
   * 分成兩條路徑算的話，兩邊的 spread 有機會對不起來，而那種不一致沒有任何徵兆。
   * 跟「RunStats 只准有一份實作」是同一個理由。
   *
   * reasons 存在的理由：spec §1 原則 4 是「修變因，不修結論」——
   * 徽章必須指出該修什麼，否則它只是一個沒有行動可循的紅燈。
   */
  const reasons: string[] = [];
  for (const row of rows) {
    if (row.across === null || row.values.length < MEASURE_CONFIG.runsForReproducibility) {
      reasons.push(
        `${row.mode.label}：只有 ${row.values.length} 輪有 ${p.meta.primaryMetric} 的值，需要 ${MEASURE_CONFIG.runsForReproducibility} 輪`,
      );
      continue;
    }
    if (row.across.spread > REPRODUCIBLE_SPREAD_MAX) {
      reasons.push(
        `${row.mode.label}：跨輪離散度 ${Math.round(row.across.spread * 100)}% > ${Math.round(REPRODUCIBLE_SPREAD_MAX * 100)}%`,
      );
    }
  }

  return (
    <section className="rep-sec">
      <h3 className="rep-h">歷次 run —— 同一標本、同一 mode、同一組 conditions 之間才可比</h3>
      <p className="rep-note">
        跨輪比較的是主指標 {p.meta.primaryMetric}
        {inpBased ? ' 的每輪 median' : ' 的每輪終值'}。
        {/* 面板頂端報的 INP 是 max（n<50 時 p98 公式退化成 max），但 max 抗離群為零 ——
            拿它做可重現性判定會製造假警報。protocol.ts 的 RunStats 也是這樣定義的。 */}
        {inpBased ? ' 用 median 不用 max：max 抗離群為零，拿它判定會製造假警報。' : ''}
      </p>

      <div className="rep-table-scroll">
        <table className="rep-table">
          <thead>
            <tr>
              <th>mode</th>
              <th>各輪</th>
              <th>median</th>
              <th>離散度</th>
              <th>vs 病變</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lesion = row.mode.kind === 'pathological';
              const label = `${lesion ? '病變' : '治療'}：${row.mode.label}`;

              if (row.across === null) {
                return (
                  <tr key={row.mode.id} className={lesion ? 'is-lesion' : undefined}>
                    <td>{label}</td>
                    <td colSpan={4}>
                      {row.runs === 0
                        ? row.pending === null
                          ? '（還沒有完成的 run）'
                          : `（進行中 ${fmt(row.pending)}，按「重跑」才入帳）`
                        : `（${row.runs} 輪都沒有 ${p.meta.primaryMetric} 的值）`}
                    </td>
                  </tr>
                );
              }

              const ratio =
                lesion || lesionMedian === null || row.across.median <= 0
                  ? null
                  : lesionMedian / row.across.median;

              return (
                <tr key={row.mode.id} className={lesion ? 'is-lesion' : undefined}>
                  <td>{label}</td>
                  <td className="num">
                    {row.values.map(fmt).join(' / ')}
                    {row.pending === null ? '' : ` (+ 進行中 ${fmt(row.pending)})`}
                  </td>
                  <td className="num">{fmt(row.across.median)}</td>
                  <td className={row.across.spread > REPRODUCIBLE_SPREAD_MAX ? 'num is-culprit' : 'num'}>
                    ±{Math.round(row.across.spread * 100)}%
                  </td>
                  <td className="num">{ratio === null ? '—' : `${ratio.toFixed(1)}×`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.map((row) => (
        <Fragment key={row.mode.id}>
          {row.maxes.length > 0 && (
            <p className="rep-note">
              {row.mode.label} 各輪回報值 max：{row.maxes.join(' / ')}
            </p>
          )}
          {row.across !== null && row.across.spread > REPRODUCIBLE_SPREAD_MAX && (
            // 沒過不代表數字不可信，代表有一個變因沒凍住。修變因，不修結論（spec §1 原則 4）
            <p className="rep-alert">
              ⚠ {row.mode.label} 跨輪離散度 {Math.round(row.across.spread * 100)}% &gt; 15%
              —— 檢查其他分頁、背景下載、throttle 設定
            </p>
          )}
        </Fragment>
      ))}

      <p className={reasons.length === 0 ? 'rep-badge rep-badge--ok' : 'rep-badge'}>
        {reasons.length === 0 ? '可重現 ✓' : '尚未可重現'}
      </p>
      {reasons.length > 0 && (
        <ul className="rep-list">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {/* 這一行是立場，不是註解：best-of 是挑櫻桃，而且對病變版本來說「最佳」的意思還是反的 */}
      <p className="rep-note">
        只列歷次與中位數，不列最佳值 —— best-of 是挑櫻桃，跟本站定位正好相反。
        可重現是重跑出來的，不是宣告出來的（至少 {MEASURE_CONFIG.runsForReproducibility} 輪）。
      </p>
    </section>
  );
}

// ───────────────────────── 診斷訊息 / 檢驗限度 ─────────────────────────

function NotesSection({ p }: { p: PanelProps }) {
  if (p.notes.length === 0) return null;
  return (
    <section className="rep-sec">
      <h3 className="rep-h">診斷訊息（最新在最下面）</h3>
      <ul className="rep-list rep-list--scroll">
        {p.notes.map((n, i) => (
          <li key={`${i}-${n}`}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 三個已知的解析度下限。是「下限」，不是「數字不可信」（spec §1 誠實原則）。
 *
 * 三個都寫出來，因為**誠實標註本身就是教學內容** —— 市面上幾乎沒有人寫這三件事，
 * 而寫清楚「這個工具的解析度到哪裡」比假裝精準更有說服力。
 */
const FLOORS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'durationThreshold 最低 16ms',
    body: '低於 16ms 的互動不會被回報。治療版本可能「快到看不見」',
  },
  {
    title: 'duration 四捨五入到 8ms',
    body: '無法分辨 20ms 與 24ms。分辨 412ms 與 40ms 完全沒問題（spec §4.3）',
  },
  {
    title: 'LoAF blockingDuration 是整幀的',
    body: '無法拆到單一 script，但 forcedStyleAndLayoutDuration 可以（spec §3.3）',
  },
];

function FloorsSection() {
  return (
    <section className="rep-sec">
      <h3 className="rep-h">三個已知的解析度下限</h3>
      <ul className="rep-caveats">
        {FLOORS.map((f) => (
          <li key={f.title}>
            <b>{f.title}</b>
            <span>{f.body}</span>
          </li>
        ))}
      </ul>
      <p className="rep-note">標明限制之後，就大方地下結論。</p>
    </section>
  );
}

// ───────────────────────── 組裝 ─────────────────────────

export function Panel(p: PanelProps) {
  /*
   * 原始傾印：除錯用。LoAF 一輪可能上百幀，全丟進來只會讓 JSON 沒法讀，
   * 所以只留最嚴重的一幀與最近幾幀 —— 這是唯一會影響結論的兩種樣本。
   *
   * ⚠️ loafWorst / loafRecent 是驗收契約，不是除錯便利：
   * tools/acceptance.mjs 的第 5、6、7、12 條直接讀這兩個欄位。
   */
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
    <div className="rep">
      <Conditions p={p} />
      <InpSection p={p} />
      <LoadSection p={p} />
      <CustomSection p={p} />
      <CrossCheckSection p={p} />
      <LoafSection p={p} />
      <HistorySection p={p} />
      <NotesSection p={p} />
      <FloorsSection />

      {/*
        原始檢體。**必須是整份 document 的最後一個 <pre>** ——
        acceptance / reproducibility / b-class-isolation 三支工具都靠
        `[...document.querySelectorAll('pre')].at(-1)` 抓它 parse JSON。
        收合的 <details> 不排版內容，但 textContent 照樣讀得到，三支工具不受影響；
        而它從「永遠攤開的兩千行 <pre>」變成「收合」，外殼的版面成本是往下走的。
      */}
      <details className="rep-dump">
        <summary>原始檢體資料（JSON）</summary>
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </div>
  );
}
