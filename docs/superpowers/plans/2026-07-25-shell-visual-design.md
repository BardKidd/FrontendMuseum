# 外殼視覺設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「前端效能病理標本館」的外殼從零 CSS 的 `<pre>` 傾印，改造成一份檔案館標本標籤風格的檢驗報告，且不讓外殼自身的繪製成本污染量測。

**Architecture:** 面板從單一 `<pre>` 拆成六個各吃自己那塊 props 的 DOM 元件（`src/shell/panel/`），視覺全部走一份 `src/shell/shell.css`。衍生值（堆疊條百分比、比值、可重現徽章）抽成 `src/shell/derive.ts` 的純函式，先寫測試再實作。`App.tsx` 的量測邏輯一行都不改，只加 `className` 與調整 JSX 結構。

**Tech Stack:** React 19 + TypeScript 7 + Vite 8（rolldown/oxc）+ vanilla CSS + vitest（新增，僅測試用）

**Spec:** [`docs/superpowers/specs/2026-07-25-shell-visual-design.md`](../specs/2026-07-25-shell-visual-design.md)

---

## Global Constraints

以下每一條在每個 task 都成立，不會重複列在各 task 裡。

### 環境現況（動工前必讀）

- **這個目錄不是 git repo。** `git rev-parse --show-toplevel` 回 `/home/valens/Projects`（父目錄，零 commit，底下還有四個不相關專案）。作者已明確表示這輪不提交。**因此本計畫所有 task 以「驗證檢查點」結尾，沒有 commit 步驟。** 每個檢查點都要真的跑指令、真的看輸出
- **沒有測試框架。** Task 2 會加 `vitest`。這超出 spec §0.1 的範圍宣告（那裡只列 `src/shell/`、`index.html`、`tools/acceptance.mjs`、`src/specimens.ts` 的一個常數）。**理由：比值與可重現徽章的公式算錯會直接印出錯的數字給文章引用，是全案唯一「錯了不會有任何徵兆」的地方。** `vitest` 是 devDependency，不進產物，不影響 `vite build`
- Node v22.23.1、linux-arm64。`lightningcss` 已在 `node_modules`，`vite.config.ts:55` 的 `cssMinify: 'lightningcss'` 在第一個 `.css` 出現時不會失敗

### 不准碰

- **`specimens/` 下一行都不改。** 標本內部的 style / layout 成本本身就是量測對象，改它等於換一版產物，`01-main-thread-block` 已有的數字全部作廢
- **`src/protocol.ts` 一個欄位都不加。** 協定已凍結
- **`src/specimens.ts` 只准加 `TOTAL_SPECIMENS` 常數**，既有 metadata 一個字都不改（`viewport` / `id` / `protocol` 任一欄改動 = 歷史數字作廢）
- **`App.tsx` 的量測邏輯一行都不改**：250ms 節流閘門（`scheduleCommit`）、ref-only 訊息處理器、`awaitingResetRef` 閘門、`finalizeRun` / `startNewRun` / `switchMode` / `switchSpecimen` 全部照原樣
- **`src/measure/` 下一行都不改**
- iframe 的 `width` / `height` 永遠是取自 `meta.viewport` 的 HTML 屬性。**不准出現 `%` / `vw` / `vh` / `transform: scale`**

### CSS 紀律（spec §6，每一條都是硬規則）

1. 外殼全域禁 `transition` / `animation` / `@keyframes`
2. 禁 `box-shadow` / `filter` / `backdrop-filter` / `opacity` 動態變化 / `border-radius > 2px`
3. `:hover` / `:focus-visible` 只准改 `color` / `background-color` / `text-decoration` / `outline`。**不准改盒模型**（padding / border-width / font-size / margin）
4. 每個報告區塊 `contain: content`。長列表另加 `content-visibility: auto` + `contain-intrinsic-size`
5. 禁 `position: sticky` 與 `position: fixed`
6. 一份 `src/shell/shell.css`，`index.html` 的 `<head>` 裡 `<link>` 進來。**不 inline `<style>`、不從 JS `import './shell.css'`** —— 從 JS import 會讓樣式在 JS 執行後才注入，多一次 style recalc
7. 文字容器欄寬用 `ch` 或 grid 固定軌，不用 `%`
8. 不新增任何 `<img>` / `<svg>` / icon font。記號用文字字元：`▓ ░ ● ○ ├ └ ← ▸ ✓ ⚠`

### 設計 token（逐字照抄，不准調色）

```css
--ink:    #1a1a18;   /* 正文，16.4:1 */
--paper:  #faf8f3;   /* 骨白紙底 */
--rule:   #d8d3c8;   /* hairline 分隔（裝飾） */
--lesion: #a3231c;   /* 病變，7.0:1 */
--remedy: #1f5d5a;   /* 治療，7.0:1 */
--void:   #c0392b;   /* 檢驗無效印章底，配白字 5.4:1 */
--seg-a:  #8a8a85;   /* 堆疊條淺段，3.3:1 */
--seg-b:  #4a4a46;   /* 堆疊條深段，8.4:1 */
```

### TypeScript 現況（違反會讓 `npm run typecheck` 紅）

- `strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`
- **`verbatimModuleSyntax: true`** —— 型別匯入一律寫 `import type { X } from '...'`，不准混在值匯入裡
- `moduleResolution: "bundler"` —— import 不帶 `.ts` / `.tsx` 副檔名
- `tsconfig.json` 的 `include` 是 `["src", "specimens", "vite.config.ts"]`，所以 `src/` 下的測試檔會被 `tsc --noEmit` 一起檢查

### 每個檢查點都要跑的指令

```bash
npm run typecheck     # 必須零錯誤
npm run test          # Task 2 之後才存在，必須全綠
```

`npm run acceptance` 需要 preview server 在跑（另一個終端機 `npm run measure`）。只有明寫要跑的 task 才跑。

---

## File Structure

| 檔案 | 職責 | 動作 |
|---|---|---|
| `src/shell/derive.ts` | 三個衍生值的純函式（堆疊條百分比、跨輪 median / 比值、可重現判定）+ `REPRODUCIBLE_SPREAD_MAX` | 建立 |
| `src/shell/derive.test.ts` | 上面的測試 | 建立 |
| `src/shell/shell.css` | 全站唯一樣式檔 | 建立 |
| `src/shell/format.ts` | 只有 `ms()` | 建立（從 `Panel.tsx` 搬出） |
| `src/shell/Masthead.tsx` | 館頭 + 展間索引（含空基座） | 建立 |
| `src/shell/SpecimenLabel.tsx` | 說明牌（編號 / 標題 / 副標 / mode 按鈕） | 建立 |
| `src/shell/Vitrine.tsx` | 展櫃（iframe 外框 + 尺寸宣告 + 操作程序 + 節拍器 + 重跑） | 建立 |
| `src/shell/panel/Conditions.tsx` | 凍結條件 + throttle 未宣告警告 | 建立 |
| `src/shell/panel/InpBreakdown.tsx` | INP 三段堆疊條 | 建立 |
| `src/shell/panel/LoafReport.tsx` | 代表幀 + top scripts + 外殼自白 | 建立 |
| `src/shell/panel/RunHistory.tsx` | 歷次 run + 比值 + 可重現徽章 | 建立 |
| `src/shell/panel/pickFrame.ts` | 挑代表幀。`Panel.tsx` 的 snapshot 與 `LoafReport` 都要用，所以獨立成檔 | 建立 |
| `src/shell/panel/Floors.tsx` | 三個解析度下限 | 建立 |
| `src/shell/panel/RawDump.tsx` | `<details>` + JSON snapshot | 建立 |
| `src/shell/Panel.tsx` | 縮成組裝層：排 `panel/*`、算 snapshot | 重寫 |
| `src/shell/App.tsx` | 加 `className`、改雙欄 grid、抽出 `Masthead` / `SpecimenLabel` / `Vitrine`。**量測邏輯不動** | 修改 |
| `index.html` | `<head>` 加 `<link rel="stylesheet">`，改寫既有註解 | 修改 |
| `src/specimens.ts` | 加 `TOTAL_SPECIMENS = 6` | 修改（只加這個） |
| `tools/acceptance.mjs` | 第 4 條改綁 snapshot 欄位 | 修改 |
| `package.json` | 加 `vitest` devDependency + `test` script | 修改 |

`Panel.tsx` 現在 331 行、七個職責。拆完之後組裝層 ~60 行，`isWide` / `cols` / `padR` / `padL` / `RULE` 整批刪除（約 40 行手刻全形字寬邏輯）。

**這張表比 spec §10 多四個檔案**：`derive.ts`（+ 測試）、`Masthead.tsx`、`SpecimenLabel.tsx`、`Vitrine.tsx`、`panel/pickFrame.ts`。spec §10 只規劃到面板層級；館頭 / 說明牌 / 展櫃若留在 `App.tsx` 裡，那個檔案會從 483 行再長一截，而它裝的是全案最不該被排版邏輯稀釋的量測程式碼。`pickFrame.ts` 獨立成檔的理由見 Task 8。

---

## Task 1: 基線量測（必須第一個做，不可跳過）

**Files:**
- Create: `docs/superpowers/plans/baseline-shell-cost.md`

**Interfaces:**
- Consumes: 無
- Produces: `docs/superpowers/plans/baseline-shell-cost.md` 裡的三個 `外殼 script` 讀數與其 median，Task 12 的閘門靠它比較

**為什麼第一個做：** spec §11.2 的閘門是「改動前後比 `shellScriptDuration` median」。改完才想量基線就永遠量不到了 —— 那時 working tree 已經不是原始狀態。

- [ ] **Step 1: 確認 working tree 是原始狀態**

Run:
```bash
ls src/shell/
```
Expected: 只有 `App.tsx  Panel.tsx  loaf.ts  main.tsx`。若已經有 `shell.css` 或 `panel/`，**停下來** —— 基線已經被污染，必須先問人。

- [ ] **Step 2: 起 preview server**

Run（開一個專用終端機，跑完整個 Task 12 都不要關）:
```bash
npm run measure
```
Expected: 最後印出 preview server 在 `http://localhost:4173`

- [ ] **Step 3: 設定量測環境**

1. 用 Chromium 系瀏覽器開 `http://localhost:4173`
2. 開 DevTools → Performance → 齒輪 → CPU: **4× slowdown**
3. 頁面上的 CPU throttle 下拉選 **`4x`**（JS 偵測不到 DevTools 的設定，必須手動宣告）
4. 確認面板頂端**沒有**紅色 dev banner（有的話就是連到 5173 了，換 4173）
5. 標本選 **`00-calibration 校準標本`**

- [ ] **Step 4: 跑第一輪並記錄**

依畫面上的操作程序：每次節拍亮起時點一下「忙迴圈」按鈕，**共十次，不要連打**（`00-calibration` 的 `intervalMs` 是 1000）。

十次做完、面板出現 INP 數字之後，在面板的 LoAF 區塊找這一行：

```
    外殼 script                    3.2ms   不算在標本頭上
```

記下那個數字。**在按「重跑」之前記，按下去這一輪就進歷史了。**

- [ ] **Step 5: 再跑兩輪**

按「重跑」，重複 Step 4。共取得三個 `外殼 script` 讀數。

- [ ] **Step 6: 取自動化交叉讀數（免費，且比人眼精確）**

`tools/acceptance.mjs` 的驗收第 5 條本來就印外殼成本。跑三次：

```bash
npm run acceptance 2>&1 | grep "shellScript="
```

Expected: 每次印出一行含 `shellScript=X.Xms`，記下三個值。

這個讀數的價值：**點擊時序是程式跑的，不是人手點的** —— `runProtocol()` 固定十次、間隔 1000ms，viewport 由 CDP 固定 1400×1600。人手點的時序變異在這裡完全消失。

**但它不能取代 Step 4–5 的手動讀數。** `acceptance.mjs` 沒有呼叫 `Emulation.setCPUThrottlingRate`（第 15 條只把下拉的**宣告值**設成 `4x`，不是真的節流），所以它跑在 1× CPU。同一個真實迴歸在 4× 下會放大約四倍 —— **4× 才是嚴格的那個測試**，2ms 的門檻要套在 4× 的 median 上。1× 讀數當精確的旁證，不當判準。

- [ ] **Step 7: 寫下基線**

建立 `docs/superpowers/plans/baseline-shell-cost.md`：

