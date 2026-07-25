/**
 * 裝置條件快照。
 *
 * 這個檔案量的不是「效能數字」，是**數字成立的前提**（RunConditions.device）。
 * 前提沒記錄下來，截圖就只是一張沒有 context 的圖片（spec §5.1 第 3、12 項）。
 */
import type { CpuThrottle, DeviceProfile } from '../protocol';
import { computeRunStats } from './metrics';

/**
 * 市面上實際存在的面板刷新率。實測值一律吸附到這張表的最近者。
 *
 * rAF 取樣必定有雜訊：同一塊 60Hz 面板這次量到 59.6、下次 60.3 很正常。
 * 不吸附的話，「目標幀時間 16.78ms」與「16.61ms」會被寫進兩份 RunConditions，
 * 看起來像兩組不同條件 —— 但它們其實是同一塊螢幕。
 * 吸附把連續的雜訊變成離散選擇，可重現性才有意義。
 */
const PANEL_RATES = [60, 75, 90, 120, 144, 165, 240] as const;

/** 要幾個 delta。N 個 delta 需要 N+1 個 timestamp */
const SAMPLE_DELTAS = 20;

/**
 * 實測刷新率。
 *
 * 為什麼非量不可：droppedFrames 的門檻是「目標幀時間」，而目標幀時間不是常數。
 * 在 120Hz 面板上拿 16.7ms 當門檻，等於把每一個正常幀都判成掉幀 ——
 * 掉幀數會變成一個跟真實掉幀無關、且換台機器就完全不同的數字（spec §5.1 第 12 項）。
 *
 * ⚠️ 分頁在背景時 rAF 不會被呼叫，這個 Promise 會一直不 resolve。
 * Phase 0 刻意不加 timeout：timeout 只能 fallback 到 60，而在 120Hz 螢幕上
 * 悄悄回報 60 正是這個函式要防的錯。量測本來就必須在可見分頁進行，
 * 寧可卡住讓人發現，也不要給一個看起來正常的錯值。
 */
export function measureRefreshHz(): Promise<number> {
  return new Promise((resolve) => {
    const stamps: number[] = [];

    const tick = (t: DOMHighResTimeStamp): void => {
      stamps.push(t);
      if (stamps.length <= SAMPLE_DELTAS) {
        requestAnimationFrame(tick);
        return;
      }

      const deltas: number[] = [];
      for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);

      // 取 median 不取 mean。取樣的 20 幀裡只要有一幀被別的工作卡住
      // （擴充套件、外殼自己的 render、GC），mean 就會被拉出一個不存在的刷新率，
      // 而 median 對單一離群幀完全免疫。
      //
      // 借用 computeRunStats 而不是在這裡再寫一次 median：同一個專案裡兩份
      // median 實作遲早會對不起來，而那種不一致沒有任何徵兆。
      const { median } = computeRunStats(deltas);

      // median 為 0 只可能出現在 rAF 行為異常時。不讓 Infinity 流進 RunConditions。
      resolve(median > 0 ? snapToPanelRate(1000 / median) : 60);
    };

    requestAnimationFrame(tick);
  });
}

function snapToPanelRate(hz: number): number {
  let best: number = PANEL_RATES[0];
  let bestDelta = Infinity;
  for (const rate of PANEL_RATES) {
    const delta = Math.abs(rate - hz);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = rate;
    }
  }
  return best;
}

/**
 * cpuThrottle 是參數而不是偵測結果，這件事本身就是規格。
 *
 * DevTools 的 CPU throttling 對 JS 完全不可見：沒有 API、沒有側信道、
 * 跑分也分不出「4x 節流」與「一台本來就慢四倍的機器」。所以它只能是
 * 使用者宣告，而既然是宣告，就必須從外面傳進來，不能在這裡猜（spec §5.1 第 3 項）。
 */
export function buildDeviceProfile(cpuThrottle: CpuThrottle, refreshHz: number): DeviceProfile {
  return {
    ua: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    // Chromium-only 且會被隱私設定關掉，所以型別上就是可空的。
    deviceMemory: navigator.deviceMemory ?? null,
    dpr: window.devicePixelRatio,
    cpuThrottle,
    refreshHz,
    // Phase 0 不跑分。欄位先存在，之後補跑分不必動 protocol，先前的資料也不用重跑。
    benchScore: null,
  };
}
