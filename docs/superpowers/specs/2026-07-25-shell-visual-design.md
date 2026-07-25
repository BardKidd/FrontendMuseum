# 外殼視覺設計 — 前端效能病理標本館

日期：2026-07-25 ｜ 狀態：設計已核可，待寫實作計畫

---

## 0. 這份文件的地位

主 spec [`perf-pathology-museum-spec.md`](../../../perf-pathology-museum-spec.md) §5.3 明文寫著：

> **明文規定 Phase 0 不准寫任何一行面板 CSS** —— 這裡最容易失控

**這份文件明知故犯。** 那不是漏讀，是 2026-07-25 由專案作者確認的決定：在標本進度 1/6 的狀態下，先把外殼視覺做出來。

主 spec 的顧慮仍然成立（排版會吃掉整個週末，標本一個都沒長出來）。應對方式就是這份文件本身 —— 範圍、色彩、版式、CSS 紀律、退場條件全部**先凍結**。實作階段只准照抄，**不准在實作期間重新設計**。§11 定義了量化的退場條件。

主 spec 不修改。這份文件是它 Phase 3 的提前執行紀錄；§12 列出實作完成後要回填主 spec 的條目。

### 0.1 範圍邊界（硬規則）

**只動 `src/shell/`、`index.html`、`tools/acceptance.mjs`，加上 `src/specimens.ts` 新增一個 `TOTAL_SPECIMENS` 常數（§8）。`specimens/` 下一行都不碰，`src/protocol.ts` 一個欄位都不加。**

`src/specimens.ts` 只准加那一個常數 —— **既有的 metadata 一個字都不改**。`viewport` / `id` / `protocol` 任一欄改動都會讓歷史數字作廢（主 spec §4.6 / §5.2 第 22 項）。

標本內部的 style / layout 成本**本身就是量測對象**。改標本的 CSS 等於換一版產物 —— 與 `buildId` 同級，`01-main-thread-block` 現有的所有數字立刻作廢。美化實驗區是獨立的一次決定，動工前得先想清楚怎麼宣告作廢。這一輪不碰。

### 0.2 已評估並否決的替代方案

| 方案 | 為什麼否決 |
|---|---|
| **A：`<pre>` 全保留，只加字體 / 邊框 / 內嵌 `<span>` 上色** | 量測風險趨近零，但天花板低 —— 永遠是終端機輸出的長相，做不出三段堆疊條 |
| **C：外框與導覽做真 DOM，數字面板留 `<pre>` + ASCII 條** | 風險幾乎零、質感意外貼題（打字機檢驗報告）。**保留為退場方案**（§11） |
| **B：面板拆成真 DOM，`contain` 關住重繪** | **採用。** 天花板最高，且風險是可量測的，不是賭 —— §11 的閘門就是量測它 |

B 的量測風險比直覺低，因為 `App.tsx` 的 250ms 節流閘門已經把面板 re-render 頻率的天花板鎖住了。

---

## 1. 設計命題

**這是一份被裱起來的檢驗報告，不是一個儀表板。**

所有決策從這句推導。加任何元素之前問一次：**博物館的標本說明牌上會有這個嗎？** 不會就刪。

刻意不做的長相：深色底 + phosphor 綠 / 示波器風。那是每一個效能工具的樣子 —— 那才是「普通」。而且暗底會誘人加 glow，glow 就是 blur，blur 就是繪製成本。

---

## 2. 版式

