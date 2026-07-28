/**
 * 報告與文章共用的文件外殼 —— CSS、報頭、頁尾、章節目錄。
 *
 * 抽出來的理由不是 DRY，是**一致性有強制力**：`/reports/` 與 `/articles/` 是同一座館的
 * 兩種長文件，兩份各自維護的 CSS 遲早會分岔，而分岔的症狀是「同一個站看起來像兩個站」。
 *
 * 設計沿用首頁定案系統（Almanac · anchor hue 28，tokens 見根目錄 `tokens.css`）。
 * 零外部請求（spec §4.7）：樣式全部內嵌、系統字體堆疊、無任何外連資源。
 */

export const CSS = `
  :root {
    --paper:   oklch(97%   0.008 80);
    --paper2:  oklch(94.5% 0.011 78);
    --rule:    oklch(84%   0.010 70);
    --rule2:   oklch(90%   0.008 74);
    --neutral: oklch(58%   0.009 60);
    --muted:   oklch(43%   0.009 55);
    --ink:     oklch(21%   0.011 45);
    --accent:  oklch(45%   0.145 28);
    --focus:   oklch(52%   0.170 28);
    --serif: ui-serif, "Noto Serif CJK TC", "Noto Serif TC", Georgia, serif;
    --sans:  ui-sans-serif, system-ui, "Noto Sans CJK TC", sans-serif;
    --mono:  ui-monospace, "Noto Sans Mono CJK TC", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: var(--sans); line-height: 1.75; font-size: 1rem;
    -webkit-text-size-adjust: 100%;
  }
  .page { max-width: 46rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
  .mast { font-family: var(--mono); font-size: 0.8rem; letter-spacing: 0.05em;
    color: var(--muted); display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem;
    justify-content: space-between; }
  .mast a { display: inline-flex; align-items: center; min-height: 44px;
    color: var(--accent); white-space: nowrap; text-underline-offset: 0.2em; }
  .mast a:hover { color: var(--focus); }
  /* 目前所在的區塊：不是靠顏色一種訊號，加一條底線與實墨字色 ——
     「不准只用顏色表達狀態」是 WCAG 的要求，不是偏好 */
  .mast a[aria-current] { color: var(--ink); text-decoration: none;
    border-bottom: 2px solid var(--accent); }
  .rule  { border: 0; border-top: 3px solid var(--ink);  margin: 0.5rem 0 0; }
  .rule2 { border: 0; border-top: 1px solid var(--rule); margin: 4px 0 2rem; }
  h1 { font-family: var(--serif); font-size: 1.9rem; line-height: 1.3; margin: 0 0 1rem; }
  /* 一份報告一萬多像素高，節與節的邊界必須用掃的就看得到 ——
     舊版七節全是 h4（1rem，跟內文同級），結構等於不存在。
     h2 是**唯一**的分節層級：實墨橫線 + 1.5rem，配上頁首目錄就能跳。 */
  h2 { font-family: var(--serif); font-size: 1.5rem; line-height: 1.35; font-weight: 600;
    margin: 3rem 0 0.75rem; padding-top: 1.25rem; border-top: 2px solid var(--ink);
    scroll-margin-top: 1rem; }
  h3 { font-family: var(--serif); font-size: 1.15rem; margin: 2rem 0 0.5rem;
    scroll-margin-top: 1rem; }
  h4 { font-size: 1rem; margin: 1.5rem 0 0.5rem; }

  /* 頁首目錄。零 JS、零 hover-only 資訊 —— 目錄本身就是可見的導覽，
     所以標題不再另外掛「滑過才出現的錨點連結」。 */
  .toc { margin: 0 0 1rem; padding: 0.75rem 0 0; border-top: 1px solid var(--rule); }
  .toc b { display: block; font-family: var(--mono); font-size: 0.8rem;
    letter-spacing: 0.05em; color: var(--muted); font-weight: 500; }
  .toc ol { list-style: none; padding: 0; margin: 0.25rem 0 0; counter-reset: toc;
    display: flex; flex-wrap: wrap; gap: 0 1.5rem; }
  .toc li { margin: 0; counter-increment: toc; }
  /* 可點擊文字不准斷成兩行；44px 靠 inline-flex 撐，不用 padding-block。
     底線走 text-decoration 而不是 border-bottom —— 後者會畫在 44px 盒子的底緣，
     離文字十幾像素，看起來不像「這幾個字的底線」。 */
  .toc a { display: inline-flex; align-items: center; min-height: 44px;
    white-space: nowrap; text-decoration: underline;
    text-decoration-color: var(--rule); text-decoration-thickness: 1px;
    text-underline-offset: 0.25em; }
  .toc a::before { content: counter(toc) " "; font-family: var(--mono);
    font-size: 0.8em; color: var(--neutral); margin-right: 0.4em;
    text-decoration: none; }
  /* hover 只做顏色，不疊第二種效果 */
  .toc a:hover { color: var(--focus); text-decoration-color: var(--accent); }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
  p { margin: 0.75rem 0; }
  a { color: var(--accent); }
  a:hover { color: var(--focus); }
  /* 側邊色條（border-left 當裝飾）是模板味最重的一招，換成滿框 + 底色。
     引言在這個站承載的是「出處與條件」，它該讀起來像一張夾進來的標籤，不像警告條。 */
  blockquote { margin: 1.25rem 0; padding: 0.75rem 1rem;
    border: 1px solid var(--rule); background: var(--paper2);
    color: var(--muted); }
  blockquote p { margin: 0.5rem 0; }
  blockquote :first-child { margin-top: 0; }
  blockquote :last-child { margin-bottom: 0; }
  code { font-family: var(--mono); font-size: 0.875em;
    background: var(--paper2); padding: 0.1em 0.35em; border-radius: 3px;
    overflow-wrap: anywhere; }
  pre { background: var(--paper2); border: 1px solid var(--rule2);
    padding: 0.75rem 1rem; overflow-x: auto; line-height: 1.6; }
  pre code { background: none; padding: 0; overflow-wrap: normal; }
  h1, h2, h3, h4, p, li { overflow-wrap: anywhere; min-width: 0; }
  .rlist { list-style: none; padding: 0; }
  .rlist li { margin: 0 0 1.25rem; padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--rule2); }
  .rlist li:last-child { border-bottom: 0; }
  .rlist a { display: inline-flex; align-items: center; min-height: 44px;
    font-family: var(--serif); font-size: 1.15rem; }
  .rlist p { margin: 0; font-size: 0.9rem; color: var(--muted); }
  .tw { overflow-x: auto; margin: 1rem 0; }
  table { border-collapse: collapse; font-size: 0.9rem; min-width: 100%; }
  th, td { text-align: left; padding: 0.45rem 0.75rem; vertical-align: top;
    border-bottom: 1px solid var(--rule2); }
  th { font-family: var(--mono); font-weight: 600; font-size: 0.8rem;
    letter-spacing: 0.04em; color: var(--muted);
    border-bottom: 2px solid var(--rule); white-space: nowrap; }
  ul, ol { padding-left: 1.5rem; }
  li { margin: 0.35rem 0; }
  strong { font-weight: 650; }
  .foot { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule);
    font-family: var(--mono); font-size: 0.8rem; color: var(--neutral); }
  .foot a { white-space: nowrap; display: inline-flex; min-height: 44px;
    align-items: center; margin-right: 1.25rem; }
`;