```markdown
# 外殼成本基線（改動前）

量測日期：<填今天>
條件：CPU throttle 4x · <填面板顯示的 Hz>Hz · viewport 800×600 · 標本 00-calibration · mode busy-300
buildId：<填面板顯示的 build>

## 手動 4x（判準用這個）

| 輪 | 外殼 script |
|---|---|
| 1 | <填>ms |
| 2 | <填>ms |
| 3 | <填>ms |

**median：<填>ms**

## 自動化 1x（旁證，不是判準）

`npm run acceptance` 第 5 條的 `shellScript=`：

| 次 | shellScript |
|---|---|
| 1 | <填>ms |
| 2 | <填>ms |
| 3 | <填>ms |

**median：<填>ms**

閘門（spec §11.2）：改動後同樣程序三輪，**手動 4x 的 median** 上升 > 2ms 就不算過，退回 spec §11.3 的 C 案。
```

- [ ] **Step 8: 驗證檢查點**

Run:
```bash
grep -c "填" docs/superpowers/plans/baseline-shell-cost.md
```
Expected: `0` —— 六個讀數與兩個 median 全部填了實際數字，沒有任何 `<填>` 殘留。

---

## Task 2: 衍生值純函式 + 測試框架

**Files:**
- Modify: `package.json`（加 `vitest` devDependency 與 `test` script）
- Create: `src/shell/derive.ts`
- Create: `src/shell/derive.test.ts`

**Interfaces:**
- Consumes: `computeRunStats` from `../measure/metrics`、`MEASURE_CONFIG` from `../protocol`
- Produces:
  - `REPRODUCIBLE_SPREAD_MAX: 0.15`
  - `interface RunLike { specimenId: string; mode: string; stats: { median: number } }`
  - `interface ModeLike { id: string; label: string }`
  - `interface ReproducibilityVerdict { reproducible: boolean; reasons: string[] }`
  - `segmentPct(segment: number, duration: number): number`
  - `modeMedian(history: RunLike[], specimenId: string, modeId: string): number | null`
  - `remedyRatio(pathological: number | null, treatment: number | null): number | null`
  - `assessReproducibility(specimenId: string, modes: ModeLike[], history: RunLike[]): ReproducibilityVerdict`

`RunLike` / `ModeLike` 刻意只收判定需要的欄位 —— `RunResult` 與 `SpecimenModeDef` 在結構上都滿足它們，而測試不必造整個 `RunConditions` fixture。

- [ ] **Step 1: 安裝 vitest**

Run:
```bash
npm install --save-dev vitest@^4
```
Expected: `package.json` 的 `devDependencies` 出現 `vitest`

- [ ] **Step 2: 加 test script**

Modify `package.json` 的 `scripts`，在 `"acceptance"` 後面加一行：

```json
    "test": "vitest run",
```

不需要改 `vite.config.ts` —— 這些是純函式測試，vitest 預設的 node 環境就夠，且測試檔用 `import { describe, it, expect } from 'vitest'` 明確匯入，不依賴 globals，所以 `tsconfig.json` 也不用改。

- [ ] **Step 3: 寫失敗的測試**

Create `src/shell/derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  REPRODUCIBLE_SPREAD_MAX,
  assessReproducibility,
  modeMedian,
  remedyRatio,
  segmentPct,
} from './derive';
import type { ModeLike, RunLike } from './derive';

const MODES: ModeLike[] = [
  { id: 'broken', label: '病變：同步排序' },
  { id: 'fixed-yield', label: '治療一：切 chunk + yield' },
];

function run(mode: string, median: number, specimenId = '01-main-thread-block'): RunLike {
  return { specimenId, mode, stats: { median } };
}

describe('segmentPct', () => {
  it('把段換算成 duration 的百分比', () => {
    expect(segmentPct(386, 412)).toBeCloseTo(93.689, 3);
  });

  it('duration 為 0 時回 0，不回 NaN 或 Infinity', () => {
    expect(segmentPct(12, 0)).toBe(0);
  });

  it('三段之和小於 duration 時不重新正規化 —— 差額留在條尾（設計 §5.1）', () => {
    const total = segmentPct(12, 412) + segmentPct(386, 412) + segmentPct(8, 412);
    expect(total).toBeLessThan(100);
  });

  it('clamp 到 0..100', () => {
    expect(segmentPct(-5, 100)).toBe(0);
    expect(segmentPct(150, 100)).toBe(100);
  });
});

describe('modeMedian', () => {
  it('取各輪 median 再取 median，不是取 max', () => {
    const history = [run('broken', 412), run('broken', 398), run('broken', 431)];
    expect(modeMedian(history, '01-main-thread-block', 'broken')).toBe(412);
  });

  it('只算同一標本同一 mode 的輪次', () => {
    const history = [
      run('broken', 412),
      run('fixed-yield', 40),
      run('broken', 9999, '00-calibration'),
    ];
    expect(modeMedian(history, '01-main-thread-block', 'broken')).toBe(412);
  });

  it('沒有完成的輪次回 null', () => {
    expect(modeMedian([], '01-main-thread-block', 'broken')).toBeNull();
  });
});

describe('remedyRatio', () => {
  it('病變 median 除以治療 median', () => {
    expect(remedyRatio(412, 40)).toBeCloseTo(10.3, 1);
  });

  it('任一邊為 null 就回 null，不回 0', () => {
    expect(remedyRatio(412, null)).toBeNull();
    expect(remedyRatio(null, 40)).toBeNull();
  });

  it('治療 median 為 0 時回 null，不回 Infinity', () => {
    expect(remedyRatio(412, 0)).toBeNull();
  });
});

describe('assessReproducibility', () => {
  it('每個 mode 都三輪且離散度在門檻內才算可重現', () => {
    const history = [
      run('broken', 412),
      run('broken', 398),
      run('broken', 431),
      run('fixed-yield', 38),
      run('fixed-yield', 41),
      run('fixed-yield', 40),
    ];
    const v = assessReproducibility('01-main-thread-block', MODES, history);
    expect(v.reproducible).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it('任一 mode 輪數不足就不可重現，理由指名那個 mode', () => {
    const history = [run('broken', 412), run('broken', 398), run('broken', 431)];
    const v = assessReproducibility('01-main-thread-block', MODES, history);
    expect(v.reproducible).toBe(false);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toContain('治療一：切 chunk + yield');
    expect(v.reasons[0]).toContain('0 輪');
  });

  it('離散度超標就不可重現，理由帶百分比', () => {
    const history = [
      run('broken', 100),
      run('broken', 200),
      run('broken', 400),
      run('fixed-yield', 38),
      run('fixed-yield', 41),
      run('fixed-yield', 40),
    ];
    const v = assessReproducibility('01-main-thread-block', MODES, history);
    expect(v.reproducible).toBe(false);
    expect(v.reasons[0]).toContain('病變：同步排序');
    expect(v.reasons[0]).toContain('%');
  });

  it('門檻是 15%，跟 Panel 原本硬編的數字同一份定義', () => {
    expect(REPRODUCIBLE_SPREAD_MAX).toBe(0.15);
  });
});
```

- [ ] **Step 4: 跑測試確認失敗**

Run:
```bash
npm run test
```
Expected: FAIL，錯誤是解析不到 `./derive`（`Failed to load url ./derive`）

- [ ] **Step 5: 實作**

Create `src/shell/derive.ts`:

```ts
/**
 * 報告區的衍生值 —— 全部是純函式，因為它們是唯一「算錯不會有任何徵兆」的程式碼。
 *
 * 比值與可重現徽章會被直接引用到文章裡。公式錯了，面板不會抱怨、tsc 不會抱怨，
 * 數字仍然落在合理範圍 —— 你只會發表一個錯的倍率。所以這裡有測試，
 * 而面板的排版沒有。
 */
import { MEASURE_CONFIG } from '../protocol';
import { computeRunStats } from '../measure/metrics';

/**
 * 跨輪離散度的及格線。原本硬編在 Panel.tsx 的 `spread > 0.15`。
 *
 * 15% 不是 30%：30% 是 protocol.ts 給**輪內** spread 的提示線，
 * 這裡是**跨輪**離散度，驗收第 16 條寫的是「三輪 median 相對離散度 ≤ 15%」。
 * 全站只准有一份這個數字。
 */
export const REPRODUCIBLE_SPREAD_MAX = 0.15;

/** 判定只需要這三個欄位。RunResult 在結構上滿足它，測試不必造整個 RunConditions */
export interface RunLike {
  specimenId: string;
  mode: string;
  stats: { median: number };
}

/** 同理，SpecimenModeDef 在結構上滿足它 */
export interface ModeLike {
  id: string;
  label: string;
}

export interface ReproducibilityVerdict {
  reproducible: boolean;
  /** 未達標的原因，每個沒過的 mode 一句。reproducible 為 true 時是空陣列 */
  reasons: string[];
}

/**
 * 堆疊條一段的寬度百分比。分母是代表互動的 duration。
 *
 * **三段之和可能不等於 duration**（8ms 網格量化造成）。不重新正規化 ——
 * 條不填滿本身就是量化誤差的視覺呈現，比湊到 100% 誠實（設計 §5.1）。
 */
export function segmentPct(segment: number, duration: number): number {
  if (duration <= 0) return 0;
  const pct = (segment / duration) * 100;
  if (pct < 0) return 0;
  return pct > 100 ? 100 : pct;
}

/**
 * 某個 mode 的跨輪 median —— 各輪的 median 再取一次 median。
 *
 * 用 median 不用 max：面板頂端報的 INP 是 max（n<50 時 p98 公式退化成 max），
 * 但 max 抗離群為零，拿它做跨輪判定會製造假警報。
 */
export function modeMedian(
  history: RunLike[],
  specimenId: string,
  modeId: string,
): number | null {
  const runs = history.filter((r) => r.specimenId === specimenId && r.mode === modeId);
  if (runs.length === 0) return null;
  return computeRunStats(runs.map((r) => r.stats.median)).median;
}

/** 治療對病變的倍率。任一邊沒有完成的 run 就回 null —— 不准回 0，那會被誤讀成「沒有改善」 */
export function remedyRatio(
  pathological: number | null,
  treatment: number | null,
): number | null {
  if (pathological === null || treatment === null) return null;
  if (treatment <= 0) return null;
  return pathological / treatment;
}

/**
 * 可重現徽章。只有兩個狀態，沒有「接近」。
 *
 * reasons 存在的理由：主 spec §1 原則 4 是「修變因，不修結論」——
 * 徽章必須指出該修什麼，否則它只是一個沒有行動可循的紅燈。
 */
export function assessReproducibility(
  specimenId: string,
  modes: ModeLike[],
  history: RunLike[],
): ReproducibilityVerdict {
  const reasons: string[] = [];

  for (const m of modes) {
    const runs = history.filter((r) => r.specimenId === specimenId && r.mode === m.id);

    if (runs.length < MEASURE_CONFIG.runsForReproducibility) {
      reasons.push(
        `${m.label}：只有 ${runs.length} 輪，需要 ${MEASURE_CONFIG.runsForReproducibility} 輪`,
      );
      continue;
    }

    const spread = computeRunStats(runs.map((r) => r.stats.median)).spread;
    if (spread > REPRODUCIBLE_SPREAD_MAX) {
      reasons.push(`${m.label}：跨輪離散度 ${Math.round(spread * 100)}% > 15%`);
    }
  }

  return { reproducible: reasons.length === 0, reasons };
}
```

- [ ] **Step 6: 跑測試確認通過**

Run:
```bash
npm run test
```
Expected: PASS，14 個測試全綠

若 `modeMedian` 的第一個測試失敗（期望 412 卻拿到別的值），去讀 `src/measure/metrics.ts` 的 `computeRunStats`，確認 `median` 對三個元素的定義（排序後取中間 = 412）。**不要改測試去迎合實作** —— 若 `computeRunStats` 的 median 定義跟預期不同，那是要回報的發現，不是要改的期望值。

- [ ] **Step 7: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: typecheck 零錯誤，測試全綠

---

## Task 3: `acceptance.mjs` 第 4 條改綁 snapshot

**Files:**
- Modify: `tools/acceptance.mjs:92`、`:119`、`:129-132`

**Interfaces:**
- Consumes: 既有的 `snapshot()` helper（`:89-90`，抓最後一個 `<pre>` parse JSON）
- Produces: 驗收第 4 條不再依賴面板散文

**為什麼排在面板重構之前：** Task 8 會拆掉文字 `<pre>`，那一刻起 `panelText()` 抓到的第一個 `<pre>` 就是 JSON snapshot，第 4 條會以看不懂的方式變紅。先把它改成讀結構化欄位，驗收就能全程保持綠燈。

**立場：** 面板文字是 UI，會一直改；snapshot 是協定，凍結了。**驗收該綁協定，不該綁散文。** `:89-90` 本來就是這樣做的，這次讓第 4 條跟上。