```
┌────────────────────────────────────────────────────────────┐
│ 館頭   前端效能病理標本館          Phase 0 · build a3f2c1   │
│ ────────────────────────────────────────────────────────── │
│ 展間索引  ▓00校準  ▓01主執行緒阻塞  ░未開放 ░未開放 ░ ░ ░  │
├────────────────────────────────────────────────────────────┤
│ 標本 01                                       ← 說明牌      │
│ 主執行線阻塞                    ← 全站唯一的襯線字          │
│ 同步排序五萬筆訂單                                          │
│ [ 病變 ] [ 治療·scheduler.yield ] [ 治療·Worker ]  即時切換  │
├─────────────────────────────┬──────────────────────────────┤
│ 展櫃                         │ 檢驗報告                      │
│ ┌─────────────────────────┐ │ 凍結條件 CPU 4x·60Hz·800×600  │
│ │ iframe 800×600 屬性寫死  │ │ ───────────────────────       │
│ │                         │ │ INP  412ms   n=10 · max      │
│ └─────────────────────────┘ │ ███░░░░░░░░░░░░░░░░░░░░░▓    │
│ viewport 800×600 · 尺寸凍結  │ 12 / 386 兇手 / 14 ±8ms      │
│                             │ ───────────────────────       │
│ 操作程序                     │ LoAF 標本 371ms              │
│ 節拍 ● 第 4 / 10 拍          │      外殼 3.2ms ← 自白        │
│ 已記錄 4 / 10   [ 重跑 ]     │ ───────────────────────       │
│                             │ 病變 412/398/431 median±8%   │
│                             │ 治療  38/ 41/ 40 median±8%   │
│                             │ 比值 10.3× · 可重現 ✓  ← 新增 │
├────────────────────────────────────────────────────────────┤
│ 檢驗限度說明（三個解析度下限，小字）                          │
│ ▸ 原始檢體資料                              ← details 收合  │
└────────────────────────────────────────────────────────────┘
```

- 容器 `max-width: 1180px`，水平置中。左欄 `800px` 固定，右欄彈性
- `< 1180px` 時報告欄掉到展櫃下方，變單欄

### 2.1 實驗區永不縮放（規格級要求）

iframe 的 `width` / `height` 永遠是取自 `meta.viewport` 的 HTML 屬性，**不准出現任何 `%` / `vw` / `vh` / `transform: scale`**。窄螢幕時外層容器 `overflow-x: auto`，讓它橫向捲。

理由（主 spec §4.6）：CLS = impact fraction × distance fraction，兩者都是 viewport 相對量；LCP element 的選擇也依賴 viewport。縮它等於讓所有歷史數字作廢。

---

## 3. 色彩

六個 token。每一個承載資訊的顏色都有**非顏色的第二訊號**（記號、位置或字重）。

| token | 值 | 用途 | 對比（vs `--paper`） |
|---|---|---|---|
| `--ink` | `#1a1a18` | 正文 | 16.4:1 |
| `--paper` | `#faf8f3` | 骨白紙底 | — |
| `--rule` | `#d8d3c8` | hairline 分隔線（裝飾） | 非文字 |
| `--lesion` | `#a3231c` | 病變。**只出現在**兇手段、病變 mode 的按鈕、歷次 run 的病變列 | 7.0:1 |
| `--remedy` | `#1f5d5a` | 治療 mode 的按鈕、歷次 run 的治療列、比值標記（§5.5）。**不用在堆疊條上** | 7.0:1 |
| `--void` | `#c0392b` | 「檢驗無效」印章底色（配白字） | 白字 5.4:1 |

堆疊條的非兇手段另用兩個實色灰（不用 opacity，避免疊圖成本）：

| token | 值 | 對比 vs `--paper` |
|---|---|---|
| `--seg-a` | `#8a8a85` | 3.3:1 |
| `--seg-b` | `#4a4a46` | 8.4:1 |

兩者相鄰對比 2.6:1，低於 WCAG 1.4.11 的 3:1，所以**段與段之間一律有 1px `--rule` 分隔**，邊界由分隔線承擔而不是靠色差。堆疊條同時是文字資料的冗餘視覺化 —— 每段的數字與段名都以文字並列。

**紅色稀有才有重量。** `--lesion` 在整個報告區只出現在兇手那一段，而且另外帶 `←` 記號，不靠顏色單獨傳訊。

### 3.1 不做深色模式

截圖是這個站的產出物。兩套主題會讓不同文章裡的圖對不起來，而跨文章一致的骨白底截圖本身就是識別。這是設計決定，不是省事。

---

## 4. 字體

**零外部字體請求。** 主 spec §5.1 第 7 條要求靜態資源 self-host 以保可重現；最省的 self-host 就是不要有。

| 用途 | 堆疊 |
|---|---|
| 數字 / 表格 / 一般 UI | `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace` |
| 標本名（**全站唯一襯線用法**） | `"Noto Serif TC", "Songti TC", serif` |

所有數字欄位加 `font-variant-numeric: tabular-nums`。這取代 `Panel.tsx` 現有的手刻對齊，並讓數字位數變動時不推版。

襯線只出現在標本標題 —— 那就是博物館說明牌的長相。

---

## 5. 三段堆疊條與兩個衍生值

