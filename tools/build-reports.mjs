/**
 * docs/reports/*.md → public/reports/*.html（+ index.html）。
 *
 * 為什麼走 public/ 而不是 vite entry：報告是純靜態文件，不需要 JS、
 * 不在量測路徑上，`public/` 會被逐字複製進 dist —— 零 vite 設定改動，
 * `vite.config.ts` 的 keepNames 三處一個都不用碰。
 *
 * 產出**要 commit**（public/reports/ 進版控）：報告改了跑一次
 * `npm run build:docs` 再 commit，跟量測資料一樣走「產物可審閱」路線。
 *
 * CSS、報頭、章節目錄與文章共用 `tools/lib/doc-shell.mjs` —— 兩份各自維護的樣式
 * 遲早會分岔，而分岔的症狀是「同一個站看起來像兩個站」。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { marked } from 'marked';
import { shell, withToc, wrapTables } from './lib/doc-shell.mjs';

const SRC = 'docs/reports';
const OUT = 'public/reports';
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();

const foot = `<footer class="foot">
  <p>每個數字在文中都附了 JSON 欄位路徑或登記檔行號 ——
  原始資料在 <a href="https://github.com/BardKidd/FrontendMuseum">GitHub repo</a> 的
  <code>docs/measurements/</code>，可自行覆算。臂間比值只在同一份 JSON 內部成立。</p>
  <p><a href="/">← 標本索引</a> <a href="/reports/">報告目錄</a> <a href="/articles/">文章</a> <a href="/measure.html">量測台 →</a></p>
</footer>`;

const index = [];
for (const f of files) {
  const md = readFileSync(`${SRC}/${f}`, 'utf8');
  const m = md.match(/^#\s+(.+)$/m);
  const title = (m ? m[1] : f).replace(/^病理報告\s*·\s*/, '');
  // 索引頁的一句話說明取標本抬頭（md 的第一個 `## `），不另外手寫一份會走鐘的副本
  const sub = md.match(/^##\s+(.+)$/m);
  let html = marked.parse(md, { gfm: true });
  html = wrapTables(html);
  html = withToc(html);
  const out = f.replace(/\.md$/, '.html');
  writeFileSync(`${OUT}/${out}`, shell({ title, body: html, here: 'reports', foot }));
  index.push({ out, title, sub: sub ? sub[1] : '' });
  console.log(`${SRC}/${f} → ${OUT}/${out}`);
}

writeFileSync(
  `${OUT}/index.html`,
  shell({
    title: '病理報告目錄',
    here: 'reports',
    foot,
    body: `
<h1>病理報告 · 目錄</h1>
<p>每個標本一份，固定七節：凍結條件、動工前登記的預期、實測、兇手歸因、
治療梯度、與登記的差異、誠實揭露。<strong>每個數字都附出處</strong>。</p>
<ul class="rlist">
${index.map((r) => `  <li><a href="/reports/${r.out}">${r.title}</a><p>${r.sub}</p></li>`).join('\n')}
</ul>
<p>讀法建議：先看「病症一句話」與「誠實揭露」，再決定要不要信中間那幾節。
每份報告頁首都有章節目錄，可以直接跳過去 —— 一份報告一萬多像素高，不必從頭捲。</p>
`,
  }),
);
console.log(`${OUT}/index.html（${index.length} 份）`);
