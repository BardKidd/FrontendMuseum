# 病理報告 · 標本 05

> 實測數字唯一來源：`docs/measurements/2026-07-26-reproducibility-4x-5.json`
> （`sweep.measuredAt` 2026-07-26T05:52:29.671Z、`isFullSweep: true`、`problems: []`、
> `runsPerMode: 3` —— 66 筆完整六標本掃描，現行正典檔，見 `phase2:1059-1062`）。
> 其他 session 的數字只以「已作廢」或「另一輪」的身分出現，並逐一標明出處。
> 本文引用 `phase2:行號` = `docs/phase2-expected-results.md`，
> `ts:行號` = `specimens/05-layout-shift.ts`。行號會漂，引用時連內容一起引（`phase2:1199`）。

---

## 05 版面位移（Layout Shift / CLS）

**病症一句話**：載入後靜置、零互動，三個排程在 300 / 900 / 1500ms 的位移源
（無尺寸圖片、字族換入、上方插入橫幅）落進**同一個 CLS session window** 並累加，
CLS = **0.2694**（本輪三輪逐位元相同；「差」門檻 0.25，登記於 `phase2:254`）；
三段累加治療逐一預留空間之後，全治療臂 `fixed-banner` **一筆 layout-shift entry 都沒有**。

> 絕對值標 session：0.2694 出自 2026-07-26 完整掃描（4x、CDP、buildId `0.1.0-ms191c71`）。
> CLS 是純幾何量、三輪逐位元相同（`phase2:1317`），但它的「幾何確定」建立在
> 一組被護欄計數器盯著的前提上（字數、字族解析、圖片尺寸 —— 見誠實揭露），
> 不標條件就引用仍然是錯的。

## 凍結條件

同一組條件之間才能比較。任何一項改動，先前所有數字作廢。

| | |
|---|---|
| CPU throttle | 4x —— **宣告值**，JS 偵測不到（`sweep.cpuThrottle`、`records[*].cpuThrottle`）。CLS 登記為與 throttle 無關（`phase2:259-261`），但本份 JSON 沒有 1x 臂，這句宣稱**本輪無法檢核** |
| 驅動方式 | CDP 機器驅動（`sweep.driver`）—— 但本標本 `action: 'idle'`，驅動器只負責導覽與靜置，**不派送任何輸入**（互動會經 `hadRecentInput` 豁免毀掉主指標，`ts:40-43`） |
| viewport | 800 × 600（`src/specimens.ts:10` `FROZEN_VIEWPORT`）。**量測寬度另外凍結成 769px**：`html { overflow-y: scroll; }` 讓捲軸從第一幀就佔位（`ts:286`），護欄 `records[*].custom.contentWidthPx` 12 筆全為 769。CLS 的分母是扣掉捲軸後的 785 × 600 視窗（`ts:477-480` 逐位驗證），不是 800 × 600 |
| refreshHz | 60（`records[*].refreshHz`）—— 本標本主指標與幀率無關，`droppedFramesPeak` 12 筆皆 0 |
| 操作程序 | idle · 載入後靜置 · `repetitions: 1`、`intervalMs: null`（`src/specimens.ts:344-350`） |
| buildId | `0.1.0-ms191c71`（`records[*].buildId`） |
| protocolVersion | 1（`src/protocol.ts:8` `PROTOCOL_VERSION`；records 未載此欄位） |
| dispatchSpanMs | 不適用 —— idle 協定沒有絕對排程節拍，records 無此欄（無派送可言，不是 0） |

**B 類量測法（本輪數字的成立前提）**：切 mode 必須重載整份 document（LCP per-document、
CLS 是 document 級累計值，`ts:431-435`）。本輪採用 B 類前導污染修正後的方法：
每一筆樣本從**全新的 deep-link 導覽**開始、CPU 節流在導覽之前打開、
另加一次**丟棄的暖身導覽**吃掉冷啟動（`phase2:989-1001`）。
同一節已驗證 **#5 的 CLS 完全未受前導污染**（四臂三輪逐位元相同、與修前同值 ——
CLS 不掛 document 時鐘，`phase2:1046-1047`）；LCP 欄則是載入期指標，
本輪的 LCP 是在修正後的隔離法之下量得的。

## 動工前登記的預期