三個 `div`，`width: calc(var(--pct) * 1%)`，`--pct` 由 React 以 inline custom property 寫入。

### 5.1 比例計算

以代表互動的 `duration` 為分母：

```
pct(seg) = seg / representative.duration * 100
```

三段（`inputDelay` / `processing` / `presentation`）之和可能不等於 `duration`（量化造成）。**不重新正規化，把差額留在條的尾端當空白** —— 條不填滿本身就是量化誤差的視覺呈現，比湊到 100% 誠實。

### 5.2 顏色映射

固定映射，兇手覆寫：

| 段 | 預設 | 兇手時 |
|---|---|---|
| input delay | `--seg-a` | `--lesion` |
| processing | `--seg-b` | `--lesion` |
| presentation | `--seg-a` | `--lesion` |

input 與 presentation 永不相鄰（processing 夾在中間），所以交替兩灰足以讓每一組相鄰段都不同色。

**`meta.culprit === 'loaf'` 時三段都不上紅**（兇手不在 INP 分解裡，例如標本 #2 之外的 LoAF 主導案例）。此時紅色只出現在 LoAF 區塊的標題，堆疊條維持兩灰。條上不准出現「找不到兇手」以外的暗示。

### 5.3 狀態

| 狀態 | 呈現 |
|---|---|
| 還沒有有效互動 | 條為空框（1px `--rule`），INP 顯示 `—`，下方提示「做完 N 次操作程序，數字才會出現」 |
| `n < 50` | 條右端虛線邊 + 文字標 `max（樣本不足 50，非 p98）` |
| `duration < 32ms` | presentation 段加 45° 斜線紋 + 文字標 `±8ms` |
| `presentationClamped` | presentation 段寬度 0 → 改畫 2px 實心 tick，不讓它消失；旁邊標 clamp 警語 |
| 某段為 0 但未 clamp | 同上：2px tick，不留空 |

斜線紋用 `repeating-linear-gradient`（一次 paint，靜態），**不用 SVG pattern、不用背景圖**。

### 5.4 禁止

- **無 `transition`。** 數字跳就跳。轉場要在 commit 那一幀多做合成工作，而且動畫正是這個站要指控的東西
- **無 tooltip。** hover 要 JS 或額外重繪。段名與數字直接寫在條的上下

### 5.5 報告區新增的兩個衍生值

§2 的版式圖有兩樣東西目前的 `Panel.tsx` 沒有。它們是這一輪**唯一新增的功能**（其餘全是重新排版），主 spec §2 的版式圖本來就有，補上不算擴張範圍。

**比值** —— 每個治療 mode 對病變 mode 的倍率：

```
比值(治療) = median(病變的各輪 median) / median(治療的各輪 median)
```

- 分子分母都用**跨輪 median**，跟 `RunHistory` 現有的判定基準同源。不用 max（主 spec：max 抗離群為零）
- 任一邊不足 1 輪 → 顯示 `—`，不顯示 0 也不隱藏該列
- 標 `--remedy` 色。這是全站最想讓人看到的數字，但它是**推導值不是量測值**，所以字重不超過 INP

**可重現徽章** —— 只有兩個狀態，判準完全沿用既有邏輯，不新增門檻：

| 狀態 | 條件 |
|---|---|
| `可重現 ✓` | 該標本的**每一個** mode 都滿足 `runs.length >= MEASURE_CONFIG.runsForReproducibility` **且** 跨輪 `spread <= 0.15` |
| `尚未可重現` | 其餘一切情況（含輪數不足） |

**沒有第三種狀態，也沒有「接近」。** 徽章旁邊列出未達標的原因（輪數不足／離散度超標），因為主 spec §1 的立場是修變因不是修結論 —— 徽章要能指出該修什麼。

---

## 6. 量測安全的 CSS 紀律

**這一節是整份設計最重要的部分。** 違反任何一條就是讓展場污染展品（主 spec §3.2：iframe 不隔離 INP 的 presentation 段）。

