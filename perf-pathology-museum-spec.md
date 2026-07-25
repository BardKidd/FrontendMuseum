# 前端效能病理標本館 — 專案規劃文件

> 一頁一個效能反模式，每頁都能切換「壞版本 / 修好版本」，旁邊即時顯示實測指標。

---

## 1. 專案定位

**這不是一個效能優化教學網站。** 網路上那種東西已經太多了，而且大多是「請使用虛擬滾動」這種講完就沒了的條列。

這個專案的差異化在**可重現的對照實驗**：每個反模式都是一個可以親手操作、當場看到數字跳動的標本。讀者不是被告知「這樣會慢」，而是自己按下按鈕感受到卡頓，再切到修好版本感受差異，同時看到 INP 從 480ms 掉到 40ms。

### 三個目標，優先序如下

1. **產出可傳播的內容** — 每個標本配一篇短文，整套可以長成系列文章、分享會素材、或履歷上的作品連結
2. **把量測能力內化** — 做完之後你應該能徒手用 `PerformanceObserver` 抓出任何頁面的效能歸因，而不是只會開 Lighthouse 看分數
3. **程式碼量刻意壓低** — 重點在密度不在規模

### 明確不做的事

- 不做使用者系統、不做後端、不做資料庫
- 不追求標本數量，六個做透遠勝二十個做淺
- 不做跨瀏覽器相容，明確標示「本站量測功能需要 Chromium 系瀏覽器」

### 實驗有效性原則 — 本站追求可重現，不追求絕對精確

**這是對照實驗，不是效能稽核。** 本站對每個標本只做一句宣稱：

> 其他條件全部凍結時，翻動這一個變因，產生這個差距。

由此推出四條操作原則，它們同時界定了「什麼要做」與**「什麼不必做」**：

**1. 有效性的判準是「重跑能得到同樣的結論」，不是「重跑能得到同樣的數字」。**

同一台機器、同一組凍結條件下，病變版 412ms / 治療版 40ms 這個**結論**必須穩定重現。至於下次跑出 408ms 還是 424ms，無所謂。

**2. 量測誤差只有在「大到足以翻轉結論」時才需要處理。**

`duration` 的 8ms 量化，對一個 10 倍的差距完全無關緊要；它只在你要比較「兩個都已經很快的治療方案」時才咬人（§4.3）。**判準是誤差會不會翻轉結論，不是誤差存不存在。** 追求零誤差的終點是什麼都不敢發表。

**3. 環境變因不是要「解決」的問題，是要「凍結並宣告」的問題。**

網路速度、裝置效能、螢幕更新率 —— 這些全部不在本站的宣稱範圍內。就像你不會因為使用者網路爛就說自己的頁面效能有問題：那不是你翻動的變因。

本站的作法是把它們全部固定下來並寫在面板上：viewport 尺寸凍結（§4.6）、資源自架不吃快取（§4.7）、CPU throttling 手動宣告（§2）、操作程序凍結（§5.4 的 `protocol` 欄位）、切換後丟棄暖機期（§3.4）、build 設定固定（§3.1）。

**唯一的例外是「單次 session 內就在變」的噪音** —— 其他分頁、背景下載、瀏覽器擴充套件、OS 排程。這一類宣告不了，因為它在你量測的當下就在變。對付它的方法不是宣告，是重跑（原則 4）。

**4. 可重現不是宣告出來的，是重跑出來的。**

凍結變因只是前置作業，是必要條件不是充分條件。一個標本的結論要成立，必須：**同一台機器、同一組凍結條件，連跑三輪，三輪得到同一個結論。**

「同一個結論」要能機械判定，不能靠感覺：

1. 三輪的病變／治療中位數比值，都落在同一個量級帶（例如都 ≥ 5×）
2. 三輪的**兇手段一致** —— 不會這輪 processing 爆掉、下輪變成 input delay
3. 三輪病變值的相對離散度 ≤ 30%（`(max - min) / median`）

不通過**不代表數字不可信，代表有一個變因沒凍住** —— 最常見是其他分頁、背景下載、或忘了開 throttle。**修變因，不修結論。**

這條同時取代掉一大批 caveat：**展示三輪一致，比解釋十個誤差來源有說服力得多。** 而且市面上的效能文章清一色是單次量測的截圖 ——「三輪都是 400±20ms → 40±8ms」和「412ms 降到 40ms」是完全不同等級的說服力。

### Phase 0 清單為什麼那麼長 —— 三個目的，沒有一個是絕對精確

Phase 0 的項目看起來很多，但每一項都只落在三格之一：

| | 目的 | 服務什麼 |
|---|---|---|
| **G1** | 讓實驗可重現 | 凍結變因：viewport、資源、build 模式、throttling 宣告、暖機、操作程序 |
| **G2** | 讓結論指向對的原因 | 歸因不能把外殼的工作算到標本頭上：`interactionId` 分組、LoAF 粗過濾 |
| **G3** | 讓你不用回頭重寫 | 純型別形狀，**跟數字完全無關**：協定、metadata、runtime contract |

**判斷一項該不該進 Phase 0，就問它落在哪一格。三格都不落 → 延後。**

### 誠實原則 — 限制寫在 UI 上，不寫在心裡

本站有三個已知的**解析度下限**（注意：是下限，不是「數字不可信」）：

| 限制 | 實際影響 |
|---|---|
| `durationThreshold` 最低 16ms | 低於 16ms 的互動不會被回報。治療版本可能「快到看不見」 |
| `duration` 四捨五入到 8ms | 無法分辨 20ms 與 24ms。分辨 412ms 與 40ms 完全沒問題（§4.3） |
| LoAF `blockingDuration` 是整幀的 | 無法拆到單一 script，但 `forcedStyleAndLayoutDuration` 可以（§3.3） |

三個都要寫進 UI 與文章。**誠實標註本身就是教學內容** —— 市面上幾乎沒有人寫這三件事，而寫清楚「這個工具的解析度到哪裡」比假裝精準更有說服力。

但誠實不等於自我否定：**標明限制之後，就大方地下結論。**

---

## 2. 核心體驗設計

### 單一標本頁的結構

```
┌─────────────────────────────────────────────┐
│  標本 #03  強制同步版面重排                    │
│  ┌───────────────────────────────────────┐  │
│  │  [ 病變 ] [ 治療:讀寫分離 ]   ← 切換    │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│                                             │
│   ← 實驗區（iframe，尺寸凍結 800×600）        │
│      使用者在這裡實際操作                     │
│                                             │
├─────────────────────────────────────────────┤
│  指標面板    CPU: [4x ▾]  60Hz  n=10  [重跑] │
│  INP  412ms  ⚠ 樣本 <50，此為 max 非 p98     │
│  ├ input delay      12ms                    │
│  ├ processing      386ms  ← 兇手在這         │
│  └ presentation     14ms  ±8ms              │
│  LoAF 標本 script   371ms                    │
│       整幀 blocking 389ms（含外殼）           │
│       forced layout 340ms  ← 標本 #3 主指標   │
│  ─────────────────────────────────────────  │
│  病變 412 / 398 / 431 · median 412 · ±8%    │
│  治療  38 /  41 /  40 · median  40 · ±8%    │
│  比值 10.3×  兇手段三輪一致 ✓  可重現 ✓      │
├─────────────────────────────────────────────┤
│  病理報告（文字）                             │
│  症狀 / 成因 / 怎麼量出來 / 怎麼修 / 延伸閱讀  │
└─────────────────────────────────────────────┘
```

### 關鍵互動原則

- **先讓人痛，再給解藥**：預設載入「病變版本」，且頁面上有明確的操作提示，確保使用者真的感受到卡頓才去看數字
- **操作程序也是凍結變因**：不能只說「連續點擊十次」—— 十次連打與十次每秒一下，INP 差很多（連打時 input delay 會疊加）。metadata 的 `protocol` 欄位宣告次數與間隔（§5.4），UI 做成**節拍器**（每 `intervalMs` 閃一下提示點擊）。這把可重現性從紙面規則變成實際機制，大概二十行程式碼
- **數字要有對照，而且顯示歷次結果不是最佳結果**：面板顯示每個 mode 的**歷次 run 與中位數**（`412 / 398 / 431 · median 412 · spread 8%`）。**顯示最佳值等於挑櫻桃**，跟本站「可重現」的定位正好相反 —— 而且對病變版本來說「最佳」的意思還是反的（最佳 = 最不誇張）
- **CPU throttling 必須手動宣告**：**JS 無法偵測 DevTools 的 CPU throttling**。面板上放一個 `1x / 4x / 6x` 下拉，使用者自己選，選了之後寫進每一筆樣本。沒有這個欄位，你截的圖不知道是幾倍速，文章沒法比較 —— 而且這個欄位若之後才加，先前所有截圖等於作廢
- **樣本數永遠可見**：面板固定顯示 `n=`。互動少於 50 次時，算出來的是 max 不是 p98，UI 必須標明（見 §4.2）

---

## 3. 技術架構

### 3.1 技術選型

| 項目 | 選擇 | 理由 |
|---|---|---|
| 建置工具 | Vite（multi-page 模式） | 每個標本一個獨立 HTML entry，天然隔離 |
| 外殼框架 | React + TypeScript | 你熟悉，且外殼本身不是效能量測對象 |
| 標本內部 | **原生 JS，不用框架** | 框架的排程與批次更新會污染實驗結果 |
| 樣式 | vanilla CSS | 避免 CSS-in-JS 的執行期開銷混進數字 |
| 路由 | **不用 router** | MPA 本來就是多個 HTML entry，加 router 只讓外殼變重、LoAF 更髒 |
| 部署 | Cloudflare Pages / Vercel | 靜態站，免費額度綽綽有餘 |

**標本內部堅持用原生 JS 是核心決策。** 如果標本 #1（主執行緒阻塞）用 React 寫，React 的排程機制會替你做一部分緩解，你量到的就不是純粹的反模式。

**⚠️ build 設定是量測正確性的一部分，不是打包細節。**

LoAF 的最大賣點是 `sourceFunctionName` + `sourceCharPosition` 能精確指出兇手。**Vite build 預設會 mangle 函式名，你拿到的會是 `sourceFunctionName: "n"`** —— 標本 #3 的核心證據直接報廢。

標本 entry 必須保留函式名：

```ts
// vite.config.ts
export default defineConfig({
  esbuild: { keepNames: true },     // 保住 LoAF 的 sourceFunctionName
  build: {
    minify: 'esbuild',
    rollupOptions: { input: { /* 每個標本一個 entry */ } },
  },
});
```

這個決定會改變產物，**之後才改 = 先前所有截圖與數字作廢**，所以它是 Phase 0 項目。

**部署注意**：不要設 SPA catch-all rewrite。標本路徑形如 `/specimens/03-layout-thrashing.html?mode=broken&t=...`，被 rewrite 吃掉就整站壞掉。

### 3.2 iframe 到底隔離了什麼

**先把不成立的部分講清楚**：

| 以為隔離的 | 實際 | 原因 |
|---|---|---|
| 主執行緒阻塞 | ❌ 完全不隔離 | 同源 iframe 與主頁面共用 renderer 主執行緒 |
| LoAF | ❌ 完全不隔離 | 規格：同源 iframe 的 frame timing 沿用最近的同源 root；top level page 內**所有** observer 收到同一批 entry |
| INP 的 presentation delay 段 | ⚠️ 只減輕，沒消除 | presentation delay 等到 next paint，paint 是 renderer 層級的。外殼面板的 style/layout 成本仍會延後 paint |
| LCP / CLS | ✅ 真的隔離 | per-document，父頁面看不到 iframe 內容 |
| DOM / 樣式作用域 | ✅ 真的隔離 | 標本 #2 塞 5000 節點不會墊高外殼的 selector matching 成本 |
| 整個 document 可重載 | ✅ 唯一做法 | B 類標本的生命線 |