> 登記出處：原始登記 `phase2:235-285`；重新設計登記（位移源二補上真實位移、
> 單一 `fixed` 臂拆成梯度三段）`phase2:646-737`；判準定案追記 `phase2:1302-1317`。
> **這一節不准回頭改去迎合實測。** 修正只在該檔「修正紀錄」追加。

- 主指標：`cls`。`broken` 預期 **0.15~0.50**（「差」門檻 0.25，`phase2:254`）
- `broken` `sessionCount` 預期 **1**（`phase2:255`）。歷史：2026-07-25 三輪實測 2 曾推翻它，
  後查明真因是**位移源二在結構上不產生任何 entry**（`#ls-prose` 是模板最後一個元素，
  自己長高不推人，`phase2:525-537`）——原登記的推理與那三輪的 2 **雙雙作廢**（`phase2:732`），
  位移源二修復後（`phase2:658-660`）預期回到 1
- 治療 CLS **< 0.02**（`phase2:256`）。登記時只有單一 `fixed` 臂；拆成梯度後受詞定為
  **`fixed-banner`**（全治療臂，`phase2:1304-1305`）。⚠️ 該判準連同下一條，
  依生效範圍條款（`phase2:1334-1338`）**自追記起生效、對本份 JSON 不回溯**——
  本報告對它們只報方向與絕對值，不寫「通過／未通過」
- 比值 **> 10×**（`phase2:257`）——**作廢**（`phase2:1310-1312`：分母零 entry 時除法無定義；
  `broken` 下界 0.15 與 `fixed-banner < 0.02` 兩個絕對錨已蘊含 ≥ 7.5×，比值不帶新資訊）
- 新增**梯度單調遞減**判準：`broken > fixed-image > fixed-font > fixed-banner`（嚴格），
  從「每臂恰好移除一個位移源、三源貢獻皆為正」的結構推出，不含實測數字
  （`phase2:1313-1317`）——同樣生效於下一輪
- 各位移源貢獻區間：源一 0.05~0.20、源二 0.02~0.10、源三 0.05~0.25（`phase2:239-243`）
- 兇手宣告：`cls`（`src/specimens.ts:342`）
- 梯度設計：每一臂相對前一臂**只翻一個 CSS 宣告**，三條累加（`phase2:669-676`；
  `ts:87` `STAGES` 是唯一真相）
- 護欄登記值：`proseCharsCollapsed` 202、`captionCharsCollapsed` 444、
  `proseHeightBeforePx → AfterPx` 在 `broken`/`fixed-image` 應為 112 → 140、
  在 `fixed-font`/`fixed-banner` 應為 168 → 168（`phase2:703-707`）；
  `bannerPushPx` 前三臂 72、`fixed-banner` 0（`ts:235-237`）；
  `figureHeightAtFontShiftPx` 與 `figureNaturalHeightPx` 皆 360，任一不是 360
  位移源二的數字不得引用（`ts:192-199`）
- 登記在案的風險（`phase2:277-285`）：
  R1 圖片快取 → 每次載入帶 cache buster（`ts:159-160, 170`）；
  R2 `hadRecentInput` 豁免 → 靜置 + `clsIgnoredByInput` 護欄；
  R3「三個位移源都必須落在第一屏內」——**已正式撤銷**（`phase2:716-721`），
  改為貢獻由摺線裁切後的可見高度決定，上報 `captionTopPx` / `captionVisibleBeforePx`
- 登記在案的實作偏差（登記時即寫明，非事後補記）：位移源二**不是真的 web font**，
  以系統字族互換觸發同一機制（`phase2:263-275`）——見誠實揭露

## 實測

三輪，同一組凍結條件。可重現性判定用每輪 median 不用 max（`protocol.ts:309`
「抗離群。可重現性判定用這個，不用 max」）；CLS 每輪只有一個終值
（`records[*].cls.value`），該值即每輪的代表值，無輪內分布可言。
相對離散度 = (max − min) / median-of-three；絕對底線 CLS 0.01
（`tools/analyze-repro.mjs:54`）。

| mode | 三輪 CLS | 相對離散度 | 絕對全距 | sessionCount | 判定 |
|---|---|---|---|---|---|
| `broken` 三個位移源 | 0.269378 / 0.269378 / 0.269378（逐位元相同） | 0.0% | 0 | 1 / 1 / 1 | ✅ 可重現 |
| `fixed-image` | 0.102056 ×3（逐位元相同） | 0.0% | 0 | 1 ×3 | ✅ 可重現 |
| `fixed-font` | 0.088652 ×3（逐位元相同） | 0.0% | 0 | 1 ×3 | ✅ 可重現 |
| `fixed-banner` | **無 entry** ×3 | —（無值可算） | 0（三輪一致無 entry） | 無 entry | ✅ 可重現 |