1. 外殼全域禁 `transition` / `animation` / `@keyframes`
2. 禁 `box-shadow` / `filter` / `backdrop-filter` / `opacity` 動態變化 / `border-radius > 2px`。層次靠 hairline 與間距
3. `:hover` / `:focus-visible` 只准改 `color` / `background-color` / `text-decoration` / `outline`。**不准改盒模型**（padding / border-width / font-size / margin）
4. 每個報告區塊 `contain: content`。長列表（LoAF 最近幾幀、歷次 run）另加 `content-visibility: auto` + `contain-intrinsic-size`
5. 禁 `position: sticky`（scroll 期間 recalc）與 `position: fixed`。面板跟著捲
6. 一份 `src/shell/shell.css`，`index.html` 的 `<head>` 裡 `<link>` 進來。不 inline `<style>`、不 CSS-in-JS（主 spec §3.1 已定：vanilla CSS）
7. 文字容器欄寬用 `ch` 或 grid 固定軌，不用 `%` —— 數字更新不觸發跨容器 reflow
8. 不新增任何 `<img>` / `<svg>` / icon font。記號用文字字元：`▓ ░ ● ○ ├ └ ← ▸ ✓ ⚠`

`index.html` 現有那段「這裡沒有任何 stylesheet 是刻意的」註解要改寫成指向這份文件，不是刪掉 —— 決定的歷史要留著。

---

## 7. `tools/acceptance.mjs` 一併修

面板拆成 DOM 會打斷現有驗收。**這不是附帶災害，是該做的改善。**

### 7.1 必改

| 位置 | 現況 | 改成 |
|---|---|---|
| `:92` `panelText()` | 抓第一個 `<pre>` 的 textContent | 刪掉。沒有面板散文可抓了 |
| `:119` `const txt1 = await panelText()` | 唯一的呼叫點 | 一併刪 |
| `:131` 驗收第 4 條的判定 | `txt1.includes('max（樣本不足 50，非 p98）') && txt1.includes('n=10')` | `s1.metrics.inp.isMaxNotP98 === true && s1.metrics.totalInteractions === 10`（`s1` 是同一輪已經抓到的 snapshot） |
| `:132` 驗收第 4 條的證據字串 | regex `/n=\d+ · [^\n·]*/` 比對面板散文 | 由上面兩個欄位組出來，例如 `n=10 · max（isMaxNotP98=true）` |

**理由：面板文字是 UI，會一直改；snapshot 是協定，凍結了。驗收該綁協定，不該綁散文。** `:89-90` 本來就是這樣做的，這次讓第 4 條跟上。

### 7.2 必須維持相容（實作時的約束）

| 位置 | 依賴 | 實作端的約束 |
|---|---|---|
| `:89-90` | 最後一個 `<pre>` 是 JSON snapshot | 原始檢體 `<details><pre>` 必須是 DOM 中最後一個 `<pre>`（收合狀態 `textContent` 照樣讀得到） |
| `:81-82` | 用 `textContent` 找 `button, select` | 按鈕的文字字面不改（`重跑`、mode label 等） |
| `:233` | `document.querySelector('select')` | **CPU throttle 維持全站唯一的 `<select>`。** 標本索引用 button，不准改成下拉 |

---

## 8. 三個貼題元件

- **「檢驗無效」印章** —— dev 模式的紅字段落改成滿寬 `--void` 實色帶，白色等寬大字 `檢驗無效 · DEV SERVER`，下一行「這頁的數字全部作廢，量測請跑 `npm run measure`」。**無旋轉、無半透明疊圖**（都是繪製成本），純實色帶。條件仍是 `import.meta.env.DEV`

- **空基座** —— 展間索引把尚未布展的展位畫成 `--rule` 虛線框 + 灰字「未開放」，`disabled` 不可點。博物館誠實呈現未布展的展位，順便就是路線圖。

  **不硬編標本名稱。** 主 spec 只零散提到 #1 主執行緒阻塞、#2 超多 DOM 節點、#3 強制同步版面重排、#5 網頁字型／CLS，#4 與 #6 的題目還沒定。替沒定案的標本編名字是把未決定寫成已決定。

  資料來源分兩層，兩層都已存在，不新增協定欄位：
  - `SpecimenMeta.status`（`protocol.ts:137`，`'draft' | 'ready'`）—— 已註冊的標本：`ready` 可點，`draft` 顯示標題但虛線框、不可點
  - `src/specimens.ts` 新增一個常數 `TOTAL_SPECIMENS = 6`（不含 `00-calibration`，它按主 spec §5.5 不是六個標本之一）—— 補到六個的差額畫成**無名空基座**，只有編號與「未開放」

  之後任何標本的題目一定案，就用 `status: 'draft'` 註冊進 `SPECIMENS`，索引自動長出名字，不用改 `shell.css` 也不用改這份文件

