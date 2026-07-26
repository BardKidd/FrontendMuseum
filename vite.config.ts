import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;

/**
 * 每個標本一個獨立 HTML entry（MPA）。
 * 掃描 specimens/*.html，新增標本不必動 config。
 */
function specimenEntries(): Record<string, string> {
  const dir = resolve(root, 'specimens');
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => [f.replace(/\.html$/, ''), resolve(dir, f)]),
  );
}

/**
 * buildId 是 RunConditions 的一部分：換一版 build 就不是同一組條件，
 * 數字不可跨版比較（spec §5.1 第 11 項）。
 */
const buildId = `${process.env.npm_package_version ?? '0.0.0'}-${Date.now().toString(36)}`;

export default defineConfig({
  plugins: [react()],

  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },

  build: {
    target: 'es2022',
    sourcemap: true,

    // ⚠️ 以下三行是量測正確性的一部分，不是打包細節（spec §3.1 / 陷阱 #2）。
    //
    // LoAF 的最大賣點是 sourceFunctionName + sourceCharPosition 能精確指出兇手。
    // 一旦 minifier mangle 掉函式名，拿到的會是 sourceFunctionName: "n"，
    // 標本 #3 的核心證據直接報廢。
    //
    // Vite 8 底層換成 rolldown/oxc，舊的 `esbuild: { keepNames: true }` 已不存在。
    // 對應開關改在 rollupOptions.output：
    //   - output.keepNames       bundler 階段的 rename
    //   - output.minify.mangle.keepNames  minifier 階段的 mangle
    // build.minify 設 false 是為了讓下面的 output.minify 物件形式生效，
    // **不是關掉 minify** —— 產物仍然有壓縮，只是不動函式／類別名。
    minify: false,

    // build.minify: false 會連帶把 CSS 壓縮也關掉（vite 的 cssMinify 預設是
    // 「跟隨 build.minify」）。目前沒有任何 .css 產物所以無感，但第一個 import 樣式表的
    // 標本會在無警告的情況下出未壓縮的 CSS。明寫回來，讓意圖活過那一天。
    cssMinify: 'lightningcss',

    rollupOptions: {
      input: {
        // `/` 是首頁／標本索引（推廣入口）。**不在量測路徑上** ——
        // 它不載入外殼、不掛任何 observer，所以它有 CSS 不違反
        // 「量測站點不准替自己引進污染源」那條紀律。
        // 樣式整段內嵌，零額外請求（tokens.css 只是可攜的匯出副本）。
        index: resolve(root, 'index.html'),
        // 量測台（外殼 + iframe）。2026-07-26 從 `/` 搬到這裡 ——
        // ⚠️ tools/acceptance.mjs 與 tools/reproducibility.mjs 的 URL_SHELL
        // 必須跟著指到 /measure.html，兩邊不同步的話量測會開到首頁去。
        measure: resolve(root, 'measure.html'),
        ...specimenEntries(),
      },
      output: {
        keepNames: true,
        minify: {
          mangle: { keepNames: { function: true, class: true } },
          compress: { keepNames: { function: true, class: true } },
        },
      },
    },
  },

  // Worker 是**另一個 config 介面**，不繼承 build.rollupOptions.output。
  // 少了這塊，標本 #1 的 fixed-worker 那條路徑會出完全沒壓縮的產物，
  // 而同一個標本的同步路徑是壓縮過的 —— 對照實驗的兩臂用不同方式打包，
  // 那就不是「只翻動一個變因」了。
  worker: {
    rolldownOptions: {
      output: {
        keepNames: true,
        minify: {
          mangle: { keepNames: { function: true, class: true } },
          compress: { keepNames: { function: true, class: true } },
        },
      },
    },
  },

  server: { port: 5173 },
  preview: { port: 4173 },
});