出處：`records[mode=broken,run=1..3].cls.value` = 0.26937771106332914 ×3、
`records[mode=fixed-image,run=1..3].cls.value` = 0.10205648910706316 ×3、
`records[mode=fixed-font,run=1..3].cls.value` = 0.08865229421071848 ×3、
`records[mode=fixed-banner,run=1..3].cls` = `null` ×3。

> ⚠️ **`fixed-banner` 的 `null` 是「無 entry」，不是「量到 0」。**
> `ClsCollector.current()` 在一筆 entry 都沒收到（含被豁免的）時回 `null`
> （`src/measure/vitals.ts:200-203`「面板才能區分『沒有位移』與『還沒開始觀測』」；
> 快照經 `runtime.ts:269` 取值。`phase2:1306` 引的 `runtime.ts:193` 已漂移，
> 現指向 crossCheck 的欄位，機制敘述不變）。對 CLS 而言 observer 掛著、沒東西可報，
> 語意上就是位移為零 —— 但記法必須是「無 entry」，這是標本 #3 治療版建立起來的區別
> （模板前言），不因為結果是好事就省略。依生效範圍條款這裡**不宣稱**「通過 < 0.02」。

**量化假象（登記在案，本輪單邊落點）**：`broken` 的位移源一可能記成一筆或兩筆 entry
（alt 盒塌陷 + 20ms 後撐開，兩步是否同幀不定），兩個離散落點 0.24741 / 0.26931、
之間沒有中間值（`ts:118-129`）。本輪三輪**全部落在拆兩筆值** 0.269378；
同日稍早的 #2/#5 驗證輪（`2026-07-26-reproducibility-4x-4.json`，另一份 JSON，
僅作機制佐證、不作絕對值比較）三輪是 0.2474 / 0.2474 / 0.2694（`phase2:1009`）——
兩個落點各自逐位可重現。`sessionCount` 不受此影響（`ts:129`）。

**護欄計數器（`records[*].custom`，每臂三輪皆相同）**：

| 護欄 | 登記值 | broken | fixed-image | fixed-font | fixed-banner |
|---|---|---|---|---|---|
| `contentWidthPx` | 769 | 769 | 769 | 769 | 769 |
| `proseCharsCollapsed` | 202 | 202 | 202 | 202 | 202 |
| `captionCharsCollapsed` | 444 | 444 | 444 | 444 | 444 |
| `proseHeightBeforePx → AfterPx` | 112→140 ／ 168→168 | 112→140 | 112→140 | 168→168 | 168→168 |
| `figureHeightAtFontShiftPx` / `figureNaturalHeightPx` | 360 / 360 | 360 / 360 | 360 / 360 | 360 / 360 | 360 / 360 |
| `bannerPushPx` | 72（前三臂）／ 0 | 72 | 72 | 72 | 0 |
| `clsIgnoredByInput` | 0（風險 R2 未觸發） | 0 | 0 | 0 | 0 |
| `shiftSourcesScheduled` | 3（排程數，**不是** entry 數，`ts:118-142`） | 3 | 3 | 3 | 3 |
| `captionTopPx`（掛載時） | —（觀測值） | 343.875 | 679.875 | 735.875 | 807.875 |
| `captionVisibleBeforePx` | —（觀測值） | 208 | 0 | 0 | 0 |

4 臂 × 3 輪共 12 筆，護欄**全部命中登記值**。`captionTopPx` 逐臂下移的差額
（+336 / +56 / +72）正是各段預留的空間（圖片 360 − alt 盒 24、內文 168 − 112、
橫幅 64 + 邊界合併的 8，`ts:59-68`）——預留逐段生效的幾何直接寫在護欄裡。
`captionVisibleBeforePx` 208 → 0 顯示：治療臂把圖說整段推到摺線下，
這是撤銷 R3 後「裁切量自身可觀測」的設計在動作（`phase2:716-721`）。

**次指標 LCP（B 類附帶）**：