- **外殼自白** —— 報告區常駐一行：`外殼在本輪貢獻 3.2ms（本館展場自身的污染，見主 spec §3.2）`。資料早就在 `LoafSample.shellScriptDuration`，只是沒被當一等公民。全站最貼題的一行字

---

## 9. 不做（YAGNI）

深色模式 · 圖表函式庫 · SVG 折線圖（歷次 run 只有三個數字，畫折線是裝飾）· hover tooltip · 動畫 / 轉場 / 骨架屏 · 外部字體與 icon sprite · 手機版佈局最佳化（iframe 凍結 800×600，手機上這站本來就沒有意義；只保證不破版）· localStorage 持久化（主 spec §5.3 已列 Phase 3，這輪不碰）

---

## 10. 檔案結構

```
src/shell/
  shell.css            ← 唯一的樣式檔
  App.tsx              ← 加 className，改雙欄 grid；邏輯不動
  Panel.tsx            ← 縮成組裝層，只負責排 panel/* 與算 snapshot
  format.ts            ← 只留 ms()
  panel/
    Conditions.tsx     ← 凍結條件 + throttle 未宣告警告
    InpBreakdown.tsx   ← 三段堆疊條（§5）
    LoafReport.tsx     ← 代表幀 + top scripts + 外殼自白（§8）
    RunHistory.tsx     ← 歷次 run + 跨輪離散度
    Floors.tsx         ← 三個解析度下限
    RawDump.tsx        ← <details> + JSON snapshot
```

`Panel.tsx` 現在 331 行、七個職責混在一起。拆成六個各吃自己那塊 props 的元件。

**移除**：`isWide` / `cols` / `padR` / `padL` / `RULE` —— 約 40 行手刻全形字寬邏輯。對齊改由 grid + `tabular-nums` 承擔。

**`App.tsx` 的量測邏輯一行都不改。** 250ms 節流閘門、ref-only 訊息處理器、`awaitingResetRef` 閘門、`finalizeRun` / `startNewRun` 全部照原樣 —— 這輪只加 `className` 與調整 JSX 結構。

---

## 11. 驗證與退場條件

### 11.1 必過

```bash
npm run typecheck      # tsc --noEmit
npm run measure        # build + preview（另一個終端機留著）
npm run acceptance     # 全條通過，含改寫後的第 4 條
```

### 11.2 校準閘門（這輪的核心驗收）

**改動前**先在乾淨的 working tree 上跑三輪 `00-calibration`，記下面板報的 `shellScriptDuration` median。改完再跑三輪，同一組 conditions（同 CPU throttle、同螢幕）。

**判準：`shellScriptDuration` 的 median 上升 > 2ms 就不算過。**

2ms 的來由：`event.duration` 本身四捨五入到 8ms 網格（主 spec §4.3），2ms 遠低於解析度下限，翻不動任何結論；超過就開始有意義。這是把主 spec §1 原則 4「這個誤差會不會翻轉結論？」套在外殼自己身上。

### 11.3 沒過怎麼辦

**退回 §0.2 的 C 案**：外框、館頭、展間索引、說明牌、展櫃邊框保留真 DOM 與 `shell.css`；**報告區恢復 `<pre>`**，堆疊條改 ASCII（`███░░░`），`format.ts` 復原 `padL` / `cols` 那組工具。

C 案的視覺天花板比 B 低，但打字機檢驗報告的質感本來就貼題。**不准的作法是留著 B 然後把 2ms 的門檻調寬** —— 那是修結論不修變因。

### 11.4 人眼

`00-calibration` 與 `01-main-thread-block` 各截一張圖，確認能直接貼進文章而不需要再裁切或加註。

---

## 12. 實作完成後要回填主 spec

1. §5.3 的「面板的視覺設計」一列加註：已於 2026-07-25 提前執行，設計見本文件
2. §3.1 技術選型的「樣式 vanilla CSS」一列加註：紀律清單見本文件 §6
3. §5.6 驗收清單新增一條：**外殼視覺不得使 `shellScriptDuration` median 上升超過 2ms**
4. 驗收第 4 條的敘述從「面板字串」改為「snapshot 欄位」