**扣掉不成立的，iframe 仍然值得，剩下三個理由每個都夠強：**

1. **B 類標本沒有 iframe 就做不出來。** LCP/CLS 是 per-document，要重量一次只能重載 document。沒有 iframe = 重載整頁 = 外殼狀態與對照歷史值全丟
2. **標本之間不互相污染。** 切換標本 = 丟棄整個 document，是唯一乾淨的清理方式
3. **DOM/樣式作用域隔離**讓外殼的 selector matching 成本與標本無關

**評估過但否決的替代方案：**

- **不用 iframe，面板畫在同一個 document** → 否決。面板的 React render 會落在互動的同一幀，直接污染 presentation delay，且 LoAF 完全無法歸因
- **同源直接存取 `iframe.contentWindow`，砍掉 postMessage** → 否決。省 2~3h，但 postMessage 的訊息邊界**強迫你把「什麼時候算一批」定義清楚**，而 warmup / session / seq 這些語意正是靠它凍結下來的。這是少數「多一層抽象反而正確」的地方
- **cross-site iframe（不同 eTLD+1）→ site isolation → 真正隔離** → 技術上是唯一真隔離方案，但要跑兩個 origin、部署變兩份，為地基太重。**改成加碼標本 #9，它本身就是絕佳教材**

### 3.3 觀測職責分工（架構定案）

因為 LoAF 是頁面級的，把它拉到外殼觀測反而更簡單，`postMessage` 協定少一半：

| 指標 | 觀測位置 | 理由 |
|---|---|---|
| **LoAF** | **外殼** | 頁面級，iframe 內觀測沒有額外好處；外殼本來就知道自己在做什麼，能自我排除 |
| **INP / Event Timing** | **iframe 內** | entry 只回報給事件目標所在的 document |
| **LCP / CLS** | **iframe 內** | per-document，父頁面看不到 |

**LoAF 歸因規則（凍結）**，優先序由可靠到不可靠：

```ts
// W3C LoAF 規格的完整列舉，只有這五個值：
//   enum ScriptWindowAttribution { "self", "descendant", "ancestor", "same-page", "other" };
// 不存在 'same-origin-descendant' / 'other-origin-descendant' 之類的值，別自己加。
function classifyScript(s: any, iframeWin: Window | null): LoafOrigin {
  // 1. 最可靠：same-origin 下 script.window 直接是 Window 物件
  if (iframeWin && s.window === iframeWin) return 'specimen';
  // 2. 次選：從外殼看，iframe 內的 script 是 'descendant'
  if (s.windowAttribution === 'descendant') return 'specimen';
  if (s.windowAttribution === 'self') return 'shell';
  // 3. Fallback：路徑前綴。最小可行版只用這一條就夠
  if (typeof s.sourceURL === 'string' && s.sourceURL.includes('/specimens/')) return 'specimen';
  if (typeof s.sourceURL === 'string' && s.sourceURL.length > 0) return 'shell';
  return 'unknown';
}
```