| mode | LCP 標的（三輪一致） | 三輪 LCP (ms) | median | 相對離散度 | 絕對全距 |
|---|---|---|---|---|---|
| `broken` | `p#ls-caption` | 92 / 108 / 72 | 92 | 39.1% ⚠️ | 36ms（< 50ms 底線 → ✅） |
| `fixed-image` | `div#ls-prose` | 84 / 84 / 76 | 84 | 9.5% | 8ms |
| `fixed-font` | `img#ls-figure` | 384 / 376 / 388 | 384 | 3.1% | 12ms |
| `fixed-banner` | `img#ls-figure` | 380 / 404 / 384 | 384 | 6.3% | 24ms |

出處：`records[mode=*,run=1..3].lcp.value` 與 `.lcp.el`。

> ⚠️ **四臂三種 LCP 標的，這一欄不得跨臂引用**（`phase2:1231-1232`）。
> 治療臂 LCP 較大是**標的換人**：`broken` 的 LCP 是第一次繪製就定案的圖說文字，
> `fixed-font`/`fixed-banner` 的 LCP 是要等網路的圖片 —— 不是「治療讓頁面變慢」
> （`ts:538-543`）。機制上圖片在 `broken` 臂反而因可見面積較大而被
> **低熵規則（< 0.05 bpp）排除**在 candidate 之外（校準 D 規則 `phase2:32`；
> `ts:524-536` 以 998 / 1198 bytes 兩點證偽驗證過門檻位置）。
> 先前「aspect-ratio 預留後圖片才有資格當標的」那句無證據的因果解釋已刪（`phase2:723-728`）。
> ⚠️ `ts:513-543` 檔尾的 LCP 推導寫於**單一 fixed 臂時代**，其「`fixed-*` →
> `img#ls-figure`」對 `fixed-image` 臂不成立（本輪實測是 `div#ls-prose`）；
> 逐臂標的以 `phase2:862` 與本表為準。
> `broken` 臂相對離散度 39.1% 超過 30% 門檻，靠絕對全距 36ms < 50ms 底線判可重現。

**互動期欄位**：`totalInteractions` 12 筆皆 0（idle 協定設計如此）；
`inp` / `inputDelay` / `processing` / `presentation` / `duration` 皆 `null` = **未量測**
（無互動可量，不是量到 0）。捲動與點擊都會污染主指標，零互動是實驗條件不是缺漏。

## 兇手歸因

| | `broken` | `fixed-banner`（全治療臂） |
|---|---|---|
| inputDelay | 未量測（idle 協定、`totalInteractions` 0） | 未量測（同左） |
| processing | 未量測 | 未量測 |
| presentation | 未量測 | 未量測 |
| LoAF forcedStyleAndLayout（僅標本自己的 script） | 無 entry（`forcedSamples: []`、`loafPickedBy: "none"`，三輪皆同） | 無 entry（同左） |
| sourceFunctionName | 無 entry 可指認（`forcedFn: null`） | 無 entry 可指認 |

三輪兇手段是否一致：**是** —— 兇手是登記的 `cls` 本身（`src/specimens.ts:342`），
證據不在 INP 三段（本標本沒有互動），在 CLS 的**梯度逐段拆解**（見治療梯度）：
每臂三輪 CLS 逐位元相同、`sessionCount` 一致，位移源逐段移除時分數逐段消失。

> ⚠️ `tools/analyze-repro.mjs` 的「三輪一致兇手 vs 登記值」判準只涵蓋 INP 三段，
> `culprit: 'cls'` 落在值域之外（`not-an-inp-segment`，`phase2:1166-1180`）——
> **登記的兇手從未被自動判準驗證過**。本報告的歸因靠梯度差分與護欄計數器，不靠該判準。
> LoAF 一欄同時是排除證據：三個位移源的實作路徑上沒有留下任何強制版面幀
> （位移源一刻意一行 DOM 量測都不做，`ts:162-165`；源二、源三的 `offsetHeight` /
> `getBoundingClientRect` 讀取沒有觸發可觀測的 LoAF entry）。

## 治療梯度

