/**
 * docs/articles/*.md → public/articles/*.html（+ index.html）。
 *
 * 為什麼這支存在：三篇成稿躺在 `docs/articles/` 裡沒有入口。首頁唯一那個連結指向
 * `/docs/articles/01-....md`，而 `docs/` 不進 `dist/` —— preview 的 fallback 會把首頁
 * 再吐一次（點下去像沒反應），正式站是 404。文章不上站，等於沒寫。
 *
 * 走 public/ 與 build-reports.mjs 同一個理由：純靜態、不需要 JS、不在量測路徑上，
 * `public/` 逐字複製進 dist，零 vite 設定改動。產出**要 commit**。
 *
 * ⚠️ 本站規矩：已發出的文章不回頭改數字（CLAUDE.md 第 5 條）。
 * 這支只做 md → html，不碰內容；要修正就寫下一篇。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { marked } from 'marked';
import { shell, withToc, wrapTables } from './lib/doc-shell.mjs';

const SRC = 'docs/articles';
const OUT = 'public/articles';
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.md')).sort();

const foot = `<footer class="foot">
  <p>已發出的文章不回頭改數字 —— 這是有日期、附原始資料連結的快照，
  後續發現問題就寫下一篇，不是改上一篇。原始資料在
  <a href="https://github.com/BardKidd/FrontendMuseum">GitHub repo</a> 的
  <code>docs/measurements/</code>，可自行覆算。</p>
  <p><a href="/">← 標本索引</a> <a href="/articles/">文章目錄</a> <a href="/reports/">病理報告</a> <a href="/measure.html">量測台 →</a></p>
</footer>`;

const index = [];
for (const f of files) {
  const md = readFileSync(`${SRC}/${f}`, 'utf8');
  const m = md.match(/^#\s+(.+)$/m);
  const title = m ? m[1] : f;
  /*
   * 索引頁的副標取每篇開頭那段引言的第一行（「前端效能病理標本館 · 第一篇 …」）。
   * **不從檔案推導發表日期**：md 裡出現的日期全是量測檔的日期，不是發表日，
   * 把它印成發表日就是編一個數字 —— 這個站唯一的資產就是數字可追溯。
   */
  const lead = md.match(/^>\s*(前端效能病理標本館[^\n]*)$/m);
  let html = marked.parse(md, { gfm: true });
  html = wrapTables(html);
  html = withToc(html);
  const out = f.replace(/\.md$/, '.html');
  writeFileSync(`${OUT}/${out}`, shell({ title, body: html, here: 'articles', foot }));
  index.push({ out, title, sub: lead ? lead[1] : '' });
  console.log(`${SRC}/${f} → ${OUT}/${out}`);
}

writeFileSync(
  `${OUT}/index.html`,
  shell({
    title: '文章目錄',
    here: 'articles',
    foot,
    body: `
<h1>文章 · 目錄</h1>
<p>報告是逐個標本的檢驗紀錄，文章是把它們讀成一句結論的地方。
三篇都附原始資料檔名，每個比值都能覆算。<strong>已發出的不回頭改數字</strong> ——
後來翻案的部分寫在下一篇，前一篇原地保留。</p>
<ul class="rlist">
${index.map((r) => `  <li><a href="/articles/${r.out}">${r.title}</a><p>${r.sub}</p></li>`).join('\n')}
</ul>
<p>沒讀過這個站的話從第三篇開始 —— 它是入口總覽，不產生新數字，
把另外兩篇與六份報告串成一條線。</p>
`,
  }),
);
console.log(`${OUT}/index.html（${index.length} 篇）`);