- [ ] **Step 1: 讀現況，確認要改的四個位置**

Run:
```bash
grep -n "panelText\|txt1" tools/acceptance.mjs
```
Expected 正好四行：`:92` 定義、`:119` 呼叫、`:131` 判定、`:132` 證據字串

- [ ] **Step 2: 確認要沿用的變數已經存在**

Run:
```bash
sed -n '116,133p' tools/acceptance.mjs
```
Expected: 看到這三行已經在第 4 條**之前**就宣告好了 —— 不需要新增任何變數：

```js
const s1 = await snap();
const txt1 = await panelText();
const inp1 = s1.metrics.inp;
```

- [ ] **Step 3: 刪掉 `panelText()` 定義**

Modify `tools/acceptance.mjs`，刪掉 `:92` 整行：

```js
const panelText = () => evaluate(`[...document.querySelectorAll('pre')][0].textContent`);
```

- [ ] **Step 4: 刪掉 `:119` 的呼叫**

刪掉這一行：

```js
const txt1 = await panelText();
```

- [ ] **Step 5: 改寫第 4 條**

把這一段（`:131-132`）：

```js
check(4, '統計量標註 max 非 p98',
  txt1.includes('max（樣本不足 50，非 p98）') && txt1.includes('n=10'),
  `面板字串：${(txt1.match(/n=\d+ · [^\n·]*/) || [''])[0]}`);
```

換成：

```js
check(4, '統計量標註 max 非 p98',
  inp1.isMaxNotP98 === true && s1.metrics.totalInteractions === 10,
  `n=${s1.metrics.totalInteractions} · isMaxNotP98=${inp1.isMaxNotP98}`);
```

`s1` 與 `inp1` 都是既有變數，不必新增。判定邏輯與原本等價：原本比對面板印的 `max（樣本不足 50，非 p98）` 與 `n=10` 兩段字串，現在直接讀產生那兩段文字的來源欄位。**check 名稱不改** —— 驗收清單的條目名稱對得起主 spec §5.6。

- [ ] **Step 6: 起 preview 並跑驗收**

Run（terminal A，若 Task 1 的還開著就跳過）:
```bash
npm run measure
```

Run（terminal B）:
```bash
npm run acceptance
```
Expected: 全條通過，第 4 條的證據字串印成 `n=10 · isMaxNotP98=true`

- [ ] **Step 7: 驗證檢查點**

Run:
```bash
grep -c "panelText\|txt1" tools/acceptance.mjs
```
Expected: `0`

---

## Task 4: `shell.css` 設計 token + 雙欄骨架

**Files:**
- Create: `src/shell/shell.css`
- Modify: `index.html`（`<head>` 加 `<link>`，改寫既有註解）
- Modify: `src/shell/App.tsx`（外層加 `className`，改雙欄 grid）

**Interfaces:**
- Consumes: 無
- Produces: CSS class 名稱契約，後續 task 都用這一組
  - `.museum`（頁面容器）、`.masthead`、`.label`、`.stage`（雙欄 grid）、`.vitrine`、`.report`、`.floors`、`.dump`
  - `.void-stamp`（檢驗無效印章）
  - block modifier：`.is-lesion`、`.is-remedy`

- [ ] **Step 1: 建立 `shell.css`**

Create `src/shell/shell.css`:

```css
/*
 * 前端效能病理標本館 —— 外殼樣式。全站唯一的樣式檔。
 *
 * 設計依據：docs/superpowers/specs/2026-07-25-shell-visual-design.md
 *
 * ⚠️ 這個檔案裡的每一條禁令都是量測正確性的一部分，不是風格偏好。
 * 主 spec §3.2：iframe 不隔離 INP 的 presentation 段 —— 外殼的 style/layout
 * 成本會落在互動的同一幀。所以：
 *
 *   禁 transition / animation / @keyframes
 *   禁 box-shadow / filter / backdrop-filter / 動態 opacity
 *   禁 position: sticky / fixed
 *   :hover 只准改 color / background-color / text-decoration / outline
 *
 * 加東西之前先問：博物館的標本說明牌上會有這個嗎？不會就不要加。
 */

:root {
  --ink: #1a1a18;
  --paper: #faf8f3;
  --rule: #d8d3c8;
  --lesion: #a3231c;
  --remedy: #1f5d5a;
  --void: #c0392b;
  --seg-a: #8a8a85;
  --seg-b: #4a4a46;

  --mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace;
  /* 全站唯一的襯線用法：標本名。那就是說明牌的長相 */
  --serif: 'Noto Serif TC', 'Songti TC', serif;

  --gap: 1.5rem;
}

/* 不做深色模式：截圖是這個站的產出物，兩套主題會讓不同文章裡的圖對不起來 */

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 400 14px/1.6 var(--mono);
  /* 數字位數變動時不推版。這取代 Panel.tsx 原本手刻的全形字寬對齊 */
  font-variant-numeric: tabular-nums;
}

.museum {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--gap);
}

/* ── 檢驗無效印章（dev 模式）────────────────────────────────
   無旋轉、無半透明疊圖 —— 兩者都是繪製成本。純實色帶。 */
.void-stamp {
  margin: 0 0 var(--gap);
  padding: 0.75rem 1rem;
  background: var(--void);
  color: #fff;
  border: 0;
}

.void-stamp b {
  display: block;
  font-size: 1.25rem;
  letter-spacing: 0.15em;
}

.void-stamp code {
  color: #fff;
  text-decoration: underline;
}

/* ── 雙欄舞台 ────────────────────────────────────────────
   左欄 800px 固定 = iframe 的凍結寬度。不用 %、不用 minmax 讓它縮。
   主 spec §4.6：CLS/LCP 都是 viewport 相對量，縮實驗區等於讓歷史數字作廢。 */
.stage {
  display: grid;
  grid-template-columns: 800px 1fr;
  gap: var(--gap);
  align-items: start;
}

@media (max-width: 1179px) {
  .stage {
    grid-template-columns: 800px;
  }
}

/* 窄螢幕讓實驗區橫向捲，不縮放 */
.vitrine {
  overflow-x: auto;
}

.vitrine iframe {
  display: block;
  border: 1px solid var(--ink);
  background: #fff;
}

.vitrine__caption {
  margin: 0.5rem 0 var(--gap);
  color: var(--seg-a);
  font-size: 12px;
}

/* ── 報告區 ──────────────────────────────────────────────
   contain: content = layout paint style。面板重繪不外溢到 iframe 所在的
   格線，也不會讓外殼的 style recalc 掃到整個 document。 */
.report > section {
  contain: content;
  padding: 0 0 1rem;
  border-bottom: 1px solid var(--rule);
  margin: 0 0 1rem;
}

.report > section:last-child {
  border-bottom: 0;
}

.report h3 {
  margin: 0 0 0.5rem;
  font: 400 12px/1.4 var(--mono);
  letter-spacing: 0.1em;
  color: var(--seg-a);
}

/* 長列表：離開視窗就不排版。LoAF 一輪可能上百幀 */
.report .scroll-list {
  content-visibility: auto;
  contain-intrinsic-size: auto 8rem;
}

/* ── 語意色 ──────────────────────────────────────────────
   紅色稀有才有重量。--lesion 只出現在兇手段、病變 mode 按鈕、歷次 run 的病變列。 */
.is-lesion {
  color: var(--lesion);
}

.is-remedy {
  color: var(--remedy);
}

/* ── 按鈕：不准改盒模型的 hover ───────────────────────────
   border-width / padding / font-size 在 hover 改動 = 每次滑過就 reflow。 */
button {
  font: inherit;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--ink);
  border-radius: 2px;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--ink);
  color: var(--paper);
}

button:disabled {
  cursor: default;
  border-color: var(--rule);
  color: var(--seg-a);
}

button:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

select {
  font: inherit;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--ink);
  border-radius: 2px;
  padding: 0.25rem;
}

/* Phase 0 的殘留 <pre>：只剩原始檢體傾印會用到 */
pre {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-all;
}
```

- [ ] **Step 2: `index.html` 掛上樣式表**

Modify `index.html`：把現有那段「這裡沒有任何 `<link rel="stylesheet">`，是刻意的」的註解**改寫**（不是刪掉 —— 決定的歷史要留著），並加上 `<link>`：

```html
    <!--
      Phase 0 原本明文規定不准寫任何一行面板 CSS（主 spec §5.3），面板整個是 <pre>。
      2026-07-25 由作者決定提前執行 Phase 3 的視覺工作，設計與 CSS 紀律見
      docs/superpowers/specs/2026-07-25-shell-visual-design.md。

      樣式一律走 <link>，不從 main.tsx import ——
      從 JS import 會讓樣式在 JS 執行後才注入，多一次 style recalc。
    -->
    <link rel="stylesheet" href="/src/shell/shell.css" />
```

- [ ] **Step 3: `App.tsx` 套上骨架 class**

Modify `src/shell/App.tsx`。**只改 JSX 結構與 className，量測邏輯一行都不動。**

把 dev banner 換成印章：

```tsx
      {import.meta.env.DEV && (
        <p className="void-stamp">
          <b>檢驗無效 · DEV SERVER</b>
          這頁量到的數字全部作廢。dev server 不 minify、不打包、還有 HMR 開銷，
          而且函式名沒有經過 build 的 keepNames 路徑。量測請跑 <code>npm run measure</code>。
        </p>
      )}
```

把最外層 `<main>` 加 class，並把 iframe 與 `<Panel>` 包進雙欄：

```tsx
    <main className="museum">
```

iframe 與 Panel 的部分改成：

```tsx
      <div className="stage">
        <div className="vitrine">
          {/*
            width / height 用 HTML 屬性寫死 800×600，取自 meta.viewport。
            絕對不要用百分比或 vh：CLS = impact fraction × distance fraction，兩者都是
            viewport 相對量，LCP element 的選擇也依賴 viewport —— 改尺寸等於讓所有
            歷史數字作廢（spec §4.6）。窄螢幕由 .vitrine 的 overflow-x 橫向捲，不縮放。
          */}
          <iframe
            key={meta.id}
            ref={iframeRef}
            src={iframeSrc}
            width={meta.viewport.width}
            height={meta.viewport.height}
            title={`${meta.id} 實驗區`}
          />
          <p className="vitrine__caption">
            viewport {meta.viewport.width}×{meta.viewport.height} · 尺寸凍結
          </p>
        </div>

        <div className="report">
          <Panel
            meta={meta}
            mode={mode}
            runId={runId}
            conditions={conditions}
            ready={view.ready}
            metrics={view.metrics}
            loaf={view.loaf}
            loafSupported={LOAF_SUPPORTED}
            history={history}
            notes={view.notes}
          />
        </div>
      </div>
```

其餘 `<h1>` / 標本按鈕 / mode 清單 / 操作程序 / 凍結條件先原樣留著 —— Task 5–7 再搬。

- [ ] **Step 4: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run（terminal A 若已在跑 preview，先 Ctrl-C 再重跑，因為要重新 build）:
```bash
npm run measure
```
Expected: build 成功，**且產物含一個 CSS 檔**。build log 應該出現類似 `dist/assets/shell-<hash>.css`。若 build 因 `lightningcss` 失敗，回報 —— 那與 `vite.config.ts:55` 的 `cssMinify: 'lightningcss'` 有關，不要自己改那一行（它是刻意寫回來的）。

開 `http://localhost:4173`：紙底是骨白色、字是等寬、iframe 有黑細框、面板在右邊。

---

## Task 5: 館頭 + 展間索引（含空基座）

**Files:**
- Modify: `src/specimens.ts`（只加 `TOTAL_SPECIMENS`）
- Create: `src/shell/Masthead.tsx`
- Modify: `src/shell/App.tsx`（用 `Masthead` 取代 `<h1>` 與標本按鈕那一段）
- Modify: `src/shell/shell.css`（加 `.masthead` 區塊）

**Interfaces:**
- Consumes: `SPECIMENS`、`TOTAL_SPECIMENS` from `../specimens`；`SpecimenMeta`、`SpecimenId` from `../protocol`
- Produces: `<Masthead current={SpecimenId} buildId={string} onSelect={(id: SpecimenId) => void} />`

**不硬編標本名稱。** 主 spec 只零散提到 #1 主執行緒阻塞、#2 超多 DOM 節點、#3 強制同步版面重排、#5 網頁字型／CLS；#4 與 #6 的題目還沒定。替沒定案的標本編名字是把未決定寫成已決定。

- [ ] **Step 1: 加 `TOTAL_SPECIMENS`**

Modify `src/specimens.ts`，在 `SPECIMENS` 宣告的**後面**加：