| 治療 | 唯一翻動的變因 | 三輪 CLS | 相對病變（同一 JSON 內，描述值） | 代價 |
|---|---|---|---|---|
| `fixed-image` | **只**加 `.ls-figure` 的 `aspect-ratio`（`ts:291`） | 0.102056 ×3 | 2.64×（0.269378 ÷ 0.102056） | 必須事先知道圖片內在比例；比例錯了空間照樣跳 |
| `fixed-font` | 再加 `.ls-prose` 的 `min-height: 168px`（`ts:306`） | 0.088652 ×3 | 3.04×（0.269378 ÷ 0.088652） | 刻意多留一行 = 常態多 28px 空白（`ts:298-303`）；是替代解不是正解（正解 `size-adjust` 需自架字型）；`min-height` 與文案長度耦合，改字要重量（`ts:349-354`） |
| `fixed-banner` | 再加 `.ls-banner-slot` 的 `min-height: 64px`（`ts:314`） | **無 entry** ×3 | **不報比值** —— 分母無 entry，除法無定義（`phase2:1310-1312`） | 頁面從第一幀起常駐 64px 的空 slot；等價替代（`position: fixed` 疊加）會遮內容（`ts:230-234`，未做臂） |

**逐段歸因（同一份 JSON 內的差分，每臂只差一個位移源）**：

- 位移源一（無尺寸圖片）＝ broken − fixed-image ＝ 0.269378 − 0.102056 ＝ **0.16732**
- 位移源二（字族換入）＝ fixed-image − fixed-font ＝ 0.102056 − 0.088652 ＝ **0.01340**
- 位移源三（插入橫幅）＝ fixed-font − 無 entry ＝ **0.08865**

與標本檔尾逐筆推導的**獨立計算**相符（源一拆兩筆 0.16726、源二 0.013409、
源三 0.088652，`ts:487-511`；源一差 0.00006 來自登記註解的成分捨入）。
梯度拆臂讓歸因不需要擴充協定送逐筆 entry —— 臂間的 `cls.value` 差異本身就是歸因
（`phase2:678-679`、`phase2:857-860`）。

方向：0.269378 > 0.102056 > 0.088652 > 無 entry —— **嚴格單調遞減**，
與梯度設計的結構性預測同向（`phase2:1313-1317`）。依生效範圍條款
（`phase2:1334-1338`），本報告**不宣稱**通過或未通過任何比值／單調判準，
上述只是方向與絕對值。

**位移源二那段只值 0.01340 —— 這不是「治療二效果小」，是分數被摺線壓小**：
它推動的插圖有 65px 已在摺線以下、不進帳（`ts:489-493`），
貢獻由裁切量決定（`phase2:859`）—— 這正是撤銷「三源都須在第一屏內」條款時
登記的機制（`phase2:716-721`）。無效或反向的治療：**無**。

## 與登記的差異

- **符合**（誤差 ≤ 30%）：
  - `broken` CLS 0.269378 ∈ 登記 0.15~0.50（`phase2:254`）✅
  - `broken` `sessionCount` 1 ×3 = 登記值（`phase2:255`）✅ ——
    注意這是**修復位移源二之後**才成立的；2026-07-25 量到的 2 與原登記推理已雙雙作廢
    （`phase2:732`），本輪是「三筆位移落進同一個窗並累加」**第一次在正典掃描中成立**
    （定性判定見 `phase2:854-855`，該節表格數字屬 `-4x-4.json` 驗證輪）
  - 位移源一段 0.16732 ∈ 登記 0.05~0.20（`phase2:241`）✅
  - 位移源三段 0.08865 ∈ 登記 0.05~0.25（`phase2:243`）✅
  - 護欄 12 筆全部命中登記值（202 / 444 / 112→140 / 168→168 / 360 / 72 / 0）✅
- **數值落空**（同方向但低於登記帶）：
  - 位移源二段 0.01340 低於登記區間 0.02~0.10 下緣（`phase2:242`）約 **33%** ——
    超出 30% 容忍帶，但遠非數量級。已在 `phase2:859` 歸因於摺線裁切
    （與撤銷 R3 同一機制）；依處置順序查的是實驗幾何而非量測層，
    幾何解釋與護欄（`captionTopPx` / 插圖裁切 65px）一致，**不動 protocol**。
    登記區間寫於梯度拆臂前，本輪起這一段有了可直接量測的受詞
- **方向落空**：無。梯度嚴格單調、`sessionCount` 回到登記值、零 entry 臂三輪一致
- **判準狀態**（不是差異，是凍結）：`> 10×` 作廢（`phase2:1310-1312`）；
  `< 0.02`（受詞 `fixed-banner`）與梯度單調判準生效於下一輪，
  對本份 JSON 不回溯（`phase2:1334-1338`）—— 本報告全程只報方向與絕對值