/**
 * 給每個 h2 掛 id，並回傳目錄項。
 *
 * 走字串後處理而不是 marked 的 renderer 覆寫：renderer.heading 的簽章在 marked 各大版本
 * 之間換過三次（字串 → token → this.parser），而這裡只需要「補一個屬性、順便抄下文字」。
 * 少一個會隨相依版本靜默改變行為的接點。
 *
 * slug 保留中日韓字元 —— 分享出去的網址會被 percent-encode，但可讀性歸讀者的網址列所有，
 * 而 `#凍結條件` 比 `#sec-1` 更能看出自己被帶到哪一節。撞名或整串被清空時才退回 sec-N。
 */
/**
 * 目錄那一行的寬度預算，以「全形字」為單位。
 *
 * 是量出來的，不是估的：320px 視窗扣掉 `.page` 左右各 20px 內距 = 280px，
 * 再扣掉編號前綴約 20px，剩約 260px；標籤字級 1rem = 16px，260 / 16 ≈ 16 個全形字。
 * 取 15 留一格餘裕。
 */
const TOC_LABEL_BUDGET = 15;

/** 全形算 1、其餘算 0.55。純粹用來決定「這一行放不放得下」，不是精確排版 */
function visualWidth(s) {
  let w = 0;
  for (const ch of s) w += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.55;
  return w;
}