上面的列舉值取自 [W3C LoAF 規格的 IDL](https://w3c.github.io/long-animation-frames/)，已查證。**仍需 Phase 0 花 15 分鐘實測的是「Chrome 的實作是否已跟上規格」** —— 規格值正確不代表你那版 Chrome 就照著回傳，尤其 `script.window` 是否真的給你 Window 物件。實測完把結論寫死；對不上就走第 3 條 fallback，不要改列舉值。

**已知殘留誤差**：`entry.blockingDuration` 是整幀的，規格上無法拆到單一 script。面板顯示它時必須標「整幀（含外殼）」，另外顯示可拆的 `specimenScriptDuration`。

**架構約束（不是建議）**：因為 iframe 不保護 presentation delay，**面板在互動期間絕對不能更新**。違反它，標本 #2 的 presentation delay 會摻進你自己面板的 layout 成本 —— 而 #2 的兇手正好就是這一段，所以這裡沒有安全邊際。

### 3.4 broken / fixed 切換機制

**A 類：互動期指標（INP、LoAF）** — 可即時切換。iframe 收到 `host:set-mode` 就換掉 handler 實作，不 reload。

**B 類：載入期指標（LCP、CLS）** — **無法即時切換**。LCP 在載入後定案（且首次互動即凍結），CLS 累積整個 page lifetime。必須整個 iframe 重載：

```ts
iframe.src = buildSpecimenUrl(meta, { mode, t: String(Date.now()), sid });
```

時間戳強制不吃快取。UI 要明確呈現這是「重新載入實驗」而非「即時切換」。

**mode 不是二元的。** 標本 #1 有兩段治療（yield / worker）、#2 有兩段、#4 有三段。協定一開始就必須是 `modes: SpecimenModeDef[]`，寫成 `'broken' | 'fixed'` 做到第一個標本就要改協定 + 改外殼 UI + 改 metadata。

**切換後必須丟棄暖機期樣本。** JIT 暖機與第一次 layout 會讓數字虛胖。切 mode 後 500ms 內的樣本標記 `warmup: true`，不列入統計。這條規則改了 → 所有數字重跑，所以是 Phase 0 項目。

---

## 4. 量測方法論

**Phase 0 要先做完這一層再開始寫標本。** 做壞了，後面所有標本的數字都要重跑。

### 4.1 INP 的完整拆解

```
互動延遲 = input delay + processing time + presentation delay
           ↑              ↑                 ↑
    事件排隊等主執行緒  你的 handler 在跑   瀏覽器算樣式+繪製
```

不同標本的兇手落在不同段：
- 標本 #1（主執行緒阻塞）→ **input delay** 爆掉
- 標本 #3（強制重排）→ **processing time** 爆掉
- 標本 #2（超多 DOM 節點）→ **presentation delay** 爆掉

### 4.2 `interactionId` 分組（最嚴重的坑）

**一次點擊會產生多筆 event entry**（`pointerdown` / `pointerup` / `click`），共用同一個 `interactionId`。逐筆上報 = 一次互動算三次，面板數字忽大忽小，且跟 `web-vitals` 永遠對不起來。

正確作法：依 `interactionId` 分組取 max duration，`interactionId === 0` 丟棄。

```ts
const byInteraction = new Map<number, InteractionSample>();
/** 由 host:set-mode 設定（EpochMs）。這之前開始的互動一律標 warmup */
let warmupUntil = 0;

const po = new PerformanceObserver((list) => {
  // 用 getEntriesByType 而非 getEntries：本站架構下這個 observer 只有 'event' 一種型別
  // （LoAF 在外殼、Event Timing 在 iframe，不同 document），所以理論上不必。
  // 但這段會被複製貼上 —— 一旦有人把它併進多型別 observer，getEntries() 會混入
  // 沒有 interactionId 的 entry，下面的相減全部變 NaN。防禦成本零。
  for (const e of list.getEntriesByType('event') as PerformanceEventTiming[]) {
    if (!e.interactionId) continue;      // 0 或 undefined 都丟棄（`=== 0` 擋不掉 undefined）

    const prev = byInteraction.get(e.interactionId);
    if (!prev) {
      byInteraction.set(e.interactionId, buildSample(e, 1));
    } else if (e.duration > prev.duration) {          // 同組取 max
      byInteraction.set(e.interactionId, buildSample(e, prev.entryCount + 1));
    } else {
      prev.entryCount++;
    }
  }
});
po.observe({ type: 'event', buffered: true, durationThreshold: 16 });

function buildSample(e: PerformanceEventTiming, entryCount: number): InteractionSample {
  const raw = e.startTime + e.duration - e.processingEnd;
  const startTime = performance.timeOrigin + e.startTime;
  return {
    interactionId: e.interactionId,
    eventType: e.name,
    startTime,
    duration: e.duration,
    inputDelay: e.processingStart - e.startTime,
    processing: e.processingEnd - e.processingStart,
    presentation: Math.max(0, raw),
    presentationClamped: raw < 0,     // 量化誤差算出負值，本身是教學訊號
    entryCount,
    warmup: startTime < warmupUntil,  // ⚠️ 絕對不可以寫死 false —— 見下方
  };
}
```

INP 不是平均也不是最大，是「近似 p98」：

```ts
function computeInp(): InpSummary {
  // ⚠️ 第一步就是濾掉 warmup —— 這比下面的 index 公式重要得多。
  // 因為 n < 50 時 idx = 0，INP 就是 max：只要有一筆暖機離群值留在陣列裡，
  // 它就會直接變成你報告的那個數字，warmup 機制等於完全失效。
  const valid = [...byInteraction.values()].filter((s) => !s.warmup);
  if (valid.length === 0) return { value: null, count: 0, isMaxNotP98: true, representative: null };

  const sorted = valid.sort((a, b) => b.duration - a.duration);

  // 計數與排序陣列必須同源。用一個含 warmup 的獨立計數器去索引一個不含 warmup
  // 的陣列，兩者一旦不同步，index 就會偏移。所以不維護 totalInteractions，
  // 一律從 valid 推導。
  const n = valid.length;
  const idx = Math.min(n - 1, Math.floor(n / MEASURE_CONFIG.inpPercentileDivisor));
  const rep = sorted[idx];

  return {
    value: rep.duration,
    count: n,
    isMaxNotP98: n < MEASURE_CONFIG.inpPercentileDivisor,
    representative: rep,
  };
}
```

**樣本數 < 50 時 `floor(n/50) = 0`，算出來的是 max 不是 p98。** 10 次點擊與 100 次點擊算出的不是同一個統計量，UI 必須標明。

**而正因為是 max，warmup 過濾不是精修而是必要條件**（§5.1 第 6 項）—— max 統計下沒有平均可以稀釋離群值，一筆就夠毀掉一輪。這也是為什麼 `buildSample` 裡 `warmup` 必須真的算出來，不能寫死 `false`。

**`durationThreshold` 設 16 有代價，文章要誠實講**：低於 16ms 的互動**永遠不會被回報**。所以治療版本如果真做到 12ms，面板還是空的 —— 不是程式壞了，是規格地板。

### 4.3 8ms 量化 — 解析度下限，不是可信度問題

規格規定 `PerformanceEventTiming.duration` **四捨五入到最接近的 8ms**（防止當高精度計時器用）。104ms 這個預設門檻正是「100 以上第一個 8 的倍數」。

`startTime` / `processingStart` / `processingEnd` 解析度較高，所以：

| 段 | 解析度 |
|---|---|
| input delay | 高（直接相減） |
| processing | 高（直接相減） |
| **presentation** | 8ms（用 `startTime + duration - processingEnd` 算，繼承量化） |

**這個限制咬得到哪裡、咬不到哪裡，要分清楚：**

| 你想比較的 | 8ms 有沒有影響 |
|---|---|
| 病變 412ms vs 治療 40ms | ❌ 完全沒有。10 倍的差距，8ms 是雜訊 |
| 病變版本的三段拆解（386ms 落在 processing） | ❌ 沒有。歸因結論穩固 |
| **治療方案 A（20ms）vs 治療方案 B（24ms）** | ✅ **咬得到。** 這兩個數字在 8ms 網格上可能無法區分 |
| 治療版本 presentation 段的絕對值 | ✅ 咬得到，且可能算出負值被 clamp 到 0 |

**結論：本站的核心宣稱（病變 vs 治療的量級差距）不受影響。** 8ms 只限制一件事 —— **兩個都已經很快的方案之間，不要宣稱誰比誰快**。標本 #1 有 yield 與 worker 兩段治療，兩者都會落到 8ms 網格內，文章就寫「兩者都把 INP 壓進良好區間」，不要排名。

作法：
1. 面板對 duration < 32ms 的互動把 presentation 段標成 `±8ms`
2. 多段治療之間不做排名，只說「都達成目標」
3. `presentationClamped` 為 true 時面板顯示提示。**負值代表真實 presentation 小於 8ms 網格的解析度**，通常是好消息（快到量不出來），但它終究是量化假影 —— 不要拿它當「0ms」宣傳
4. 病理報告寫一個小節 ——「為什麼你的 INP 永遠是 8 的倍數」。網路上幾乎沒人寫這個，是原創觀點

### 4.4 Long Animation Frames (LoAF)

比 `longtask` 好用太多。`longtask` 只說「有個任務跑了 380ms」，LoAF 會說**是哪個函式、在哪個檔案的第幾個字元**。

```js
po.observe({ type: 'long-animation-frame', buffered: true });   // buffer 上限 200
```

`entry.scripts[]` 每項的關鍵欄位：

| 欄位 | 用途 |
|---|---|
| `forcedStyleAndLayoutDuration` | **標本 #3 的核心指標**，直接量化 layout thrashing。逐 script，可乾淨過濾外殼 |
| `sourceURL` / `sourceFunctionName` / `sourceCharPosition` | 精確定位（**需 `keepNames: true`**，見 §3.1） |
| `invoker` / `invokerType` | 誰觸發的 |
| `window` / `windowAttribution` | 歸因用，見 §3.3 |

`entry.blockingDuration` 是**整幀**的，無法拆。

### 4.5 CLS 的 session window

**CLS 不是所有 shift 的總和，也不是最後一個 window 的值，而是「所有 session window 中的最大值」。**

session window 規則：
- 濾掉 `hadRecentInput === true` 的 shift
- 相鄰 shift 間隔 > 1s → 開新 window
- 單一 window 跨度 > 5s → 開新 window
- CLS = max(所有 window 的累加值)

邊界處理陷阱很多，寫錯不會報錯，只會給你一個「看起來合理」的數字。**不要自己想演算法，直接照抄 `web-vitals` 原始碼的邏輯。**

### 4.6 viewport 尺寸必須凍結

**CLS = impact fraction × distance fraction，兩者都是 viewport 相對量。** LCP element 的選擇也依賴 viewport。

iframe 從 `800×600` 改成 `100% × 70vh`，標本 #5 的 CLS 分數會直接變一個數。**尺寸寫進 metadata 並凍結**，不要用百分比或 vh。

### 4.7 靜態資源必須 self-host

標本 #5 用網頁字型、#2 用頭像圖。走 CDN 或吃到快取 → LCP/CLS 每次都不同，實驗不可重現。

這是「數字定義」的一部分，不是部署細節。字型自架、圖片自架、B 類標本的資源 URL 帶時間戳。

### 4.8 量測本身的開銷

Observer callback 裡**絕對不要**直接操作 DOM。callback 只寫進 Map，每 250ms 批次 `postMessage`。外殼收到後也要節流 render。

見 §3.3 的架構約束：因為 iframe 不保護 presentation delay，這條是硬需求。

---

## 5. Phase 0 契約凍結

> Phase 0 要把所有地基一次定義完整（否則邊做標本邊回頭改量測層，先前的數字全部要重跑），但又不能膨脹成永遠做不完的框架工程。這兩件事的分界線如下。

### 核心原則：凍結型別，不凍結實作

**型別檔案寫滿**（LCP / CLS / LoAF 歸因 / deviceProfile 欄位全部先存在），**但只實作 INP + LoAF 兩條路徑**，其餘欄位先回 `null`。

- 之後補 LCP 觀測 → 只動 `metrics.ts` 一個檔案，不動協定、不動任何標本、先前數字不作廢
- 之後改 INP 的分組規則 → 先前所有數字作廢

### 判準：三格，落在哪一格決定要做到什麼程度

沿用 §1 的三個目的：

| 格 | 這個決定改變什麼 | 違反的代價 | 要做到什麼程度 |
|---|---|---|---|
| **G1 可重現** | 同一操作重跑會不會得到同樣的結論 | 全部重跑 | **做完** |
| **G2 歸因正確** | 數字指向的原因對不對 | 結論指錯兇手 | **做完（粗版即可，除非誤差翻得動結論）** |
| **G3 不用重寫** | 標本檔案的程式碼形狀 | 重寫 N 個標本檔 | **只需凍結型別，功能可延後** |
| 三格都不落 | — | 改一次就好 | 延後 |

**G3 只需要把型別寫對，不需要把功能做完** —— 這是把 Phase 0 從兩個週末砍到一個週末的關鍵。

### 5.1 必進 Phase 0（G1 可重現 / G2 歸因正確）

| # | 項目 | 格 | 為什麼不能延後 |
|---|---|---|---|
| 1 | INP 的 `interactionId` 分組 | **G2** | 不分組一次點擊算三次，所有標本 INP 全錯（§4.2）。**全清單最重要的一項** |
| 1b | p98 選取公式 | — | 因為 `minInteractions: 10`，`floor(10/50) = 0`，**本站永遠走 max 分支，p98 分支是死程式碼**。保留它的唯一理由是跟 `web-vitals` 對得起來。面板不要寫「p98」，要寫「max（n=10）」 |
| 2 | **iframe viewport 尺寸凍結** | **G1** | CLS/LCP 都是 viewport 相對量（§4.6） |
| 3 | **CPU throttling 手動宣告** | **G1** | JS 無法偵測。之後才加 → 先前所有截圖沒有 context |
| 4 | **操作程序凍結**（次數 + 間隔 + 節拍器） | **G1** | 十次連打與十次每秒一下是不同的實驗。metadata 的 `protocol` 欄位（§5.4） |
| 5 | **樣本數門檻與統計量標註** | **G1** | 面板固定顯示 `n=` 與「這是 max 不是 p98」 |
| 6 | **warmup 丟棄期** | **G1** | 因為 n<50 時 INP = max，**單一離群值就是你報告的那個數字**。在 max 統計下，離群控制不是精修，是可重現性的核心 |
| 7 | **靜態資源 self-host + cache 政策** | **G1** | 走 CDN → 實驗不可重現（§4.7） |
| 8 | **build `keepNames` / minify 政策** | 證據可讀 | mangle 是決定性的，**不影響任何數字、不影響可重現性**。它唯一的代價是 `sourceFunctionName` 變成 `n` —— 標本 #3 的示範直接失效，那比數字作廢更嚴重（§3.1） |
| 9 | build/preview 政策 + dev 模式紅色 banner | **G1** | 用 `import.meta.env.DEV` 判斷 |
| 10 | LoAF 歸因**粗版**（`sourceURL` 前綴） | **G2** | 「這一幀算誰的」必須先定義（§3.3）。**精修版（`windowAttribution`）永久延後** —— 對標本 #3，`forcedStyleAndLayoutDuration` 本來就逐 script；對標本 #1，外殼在 300ms 忙迴圈旁邊貢獻個位數 ms，翻不動任何結論。只有「外殼工作量大到翻轉結論」時才需要精修，那種情況出現時你自己會知道 |
| 11 | `buildId` 記進 run 條件 | **G1** | 換一版 build 就不是同一組條件，數字不可跨版比較。一行 Vite `define`（§5.4） |
| 12 | `refreshHz` 實測 | **G1** | 120Hz 螢幕上「16.7ms 算掉幀」是錯的。一次 rAF 取樣即可 |

> **CLS session window 演算法移到 Phase 2。** 它服務的是**教學正確性**（§4.5 本身是一個教學段落），不是可重現性 —— 標本 #5 的結論是「0.35 vs 0.002」，就算用最天真的「全部加總」也能穩定重現這個結論。而且最小可行版本來就不實作 CLS。Phase 0 只需要留一句決議：**不准自己想演算法，動工時照抄 `web-vitals`。**

### 5.2 必進 Phase 0（G3 — 只需寫型別，跟數字完全無關）

> 這一組**沒有一項服務可重現性**。一個型別欄位叫什麼名字，對數字零影響。它們純粹是「之後不用回頭重寫所有標本」的保險，而型別很便宜（1~2h 全部寫完）。

| # | 項目 |
|---|---|
| 13 | `postMessage` 協定型別（含 `v` 版本欄位） |
| 14 | 標本 metadata schema（含 `protocol` 操作程序欄位） |
| 15 | `SpecimenModule` runtime contract |
| 16 | **`modes` 是陣列不是二元** —— 多段治療（§3.4） |
| 17 | **URL query 參數契約** —— B 類標本的生命線 |
| 18 | **標本自訂數值的 `emit()` 通道** —— 否則每加一個標本就改協定 |
| 19 | **跨 frame 時間軸統一** —— iframe 與外殼各有 `timeOrigin`，全部換算成 epoch ms。誠實講：目前沒有任何結論需要把 LoAF 與 INP 對齊到同一條時間軸，它是便宜的保險不是地基 |
| 20 | `RunResult` / `RunConditions` / `RunStats` 型別 —— 可重現性證明機制的形狀（實作延到 Phase 2） |
| 21 | 錯誤通道 `specimen:error` |
| 22 | 檔案結構 + specimen id 制度 —— id 就是 URL 就是文章連結，改了斷連結 |

**降級**：`support` 能力偵測欄位留著，但 **Phase 0 硬編 `true` 不寫偵測邏輯** —— 已宣告 Chromium-only，那幾個布林在 Chromium 上永遠是 true。

**單獨一項（G1 + G2）**：**校準標本 `00-calibration`** —— 見 §5.5。它是 Phase 0 唯一能證明量測層正確的東西。

### 5.3 明確延後（防止無限上綱）

| 項目 | 為什麼不是地基 |
|---|---|
| **面板的視覺設計、圖表、動畫、三段堆疊條** | 純 UI。Phase 0 用 `<pre>{JSON.stringify(snapshot, null, 2)}</pre>` 就夠。**明文規定 Phase 0 不准寫任何一行面板 CSS** —— 這裡最容易失控 |
| **跨 session 持久化（localStorage）／跨版本比較 UI** | Phase 3。`RunResult` 型別存在就夠，存哪裡之後再說。注意：**不要做「歷史最佳值」** —— best-of 是挑櫻桃，跟本站定位相反（§2） |
| **把 `metrics.ts` 抽成 npm 套件 / plugin 架構** | **本專案最大的無限上綱風險。** 一旦開始想「別人怎麼用」就會加 options、加 hook、加 adapter，然後三個週末過去一個標本都沒有。Phase 0 的 `metrics.ts` 應該**刻意寫死、刻意耦合**。抽套件是六個標本做完之後的事 |
| React Router / SPA 外殼 / 狀態管理 | MPA 不需要 router。加了只讓外殼變重、LoAF 更髒 |
| 自動化效能回歸測試 / CI 跑 Lighthouse | CI runner 噪音極大，你會花整個週末調容差然後全部關掉。Phase 0 的驗證是**人工跑一次校準標本** |
| 跨瀏覽器 fallback / Safari 降級 | 已宣告不做，貫徹它。只做「偵測不到 LoAF → 顯示警告」三行 |
| `scheduler.yield()` 的 polyfill 抽象層 | **這是標本 #1 的教學內容本身**，不是地基。寫在標本檔案裡，而且要故意暴露細節 |
| web-vitals 交叉驗證的自動化 harness | 過度工程。只需 `?validate=1` 時 `console.table` 印出手刻 vs 套件值，**人眼看一次**，對上就永遠不用再看 |
| CPU 基準跑分實作 | schema 留 `benchScore: number \| null` 欄位是 Phase 0，跑分實作延後 |
| B 類 reload 的 UI 打磨 | 機制（URL 契約 + `switchKind`）是 Phase 0，UI 是 Phase 2 |
| iframe 載入失敗的優雅降級 | Phase 0 只做「拋出可見錯誤，紅字寫面板上」 |
| 病理報告文字模板 / diff 檢視元件 / OG image / SEO | Phase 1 與 Phase 3 |

### 5.4 `src/protocol.ts` — 凍結後只准加欄位，不准改語意

```ts
export const PROTOCOL_VERSION = 1 as const;

/** 跨 frame 唯一可比的時間軸：performance.timeOrigin + entry.startTime */
export type EpochMs = number;
/** iframe 自己 document 內的相對時間（載入期指標用這個才有意義） */
export type DocMs = number;

/** '01-main-thread-block'，等同 URL slug 與文章連結，凍結後不可改 */
export type SpecimenId = string;

// ───────────────────────── 量測參數 ─────────────────────────
// 任何一個值改動 = 先前所有數字作廢

export interface MeasureConfig {
  /** 16 = 規格允許的最低值。低於 16ms 的互動永遠不會被回報 */
  readonly eventDurationThreshold: 16;
  readonly flushIntervalMs: 250;
  readonly clsSessionGapMs: 1000;
  readonly clsSessionMaxMs: 5000;
  /**
   * INP ≈ p98：index = min(len-1, floor(count / divisor))
   * 注意：因為 minInteractions = 10，floor(10/50) = 0，本站永遠走 max 分支。
   * 保留這條公式的唯一理由是跟 web-vitals 對得起來 —— 面板要標「max」不是「p98」。
   */
  readonly inpPercentileDivisor: 50;
  /** 切換 mode 後丟棄的暖機時間。在 max 統計下，離群控制是可重現性的核心 */
  readonly warmupMs: 500;
  /** 統計有效所需的最少互動次數，未達標時 UI 必須標示 */
  readonly minInteractions: 10;
  /** droppedFrames 的量測窗。沒有它，掉幀數不可重現 */
  readonly droppedFrameWindowMs: 5000;
  /** 連續幾輪一致才算可重現（§1 原則 4） */
  readonly runsForReproducibility: 3;
}

export const MEASURE_CONFIG: MeasureConfig = Object.freeze({
  eventDurationThreshold: 16,
  flushIntervalMs: 250,
  clsSessionGapMs: 1000,
  clsSessionMaxMs: 5000,
  inpPercentileDivisor: 50,
  warmupMs: 500,
  minInteractions: 10,
  droppedFrameWindowMs: 5000,
  runsForReproducibility: 3,
});

/** 無法從 JS 偵測，只能由使用者宣告 */
export type CpuThrottle = '1x' | '4x' | '6x' | 'unknown';

export interface DeviceProfile {
  ua: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  dpr: number;
  cpuThrottle: CpuThrottle;
  /**
   * 實測（一次 rAF 取樣即可）。60 還是 120 會讓 droppedFrames 的定義完全不同 ——
   * 120Hz 上用 16.7ms 當目標幀時間是錯的。
   */
  refreshHz: number;
  /** Phase 0 先填 null，之後補跑分不需改協定 */
  benchScore: number | null;
}

// ───────────────────────── 標本 metadata ─────────────────────────

export type SpecimenClass = 'A' | 'B';        // A = 互動期指標，B = 載入期指標
export type SwitchKind = 'live' | 'reload';

export interface SpecimenModeDef {
  /** 'broken' | 'fixed-yield' | 'fixed-worker' … 第一個必須是病變版本 */
  id: string;
  label: string;
  kind: 'pathological' | 'treatment';
  /** 治療梯度順序，UI 依此排列切換按鈕 */
  order: number;
  /** 這個 mode 用到的非 Baseline API，UI 需標註 */
  requires?: Array<'scheduler.yield' | 'web-worker' | 'content-visibility'>;
}

export type MetricKey =
  | 'inp' | 'inp.inputDelay' | 'inp.processing' | 'inp.presentation'
  | 'loaf.blockingDuration' | 'loaf.forcedStyleAndLayout' | 'loaf.specimenScriptDuration'
  | 'lcp' | 'cls'
  | 'custom.domNodeCount' | 'custom.renderedItems' | 'custom.droppedFrames';

export interface SpecimenMeta {
  id: SpecimenId;
  order: number;
  title: string;
  subtitle: string;

  class: SpecimenClass;
  /** A 類 = 'live'，B 類 = 'reload'。外殼據此渲染不同切換 UI */
  switchKind: SwitchKind;
  modes: SpecimenModeDef[];

  /** 面板置頂、文章主打的那一個 */
  primaryMetric: MetricKey;
  secondaryMetrics: MetricKey[];
  /** 教學重點：兇手落在哪 */
  culprit: 'inputDelay' | 'processing' | 'presentation' | 'loaf' | 'lcp' | 'cls';

  /**
   * 操作程序也是凍結變因 —— 十次連打與十次每秒一下是不同的實驗。
   * UI 照這個發指令（做成節拍器），文章照這個描述條件。
   */
  protocol: {
    action: 'click' | 'scroll' | 'type' | 'stream';
    repetitions: number;
    /** 每次之間的間隔；null = 盡快連續（這本身也是一種凍結） */
    intervalMs: number | null;
    /** '每次節拍亮起時點一下，共十次' */
    instruction: string;
  };

  /** 凍結。CLS 與 LCP 都依賴 viewport，改這裡等於讓歷史數字作廢 */
  viewport: { width: number; height: number };

  entry: string;        // '/specimens/01-main-thread-block.html'
  status: 'draft' | 'ready';
  difficulty: 1 | 2 | 3;
  drama: 1 | 2 | 3 | 4 | 5;
  tags: string[];
}

// ───────────────────────── URL 契約（B 類的生命線）─────────────────────────

export interface SpecimenUrlParams {
  mode: string;
  /** cache buster，B 類必帶 */
  t: string;
  /** 外殼的 sessionId，讓 iframe 回報時帶回來對帳 */
  sid: string;
  /**
   * '1' 時額外載入 web-vitals 交叉驗證。預設不載入，避免污染 baseline。
   * iframe 端一律用 `params.get('validate') === '1'` 判斷，**不要用 truthy**。
   */
  validate?: '1';
}

export function buildSpecimenUrl(meta: SpecimenMeta, p: SpecimenUrlParams): string {
  // 必須先濾掉 undefined。URLSearchParams 對每個值做 ToString，
  // 所以 { validate: undefined } 會變成字串 "validate=undefined" ——
  // 而 iframe 端 params.get('validate') 拿到 "undefined" 這個非空字串，
  // truthy 判斷會誤開 crossCheck 模式，污染 baseline。
  //   不帶 key            → mode=broken&t=1&sid=x          ✅
  //   帶 validate: undefined → …&validate=undefined         ❌
  // 省略 key 時本來就安全，但 `validate: cond ? '1' : undefined` 是很自然的寫法。
  const clean = Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
  return `${meta.entry}?${new URLSearchParams(clean)}`;
}

// ───────────────────────── 樣本型別 ─────────────────────────

export interface InteractionSample {
  /** 一律 > 0；interactionId === 0 的 entry 必須丟棄 */
  interactionId: number;
  eventType: string;
  startTime: EpochMs;

  /** 已知四捨五入到最接近的 8ms */
  duration: number;
  inputDelay: number;   // 高解析度
  processing: number;   // 高解析度
  /**
   * 繼承 duration 的 8ms 量化，所以會落在 8ms 網格上。
   * 對「病變 vs 治療」的量級對照無影響；只在替兩個都已經很快的方案排名時咬人（§4.3）。
   * duration < 32ms 時 UI 標 ±8ms。
   */
  presentation: number;
  /** 量化誤差導致算出負值而被 clamp —— 這本身是重要的教學訊號 */
  presentationClamped: boolean;

  /** 這組底下的原始 entry 數（除錯用，正常點擊約 2~3） */
  entryCount: number;
  warmup: boolean;
}

export interface InpSummary {
  value: number | null;         // null = 樣本數為 0
  count: number;
  /** count < inpPercentileDivisor 時為 true，代表這是 max 不是 p98 */
  isMaxNotP98: boolean;
  representative: InteractionSample | null;
}

export interface LcpSample {
  value: DocMs;                 // 相對 iframe 自己的 timeOrigin
  elementDescriptor: string;
  url: string | null;
  renderTime: DocMs;
  loadTime: DocMs;
}

export interface ClsSample {
  /** 所有 session window 的最大值，不是總和 */
  value: number;
  sessionCount: number;
  largestShift: { value: number; at: EpochMs; sourceDescriptors: string[] } | null;
}

export interface WebVitalsCrossCheck {
  inp: number | null;
  lcp: number | null;
  cls: number | null;
  /**
   * 容差是「結論級」不是「數值級」—— 目的是確認我沒有錯得離譜，
   * 不是證明我完全正確。詳見 §5.6 驗收第 8 條。
   */
  deltaInp: number | null;   // 容差 max(24ms, 10%)，且兩者落在同一 CWV 區間
  deltaLcp: number | null;   // 容差 50ms，且兩者選到同一個 elementDescriptor
  deltaCls: number | null;   // 容差 0.02 或相對 10%，且落在同一門檻區間
}

// ───────────────────────── 可重現性（§1 原則 4）─────────────────────────

/** 一輪 = 一次「重置 → 照 protocol 互動 n 次 → 收斂」的完整量測 */
export interface RunResult {
  runId: string;
  specimenId: SpecimenId;
  mode: string;
  startedAt: EpochMs;
  /** 凍結條件快照。可重現的宣稱只在同一組 conditions 之間成立 */
  conditions: RunConditions;
  /** 本輪所有非 warmup 的互動 */
  samples: InteractionSample[];
  stats: RunStats;
}

export interface RunConditions {
  device: DeviceProfile;                        // 含 cpuThrottle 與 refreshHz
  viewport: { width: number; height: number };
  /** 操作程序快照，取自 SpecimenMeta.protocol */
  protocol: SpecimenMeta['protocol'];
  /** build 產物識別。換一版 build 就不是同一組條件，數字不可跨版比較 */
  buildId: string;
  protocolVersion: number;
  measure: MeasureConfig;
}

export interface RunStats {
  n: number;
  /** 面板顯示的 INP（n < 50 時等同 max） */
  max: number;
  /** 抗離群。可重現性判定用這個，不用 max */
  median: number;
  p75: number;
  /** (max - min) / median。> 0.3 時面板提示「條件可能沒凍住」 */
  spread: number;
}

/** 同一標本、同一 mode、同一組 conditions 下的多輪比較 */
export interface ReproducibilityReport {
  runs: RunResult[];                            // 至少 MEASURE_CONFIG.runsForReproducibility
  /** 各輪 median 彼此的相對離散度 */
  medianSpread: number;
  /** 各輪的兇手段是否一致 */
  culpritStable: boolean;
  verdict: 'reproducible' | 'unstable' | 'insufficient-runs';
}

// ───────────────────────── LoAF（外殼側，不走 postMessage）─────────────────────────

export type LoafOrigin = 'specimen' | 'shell' | 'unknown';

export interface LoafScriptSample {
  sourceURL: string;
  sourceFunctionName: string;
  sourceCharPosition: number;
  duration: number;
  forcedStyleAndLayoutDuration: number;
  invoker: string;
  invokerType: string;
  origin: LoafOrigin;
}

export interface LoafSample {
  start: EpochMs;
  duration: number;
  /** 整幀的值，規格上無法拆到單一 script。UI 必須標明「含外殼」 */
  blockingDuration: number;
  styleAndLayoutDuration: number;

  /** 唯一可拆的部分 */
  specimenScriptDuration: number;
  shellScriptDuration: number;
  /** 只加總 origin === 'specimen' 的 script —— 標本 #3 的核心數字 */
  specimenForcedStyleAndLayoutDuration: number;

  attribution: LoafOrigin | 'mixed';
  topScripts: LoafScriptSample[];   // 依 duration 取前 5
}

// ───────────────────────── Shell → Specimen ─────────────────────────

export interface HostInit {
  type: 'host:init';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  specimenId: SpecimenId;
  mode: string;
  measure: MeasureConfig;
}

export interface HostSetMode {
  type: 'host:set-mode';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  mode: string;
}

/** 清空累積樣本但不 reload。「重跑」按鈕發這個 —— 前一輪的 RunResult 由外殼保留 */
export interface HostReset {
  type: 'host:reset';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  /** 新一輪的識別碼，後續 metrics 都掛在這個 run 底下 */
  runId: string;
}

/** 強制立即 flush，用於截圖前 */
export interface HostFlush {
  type: 'host:flush';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
}

export type HostMessage = HostInit | HostSetMode | HostReset | HostFlush;

// ───────────────────────── Specimen → Shell ─────────────────────────

export interface SpecimenReady {
  type: 'specimen:ready';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  specimenId: SpecimenId;
  mode: string;
  /** 外殼用來把 iframe 的 DocMs 換算成 EpochMs */
  timeOrigin: number;
  support: {
    eventTiming: boolean;
    interactionId: boolean;
    lcp: boolean;
    layoutShift: boolean;
    schedulerYield: boolean;
  };
}

export interface SpecimenModeChanged {
  type: 'specimen:mode-changed';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  mode: string;
  /** 這個時間點之後的樣本才屬於新 mode */
  at: EpochMs;
  /** 這之前的樣本標記 warmup，不列入統計 */
  warmupUntil: EpochMs;
}

export interface SpecimenMetrics {
  type: 'specimen:metrics';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  mode: string;
  /** 遞增序號，外殼可偵測掉包 */
  seq: number;
  flushedAt: EpochMs;

  /** 本批新增的互動（已依 interactionId 分組取 max） */
  interactions: InteractionSample[];
  /**
   * 本輪累計的**有效**（非 warmup）互動數 —— 算 index 與顯示 `n=` 都用它。
   * 不等於 interactions.length（那是本批新增的）。
   * 一律從有效樣本推導，不要另外維護計數器：計數器與排序陣列一旦不同源，index 就會偏移。
   */
  totalInteractions: number;
  inp: InpSummary | null;

  /** Phase 0 可先永遠回 null，欄位先存在 */
  lcp: LcpSample | null;
  cls: ClsSample | null;

  /** 標本自訂數值，避免每加一個標本就改協定 */
  custom: Record<string, number>;

  /** 只有 ?validate=1 時才有 */
  crossCheck: WebVitalsCrossCheck | null;
}

export interface SpecimenError {
  type: 'specimen:error';
  v: typeof PROTOCOL_VERSION;
  sessionId: string;
  stage: 'init' | 'observe' | 'set-mode' | 'runtime';
  message: string;
  stack?: string;
}

export type SpecimenMessage =
  | SpecimenReady | SpecimenModeChanged | SpecimenMetrics | SpecimenError;

// ───────────────────────── 標本檔案的 runtime contract ─────────────────────────

export interface SpecimenContext {
  mode: string;
  /** 標本上報自訂數值，會併進下一批 flush */
  emit(custom: Record<string, number>): void;
  /** 標本不准自己註冊 PerformanceObserver，一律用這個打標記 */
  mark(name: string): void;
}

export interface SpecimenModule {
  meta: SpecimenMeta;

  /** 建立實驗區 DOM。整個生命週期只呼叫一次 */
  mount(root: HTMLElement, ctx: SpecimenContext): void | Promise<void>;

  /**
   * A 類必須實作：即時換掉行為，不 reload。
   * B 類不實作，外殼偵測 switchKind === 'reload' 時走 URL 重載路徑。
   */
  setMode?(mode: string): void | Promise<void>;

  /** 回到初始狀態但不 reload。清 DOM、清計時器、清累積資料 */
  reset?(): void;

  /** 必須移除所有 listener / timer / observer / worker / RAF */
  destroy(): void;
}
```

### 5.5 校準標本 `00-calibration` — Phase 0 的驗收工具

**驗收條件必須可否證。**「拿一個爛頁面塞進去看數字合不合理」只能當煙霧測試 —— 它抓得到「面板全空」「量級離譜」「iframe 沒載入」，但抓不到「分組錯了，數字卻看起來很合理」這種最致命的情況。

所以 Phase 0 需要一個**每個負載都有解析解可以反推**的自測件。它不是六個標本之一。

```
/specimens/00-calibration.html
  [按鈕 A] 忙迴圈 N ms（可調）        → 預期 processing ≈ N ± 10%
  [按鈕 B] 強制 layout M 次           → 預期 forcedStyleAndLayout > 0 且隨 M 線性成長
  [按鈕 C] 插入已知高度的元素          → CLS 可用 impact × distance 手算對照
  [按鈕 D] 延遲 N ms 載入已知尺寸圖    → 預期 LCP ≈ N
```

**⚠️ 按鈕 A 的忙迴圈必須用 wall-clock 界定，不能用迭代次數：**

```js
const t0 = performance.now();
while (performance.now() - t0 < N) { /* 空轉 */ }   // ✅ 換機器仍然是 N ms
// for (let i = 0; i < 50000; i++) {}               // ❌ 換機器結果就不同
```

用次數的話，校準件自己就沒有被校準 —— 那整個驗收都失去意義。

最小可行 Phase 0 只做 A、B 兩顆（C、D 驗證 CLS/LCP，而那兩個先不實作）。

### 5.6 Phase 0 驗收清單

| # | 驗收條件 | 通過標準 | 最小版 |
|---|---|---|---|
| 1 | `build && preview`，開校準標本，面板出數字 | 非空 | ✅ |
| 2 | **已知負載反推**：按鈕 A 設 300ms，點 10 次 | `processing` 落在 270~330ms | ✅ |
| 3 | **INP 分組正確** | 暖機期過後點 10 次，`totalInteractions === 10`（不是 20/30） | ✅ |
| 3b | **warmup 真的被濾掉** | 切 mode 後**立刻**點一下製造離群值，再正常點 10 次 → 那筆離群值**不得**成為 INP | ✅ |
| 4 | 統計量標註 | 面板顯示 `n=10 · max（樣本不足 50，非 p98）` | ✅ |
| 5 | **LoAF 歸因**：點按鈕 A | `attribution === 'specimen'`，`specimenScriptDuration ≈ 300` | ✅ |
| 6 | **反向歸因**：外殼 console 跑 `while(performance.now()-t<200){}` | `attribution === 'shell'`，且**不**混入標本統計 | ✅ |
| 7 | **函式名可讀**：按鈕 B 跑 200 次讀寫交替 | `specimenForcedStyleAndLayoutDuration > 50ms`，且 `sourceFunctionName` 是**可讀函式名**（不是 `n`/`t`） | ✅ |
| 8 | web-vitals 交叉驗證 `?validate=1` | **結論一致即通過**，見下方 | 只驗 INP |
| 9 | 節流生效 | 連續互動 5 秒，`seq` 遞增 ≤ 25 次 | ✅ |
| 10 | A 類 live 切換 | `warmupUntil` 前的樣本被標記且不列入統計；舊 mode 樣本不混入 | ✅ |
| 11 | B 類 reload | Network 顯示 `200`（非 `304`/`from cache`），LCP entry 重新產生 | 延後 |
| 12 | `destroy` 無殘留 | 切換標本後**靜置 5 秒，不應出現任何新的 `origin === 'specimen'` LoAF entry** | ✅ |
| 13 | 型別單一來源 | 外殼與標本 import 同一個 `protocol.ts`，`tsc --noEmit` 通過 | ✅ |
| 14 | dev 模式警告 | `npm run dev` 下面板頂端有紅色 banner | ✅ |
| 15 | throttling 宣告 | 面板有 `1x/4x/6x` 下拉，選了寫進 snapshot | ✅ |
| 16 | **可重現性** | 按鈕 A（300ms）**連跑三輪**，三輪 `processing` median 的相對離散度 ≤ 15% | ✅ |

**通過第 2、3、5、6、7、16 條，地基就成立了** —— 它們分別證明了：數字量級對、分組對、歸因對、隔離對、可讀性對、**跑得穩**。其餘是防呆。

**第 16 條用校準標本驗，因為它有解析解** —— 300ms 忙迴圈連跑三輪應該非常穩。如果連這個都跑不穩，代表環境有沒凍住的變因，這時候去量真正的標本毫無意義。這條只要多按兩次按鈕。

**第 6 條沒過不代表架構有問題。** `windowAttribution` 行為不如預期時，直接退回 `sourceURL` 前綴過濾（外殼與標本的 `sourceURL` 本來就不同，這條 fallback 一定可用），繼續往下做。它是 sanity check，不是關卡。

#### 第 8 條的容差與時間盒

容差訂在**結論級**，不是數值級。原因：兩邊可能挑到不同的代表互動（tie-break 不同、或 `web-vitals` 額外觀測 `first-input`），挑到不同互動時差距輕易就是 16~24ms，而結論完全相同。

| 指標 | 通過標準 |
|---|---|
| INP | 差距 ≤ `max(24ms, 值的 10%)`，**且兩者落在同一個 CWV 區間**（≤200 / 200–500 / >500） |
| LCP | 兩者的 `elementDescriptor` **相同**，且值差 ≤ 50ms |
| CLS | 差距 ≤ 0.02 或相對 ≤ 10%，且落在同一門檻區間 |

> **交叉驗證有時間盒：60 分鐘。**
>
> 超過 60 分鐘仍對不上 → **不繼續 debug**。做三件事然後往下走：
> 1. 記下差異的方向與量級（系統性偏移還是隨機？）
> 2. 面板 `crossCheck` 區塊顯示一行 `mismatch Δ=32ms`
> 3. 文章的方法論段落誠實寫「本站手刻計算與 `web-vitals` 有 X ms 的系統性差異，原因待查」
>
> **交叉驗證的目的是「確認我沒有錯得離譜」，不是「證明我完全正確」。** 兩邊都說「病變 400 級、治療 40 級」就已經達成目的了。這條規則就是陷阱 #19 套用在驗收清單上。

---

## 6. 標本清單

六個核心 + 三個加碼。每個標本的文件都用相同結構：**症狀 / 成因 / 怎麼量 / 怎麼修 / 延伸**。

> **明確排除「Hydration 過重」這個題目。** 理由：(i) 要做得有說服力必須引入 SSR 或框架，與「標本內部用原生 JS」原則正面衝突；(ii) 改用模擬版（手動延遲綁 handler）讀者一眼看出是假的；(iii) **它沒有對應的乾淨指標** —— 在這套框架下端不出數字，而其餘標本都有明確的 primary metric。

---

### 標本 #1 — 主執行緒阻塞

**病變版本**：點擊按鈕後在事件處理器裡同步跑一個五萬次迭代的計算（排序一個訂單列表 / 計算報表加總），期間 UI 完全凍結。

**互動設計**：畫面上放一個 CSS 動畫 spinner + 一個輸入框。點下按鈕後 spinner 卡住、輸入框打不出字 —— 比看數字直觀一百倍。

**治療方案**（兩段梯度，`modes` 陣列三項）：
1. **切 chunk + `await scheduler.yield()`**：每 5ms 一批。說明它與 `setTimeout(0)` 的差別 —— 前者讓出後仍保有較高續跑優先權，不會被排隊任務插隊到天荒地老。
   > 支援度：Chrome / Edge / Firefox 有，**Safari 沒有**，非 Baseline。fallback 用 `MessageChannel`，**且要故意把 fallback 寫在標本檔案裡暴露細節** —— 那個差異本身就是教學點，不要抽成共用 util。
2. **丟 Web Worker**：計算完全離開主執行緒。順帶說明什麼情況不適合（頻繁存取 DOM、大量資料的序列化成本）。

**主要指標**：INP 的 input delay 段、LoAF `specimenScriptDuration`

**難度**：低　**戲劇性**：★★★★★　**類別**：A

---

### 標本 #2 — 長列表未虛擬化

**病變版本**：一次渲染 5,000 筆列表項目（裝置狀態清單，你很熟），每項含頭像、多行文字、幾個 badge。捲動掉幀，初次渲染 LCP 被拖累。

**治療方案**：
1. **`content-visibility: auto` + `contain-intrinsic-size`** — 一行 CSS 讓瀏覽器跳過視窗外元素的渲染。很多前端不知道這個屬性存在，光這段就值得寫成獨立文章。要說明 `contain-intrinsic-size` 為什麼必須設（否則捲軸長度亂跳，反而製造 CLS），並介紹 `contain-intrinsic-size: auto 120px` —— 瀏覽器記住上次實際尺寸，比寫死猜測值準得多。
2. **真正的虛擬滾動** — 只渲染可視範圍 ± buffer。說明什麼時候值得上這個複雜度。

**主要指標**：LCP、`custom.domNodeCount`、INP 的 presentation delay 段

> presentation delay 在治療後會落到 8ms 網格附近，所以兩段治療之間不做排名（§4.3）。用 `domNodeCount` 與 LCP 佐證 —— 這兩個指標沒有量化問題，而且「5,000 節點 → 60 節點」比任何毫秒數都直觀。

**難度**：中　**戲劇性**：★★★★☆　**類別**：B（LCP 需重載）

---

### 標本 #3 — 強制同步版面重排（Layout Thrashing）

**這是整套最值得寫的一個** —— 最隱蔽、最多人寫出來卻不自知，而且 LoAF 剛好提供完美的量化證據。**也是全站數字最可信的標本**，因為 `forcedStyleAndLayoutDuration` 是逐 script 的，外殼貢獻可以乾淨濾掉。

**病變版本**：迴圈中交替讀寫 ——
```js
items.forEach(el => {
  const h = el.offsetHeight;         // 讀 → 強制瀏覽器立刻算版面
  el.style.height = (h + 10) + 'px'; // 寫 → 弄髒版面
});                                  // 下一圈的讀又強制重算…
```

**治療方案**：讀寫分離 —— 先跑一輪收集所有測量值到陣列，再跑第二輪統一寫入。順帶介紹用 `ResizeObserver` / `IntersectionObserver` 從根本上避免手動測量。

**教學重點**：列出會觸發強制重排的屬性清單（`offsetTop`/`offsetHeight`、`getBoundingClientRect()`、`getComputedStyle()`、`scrollTop`、`clientWidth`…）。這份清單本身就是很多人會收藏的東西。

**主要指標**：`loaf.forcedStyleAndLayout`（病變版本一個誇張數字，治療後趨近 0）

**難度**：中　**戲劇性**：★★★★★　**類別**：A

---

### 標本 #4 — 事件處理未節流

**⚠️ 這個標本有一個會讓病變版本「壞不起來」的陷阱，動工前務必先讀完。**

**Chrome 對掛在 `window` / `document` / `document.body` 上的 `touchstart` / `touchmove` / `wheel` 預設就是 passive。** 照直覺寫，病變版本和治療版本會量到一樣的數字，而你會 debug 很久才發現不是量測壞掉。

必須二選一：
- 監聽器掛在**具體的捲動容器元素**上（非 window / document / body）
- 或顯式寫 `addEventListener('wheel', handler, { passive: false })`

**另一個要講清楚的點**：`scroll` 事件不可 cancel，對它加 `passive` 是 no-op。很多人到處亂加 `{ passive: true }`，這個標本正好把「哪裡有用、哪裡沒用」講明白。

**病變版本**：`scroll` handler 裡每次做 `getBoundingClientRect()` 算幾十個元素的可見性；`wheel` 監聽器 `{ passive: false }` 直接阻塞捲動。

**治療方案**（三段）：
1. `requestAnimationFrame` 節流（而非 `setTimeout` debounce —— 說明為什麼視覺相關的更新該對齊幀）
2. `{ passive: true }` 的作用機制
3. 用 `IntersectionObserver` 徹底取代 scroll 監聽 —— 這才是正解

**主要指標**：LoAF、`custom.droppedFrames`

**難度**：低　**戲劇性**：★★★☆☆　**類別**：A

---

### 標本 #5 — 版面位移（CLS）

**B 類標本，切換需要 reload iframe。**

**病變版本**（三個位移源疊加）：
1. `<img>` 沒有 `width`/`height` → 圖片載入後把下方內容整個往下推
2. 網頁字型 `font-display: swap` 且 fallback metric 差很多 → 字型換入時文字重排
3. 載入 1.5 秒後從上方插入通知橫幅 → 整頁往下跳

**治療方案**：
1. 設 `width`/`height` 或 `aspect-ratio` 保留空間
2. `font-display: optional` + `size-adjust` / `ascent-override` 對齊 fallback metric
3. 橫幅預留空間，或 `position: fixed` 疊加而非插入文檔流

**實作注意**：字型與圖片**必須自架**，不要用 CDN。CDN 會被快取，第二次載入就不位移了，實驗不可重現。

**教學重點**：CLS 的 session window 計算 —— **是所有 window 的最大值，不是總和**（見 §4.5）。這是最多人算錯的地方，值得畫一張圖。也要提 `hadRecentInput` 的 500ms 豁免窗口。

**主要指標**：CLS

**難度**：低　**戲劇性**：★★★★☆（視覺上最直觀）　**類別**：B

---

### 標本 #6 — 高頻資料流造成的 re-render 風暴 ⭐

> **這是全案最有原創性的標本，市面上幾乎沒有人做過。** 它同時是唯一的差異化資產（IoT 背景 + 沒人做過）與最直接命中第一優先目標的一個，所以放進核心六件而不是加碼。

**病變版本**：模擬 WebSocket 每 50ms 推送一批裝置狀態更新，每次推送直接觸發整張列表重繪。裝置數拉到 200 台，畫面卡成幻燈片。

**治療方案**（三段）：
1. **批次化**：50ms 內的多筆更新合併，用 `requestAnimationFrame` 對齊幀率上限
2. **細粒度更新**：只改真正變動的 DOM 節點，不重繪整張列表
3. **背壓（backpressure）**：推送速率超過渲染能力時主動丟棄中間狀態，只渲染最新值

**主要指標**：LoAF、`custom.droppedFrames`、INP 的 presentation delay 段

**難度**：中　**戲劇性**：★★★★★　**類別**：A

---

### 加碼 #7 — 第三方腳本阻塞 + Facade Pattern

同步 `<script>` 阻塞 HTML parser，再加一個「假的 YouTube 嵌入」拖垮 LCP。

治療：`async` / `defer` 的差異（`defer` 保序、等 parse 完；`async` 不保序、下載完就插隊），以及 **facade pattern** —— 先渲染假的播放器縮圖，使用者真的點了才載入第三方腳本。對真實專案投報率極高。

**難度**：低　**類別**：B

### 加碼 #8 — 動畫觸發版面重排

動畫 `top`/`left`/`width` vs `transform`/`opacity`。說明合成器層概念，以及 `will-change` 為什麼不能亂加。搭配 DevTools Rendering → Paint flashing 截圖。

**難度**：低　**類別**：A

### 加碼 #9 — iframe 到底隔離了什麼 ⭐

same-origin iframe vs cross-site iframe（不同 eTLD+1 → Chrome site isolation → 獨立 renderer process）的實測對照。同一個 300ms 忙迴圈，看它在兩種情況下對外殼的影響差多少。

**這是第二個市面上沒有的標本**，而且素材在你做 Phase 0 的過程中會自然累積（§3.2 的那張表就是文章骨架）。

**難度**：中（要跑兩個 origin）　**戲劇性**：★★★★☆

---

## 7. 開發階段規劃

### Phase 0 — 量測底座

原則：**型別 100% 寫滿，實作只做兩個旗艦標本用得到的部分。**

#### 最小可行版（8~12h，一個週末）

**必做（砍了要回頭重做）：**

- [ ] `protocol.ts` **全部型別**（G3），含 LCP / CLS / deviceProfile / B 類 / `emit(custom)` / `RunResult` 欄位
      → 型別很便宜（1~2h），但它買下「之後不用回頭改所有標本」
- [ ] Vite MPA 骨架 + **`esbuild.keepNames: true`** + `buildId` 的 `define`
- [ ] INP `interactionId` 分組（G2，全清單最重要）
- [ ] LoAF 觀測 + **粗版**歸因（只用 `sourceURL` 前綴）
- [ ] iframe viewport 尺寸凍結（改一行常數，但必須現在定）
- [ ] `refreshHz` 一次 rAF 實測，寫進 `DeviceProfile`
- [ ] epoch ms 時間軸統一
- [ ] `SpecimenModule` contract + metadata schema（**含 `protocol` 操作程序欄位**）
- [ ] 校準標本，**只做按鈕 A（wall-clock 忙迴圈）+ 按鈕 B（強制 layout）**
- [ ] CPU throttling 下拉（30 分鐘）
- [ ] **「重跑」按鈕 + 面板顯示歷次 run 與 median**（可重現性的證明機制，§1 原則 4）
- [ ] dev 模式紅色 banner
- [ ] 驗收第 1~10、12~16 條（第 11 條 B 類 reload 延後）

**降級處理（欄位留著，實作先簡）：**

| 項目 | 最小版做法 |
|---|---|
| LoAF 歸因 | 只用 `sourceURL.includes('/specimens/')`。**`windowAttribution` 精修永久延後**，除非哪天真的出現「外殼工作量翻轉結論」 |
| web-vitals 交叉驗證 | **只驗 INP**，容差走結論級 + 60 分鐘時間盒。CLS/LCP 留到寫標本 #2/#5 之前 |
| CLS / LCP 觀測 | **完全不實作**，回 `null`。標本 #1/#3 用不到。**這一刀省 2~4h** |
| CLS session window 演算法 | 不寫。Phase 0 只留決議：動工時照抄 `web-vitals`，不准自己想 |
| `support` 能力偵測 | 欄位留著，**硬編 `true`**。已宣告 Chromium-only |
| B 類 reload 機制 | 不實作。但 `switchKind` 與 `SpecimenUrlParams` 型別先存在 |
| 節拍器 UI | 最小版用文字提示 + 手動計時即可，`protocol.intervalMs` 欄位先存在 |
| `ReproducibilityReport` 自動判定 | 不實作。最小版面板列出三輪數字，**人眼看一下有沒有離譜** |
| 面板 | `<pre>` + 數字 + mode 按鈕 + throttling 下拉 + 歷次 run。**零 CSS** |
| `reset()` / `destroy()` | 最陽春（`root.innerHTML = ''` + 清 timer） |
| 校準標本 C/D 按鈕 | 不做 |

**沒有任何一項會在 Phase 2 逼你回頭重跑數字或重寫標本。**

#### 完整版工時（1.5~2 個週末，非本階段目標）

| 項目 | 樂觀 | 悲觀 |
|---|---|---|
| Vite MPA + TS + `protocol.ts` 全型別 | 1.5h | 2.5h |
| `metrics.ts`：INP 分組 + p98 + 批次節流 | 2h | 3h |
| CLS session window（照抄 web-vitals） | 1.5h | 3h |
| LCP 觀測 | 0.5h | 1h |
| LoAF 觀測 + 歸因（含實測 `windowAttribution`） | 2h | 4h |
| postMessage handshake + mode 切換 + reload | 2h | 3h |
| 校準標本（四種負載 + 解析解） | 2h | 3h |
| web-vitals 對帳 + **實際 debug** | 1.5h | **4h** |
| build 調到 `sourceFunctionName` 可讀 | 1h | 2.5h |
| 面板（醜版） | 1h | 2h |
| 跑完 15 條驗收 + 修 | 2h | 3.5h |
| **合計** | **17h** | **31.5h** |

**兩個真正的黑洞** —— 兩個都已經在最小可行版裡拆掉了：
1. **web-vitals 對帳對不上** —— 幾乎必然發生一次。最小版只驗 INP、容差走結論級、加 60 分鐘時間盒（§5.6），這個黑洞就填掉了
2. **LoAF 歸因的實測行為** —— `script.window` 在 same-origin iframe 下的實際行為只能實測。最小版直接用 `sourceURL` 前綴，精修永久延後

### Phase 1 — 兩個旗艦標本

- [ ] **先寫下每個標本的預期結論與量級**（陷阱 #19 —— 沒有預期，「誤差會不會翻轉結論」這條判準是空的）
- [ ] 標本 #1 主執行緒阻塞
- [ ] 標本 #3 強制同步版面重排
- [ ] 每個標本、每個 mode 各跑三輪，確認可重現（§1 原則 4）
- [ ] 病理報告的文字模板定案（含條件說明段與方法論段）
- [ ] **第一篇文章發出去**

做到這裡就有可傳播的內容了。

### Phase 2 — 補齊核心六件

- [ ] LCP / CLS 觀測實作 + 校準標本 C/D 按鈕 + 對應的 web-vitals 對帳
- [ ] B 類標本的 reload 切換機制
- [ ] LoAF 歸因精修（`windowAttribution`）
- [ ] 標本 #2、#4、#5、#6

### Phase 3 — 內容化與上線

- [ ] 每個標本的完整病理報告
- [ ] 面板視覺設計（Phase 0~2 一直是 `<pre>`，這裡才動 CSS）
- [ ] 首頁：標本索引 + 專案說明 + CPU throttling 教學
- [ ] 部署（確認沒有 SPA catch-all rewrite）、OG image
- [ ] 「為什麼做這個」總覽文章當入口

### Phase 4 — 選配

- [ ] 加碼 #9（iframe 隔離實測）—— 最有辨識度，有餘力優先
- [ ] 加碼 #7、#8
- [ ] 「你的裝置有多快」基準測試頁（填 `benchScore` 欄位）
- [ ] 把 `metrics.ts` 抽成 npm 套件 —— **只有走到這裡才准做**
- [ ] 英文版

### 節奏總結

| 週末 | 產出 |
|---|---|
| 1 | 最小可行 Phase 0 + 校準標本通過驗收 |
| 2 | 標本 #1 + #3 + **第一篇文章** |
| 3~4 | Phase 2 補齊核心 |
| 5 | Phase 3 上線 |

**約 5 個週末到可發布。** 程式碼量確實低，時間幾乎都花在「讓數字對」上 —— 這符合「重密度不重規模」的定位，但別誤判成「一個週末就能上線」。

---

## 8. 陷阱清單

按踩到的機率排序：

1. **`interactionId` 沒分組導致 INP 重複計數** — 一次點擊三筆 entry。不分組數字會忽大忽小，且跟 `web-vitals` 永遠對不起來。見 §4.2。

   同一族的第二個坑，**更難發現**：**warmup 樣本忘了濾掉**。因為 n<50 時 INP = max，max 統計沒有平均可以稀釋離群值 —— **一筆暖機樣本就會直接變成你報告的那個數字**，而面板看起來完全正常。`buildSample` 裡的 `warmup` 必須真的算（`startTime < warmupUntil`），`computeInp` 第一步必須 `filter(s => !s.warmup)`。驗收第 3b 條專門測這個。

   第三個坑：**計數器與排序陣列不同源**。如果你維護一個獨立的 `totalInteractions++`（含 warmup），卻拿它去索引一個已濾掉 warmup 的陣列，index 就會偏移。一律從有效樣本推導 `n`，不要另外維護計數器。

2. **build 把函式名 mangle 掉，`sourceFunctionName` 變成 `n`** — 標本 #3 的核心證據直接報廢，而且你要等到看見面板才會發現。`esbuild.keepNames: true`。見 §3.1。

3. **用開發模式量效能** — Vite dev server 不 minify、不打包、有 HMR 開銷。**每次量測前必須 `vite build && vite preview`。** 寫進 README 第一行，並在 dev 模式下顯示紅色 banner。

4. **`durationThreshold` 忘了調** — 預設 104ms，修好版本的數字全部消失。但調到 16 之後仍有地板：**低於 16ms 的互動永遠不會被回報**。見 §4.2。

5. **以為 iframe 隔離了 LoAF** — 沒有。頁面級，同源 iframe 與外殼共用同一批 entry。不做過濾，標本 #1/#3/#4/#6 的數字就摻了外殼的工作量。見 §3.2。

6. **CLS 算成總和** — 是**所有 session window 的最大值**，不是總和、不是最後一個。寫錯不會報錯。照抄 `web-vitals`。見 §4.5。

7. **拿 `web-vitals` 從外殼驗 iframe 內的指標** — 驗不到任何東西，該套件對 iframe 內容零可見度（同源也一樣）。必須 bundle 進標本頁。

8. **標本 #4 的病變版本壞不起來** — Chrome 對 window/document/body 上的 touch/wheel 預設 passive。掛到具體容器元素，或顯式 `{ passive: false }`。見標本 #4。

9. **拿治療後的 presentation 段替兩個治療方案排名** — 兩者都落在 8ms 網格上，分不開。改用 `domNodeCount`、LCP 這類沒有量化問題的指標佐證。見 §4.3。

10. **viewport 尺寸沒凍結** — CLS/LCP 都是 viewport 相對量，改尺寸等於讓歷史數字作廢。見 §4.6。

11. **忘了記錄 CPU throttling 狀態** — JS 偵測不到，只能手動宣告。之後才加 = 先前所有截圖沒有 context。

12. **量測程式本身變成瓶頸** — 面板 re-render 會落在互動的同一幀，直接污染 presentation delay。iframe **不保護**這一段。見 §3.3。

13. **忘記 `buffered: true`** — 載入期指標在 observer 註冊前可能已發生。LoAF buffer 上限 200 筆。

14. **快取讓 reload 失效** — B 類切換必帶時間戳；字型與圖片自架，否則第二次載入就不位移了。

15. **部署設了 SPA catch-all rewrite** — 標本的 `.html` entry 加 query param 被吃掉，整站壞掉。

16. **React StrictMode 污染** — dev 模式 double render。外殼可留著，但 LoAF 過濾要能濾掉它。

17. **標本太「乾淨」缺乏說服力** — 五萬次空迴圈這種假負載，讀者會覺得「真實專案不會這樣寫」。用貼近現實的場景包裝：排序訂單列表、計算報表加總、渲染裝置狀態清單（這個你很熟）。

18. **把 `metrics.ts` 提早抽成通用套件** — 範圍上的無限上綱。一旦開始想「別人怎麼用」就會加 options、加 hook、加 adapter，然後三個週末過去一個標本都沒有。Phase 0 刻意寫死、刻意耦合。見 §5.3。

---

### 最後一個陷阱，性質不同，但最致命

19. **被誤差分析癱瘓。**

任何量測方法都找得出漏洞。8ms 量化、iframe 不隔離主執行緒、單機不等於實地 p75、CPU throttling 靠自己宣告、假負載不像真實程式碼 —— 每一條都是真的。**如果把「有漏洞」當成「不可信」，這個專案的正確結論就是不要做，而那顯然是錯的。**

判準只有一條：

> **這個誤差會不會翻轉結論？**

會 → 處理它（例如 `interactionId` 沒分組會讓 INP 全錯，必須修）。
不會 → 標註它，然後繼續（例如 8ms 對一個 10 倍的差距毫無影響）。

**不要為了消滅一個不會翻轉結論的誤差，去增加實驗的複雜度。** 複雜度本身會製造新的錯誤來源，而且會拖垮進度 —— 進度拖垮了，一篇文章都發不出去，那才是這個專案真正的失敗模式。

**但這條判準有一個前提：你得先知道結論是什麼。** 標本還沒做出來時你不知道，於是判準會退化成「感覺一下」。可執行的版本是 ——

> **動工前先寫下你預期的結論，含量級。**
>
> 例如標本 #3：「病變版 `forcedStyleAndLayout` 應在 200~500ms，治療後 < 10ms，比值 > 20×」。
>
> 量出來之後：
> - 和預期差在 30% 以內 → 接受，往下走
> - 差一個數量級 → 先懷疑量測（多半是分組錯了、或忘了 build）
> - 方向相反 → 恭喜，你發現了比原本計畫更好的文章題材

**先寫預期，才有「翻轉結論」可言。** 沒有預期，這條判準是空的。成本是動工前多寫兩行字。

參考 §1「實驗有效性原則」。可重現是及格線，絕對精確不是。

---

## 9. 延伸方向

- **變成團隊教材** — 標本 #2（長列表）和 #6（高頻資料流）幾乎必然對應到你們 IoT 儀表板的真實痛點。改成內部版本，用真實裝置狀態資料當素材
- **`metrics.ts` 抽成 npm 套件** — 六個標本做完之後才准做。README 要把「LoAF 是頁面級」這個限制寫清楚，這正是市面上多數量測工具講不明白的地方

---

## 附錄 A：參考資源

- [Long Animation Frames API — Chrome for Developers](https://developer.chrome.com/docs/web-platform/long-animation-frames) — `entry.scripts[]` 的欄位定義值得完整讀一遍
- [Long Animation Frames API 規格](https://w3c.github.io/long-animation-frames/) — 同源 iframe 共用 frame timing 的規定在這裡
- [Event Timing API — W3C](https://www.w3.org/TR/event-timing/) — 8ms 量化與 104ms 預設門檻的來源
- [PerformanceEventTiming — MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming)
- [`web-vitals` 套件](https://www.npmjs.com/package/web-vitals) — 交叉驗證用；CLS session window 直接照抄它的邏輯；注意其 iframe 限制
- [Scheduler: yield() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield)
- [Largest Contentful Paint — web.dev](https://web.dev/articles/lcp)
- Chrome DevTools Performance panel — 標本開發時的除錯主力

---

## 附錄 B：指標定義、出處與合格門檻

> 這份表是寫文章時的事實查核清單。每個數字都要能說出「誰定的、憑什麼」，否則文章一被追問就垮。

### B.1 兩層區分：規格 vs 指標

這件事要先講清楚，因為很多文章把兩者混為一談：

| 層 | 誰定義 | 產出什麼 | 會不會變 |
|---|---|---|---|
| **API 規格層** | **W3C Web Performance Working Group** | `PerformanceObserver` 能觀測到什麼 entry、欄位怎麼算 | 很少變，變了會有 breaking change 公告 |
| **指標與門檻層** | **Google Chrome 團隊**（發布在 web.dev） | 「INP 是什麼」「多少算好」 | **會變。** INP 在 2024-03 才取代 FID 成為 Core Web Vital |

**重點：門檻不是規格的一部分。** W3C 規格只定義怎麼量，不定義多少算好。所有「≤ 2.5s 算良好」這類數字都是 Google 訂的，理由是「用 HTTP Archive 資料校準到約 75% 的網站有機會達成」+ 人類感知研究。寫文章時要標明出處，不要寫成「規格規定」。

### B.2 本站使用的指標

#### LCP — Largest Contentful Paint（最大內容繪製）

| | |
|---|---|
| **意義** | 視窗內最大的那塊內容（圖片或文字區塊）繪製完成的時間點。代表「使用者覺得主要內容出現了」 |
| **API 規格** | [W3C Largest Contentful Paint](https://w3c.github.io/largest-contentful-paint/)，observer type `largest-contentful-paint` |
| **指標定義者** | Google Chrome 團隊，Core Web Vitals 之一 |
| **合格門檻** | **良好 ≤ 2.5s**／需改善 2.5~4.0s／差 > 4.0s |
| **本站用在** | 標本 #2（長列表）、#5（CLS 頁面）、加碼 #7 |
| **注意** | 首次使用者互動後即凍結，不再更新。per-document，父頁面看不到 iframe 內容 |

#### CLS — Cumulative Layout Shift（累積版面位移）

| | |
|---|---|
| **意義** | 頁面存活期間非預期的版面位移量。無單位，是 `impact fraction × distance fraction` 的累加 |
| **API 規格** | [W3C Layout Instability](https://w3c.github.io/layout-instability/)，observer type `layout-shift` |
| **指標定義者** | Google Chrome 團隊，Core Web Vitals 之一 |
| **合格門檻** | **良好 ≤ 0.1**／需改善 0.1~0.25／差 > 0.25 |
| **本站用在** | 標本 #5 |
| **注意** | 是**所有 session window 的最大值**，不是總和（§4.5）。兩個 fraction 都是 viewport 相對量，所以 viewport 尺寸必須凍結（§4.6） |

#### INP — Interaction to Next Paint（互動到下次繪製）

| | |
|---|---|
| **意義** | 從使用者互動開始，到瀏覽器畫出下一幀為止的時間。代表「頁面回應快不快」 |
| **API 規格** | [W3C Event Timing](https://www.w3.org/TR/event-timing/)，observer type `event` |
| **指標定義者** | Google Chrome 團隊。**2024-03-12 正式取代 FID 成為 Core Web Vital** |
| **合格門檻** | **良好 ≤ 200ms**／需改善 200~500ms／差 > 500ms |
| **本站用在** | 標本 #1、#2、#3、#4、#6 |
| **注意** | 不是平均也不是最大，是近似 p98（§4.2）。`duration` 四捨五入到 8ms（§4.3） |

#### INP 三段拆解 — input delay / processing / presentation

| | |
|---|---|
| **意義** | INP 的內部組成，用來歸因「慢在哪一段」 |
| **出處** | 三個數值由 Event Timing 規格的欄位算出（`startTime`/`processingStart`/`processingEnd`/`duration`），但**「拆成三段」這個框架是 Chrome 團隊在 web.dev 的 INP 優化指南提出的**，不是規格定義的欄位 |
| **合格門檻** | **沒有官方門檻。** 三段沒有各自的「良好」值 —— 它們是診斷工具，不是評分項 |
| **注意** | input delay 與 processing 是直接相減，**任何量級下都是高解析度**；只有 presentation 段繼承 8ms 量化。治療後落在 8ms 網格上代表「快到超出解析度」，不代表數字有問題（§4.3） |

#### LoAF — Long Animation Frames

| | |
|---|---|
| **意義** | 一個渲染幀從開始到繪製完成超過 50ms 時，回報這一幀的完整分解，含每支 script 的歸因 |
| **API 規格** | [W3C Long Animation Frames](https://w3c.github.io/long-animation-frames/)（草案），Chromium 發起，Chrome 123+ |
| **指標定義者** | 這是**診斷 API，不是評分指標** —— Google 沒有為它訂 Core Web Vitals 門檻 |
| **合格門檻** | **沒有官方門檻。** 判定「這是一個 LoAF」的閾值是幀渲染 > 50ms，但那是觸發條件不是及格線 |
| **本站用在** | 標本 #1、#3、#4、#6 |

其中兩個欄位要分開說：

| 欄位 | 意義 | 門檻 |
|---|---|---|
| `blockingDuration` | 這一幀中「阻塞」的總時長，沿用 Long Tasks 的「超過 50ms 的部分才算阻塞」定義 | 無官方門檻。**整幀的值，無法拆到單一 script** |
| `forcedStyleAndLayoutDuration` | 該支 script 強迫瀏覽器同步重算樣式與版面的耗時 | 無官方門檻。**目標是 0** —— 這是本站最乾淨的對照指標，因為「趨近 0」是自明的合格條件，不需要別人訂數字 |

#### Long Task（本站不直接用，但要知道它的 50ms 從哪來）

`blockingDuration` 的「超過 50ms 才算阻塞」來自 [W3C Long Tasks API](https://w3c.github.io/longtasks/)，而 50ms 這個數字來自 Google 的 **RAIL 模型**：使用者對「立即回應」的容忍上限約 100ms，扣掉瀏覽器自身的處理開銷，留給單一任務的預算是 50ms。

**這是一條可以寫進文章的知識鏈**：RAIL 的 100ms → Long Task 的 50ms → Event Timing 預設門檻的 104ms（100 以上第一個 8 的倍數）。三個數字同源。

#### DOM 節點數

| | |
|---|---|
| **意義** | `document.querySelectorAll('*').length`。節點越多，每次 recalc style 與 layout 越貴 |
| **出處** | **不是規格指標，也不是 Core Web Vitals。** 是 Lighthouse 的「避免過大的 DOM」審計 heuristic |
| **合格門檻** | Lighthouse 的參考值：總元素數約 **800 以上開始扣分、1,400 以上判定失敗**；另有「巢狀深度 > 32」「單一父節點子元素 > 60」兩個輔助條件 |
| **本站用在** | 標本 #2 的輔助指標 |
| **注意** | 這是經驗法則不是標準，文章裡要標明「Lighthouse 的建議值」而非「規範」 |

#### 掉幀數（droppedFrames）

**本站自訂，沒有任何標準。** 用 `requestAnimationFrame` 量相鄰兩幀的間隔，超過目標幀時間就記一次。用在標本 #4 與 #6。文章裡必須標明這是自訂量法。

它要可重現，需要兩個本站自訂的凍結值 —— 少了任何一個，掉幀數就沒有意義：

| 需要凍結的 | 為什麼 |
|---|---|
| **量測窗**（`droppedFrameWindowMs: 5000`） | 沒說量幾秒，兩次量測不可比 |
| **目標幀時間**（由實測 `refreshHz` 算） | **不是常數。** 120Hz 螢幕上用 16.7ms 當門檻是錯的，會把正常幀判成掉幀 |

### B.3 規格常數的出處

文件裡出現的每個「魔術數字」都有來源，整理成一張表方便查核：

| 常數 | 出現在 | 誰定的 | 為什麼是這個值 |
|---|---|---|---|
| **8ms** | `duration` 四捨五入 | Event Timing 規格 | 安全考量，防止當高精度計時器濫用。8ms 對 120Hz 螢幕仍夠精確 |
| **104ms** | `durationThreshold` 預設 | Event Timing 規格 | 100ms（RAIL 的回應上限）之上第一個 8 的倍數 |
| **16ms** | `durationThreshold` 最低 | Event Timing 規格 | 120Hz 下漏掉一幀以上就會 ≥ 16ms，設這個值才看得到「不夠順」的互動 |
| **50ms** | Long Task / LoAF 觸發 | Long Tasks 規格、RAIL | 100ms 容忍上限扣掉瀏覽器開銷 |
| **1s / 5s** | CLS session window | Layout Instability 規格 | 間隔 1s 視為不同批位移；單一 window 上限 5s，避免長頁面無限累加 |
| **500ms** | `hadRecentInput` 豁免窗 | Layout Instability 規格 | 使用者主動觸發的位移不該計分 |
| **200 筆** | LoAF buffer 上限 | LoAF 規格 | 與 `longtask` 一致 |
| **p75** | Core Web Vitals 判定 | Google | 見 B.4 |
| **50** | INP 的 p98 除數 | Google（`web-vitals` 實作） | 每滿 50 次互動就往下退讓一名，近似 p98。**本站因 n=10 永遠走 max 分支** |
| **500ms / 250ms / 800×600 / 5000ms** | warmup / flush / viewport / 掉幀量測窗 | **本站凍結值** | **數值本身不需要有依據 —— 它的作用是「所有量測都用同一個值」。** 換一個值，全部重跑；不換，不影響任何結論。這就是 §1 原則 3 的具體實作 |
| **3 輪** | 可重現性判定 | **本站凍結值** | 同上。三輪是成本與信心的平衡點，不是統計學推導出來的 |

### B.4 門檻在本站是刻度尺，不是判決書

**Core Web Vitals 的門檻是用「真實使用者的第 75 百分位」判定的** —— 「LCP 良好」的意思是「75% 的真實訪問其 LCP ≤ 2.5s」，資料來源是 CrUX（Chrome User Experience Report）的實地資料。

**本站是單一裝置、刻意製造、條件全凍結的實驗室量測。** 兩者的統計基礎不同，所以寫文章時要分清楚哪種說法成立：

| 說法 | 可否 |
|---|---|
| 「治療後 INP 從 480ms 降到 40ms，降幅 92%」 | ✅ 本站的核心宣稱，完全成立 |
| 「在 4× CPU throttle、800×600 viewport 下，治療版本落在 40ms，位於 Google 的 200ms 良好區間內」 | ✅ **成立** —— 條件講清楚了，門檻當刻度用 |
| 「病變版本的 480ms 是良好門檻的 2.4 倍」 | ✅ 成立，量級參照 |
| 「這個標本的治療版本符合 Core Web Vitals 良好標準」 | ❌ 不成立 —— CWV 是實地 p75 判定，不是單機一次量測 |
| 「你照這樣改，你的網站 INP 就會是 40ms」 | ❌ 不成立 —— 本站不對真實環境做預測 |
| 「這個技巧能讓你的 INP 進入良好區間」 | ❌ 不成立 —— 本站只證明「翻動這個變因造成這個差距」，不證明「翻動它足以達標」。真實頁面通常有多個瓶頸疊加，修掉一個不等於過關 |

分界線很簡單：**講「在什麼條件下量到什麼」永遠成立；講「這個網站合格了」或「你的網站也會這樣」不成立。**

**引用門檻當刻度時，門檻必須和條件寫在同一個句子裡，不能分兩段寫。** 分開寫，讀者只會帶走數字，把 4× throttle 這個前提留在原地 —— 而同一個 40ms 在 1× 下可能是 10ms，在中階 Android 上可能是 150ms。

**另外要記得：病變版本的絕對值是你設計出來的。** 你自己選了迴圈次數與資料量，480ms 不是量出來的自然事實。它的量級只說明「這類問題**能有**多嚴重」，不是「這類問題**通常有**多嚴重」。真正是量出來而非設計出來的，只有兩樣：**治療前後的比值**，與**兇手落在哪一段**。

這是 §1「實驗有效性原則」的直接延伸 —— 條件凍結並宣告之後，就大方引用門檻當參照，不必因為「這不是 p75 實地資料」就整段迴避。這條要寫進首頁說明與每篇文章的條件說明段。

### B.5 本文件事實的查證方式（誠實揭露）

寫這份文件時，以下事實是**在 2026-07 實際查證規格與官方文件後寫下的**，不是憑記憶：

- Event Timing 的 8ms 量化、104ms 預設、16ms 最低 → W3C Event Timing 規格
- LoAF 在同源 iframe 間共用 frame timing、buffer 上限 200、`entry.scripts[]` 欄位清單 → LoAF 規格 + Chrome for Developers 文件
- LCP/CLS/Event Timing 為 per-document、父頁面看不到 iframe → LCP 規格 + `web-vitals` 官方說明
- `web-vitals` 對 iframe 內容零可見度 → `web-vitals` 官方 README
- `scheduler.yield()` 的瀏覽器支援狀況 → MDN + caniuse

以下是**未經本次查證、動工時要自己實測確認**的：

- `script.window` 與 `windowAttribution` 在 same-origin iframe 下的實際回傳值（§3.3，Phase 0 驗收第 5、6 條）
- Lighthouse DOM size 審計的確切扣分門檻（寫文章引用前要去看當版 Lighthouse 原始碼）
- Chrome 對 `window`/`document`/`body` 上 touch/wheel 預設 passive 的確切版本邊界（標本 #4）

**不確定的事情就標成不確定** —— 這比寫得斬釘截鐵然後被讀者抓到錯誤好太多。

---

*2026-07-25 · 規劃定案，尚未動工*