## 誠實揭露

- 這個標本**沒有**示範的東西：
  - **真的 web font swap。** 位移源二用「系統字族互換」觸發同一機制
    （字寬變 → 換行變 → 高度變 → 推動下方），機制為真但不是 `font-display: swap`
    的完整故事；治療二的 `min-height` 是替代解，正解 `size-adjust` / `ascent-override`
    需要自架 `.woff2`，登記為已知缺口，補上前文章不得宣稱示範了完整字型位移
    （`phase2:263-275`、`ts:201-209`）
  - **`position: fixed` 疊加式橫幅**這個等價治療沒有做臂，只在註解提及（`ts:230-234`）
  - **「位移拆散到不同 window 分數變好看、畫面跳動一樣」**是本標本的教學重點
    （`ts:34-38`），但 1.2s 間隔的對照臂不存在 —— 這個宣稱本輪只有推導沒有實測
- 已知會讓數字失真的因素：
  - **兩段內文的長度是實驗參數不是文案**（`proseCharsCollapsed` 202、
    `captionCharsCollapsed` 444）。202 的可用區間有兩份方法不同的量測
    （188~209 vs 198~217），**不一致且未裁決**——現值同時落在兩份區間內，
    不影響本輪數字，留待第三種方法（`phase2:690-702`）
  - **量化假象**：`broken` 有 0.2474 / 0.2694 兩個離散落點（1 筆或 2 筆 entry），
    之間無中間值；跨輪比較 `broken` 絕對值時 0.022 的差可能整個來自落點翻面，
    不是回歸（`ts:118-129`）
  - **`monospace` 解析到哪個字族由平台決定**（`ts:299-301`）——換機器可能多一行，
    治療二會**靜默失效**（面板上只多出一個容易被當雜訊的小 CLS）
  - **位移源二的分數依賴位移源一的圖片幾何**（登記在案的混淆變因，`ts:192-199`）：
    圖片 404、命中快取、或換內在尺寸，源二的數字就變，而它自己一行未改。
    本輪護欄 `figureHeightAtFontShiftPx` / `figureNaturalHeightPx` 12 筆皆 360，前提成立
  - 圖片快取（R1）由 cache buster 排除（`ts:159-160, 170`）；
    `hadRecentInput`（R2）本輪未觸發（`clsIgnoredByInput` 12 筆皆 0）
  - LCP 欄**不得跨臂引用**（四臂三種標的，`phase2:1231-1232`）；
    `broken` 臂 LCP 離散度 39.1%，只靠 50ms 絕對底線撐住可重現判定
- 換機器後必須重跑什麼才能沿用結論：
  - 先跑**校準 C（版面位移解析解 0.00573，前輪實測 −2.3%，`phase2:319`）**
    證明量測層自己沒說謊
  - 重載一次看護欄：`proseHeightBeforePx → AfterPx` 是否仍為 112 → 140 / 168 → 168、
    `figureHeightAtFontShiftPx` / `figureNaturalHeightPx` 是否仍 360 / 360、
    `contentWidthPx` 是否仍 769 —— 任何一格不中，CLS 的「幾何確定」前提即告失效，
    本報告全部絕對值不得沿用（`phase2:703-707`、`ts:188-198`）
- 本輪未做的事：
  - 人手複驗（全程 CDP 機器驅動）
  - `?validate=1` 的 web-vitals 對帳未納入本輪三輪（上一次對帳是校準件的
    `deltaCls = 0`，`phase2:322-324`，另一 session）
  - 無 1x 臂 ——「CLS 與 throttle 無關」（`phase2:259-261`）本份 JSON 內無從檢核
  - 逐筆 layout-shift entry 未上報協定（設計決定：梯度臂間差異即歸因，`phase2:678-679`），
    所以三筆 entry 的**實際落點時刻**本輪僅有標本註解的 593~599ms（`ts:35`）可引，
    不在 records 內
  - 治療臂 LCP 標的的機制推導（低熵規則的 bpp 計算）未在拆臂後的四臂上逐臂重驗 ——
    `ts:513-543` 檔尾推導寫於單一 `fixed` 臂時代，其對 `fixed-image` 臂的描述已與實測不符