/**
 * 目錄標籤。**標題本身永遠保留全稱**，砍的只有目錄那一行。
 *
 * 為什麼需要砍：`.toc a` 是 nowrap（可點擊文字不准斷成兩行）。報告的節名是四到六個字，
 * 怎麼排都沒事；文章的 h2 是整句 —— 實測「二、雜訊底噪不是猜的——一段從未執行的
 * 程式碼替我量了它」在目錄裡寬 444px，容器 280px，於是**整個頁面橫向捲了 144px**。
 * 那是四道 gate 裡最嚴重的一條，而且只在文章上站之後才會出現。
 *
 * 三段式，越前面越無損：
 *   1. 砍句尾括號註（標本抬頭的「（Main-thread Block）」）
 *   2. 放不下就取子句頭（在 ——／：／，之前斷）—— 目錄標籤本來就該比標題短，
 *      而這些標點正好是中文的子句界，切出來的一定是標題的真前綴
 *   3. 還是放不下才硬切加刪節號
 */
function tocLabel(text) {
  const base = text.replace(/\s*[（(][^（()）]*[)）]\s*$/, '');
  if (visualWidth(base) <= TOC_LABEL_BUDGET) return base;

  const head = base.split(/——|[：:，]/)[0].trim();
  if (head.length > 0 && head !== base && visualWidth(head) <= TOC_LABEL_BUDGET) return head;

  let out = '';
  for (const ch of head.length > 0 ? head : base) {
    if (visualWidth(out + ch) > TOC_LABEL_BUDGET - 1) break;
    out += ch;
  }
  return `${out}…`;
}

export function withHeadingIds(html) {
  const toc = [];
  const used = new Set();
  const out = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_m, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    let slug = text.replace(/[\s　]+/g, '-').replace(/[^\p{Letter}\p{Number}-]/gu, '');
    if (slug.length === 0 || used.has(slug)) slug = `sec-${toc.length + 1}`;
    used.add(slug);
    toc.push({ slug, text: tocLabel(text) });
    return `<h2 id="${slug}"${attrs}>${inner}</h2>`;
  });
  return { html: out, toc };
}

/** 目錄插在 h1 之後、第一個 h2 之前。長文件一萬多像素高，這是唯一的跳節手段 */
export function withToc(html) {
  const { html: withIds, toc } = withHeadingIds(html);
  if (toc.length === 0) return withIds;
  const nav = `<nav class="toc" aria-label="本頁章節">
  <b>本頁章節</b>
  <ol>
${toc.map((t) => `    <li><a href="#${t.slug}">${t.text}</a></li>`).join('\n')}
  </ol>
</nav>`;
  const at = withIds.indexOf('</h1>');
  return at < 0 ? nav + withIds : withIds.slice(0, at + 5) + '\n' + nav + withIds.slice(at + 5);
}

/** 表格包一層可捲容器 —— 手機門檻：寬內容自己捲，頁面不准橫向捲 */
export function wrapTables(html) {
  return html.replaceAll('<table>', '<div class="tw"><table>').replaceAll('</table>', '</table></div>');
}

/**
 * 站內報頭。四個入口，每一頁都一樣 —— 導覽位置不准依頁型改變。
 * `here` 是目前所在區塊的 key；對應那一項掛 aria-current="page"。
 */
export function mastNav(here) {
  const items = [
    { href: '/', label: '← 標本索引', key: 'index' },
    { href: '/reports/', label: '病理報告', key: 'reports' },
    { href: '/articles/', label: '文章', key: 'articles' },
    { href: '/measure.html', label: '量測台 →', key: 'measure' },
  ];
  const links = items
    .map((i) =>
      i.key === here
        ? `  <a href="${i.href}" aria-current="page">${i.label}</a>`
        : `  <a href="${i.href}">${i.label}</a>`,
    )
    .join('\n');
  return `<nav class="mast" aria-label="站內">
${links}
</nav>
<hr class="rule"><hr class="rule2">`;
}

export function shell({ title, body, here, foot }) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${title} · 前端效能病理標本館</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">
${mastNav(here)}
${body}
${foot}
</div>
</body>
</html>
`;
}