```ts
/**
 * 全館規劃的標本總數，用來在展間索引畫出還沒布展的空基座。
 *
 * **不含 00-calibration** —— 它是 Phase 0 的驗收工具，不是六個標本之一（主 spec §5.5）。
 *
 * 刻意不在這裡寫未建標本的名字：主 spec 只定了 #1 #2 #3 #5 的題目，#4 與 #6 還沒定。
 * 替沒定案的標本編名字是把未決定寫成已決定。題目一定案就用 status: 'draft'
 * 註冊進 SPECIMENS，索引會自動長出名字。
 */
export const TOTAL_SPECIMENS = 6;
```

`src/specimens.ts` 的既有 metadata **一個字都不改**。

- [ ] **Step 2: 建立 `Masthead.tsx`**

Create `src/shell/Masthead.tsx`:

```tsx
/**
 * 館頭 + 展間索引。
 *
 * 索引有三種展位，全部由資料決定，沒有硬編清單：
 *   status: 'ready'  → 可點，已布展
 *   status: 'draft'  → 顯示標題但不可點（題目定了、標本還沒做）
 *   無註冊           → 無名空基座，只有編號與「未開放」
 *
 * 空基座是誠實呈現未布展的展位，順便就是路線圖。
 */
import { SPECIMENS, TOTAL_SPECIMENS } from '../specimens';
import type { SpecimenId } from '../protocol';

export interface MastheadProps {
  current: SpecimenId;
  buildId: string;
  onSelect: (id: SpecimenId) => void;
}

/** 六個標本的編號是 01..06。00-calibration 不佔展位，單獨列在前面 */
function plannedSlots(): number[] {
  return Array.from({ length: TOTAL_SPECIMENS }, (_, i) => i + 1);
}

function slotLabel(n: number): string {
  return String(n).padStart(2, '0');
}

export function Masthead({ current, buildId, onSelect }: MastheadProps) {
  const registered = new Map(SPECIMENS.map((s) => [s.order, s]));
  const calibration = SPECIMENS.find((s) => s.order === 0);

  return (
    <header className="masthead">
      <div className="masthead__title">
        <h1>前端效能病理標本館</h1>
        <span className="masthead__build">Phase 0 · build {buildId}</span>
      </div>

      <nav className="index" aria-label="展間索引">
        {calibration && (
          <button
            className="index__slot index__slot--ready"
            onClick={() => onSelect(calibration.id)}
            disabled={calibration.id === current}
          >
            ▓ 00 {calibration.title}
          </button>
        )}

        {plannedSlots().map((n) => {
          const meta = registered.get(n);

          if (meta && meta.status === 'ready') {
            return (
              <button
                key={n}
                className="index__slot index__slot--ready"
                onClick={() => onSelect(meta.id)}
                disabled={meta.id === current}
              >
                ▓ {slotLabel(n)} {meta.title}
              </button>
            );
          }

          if (meta) {
            return (
              <span key={n} className="index__slot index__slot--draft">
                ░ {slotLabel(n)} {meta.title}（草稿）
              </span>
            );
          }

          return (
            <span key={n} className="index__slot index__slot--empty">
              ░ {slotLabel(n)} 未開放
            </span>
          );
        })}
      </nav>
    </header>
  );
}
```

- [ ] **Step 3: 加 `.masthead` 樣式**

Modify `src/shell/shell.css`，在 `.void-stamp` 區塊後面加：

```css
/* ── 館頭 ────────────────────────────────────────────── */
.masthead {
  border-bottom: 1px solid var(--ink);
  margin: 0 0 var(--gap);
  padding: 0 0 0.75rem;
}

.masthead__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap);
  flex-wrap: wrap;
}

.masthead h1 {
  margin: 0;
  font: 400 1.5rem/1.3 var(--serif);
  letter-spacing: 0.05em;
}

.masthead__build {
  color: var(--seg-a);
  font-size: 12px;
}

.index {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.75rem 0 0;
}

.index__slot {
  font-size: 12px;
  padding: 0.3rem 0.6rem;
  border-radius: 2px;
}

.index__slot--draft,
.index__slot--empty {
  border: 1px dashed var(--rule);
  color: var(--seg-a);
}
```

- [ ] **Step 4: `App.tsx` 換上 `Masthead`**

Modify `src/shell/App.tsx`：

加 import：
```tsx
import { Masthead } from './Masthead';
```

把 `<h1>前端效能病理標本館 · Phase 0</h1>` 與底下 `<h2>標本</h2>` + 標本按鈕那一整段（原本的 `<p>{SPECIMENS.map(...)}</p>`）換成：

```tsx
      <Masthead current={specimenId} buildId={__BUILD_ID__} onSelect={switchSpecimen} />
```

`SPECIMENS` 若在 `App.tsx` 已無其他用途，從 import 中移除（`noUnusedLocals: true` 會擋）。`getSpecimen` 仍然要留。

- [ ] **Step 5: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```
開 `http://localhost:4173`：館頭有襯線標題與 build id；索引有 `▓ 00 校準標本`、`▓ 01 主執行緒阻塞` 可點，另外五個虛線框「未開放」不可點（01 佔掉一格，所以空基座是 02–06 共五格）。

---

## Task 6: 說明牌 + mode 切換

**Files:**
- Create: `src/shell/SpecimenLabel.tsx`
- Modify: `src/shell/App.tsx`（取代原本的 `<h2>{meta.title}</h2>` 與 mode `<ul>`）
- Modify: `src/shell/shell.css`（加 `.label` 區塊）

**Interfaces:**
- Consumes: `SpecimenMeta`、`SpecimenModeDef` from `../protocol`
- Produces: `<SpecimenLabel meta={SpecimenMeta} mode={string} onSwitch={(id: string) => void} />`

- [ ] **Step 1: 建立 `SpecimenLabel.tsx`**

Create `src/shell/SpecimenLabel.tsx`:

```tsx
/**
 * 說明牌 —— 標本編號、名稱、副標、mode 切換按鈕。
 *
 * 「先讓人痛，再給解藥」（主 spec §2）：modes 依 order 排，modes[0] 依協定必須是病變版本。
 * 病變按鈕上 --lesion、治療上 --remedy，紅色不靠顏色單獨傳訊 —— 標籤本身寫著「病變」。
 */
import type { SpecimenMeta, SpecimenModeDef } from '../protocol';

/** requires 的人話版本。不標的話使用者會以為某個 mode 壞掉，其實是瀏覽器沒有那個 API */
const REQUIRES_NOTE: Record<NonNullable<SpecimenModeDef['requires']>[number], string> = {
  'scheduler.yield': '需要 scheduler.yield（Safari 沒有）',
  'web-worker': '需要 Web Worker',
  'content-visibility': '需要 content-visibility',
};

export interface SpecimenLabelProps {
  meta: SpecimenMeta;
  mode: string;
  onSwitch: (modeId: string) => void;
}

export function SpecimenLabel({ meta, mode, onSwitch }: SpecimenLabelProps) {
  const modes = [...meta.modes].sort((a, b) => a.order - b.order);

  return (
    <section className="label">
      <p className="label__no">標本 {String(meta.order).padStart(2, '0')}</p>
      <h2 className="label__title">{meta.title}</h2>
      <p className="label__sub">{meta.subtitle}</p>

      <div className="label__modes">
        {modes.map((m) => {
          const lesion = m.kind === 'pathological';
          return (
            <button
              key={m.id}
              className={lesion ? 'is-lesion' : 'is-remedy'}
              onClick={() => onSwitch(m.id)}
              disabled={m.id === mode}
            >
              {lesion ? '病變' : '治療'}：{m.label}
            </button>
          );
        })}
        <span className="label__switch-kind">
          {meta.switchKind === 'live' ? '即時切換，不重載' : '重載整個 iframe'}
        </span>
      </div>

      {modes.some((m) => m.requires && m.requires.length > 0) && (
        <ul className="label__requires">
          {modes.flatMap((m) =>
            (m.requires ?? []).map((r) => (
              <li key={`${m.id}-${r}`}>
                {m.label} · {REQUIRES_NOTE[r]}
              </li>
            )),
          )}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: 加 `.label` 樣式**

Modify `src/shell/shell.css`，接在 `.index__slot--empty` 之後：

```css
/* ── 說明牌 ──────────────────────────────────────────── */
.label {
  border-bottom: 1px solid var(--rule);
  margin: 0 0 var(--gap);
  padding: 0 0 1rem;
  contain: content;
}

.label__no {
  margin: 0;
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--seg-a);
}

.label__title {
  margin: 0.25rem 0;
  font: 400 1.75rem/1.2 var(--serif);
}

.label__sub {
  margin: 0 0 0.75rem;
  color: var(--seg-b);
}

.label__modes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.label__switch-kind,
.label__requires {
  font-size: 12px;
  color: var(--seg-a);
}

.label__requires {
  margin: 0.5rem 0 0;
  padding-left: 1.2rem;
}

/* 病變 / 治療按鈕：hover 只翻轉前景背景，不動盒模型 */
.label__modes button.is-lesion {
  border-color: var(--lesion);
}

.label__modes button.is-lesion:hover:not(:disabled) {
  background: var(--lesion);
  color: var(--paper);
}

.label__modes button.is-remedy {
  border-color: var(--remedy);
}

.label__modes button.is-remedy:hover:not(:disabled) {
  background: var(--remedy);
  color: var(--paper);
}
```

- [ ] **Step 3: `App.tsx` 換上 `SpecimenLabel`**

Modify `src/shell/App.tsx`：

加 import：
```tsx
import { SpecimenLabel } from './SpecimenLabel';
```

把 `<h2>{meta.title} <small>...</small></h2>`、`<h3>切換（...）</h3>`、以及 mode 的整個 `<ul>` 換成：

```tsx
      <SpecimenLabel meta={meta} mode={mode} onSwitch={switchMode} />
```

`REQUIRES_NOTE` 的定義已經搬到 `SpecimenLabel.tsx`，從 `App.tsx` 刪掉；`SpecimenModeDef` 若在 `App.tsx` 已無其他用途，也從 type import 移除。

- [ ] **Step 4: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過。`noUnusedLocals` 會抓出忘了刪的 `REQUIRES_NOTE` 或多餘 import。

Run:
```bash
npm run measure
```
開 `http://localhost:4173`，切到 `01-main-thread-block`：說明牌顯示「標本 01 / 主執行緒阻塞」（襯線）、三個按鈕分別是紅框「病變」與兩個墨青框「治療」，底下列出 `scheduler.yield` / `web-worker` 的需求說明。

---

## Task 7: 展櫃 + 操作程序

**Files:**
- Create: `src/shell/Vitrine.tsx`
- Modify: `src/shell/App.tsx`（把 iframe / 節拍器 / 操作程序 / 凍結條件搬進去）
- Modify: `src/shell/shell.css`（加 `.protocol` 區塊）

**Interfaces:**
- Consumes: `SpecimenMeta`、`CpuThrottle` from `../protocol`
- Produces: `<Vitrine ... />`，props 見下方實作。`Metronome` 從 `App.tsx` 搬到 `Vitrine.tsx`，行為與註解原樣保留

**`Metronome` 的獨立元件身分是架構約束，不是整理。** 它自己持有 tick 狀態，所以每次翻拍只重繪那一小塊；翻拍的時間點正好是操作者要點下去的時間點，這裡多一次 App 級 re-render 就是直接往 presentation 段裡加料。搬檔案時**不要把它併回父元件**。

- [ ] **Step 1: 建立 `Vitrine.tsx`**

Create `src/shell/Vitrine.tsx`:

```tsx
/**
 * 展櫃 —— iframe 實驗區 + 操作程序 + 凍結條件宣告。
 *
 * iframe 的 width / height 用 HTML 屬性寫死，取自 meta.viewport。
 * 絕對不要用百分比或 vh：CLS = impact fraction × distance fraction，兩者都是
 * viewport 相對量，LCP element 的選擇也依賴 viewport —— 改尺寸等於讓所有歷史
 * 數字作廢（主 spec §4.6）。窄螢幕由 .vitrine 的 overflow-x 橫向捲，不縮放。
 */
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type { CpuThrottle, SpecimenMeta } from '../protocol';

const THROTTLE_OPTIONS: CpuThrottle[] = ['1x', '4x', '6x', 'unknown'];

/**
 * 節拍器 —— 十次連打與十次每秒一下是不同的實驗（主 spec §2 / §5.1 第 4 項）。
 *
 * 刻意獨立成一個元件、自己持有 tick 狀態：這樣每次翻拍只重繪這一小塊，
 * 不會把整個面板拖進同一幀重繪。翻拍的時間點正好是操作者要點下去的時間點，
 * 這裡多一次父層 re-render 就是直接往 presentation 段裡加料。
 * **不要把它併回父元件。**
 */
function Metronome({ intervalMs, repetitions }: { intervalMs: number; repetitions: number }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setTick(n);
      if (n >= repetitions) window.clearInterval(id);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, repetitions]);

  if (tick >= repetitions) {
    return <span>節拍結束（{repetitions} 拍）—— 按「重跑」開下一輪</span>;
  }
  return (
    <span>
      節拍 {tick % 2 === 0 ? '○' : '●'} 第 {tick} / {repetitions} 拍（每次記號翻面時點一下）
    </span>
  );
}

export interface VitrineProps {
  meta: SpecimenMeta;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  iframeSrc: string;
  /** 節拍器要在每一輪重新開始，所以 key 綁 runId */
  runId: string;
  recorded: number;
  cpuThrottle: CpuThrottle;
  onThrottleChange: (t: CpuThrottle) => void;
  onRerun: () => void;
}

export function Vitrine({
  meta,
  iframeRef,
  iframeSrc,
  runId,
  recorded,
  cpuThrottle,
  onThrottleChange,
  onRerun,
}: VitrineProps) {
  return (
    <div className="vitrine">
      <iframe
        key={meta.id}
        ref={iframeRef}
        src={iframeSrc}
        width={meta.viewport.width}
        height={meta.viewport.height}
        title={`${meta.id} 實驗區`}
      />
      <p className="vitrine__caption">
        viewport {meta.viewport.width}×{meta.viewport.height} · 尺寸凍結
      </p>

      <section className="protocol">
        <h3>操作程序 —— 這也是凍結變因</h3>
        <p className="protocol__instruction">{meta.protocol.instruction}</p>
        <p className="protocol__spec">
          動作 {meta.protocol.action} · 次數 {meta.protocol.repetitions} · 間隔{' '}
          {meta.protocol.intervalMs === null
            ? '盡快連續（不要等畫面回應）'
            : `${meta.protocol.intervalMs}ms`}
        </p>
        <p className="protocol__live">
          {meta.protocol.intervalMs !== null && (
            <Metronome
              key={runId}
              intervalMs={meta.protocol.intervalMs}
              repetitions={meta.protocol.repetitions}
            />
          )}{' '}
          已記錄 {recorded} / {meta.protocol.repetitions} 次
        </p>
      </section>

      <section className="protocol">
        <h3>凍結條件宣告</h3>
        <p>
          <label>
            CPU throttle（JS 偵測不到 DevTools 的設定，只能自己宣告）{' '}
            <select
              value={cpuThrottle}
              onChange={(e) => onThrottleChange(e.target.value as CpuThrottle)}
            >
              {THROTTLE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </p>
        <button onClick={onRerun}>重跑（把這一輪存進歷史，開新的一輪）</button>
      </section>
    </div>
  );
}
```

**`<select>` 必須是全站唯一的。** `tools/acceptance.mjs:233` 用 `document.querySelector('select')` 抓它。標本索引已經是 button，不要在別處新增下拉。

- [ ] **Step 2: 加 `.protocol` 樣式**

Modify `src/shell/shell.css`，接在 `.vitrine__caption` 之後：

```css
.protocol {
  contain: content;
  border-top: 1px solid var(--rule);
  padding: 0.75rem 0 0;
  margin: 0 0 0.75rem;
}

.protocol h3 {
  margin: 0 0 0.5rem;
  font: 400 12px/1.4 var(--mono);
  letter-spacing: 0.1em;
  color: var(--seg-a);
}

.protocol p {
  margin: 0 0 0.5rem;
}

.protocol__instruction {
  color: var(--ink);
}

.protocol__spec,
.protocol__live {
  font-size: 12px;
  color: var(--seg-b);
}
```

- [ ] **Step 3: `App.tsx` 換上 `Vitrine`**

Modify `src/shell/App.tsx`：

1. 加 import：`import { Vitrine } from './Vitrine';`
2. **刪掉** `App.tsx` 裡的 `Metronome` 函式定義與 `THROTTLE_OPTIONS` 常數（已搬到 `Vitrine.tsx`）
3. `useState` 的 import 若 `App.tsx` 仍需要就留（`sessionId` / `specimenId` 等都還在用）
4. 把 Task 4 建立的 `<div className="vitrine">…</div>` 整塊，以及原本的操作程序 `<h3>` / 凍結條件 `<h3>` 段落，全部換成：

```tsx
        <Vitrine
          meta={meta}
          iframeRef={iframeRef}
          iframeSrc={iframeSrc}
          runId={runId}
          recorded={done}
          cpuThrottle={cpuThrottle}
          onThrottleChange={setCpuThrottle}
          onRerun={rerun}
        />
```

`done` 是 `App.tsx` 既有的 `const done = view.metrics?.totalInteractions ?? 0;`，位置不變。

`modes` 這個區域變數（`const modes = [...meta.modes].sort(...)`）在 Task 6 之後 `App.tsx` 已不再使用 —— 刪掉，`noUnusedLocals` 會抓。

- [ ] **Step 4: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```

Run（另一個終端機）:
```bash
npm run acceptance
```
Expected: 全條通過。這一步特別重要 —— 驗收會透過 `querySelector('select')` 改 throttle、用 `textContent` 找「重跑」按鈕。兩者都經過這次搬移。

---

## Task 8: 面板拆解第一批 —— Conditions / Floors / RawDump

**Files:**
- Create: `src/shell/format.ts`
- Create: `src/shell/panel/pickFrame.ts`
- Create: `src/shell/panel/Conditions.tsx`
- Create: `src/shell/panel/Floors.tsx`
- Create: `src/shell/panel/RawDump.tsx`
- Modify: `src/shell/Panel.tsx`（改成組裝層；**文字 `<pre>` 在這一步消失**）
- Modify: `src/shell/shell.css`（加 `.floors` / `.dump` / `.kv` / `.notes`）

**Interfaces:**
- Consumes: `PanelProps` 的既有欄位（不改 props 形狀）
- Produces:
  - `ms(v: number, digits?: number): string` from `../format`
  - `pickFrame(loaf: LoafSample[]): LoafSample` from `./panel/pickFrame` —— Task 10 的 `LoafReport` 也 import 這一份，不重新定義
  - `<Conditions meta mode conditions runId />`
  - `<Floors />`
  - `<RawDump snapshot={unknown} />`

**這一步之後文字 `<pre>` 不存在。** Task 3 已經把驗收改成讀 snapshot，所以 `npm run acceptance` 仍然要全綠 —— 這是本 task 的主要驗證。

**⚠️ snapshot 的 `loafWorst` 欄位不准在這一步消失。** `tools/acceptance.mjs:133` 的第 5 條讀 `s1.loafWorst`、`:146` 的第 7 條讀 `s7.loafWorst`。把它留到 Task 10 才加回來，中間這兩個 task 的驗收就是紅的 —— 這是 `pickFrame` 必須在本 task 就獨立成檔的唯一原因。

- [ ] **Step 1: 抽出 `format.ts`**

Create `src/shell/format.ts`:

```ts
/** 毫秒格式化。全站只准有一份 —— 面板各處的小數位數必須一致，否則截圖對不起來 */
export function ms(v: number, digits = 1): string {
  return `${v.toFixed(digits)}ms`;
}
```

`Panel.tsx` 原本的 `isWide` / `cols` / `padR` / `padL` / `RULE` **不搬過來**，Step 6 直接刪除 —— 對齊改由 grid 與 `font-variant-numeric: tabular-nums` 承擔。

- [ ] **Step 2: 抽出 `pickFrame.ts`**

Create `src/shell/panel/pickFrame.ts`，內容從 `Panel.tsx` 原封不動搬過來（**註解一字不改，它記錄的是一個踩過的坑**）：

```ts
import type { LoafSample } from '../../protocol';

/**
 * 挑出要細看的那一幀。
 *
 * 用 blockingDuration 挑是錯的：blockingDuration 是**整幀**的，外殼自己一次
 * 慢渲染就能贏過標本的 300ms 忙迴圈，於是面板細看的變成外殼那一幀，
 * 標本 script 顯示 0.0ms —— 驗收第 5 條要看的數字直接被蓋掉。
 * 本站宣稱的是標本做了多少工，所以先挑標本 script 最久的那一幀；
 * 完全沒有標本 script 時（例如驗收第 6 條的反向歸因）才退回整幀最久的那一幀。
 */
export function pickFrame(loaf: LoafSample[]): LoafSample {
  const withSpecimen = loaf.filter((s) => s.specimenScriptDuration > 0);
  const pool = withSpecimen.length > 0 ? withSpecimen : loaf;
  return withSpecimen.length > 0
    ? pool.reduce((a, b) => (b.specimenScriptDuration > a.specimenScriptDuration ? b : a))
    : pool.reduce((a, b) => (b.blockingDuration > a.blockingDuration ? b : a));
}
```

獨立成檔而不是留在 `Panel.tsx`、也不是塞進 Task 10 的 `LoafReport.tsx`：組裝層的 snapshot 與 `LoafReport` 都要用它，而**兩份 `pickFrame` 遲早會挑到不同的幀**，那種不一致沒有任何徵兆 —— 跟 `RunStats` / `refreshHz` 只准有一份實作是同一個理由。

- [ ] **Step 3: 建立 `Conditions.tsx`**

Create `src/shell/panel/Conditions.tsx`:

```tsx
/**
 * 凍結條件 —— 可重現的宣稱只在同一組 conditions 之間成立。
 *
 * CPU throttle 未宣告的警告不是提示，是作廢通知：JS 偵測不到 DevTools 的
 * throttling，沒宣告的截圖三個月後自己也看不懂（主 spec §2）。
 */
import type { RunConditions, SpecimenMeta } from '../../protocol';

export interface ConditionsProps {
  meta: SpecimenMeta;
  mode: string;
  conditions: RunConditions;
  runId: string;
}

export function Conditions({ meta, mode, conditions, runId }: ConditionsProps) {
  const modeDef = meta.modes.find((m) => m.id === mode);
  const dev = conditions.device;
  const hz = dev.refreshHz > 0 ? `${dev.refreshHz}Hz` : '—Hz（量測中）';

  return (
    <section className="conditions">
      <h3>凍結條件</h3>
      <dl className="kv">
        <dt>mode</dt>
        <dd className={modeDef?.kind === 'pathological' ? 'is-lesion' : 'is-remedy'}>
          {modeDef?.label ?? '?'}（{modeDef?.kind === 'pathological' ? '病變' : '治療'}）
        </dd>

        <dt>run</dt>
        <dd>{runId}</dd>

        <dt>裝置</dt>
        <dd>
          CPU throttle {dev.cpuThrottle} · {hz} · viewport {conditions.viewport.width}×
          {conditions.viewport.height}
        </dd>

        <dt>產物</dt>
        <dd>
          build {conditions.buildId} · protocol v{conditions.protocolVersion} · warmup{' '}
          {conditions.measure.warmupMs}ms
        </dd>
      </dl>

      {dev.cpuThrottle === 'unknown' && (
        <p className="is-lesion">
          ⚠ CPU throttle 還沒宣告 —— 現在截圖，之後沒有人知道這是幾倍速，等同作廢
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 建立 `Floors.tsx`**

Create `src/shell/panel/Floors.tsx`:

```tsx
/**
 * 三個已知的解析度下限。
 *
 * 這是「下限」，不是「數字不可信」（主 spec §1 誠實原則）。
 * 三個都寫出來，因為**誠實標註本身就是教學內容** —— 市面上幾乎沒有人寫這三件事，
 * 而寫清楚「這個工具的解析度到哪裡」比假裝精準更有說服力。
 */
const FLOORS: Array<{ title: string; body: string }> = [
  {
    title: 'durationThreshold 最低 16ms',
    body: '低於 16ms 的互動不會被回報。治療版本可能「快到看不見」',
  },
  {
    title: 'duration 四捨五入到 8ms',
    body: '無法分辨 20ms 與 24ms。分辨 412ms 與 40ms 完全沒問題（主 spec §4.3）',
  },
  {
    title: 'LoAF blockingDuration 是整幀的',
    body: '無法拆到單一 script，但 forcedStyleAndLayoutDuration 可以（主 spec §3.3）',
  },
];

export function Floors() {
  return (
    <section className="floors">
      <h3>檢驗限度說明</h3>
      <ol>
        {FLOORS.map((f) => (
          <li key={f.title}>
            <b>{f.title}</b>
            <span>{f.body}</span>
          </li>
        ))}
      </ol>
      <p>標明限制之後，就大方地下結論。</p>
    </section>
  );
}
```

- [ ] **Step 5: 建立 `RawDump.tsx`**

Create `src/shell/panel/RawDump.tsx`:

```tsx
/**
 * 原始檢體資料 —— 除錯用的 JSON 傾印。
 *
 * ⚠️ 這必須是整個 document 裡**最後一個** <pre>。
 * tools/acceptance.mjs:89-90 用 `[...document.querySelectorAll('pre')].at(-1)` 抓它 parse JSON。
 * 在它後面再加任何 <pre> 就會打斷驗收。
 *
 * 預設收合：<details> 收合時不排版內容，但 textContent 仍然讀得到，驗收不受影響。
 */
export interface RawDumpProps {
  snapshot: unknown;
}

export function RawDump({ snapshot }: RawDumpProps) {
  return (
    <details className="dump">
      <summary>▸ 原始檢體資料（JSON）</summary>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
    </details>
  );
}
```

- [ ] **Step 6: `Panel.tsx` 改成組裝層**

Rewrite `src/shell/Panel.tsx` 全檔：

```tsx
/**
 * 指標面板 —— 組裝層。
 *
 * Phase 0 的面板是單一 <pre>，明文規定不准寫 CSS（主 spec §5.3）。
 * 2026-07-25 由作者決定提前執行 Phase 3 的視覺工作；設計與 CSS 紀律見
 * docs/superpowers/specs/2026-07-25-shell-visual-design.md。
 *
 * 這個檔案只做兩件事：排 panel/* 的順序、算原始檢體 snapshot。
 * 任何格式化邏輯都屬於它自己的元件。
 */
import { PROTOCOL_VERSION } from '../protocol';
import type {
  LoafSample,
  RunConditions,
  RunResult,
  SpecimenMeta,
  SpecimenMetrics,
  SpecimenReady,
} from '../protocol';
import { Conditions } from './panel/Conditions';
import { Floors } from './panel/Floors';
import { RawDump } from './panel/RawDump';
import { pickFrame } from './panel/pickFrame';

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

export function Panel(p: PanelProps) {
  /**
   * 原始傾印：除錯用。LoAF 一輪可能上百幀，全丟進來只會讓 JSON 沒法讀，
   * 所以只留最嚴重的一幀與最近三幀 —— 這是唯一會影響結論的兩種樣本。
   *
   * ⚠️ loafWorst / loafRecent 是驗收契約，不是除錯便利：
   * tools/acceptance.mjs:133 的第 5 條與 :146 的第 7 條直接讀這兩個欄位。
   */
  const snapshot = {
    protocolVersion: PROTOCOL_VERSION,
    specimenId: p.meta.id,
    mode: p.mode,
    runId: p.runId,
    conditions: p.conditions,
    ready: p.ready,
    metrics: p.metrics,
    loafFrames: p.loaf.length,
    loafWorst: p.loaf.length > 0 ? pickFrame(p.loaf) : null,
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
      <Conditions meta={p.meta} mode={p.mode} conditions={p.conditions} runId={p.runId} />

      {p.notes.length > 0 && (
        <section className="notes">
          <h3>診斷訊息（最新在最下面）</h3>
          <ul className="scroll-list">
            {p.notes.map((n, i) => (
              <li key={`${i}-${n}`}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <Floors />
      <RawDump snapshot={snapshot} />
    </>
  );
}
```

**INP / LoAF / 歷次 run 三個區塊在 Task 9–11 逐一加回來。** 這一步刻意讓面板短暫變少 —— 這樣每個 task 的變更都能單獨驗證，而不是一次換掉 331 行然後不知道哪裡壞了。

`loafSupported` 這個 prop 在本 task 暫時沒有消費者。**不要從 `PanelProps` 刪掉**（Task 10 會用），但 `noUnusedParameters` 只管參數不管物件屬性，所以留著不會讓 typecheck 紅。

- [ ] **Step 7: 加樣式**

Modify `src/shell/shell.css`，接在 `.is-remedy` 之後：

```css
/* ── key-value 清單：標籤欄用 ch 固定，不用 % ────────────── */
.kv {
  display: grid;
  grid-template-columns: 6ch 1fr;
  gap: 0.25rem 0.75rem;
  margin: 0;
}

.kv dt {
  color: var(--seg-a);
  font-size: 12px;
}

.kv dd {
  margin: 0;
}

/* ── 診斷訊息 ────────────────────────────────────────── */
.notes ul {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 12px;
  max-height: 10rem;
  overflow-y: auto;
}

/* ── 檢驗限度說明 ────────────────────────────────────── */
.floors {
  border-top: 1px solid var(--ink);
  margin: var(--gap) 0 0;
  padding: 0.75rem 0 0;
  font-size: 12px;
  color: var(--seg-b);
  contain: content;
}

.floors h3 {
  margin: 0 0 0.5rem;
  letter-spacing: 0.1em;
  color: var(--seg-a);
  font: 400 12px/1.4 var(--mono);
}

.floors ol {
  margin: 0 0 0.5rem;
  padding-left: 1.5rem;
}

.floors li {
  margin: 0 0 0.25rem;
}

.floors b {
  display: block;
  color: var(--ink);
  font-weight: 400;
}

.floors p {
  margin: 0;
}

/* ── 原始檢體資料 ────────────────────────────────────── */
.dump {
  border-top: 1px solid var(--rule);
  margin: var(--gap) 0 0;
  padding: 0.75rem 0 0;
  contain: content;
}

.dump summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--seg-a);
}

.dump pre {
  margin: 0.5rem 0 0;
  font-size: 11px;
  max-height: 24rem;
  overflow: auto;
}
```

`.floors` 與 `.dump` 在 `.stage` 的右欄裡，不是全寬 —— 這是刻意的：報告的限度說明屬於報告，不屬於整個頁面。

- [ ] **Step 8: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```

Run（另一個終端機）:
```bash
npm run acceptance
```
Expected: **全條通過，包含第 4、5、7 條。**

- 第 4 條是 Task 3 的回報 —— 文字 `<pre>` 已經消失，但驗收綁的是 snapshot，所以不受影響。若它紅了，先回去確認 Task 3 Step 5 真的改對了，**不要把 `<pre>` 加回來**
- 第 5、7 條驗證 Step 2 的 `pickFrame` 與 Step 6 的 `loafWorst` 有接上。若它們紅了、訊息像是讀到 `undefined`，檢查 snapshot 是否真的有 `loafWorst` 欄位

---

## Task 9: INP 三段堆疊條

**Files:**
- Create: `src/shell/panel/InpBreakdown.tsx`
- Modify: `src/shell/Panel.tsx`（掛上 `InpBreakdown`）
- Modify: `src/shell/shell.css`（加 `.inp` / `.bar`）

**Interfaces:**
- Consumes: `segmentPct` from `../derive`、`ms` from `../format`
- Produces: `<InpBreakdown meta={SpecimenMeta} metrics={SpecimenMetrics | null} />`

- [ ] **Step 1: 建立 `InpBreakdown.tsx`**

Create `src/shell/panel/InpBreakdown.tsx`:

```tsx
/**
 * INP 三段分解 + 堆疊條。
 *
 * 條上不准有 transition：轉場要在 commit 那一幀多做合成工作，
 * 而且動畫正是這個站要指控的東西（設計 §5.4）。
 *
 * 三段之和可能不等於 duration（8ms 網格量化造成）。**不重新正規化** ——
 * 條不填滿本身就是量化誤差的視覺呈現，比湊到 100% 誠實（設計 §5.1）。
 */
import { segmentPct } from '../derive';
import { ms } from '../format';
import type { CSSProperties } from 'react';
import type { SpecimenMeta, SpecimenMetrics } from '../../protocol';

export interface InpBreakdownProps {
  meta: SpecimenMeta;
  metrics: SpecimenMetrics | null;
}

type SegmentKey = 'inputDelay' | 'processing' | 'presentation';

const SEGMENTS: Array<{ key: SegmentKey; name: string; tone: 'a' | 'b' }> = [
  // input 與 presentation 永不相鄰（processing 夾在中間），所以交替兩灰
  // 就足以讓每一組相鄰段都不同色（設計 §5.2）
  { key: 'inputDelay', name: 'input delay', tone: 'a' },
  { key: 'processing', name: 'processing', tone: 'b' },
  { key: 'presentation', name: 'presentation', tone: 'a' },
];

export function InpBreakdown({ meta, metrics }: InpBreakdownProps) {
  const inp = metrics?.inp;

  if (!metrics || !inp || inp.value === null || !inp.representative) {
    return (
      <section className="inp">
        <h3>INP · 主打指標 {meta.primaryMetric}</h3>
        <p className="inp__value">—</p>
        <div className="bar bar--empty" />
        <p className="inp__note">
          n={metrics?.totalInteractions ?? 0} · 尚無有效互動樣本。 照左邊的操作程序做完{' '}
          {meta.protocol.repetitions} 次，數字才會出現。
        </p>
      </section>
    );
  }

  const r = inp.representative;
  // 十次點擊與一百次點擊不會產生同一個統計量。n<50 時算出來的是 max，
  // 把它叫做 p98 就是說謊（主 spec §4.2 / 驗收第 4 條）
  const stat = inp.isMaxNotP98 ? 'max（樣本不足 50，非 p98）' : 'p98';
  const coarse = r.duration < 32;

  return (
    <section className="inp">
      <h3>INP · 主打指標 {meta.primaryMetric}</h3>

      <p className="inp__value">{Math.round(inp.value)}ms</p>
      <p className="inp__note">
        n={metrics.totalInteractions} · {stat} · 代表互動 {r.eventType}（底下 {r.entryCount} 筆
        entry）
      </p>

      <div className={inp.isMaxNotP98 ? 'bar bar--coarse-n' : 'bar'}>
        {SEGMENTS.map((s) => {
          const value = r[s.key];
          const pct = segmentPct(value, r.duration);
          const culprit = meta.culprit === s.key;
          const cls = [
            'bar__seg',
            culprit ? 'bar__seg--lesion' : `bar__seg--${s.tone}`,
            // 段為 0（含 presentation 被 clamp）時不讓它消失：改畫 2px tick
            pct === 0 ? 'bar__seg--tick' : '',
            s.key === 'presentation' && coarse ? 'bar__seg--quantized' : '',
          ]
            .filter(Boolean)
            .join(' ');

          // 沒有 title 屬性 —— 那是原生 tooltip，設計 §5.4 明文禁止。
          // 段名與數字寫在底下的 legend，任何時候都看得到，不用把滑鼠移過去。
          return (
            <div
              key={s.key}
              className={cls}
              style={{ '--pct': String(pct) } as CSSProperties}
            />
          );
        })}
      </div>

      <dl className="inp__legend">
        {SEGMENTS.map((s) => {
          const culprit = meta.culprit === s.key;
          return (
            <div key={s.key} className={culprit ? 'is-lesion' : ''}>
              <dt>{s.name}</dt>
              <dd>
                {ms(r[s.key])}
                {s.key === 'presentation' && coarse ? ' ±8ms' : ''}
                {culprit ? ' ← 兇手在這' : ''}
              </dd>
            </div>
          );
        })}
      </dl>

      {coarse && (
        <p className="inp__note">±8ms：duration 已被四捨五入到 8ms 網格，這一段繼承了那個量化</p>
      )}

      {r.presentationClamped && (
        <p className="inp__note is-lesion">
          ⚠ presentation 被 clamp 到 0：量化算出負值，代表真實值低於 8ms 網格的解析度。
          通常是好消息（快到量不出來），但它終究是量化假影 —— 不要拿它當「0ms」宣傳（主 spec §4.3）
        </p>
      )}

      <p className="inp__note">LCP / CLS —（Phase 0 不實作，欄位先存在，補上時不動協定）</p>

      {Object.entries(metrics.custom).length > 0 && (
        <p className="inp__note">
          custom{' '}
          {Object.entries(metrics.custom)
            .map(([k, v]) => `${k}=${v}`)
            .join(' · ')}
        </p>
      )}

      {metrics.crossCheck && (
        <p className="inp__note">
          crossCheck web-vitals inp={metrics.crossCheck.inp ?? '—'} Δ=
          {metrics.crossCheck.deltaInp ?? '—'}（容差走結論級：max(24ms, 10%) 且同一 CWV 區間）
        </p>
      )}
    </section>
  );
}
```

**`meta.culprit === 'loaf'` 時三段都不上紅** —— 上面的 `culprit` 判斷比對的是 `s.key`（`inputDelay` / `processing` / `presentation`），`'loaf'` 不等於其中任何一個，所以自動落到兩灰。這是設計 §5.2 要的行為，不需要額外分支。

- [ ] **Step 2: 加 `.inp` / `.bar` 樣式**

Modify `src/shell/shell.css`，接在 `.kv dd` 之後：

```css
/* ── INP 三段堆疊條 ──────────────────────────────────── */
.inp__value {
  margin: 0;
  font-size: 2.25rem;
  line-height: 1.1;
}

.inp__note {
  margin: 0.35rem 0 0;
  font-size: 12px;
  color: var(--seg-b);
}

.bar {
  display: flex;
  height: 1.5rem;
  margin: 0.75rem 0 0.5rem;
  border: 1px solid var(--ink);
  border-radius: 2px;
  background: var(--paper);
  overflow: hidden;
}

/* 尚無樣本：空框，不畫任何段 */
.bar--empty {
  border-color: var(--rule);
}

/* n<50：右端虛線，視覺上宣告這是 max 不是 p98 */
.bar--coarse-n {
  border-right: 2px dashed var(--lesion);
}

.bar__seg {
  width: calc(var(--pct) * 1%);
  /* 段與段之間 1px 分隔 —— seg-a 與 seg-b 相鄰對比只有 2.6:1，
     邊界由分隔線承擔而不是靠色差（設計 §3） */
  border-right: 1px solid var(--rule);
}

.bar__seg:last-child {
  border-right: 0;
}

.bar__seg--a {
  background: var(--seg-a);
}

.bar__seg--b {
  background: var(--seg-b);
}

.bar__seg--lesion {
  background: var(--lesion);
}

/* 段為 0（含 presentation 被 clamp）時不讓它消失 */
.bar__seg--tick {
  width: 2px;
  min-width: 2px;
}

/* duration < 32ms：presentation 落在 8ms 網格上。斜線紋是一次 paint 的靜態
   gradient，不用 SVG pattern、不用背景圖 */
.bar__seg--quantized {
  background-image: repeating-linear-gradient(
    45deg,
    transparent 0 3px,
    var(--paper) 3px 4px
  );
}

.inp__legend {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14ch, 1fr));
  gap: 0.5rem;
  margin: 0;
  font-size: 12px;
}

.inp__legend dt {
  color: var(--seg-a);
}

.inp__legend dd {
  margin: 0;
  color: inherit;
}
```

- [ ] **Step 3: 掛進 `Panel.tsx`**

Modify `src/shell/Panel.tsx`：

加 import：
```tsx
import { InpBreakdown } from './panel/InpBreakdown';
```

在 `<Conditions ... />` 後面插入：
```tsx
      <InpBreakdown meta={p.meta} metrics={p.metrics} />
```

- [ ] **Step 4: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```

開 `http://localhost:4173`，標本選 `01-main-thread-block`，mode 留在「病變」，**連續快速點十次**（這個標本的 `intervalMs` 是 `null`，不要等畫面回應）。

Expected：
- INP 大字出現
- 堆疊條三段，**只有 input delay 那段是紅的**（`01` 的 `culprit` 是 `inputDelay`）
- 條的右端有紅色虛線（n=10 < 50）
- legend 的 input delay 那一格帶「← 兇手在這」且是紅字

Run（另一個終端機）:
```bash
npm run acceptance
```
Expected: 全條通過

---

## Task 10: LoAF 報告 + 外殼自白

**Files:**
- Create: `src/shell/panel/LoafReport.tsx`
- Modify: `src/shell/Panel.tsx`（只掛上 `LoafReport`。`loafWorst` 在 Task 8 就已經在 snapshot 裡了，不要再加一次）
- Modify: `src/shell/shell.css`（加 `.loaf`）

**Interfaces:**
- Consumes: `ms` from `../format`、`pickFrame` from `./pickFrame`（Task 8 建立，**不要在這裡重新定義一份**）
- Produces: `<LoafReport meta={SpecimenMeta} loaf={LoafSample[]} loafSupported={boolean} />`

- [ ] **Step 1: 建立 `LoafReport.tsx`**

Create `src/shell/panel/LoafReport.tsx`:

```tsx
/**
 * LoAF 報告 —— 頁面級觀測，iframe 完全不隔離（主 spec §3.2）。
 *
 * 「外殼自白」那一行是這個站最貼題的一行字：本館的展場承認自己污染了展品。
 * 資料本來就在 shellScriptDuration，只是 Phase 0 沒把它當一等公民。
 */
import { ms } from '../format';
// pickFrame 只准有一份實作（Task 8）—— 兩份遲早會挑到不同的幀，而那種不一致沒有徵兆
import { pickFrame } from './pickFrame';
import type { LoafSample, SpecimenMeta } from '../../protocol';

export interface LoafReportProps {
  meta: SpecimenMeta;
  loaf: LoafSample[];
  loafSupported: boolean;
}

export function LoafReport({ meta, loaf, loafSupported }: LoafReportProps) {
  if (!loafSupported) {
    return (
      <section className="loaf">
        <h3>LoAF</h3>
        <p className="is-lesion">
          ⚠ 這個瀏覽器沒有 long-animation-frame，LoAF 全欄空白。
          本站宣告 Chromium-only，不寫 fallback（主 spec §5.3）。
        </p>
      </section>
    );
  }

  if (loaf.length === 0) {
    return (
      <section className="loaf">
        <h3>LoAF</h3>
        <p className="inp__note">
          本輪還沒有 long animation frame（外殼觀測，頁面級，iframe 不隔離）
        </p>
      </section>
    );
  }

  const worst = pickFrame(loaf);
  const pickedBy =
    worst.specimenScriptDuration > 0 ? '依標本 script 最久' : '依 blockingDuration 最久';

  // LoAF 最大的賣點就是「哪個函式、在哪個字元」。名字變成 n / t 代表 mangle 沒關掉，
  // 標本 #3 的核心證據直接報廢（陷阱 #2 / 驗收第 7 條）
  const mangled = worst.topScripts.some(
    (s) => s.origin === 'specimen' && s.duration > 8 && s.sourceFunctionName.length <= 2,
  );

  return (
    <section className={meta.culprit === 'loaf' ? 'loaf is-lesion' : 'loaf'}>
      <h3>
        LoAF · 本輪 {loaf.length} 幀{meta.culprit === 'loaf' ? ' ← 兇手在這' : ''}
      </h3>
      <p className="inp__note">外殼觀測；頁面級，iframe 完全不隔離。代表幀{pickedBy}。</p>

      <dl className="kv kv--wide">
        <dt>整幀 blockingDuration</dt>
        <dd>{ms(worst.blockingDuration)} —— 含外殼，規格上無法拆到單一 script</dd>

        <dt>標本 script</dt>
        <dd>{ms(worst.specimenScriptDuration)} —— 可拆</dd>

        <dt>標本 forced layout</dt>
        <dd>{ms(worst.specimenForcedStyleAndLayoutDuration)} —— 逐 script，標本 #3 主指標</dd>

        <dt>歸因</dt>
        <dd>{worst.attribution}</dd>
      </dl>

      {/*
        外殼自白 —— 本館的展場承認自己污染了展品。
        設計 §8：全站最貼題的一行字。改動外殼視覺時的閘門就是盯這個數字（spec §11.2）。
      */}
      <p className="loaf__confession">
        外殼在這一幀貢獻 <b>{ms(worst.shellScriptDuration)}</b>
        —— 本館展場自身的污染，不算在標本頭上（主 spec §3.2）
      </p>

      <h3>top scripts（依 duration 取前 5）</h3>
      <ol className="loaf__scripts scroll-list">
        {worst.topScripts.map((s, i) => (
          <li key={`${i}-${s.sourceURL}-${s.sourceCharPosition}`}>
            <span>
              [{s.origin}] {ms(s.duration)} · forced {ms(s.forcedStyleAndLayoutDuration)} ·{' '}
              {s.sourceFunctionName.length > 0 ? `${s.sourceFunctionName}()` : '(匿名)'}
            </span>
            <span className="inp__note">
              {s.sourceURL || '(無 sourceURL)'} @ {s.sourceCharPosition} ← {s.invoker || '?'}（
              {s.invokerType}）
            </span>
          </li>
        ))}
      </ol>

      {mangled && (
        <p className="is-lesion">
          ⚠ 標本的 sourceFunctionName 短到像被 mangle —— 檢查 vite.config 的 keepNames（陷阱 #2）
        </p>
      )}

      <h3>最近幾幀</h3>
      <ul className="loaf__recent scroll-list">
        {loaf.slice(-6).map((s, i) => (
          <li key={`${i}-${s.start}`}>
            blocking {ms(s.blockingDuration)} · 標本 {ms(s.specimenScriptDuration)} · 外殼{' '}
            {ms(s.shellScriptDuration)} · {s.attribution}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: 加 `.loaf` 樣式**

Modify `src/shell/shell.css`，接在 `.inp__legend dd` 之後：

```css
/* ── LoAF ────────────────────────────────────────────── */
.kv--wide {
  grid-template-columns: 22ch 1fr;
}

.loaf__confession {
  margin: 0.75rem 0;
  padding: 0.5rem 0.75rem;
  border-left: 2px solid var(--seg-b);
  font-size: 12px;
  color: var(--seg-b);
}

.loaf__confession b {
  color: var(--ink);
  font-weight: 400;
}

.loaf__scripts,
.loaf__recent {
  margin: 0 0 0.75rem;
  padding-left: 1.5rem;
  font-size: 12px;
  max-height: 12rem;
  overflow-y: auto;
}

.loaf__scripts li {
  margin: 0 0 0.35rem;
}

.loaf__scripts span {
  display: block;
}

/* section 帶 is-lesion 時只讓標題變紅，不要整段變紅 */
.loaf.is-lesion {
  color: var(--ink);
}

.loaf.is-lesion > h3:first-of-type {
  color: var(--lesion);
}
```

- [ ] **Step 3: 掛進 `Panel.tsx`**

Modify `src/shell/Panel.tsx`：

加 import：
```tsx
import { LoafReport } from './panel/LoafReport';
```

`snapshot` 物件**不要改** —— `loafWorst` 與 `pickFrame` 的 import 在 Task 8 就到位了。

在 `<InpBreakdown ... />` 後面插入：
```tsx
      <LoafReport meta={p.meta} loaf={p.loaf} loafSupported={p.loafSupported} />
```

- [ ] **Step 4: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```

Run（另一個終端機）:
```bash
npm run acceptance
```
Expected: 全條通過。特別注意第 5 條（標本 script 對得上忙迴圈時間）與第 6 條（反向歸因）—— 兩者都靠 `pickFrame`，這一步搬過檔案。

開 `http://localhost:4173` 跑一輪 `00-calibration`，確認：
- 「外殼在這一幀貢獻 X ms」那一行有數字
- top scripts 的函式名是可讀的（`busy300` 之類），**不是 `n` 或 `t`**

---

## Task 11: 歷次 run + 比值 + 可重現徽章

**Files:**
- Create: `src/shell/panel/RunHistory.tsx`
- Modify: `src/shell/Panel.tsx`（掛上 `RunHistory`）
- Modify: `src/shell/shell.css`（加 `.history` / `.badge`）

**Interfaces:**
- Consumes: `assessReproducibility`、`modeMedian`、`remedyRatio`、`REPRODUCIBLE_SPREAD_MAX` from `../derive`；`computeRunStats` from `../../measure/metrics`
- Produces: `<RunHistory meta={SpecimenMeta} mode={string} metrics={SpecimenMetrics | null} history={RunResult[]} />`

- [ ] **Step 1: 建立 `RunHistory.tsx`**

Create `src/shell/panel/RunHistory.tsx`:

```tsx
/**
 * 歷次 run + 比值 + 可重現徽章。
 *
 * ⚠️ 跨輪比較用每一輪的 **median**，不是 max。
 * 面板頂端報的 INP 是 max（n<50 時 p98 公式退化成 max），但 max 抗離群為零 ——
 * 拿它做可重現性判定會製造假警報：三輪的 max 各差 30% 完全可能只是一筆離群值，
 * 三輪的 median 各差 30% 才真的代表有變因沒凍住。
 *
 * **不列最佳值。** best-of 是挑櫻桃，跟本站定位正好相反 —— 而且對病變版本來說
 * 「最佳」的意思還是反的（最佳 = 最不誇張）。
 */
import { MEASURE_CONFIG } from '../../protocol';
import { computeRunStats } from '../../measure/metrics';
import {
  REPRODUCIBLE_SPREAD_MAX,
  assessReproducibility,
  modeMedian,
  remedyRatio,
} from '../derive';
import type { RunResult, SpecimenMeta, SpecimenMetrics } from '../../protocol';

export interface RunHistoryProps {
  meta: SpecimenMeta;
  mode: string;
  metrics: SpecimenMetrics | null;
  history: RunResult[];
}

export function RunHistory({ meta, mode, metrics, history }: RunHistoryProps) {
  const modes = [...meta.modes].sort((a, b) => a.order - b.order);
  // modes[0] 依協定必須是病變版本（主 spec §2）
  const pathological = modes[0];
  const pathologicalMedian = modeMedian(history, meta.id, pathological.id);

  // 進行中那一輪的值也列出來，但標清楚 —— 它還沒入帳，也不進 median
  const liveValue = metrics?.inp?.value;
  const live = liveValue == null ? null : Math.round(liveValue);

  const verdict = assessReproducibility(meta.id, modes, history);

  return (
    <section className="history">
      <h3>歷次 run · 同一標本、同一 mode、同一組 conditions 之間才可比</h3>

      <table className="history__table">
        <thead>
          <tr>
            <th>mode</th>
            <th>各輪 median</th>
            <th>median</th>
            <th>離散度</th>
            <th>比值</th>
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => {
            const runs = history.filter((r) => r.specimenId === meta.id && r.mode === m.id);
            const pendingHere = m.id === mode ? live : null;
            const lesion = m.kind === 'pathological';

            if (runs.length === 0) {
              return (
                <tr key={m.id} className={lesion ? 'is-lesion' : 'is-remedy'}>
                  <td>{m.label}</td>
                  <td colSpan={4}>
                    {pendingHere === null
                      ? '（還沒有完成的 run）'
                      : `（進行中 ${pendingHere}，按「重跑」才入帳）`}
                  </td>
                </tr>
              );
            }

            const values = runs.map((r) => Math.round(r.stats.median));
            // 跟輪內統計用同一支 computeRunStats。全站只准有一份 median / spread 定義
            const across = computeRunStats(values);
            const spread = across.spread;
            const thisMedian = modeMedian(history, meta.id, m.id);
            const ratio = lesion ? null : remedyRatio(pathologicalMedian, thisMedian);

            return (
              <tr key={m.id} className={lesion ? 'is-lesion' : 'is-remedy'}>
                <td>{m.label}</td>
                <td>
                  {values.join(' / ')}
                  {pendingHere === null ? '' : ` (+ 進行中 ${pendingHere})`}
                </td>
                <td>{Math.round(across.median)}</td>
                <td className={spread > REPRODUCIBLE_SPREAD_MAX ? 'is-lesion' : ''}>
                  ±{Math.round(spread * 100)}%
                </td>
                <td>{ratio === null ? '—' : `${ratio.toFixed(1)}×`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {modes.map((m) => {
        const runs = history.filter((r) => r.specimenId === meta.id && r.mode === m.id);
        if (runs.length === 0) return null;
        const spread = computeRunStats(runs.map((r) => Math.round(r.stats.median))).spread;
        // max 仍然列出來，因為那才是面板頂端報的那個數字 —— 只是不拿它判定可重現
        const maxes = runs.map((r) => Math.round(r.stats.max)).join(' / ');
        return (
          <p key={m.id} className="inp__note">
            {m.label} 各輪回報值 max：{maxes}
            {spread > REPRODUCIBLE_SPREAD_MAX
              ? ' · ⚠ 跨輪離散度超標 —— 檢查其他分頁、背景下載、throttle 設定'
              : ''}
          </p>
        );
      })}

      <p className={verdict.reproducible ? 'badge badge--ok' : 'badge badge--pending'}>
        {verdict.reproducible ? '可重現 ✓' : '尚未可重現'}
      </p>

      {verdict.reasons.length > 0 && (
        <ul className="inp__note">
          {verdict.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      <p className="inp__note">
        只列歷次與中位數，不列最佳值 —— best-of 是挑櫻桃，跟本站定位正好相反。
        可重現是重跑出來的，不是宣告出來的（至少 {MEASURE_CONFIG.runsForReproducibility} 輪）。
      </p>
    </section>
  );
}
```

- [ ] **Step 2: 加 `.history` / `.badge` 樣式**

Modify `src/shell/shell.css`，接在 `.loaf.is-lesion > h3:first-of-type` 之後：

```css
/* ── 歷次 run ────────────────────────────────────────── */
.history__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin: 0 0 0.5rem;
}

.history__table th {
  text-align: left;
  font-weight: 400;
  color: var(--seg-a);
  border-bottom: 1px solid var(--rule);
  padding: 0.25rem 0.5rem 0.25rem 0;
}

.history__table td {
  padding: 0.25rem 0.5rem 0.25rem 0;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

/* 只有第一欄的 mode 名字帶語意色，數字欄維持墨色 —— 紅色稀有才有重量 */
.history__table tr.is-lesion > td:first-child {
  color: var(--lesion);
}

.history__table tr.is-remedy > td:first-child {
  color: var(--remedy);
}

/* ── 可重現徽章：只有兩個狀態，沒有「接近」 ─────────────── */
.badge {
  display: inline-block;
  margin: 0.5rem 0;
  padding: 0.25rem 0.6rem;
  border: 1px solid currentColor;
  border-radius: 2px;
  font-size: 12px;
  letter-spacing: 0.1em;
}

.badge--ok {
  color: var(--remedy);
}

.badge--pending {
  color: var(--seg-a);
}
```

- [ ] **Step 3: 掛進 `Panel.tsx`**

Modify `src/shell/Panel.tsx`：

加 import：
```tsx
import { RunHistory } from './panel/RunHistory';
```

在 `<LoafReport ... />` 後面插入：
```tsx
      <RunHistory meta={p.meta} mode={p.mode} metrics={p.metrics} history={p.history} />
```

- [ ] **Step 4: 驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```

開 `http://localhost:4173`，跑 `00-calibration`：`busy-300` 三輪、`busy-30` 三輪（每輪之間按「重跑」，切 mode 也會自動結算上一輪）。

Expected：
- 表格兩列，`busy-300` 的 mode 名是紅字、`busy-30` 是墨青
- `busy-30` 那列的「比值」約 **10×**（`00-calibration` 的兩個 mode 是 300ms / 30ms，有解析解）
- 六輪跑完且離散度都在 15% 內時，徽章顯示 `可重現 ✓`
- 只跑三輪時徽章是 `尚未可重現`，底下列出「busy-30：只有 0 輪，需要 3 輪」

Run（另一個終端機）:
```bash
npm run acceptance
```
Expected: 全條通過

---

## Task 12: 校準閘門 + 截圖驗收

**Files:**
- Modify: `docs/superpowers/plans/baseline-shell-cost.md`（加改動後的數據與結論）

**Interfaces:**
- Consumes: Task 1 寫下的基線 median
- Produces: 過 / 不過的結論。不過就執行 spec §11.3 的退場方案

**這是這一輪的核心驗收。** 前面十一個 task 做的是「看起來對」，這一個 task 決定「數字有沒有被弄壞」。

- [ ] **Step 1: 全套指令先過**

Run:
```bash
npm run typecheck && npm run test
```
Expected: 兩者都過

Run:
```bash
npm run measure
```

Run（另一個終端機）:
```bash
npm run acceptance
```
Expected: 全條通過

任何一條紅就先修，不要帶著紅燈進閘門量測。

- [ ] **Step 2: 用與基線完全相同的程序量三輪**

照 Task 1 Step 3–6 的程序，一個字都不改（手動 4x 三輪 + 自動化 1x 三次）：

1. DevTools → Performance → CPU: **4× slowdown**
2. 頁面上的 CPU throttle 下拉選 **`4x`**
3. 標本選 **`00-calibration`**，mode 留在 `busy-300`
4. 每次節拍亮起點一下，共十次，不要連打
5. 從 LoAF 區塊的「外殼在這一幀貢獻 X ms」讀數字（就是原本 `外殼 script` 那個值，Task 10 把它升成一等公民）
6. 按「重跑」，共三輪

**`refreshHz` 必須與基線相同。** 換螢幕或換更新率就不是同一組 conditions，三筆數字不能互比 —— 那時要回到基線的那台機器重量。

- [ ] **Step 3: 寫入結論**

Modify `docs/superpowers/plans/baseline-shell-cost.md`，在檔案末尾加：

```markdown
---

# 改動後（外殼視覺完成）

量測日期：<填>
條件：CPU throttle 4x · <填>Hz · viewport 800×600 · 標本 00-calibration · mode busy-300
buildId：<填>

## 手動 4x（判準用這個）

| 輪 | 外殼貢獻 |
|---|---|
| 1 | <填>ms |
| 2 | <填>ms |
| 3 | <填>ms |

**median：<填>ms**

## 自動化 1x（旁證）

`npm run acceptance` 第 5 條的 `shellScript=`，跑三次：

| 次 | shellScript |
|---|---|
| 1 | <填>ms |
| 2 | <填>ms |
| 3 | <填>ms |

**median：<填>ms**

## 閘門結果

| | 基線 | 改動後 | 差值 |
|---|---|---|---|
| 手動 4x median（判準） | <填>ms | <填>ms | <填>ms |
| 自動化 1x median（旁證） | <填>ms | <填>ms | <填>ms |

判準（spec §11.2）：**手動 4x median** 上升 > 2ms 不算過。

**結論：<過 / 不過>**

若兩個讀數指向相反結論（4x 說過、1x 說不過，或反之），以 4x 為準並記下這個矛盾 ——
那代表迴歸落在雜訊量級，值得在退場決定裡註明。
```

- [ ] **Step 4: 差值超過 2ms 的處置**

**只有這一條路：退回 spec §11.3 的 C 案。**

- 保留：`shell.css`、`Masthead`、`SpecimenLabel`、`Vitrine`、館頭 / 索引 / 說明牌 / 展櫃邊框
- 恢復 `<pre>`：`Conditions` / `InpBreakdown` / `LoafReport` / `RunHistory` 四個元件合回單一 `<pre>` 文字面板，堆疊條改 ASCII（`███░░░`），`format.ts` 復原 `padL` / `padR` / `cols` / `isWide`
- `RawDump` 保持 `<details><pre>`，且仍是最後一個 `<pre>`
- `acceptance.mjs` **不要改回去** —— 綁 snapshot 是無條件的改善，跟面板長相無關

**不准的作法是留著現狀然後把 2ms 的門檻調寬。** 那是修結論不修變因，違反主 spec §1 原則 4。

- [ ] **Step 5: 截圖驗收**

`00-calibration` 與 `01-main-thread-block` 各跑滿一輪，各截一張整頁圖。

判準：**能不能直接貼進文章而不需要再裁切或加註？** 具體看四件事：
1. CPU throttle 與 refreshHz 在圖上看得到（沒宣告的截圖等同作廢）
2. `n=` 與「max 不是 p98」的標註在圖上看得到
3. 兇手段是紅的，而且只有那一段是紅的
4. 三個解析度下限在圖上看得到

- [ ] **Step 6: 最終驗證檢查點**

Run:
```bash
npm run typecheck && npm run test
```

Run（preview 在跑的狀態下）:
```bash
npm run acceptance
```

Run:
```bash
grep -rn "transition\|animation\|box-shadow\|backdrop-filter\|position: *sticky\|position: *fixed" src/shell/shell.css
```
Expected: **零命中**。有命中就是違反 spec §6 的硬規則，刪掉。

Run:
```bash
grep -c "isWide\|padL\|padR\|cols(" src/shell/Panel.tsx
```
Expected: `0`（40 行手刻全形字寬邏輯已經移除）

Run:
```bash
grep -rn "title=" src/shell/panel/
```
Expected: **零命中。** `title` 屬性是原生 tooltip，設計 §5.4 明文禁止。

Run:
```bash
grep -c "填" docs/superpowers/plans/baseline-shell-cost.md
```
Expected: `0` —— 閘門表格全部填了實際數字，結論欄寫了「過」或「不過」。

---

## 完成後要回填主 spec 的條目

實作全部通過閘門之後，`perf-pathology-museum-spec.md` 有四處要補（**這不在本計畫的 task 內，是給作者的清單**）：

1. §5.3 的「面板的視覺設計」一列加註：已於 2026-07-25 提前執行，設計見 `docs/superpowers/specs/2026-07-25-shell-visual-design.md`
2. §3.1 技術選型的「樣式 vanilla CSS」一列加註：紀律清單見該設計文件 §6
3. §5.6 驗收清單新增一條：**外殼視覺不得使 `shellScriptDuration` median 上升超過 2ms**
4. 驗收第 4 條的敘述從「面板字串」改為「snapshot 欄位」
