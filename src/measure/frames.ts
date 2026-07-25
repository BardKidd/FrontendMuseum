/**
 * 掉幀計數 —— `custom.droppedFrames` 的來源。
 *
 * 標本 #4（事件處理未節流）與標本 #6（re-render 風暴）的主指標之一。
 * 這兩個標本的病變不是「某一次互動很慢」，是**畫面在動的期間持續掉幀**，
 * 那種病 INP 抓不到（沒有互動）、LoAF 只抓得到 ≥50ms 的幀。
 *
 * ⚠️ 三件事必須講清楚，否則這個數字會被誤讀：
 *
 * 1. **它是滾動窗內的數字，不是整輪累計。** 窗長 `droppedFrameWindowMs`（5000ms）。
 *    整輪累計會隨你按鈕按多久線性成長，那不是效能指標是碼表。
 * 2. **它自己就是主執行緒上的工作。** 每一幀跑一次 rAF callback ——
 *    雖然只有幾個算術運算，但它確實會進 LoAF 的 scripts[]，而且 `destroy()`
 *    忘了停就會讓驗收第 12 條（切走標本後靜置五秒無 specimen LoAF）掛掉。
 *    所以 stop() 不是禮貌，是驗收條件。
 * 3. **門檻依實測 refreshHz**，不是寫死 16.7ms。120Hz 面板上用 16.7ms 當目標幀時間，
 *    等於把每一個正常幀都判成掉幀（spec §5.1 第 12 項）。
 */
import { measureRefreshHz } from './device';

/** 一筆掉幀紀錄：什麼時候、掉了幾幀（document 相對時間） */
interface Miss {
  at: number;
  frames: number;
}

export class FrameCounter {
  readonly #windowMs: number;

  /** 0 = refreshHz 還沒量到，這期間不計數（見 #tick） */
  #targetFrameMs = 0;
  #misses: Miss[] = [];
  #last = 0;
  #rafId = 0;
  #running = false;

  constructor(windowMs: number) {
    this.#windowMs = windowMs;
  }

  /**
   * 非同步啟動：要先量到 refreshHz 才知道「一幀該多久」。
   *
   * 量測期間（約 20 幀，60Hz 下 ~350ms）不計數。這不是問題 ——
   * 暖機窗 `warmupMs` 是 500ms，本來就要丟掉那段的樣本。
   */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    const hz = await measureRefreshHz();
    // start() 是非同步的，等待期間可能已經被 stop() 了。不檢查的話 rAF 迴圈會活過 destroy()。
    if (!this.#running) return;
    this.#targetFrameMs = 1000 / hz;
    this.#last = performance.now();
    this.#rafId = requestAnimationFrame(this.#tick);
  }

  stop(): void {
    this.#running = false;
    if (this.#rafId !== 0) cancelAnimationFrame(this.#rafId);
    this.#rafId = 0;
  }

  reset(): void {
    this.#misses = [];
    /*
     * #last 要**重新對時**到現在，而不是歸零、也不是不動。
     *
     * 歸零會讓下一幀算出一個巨大的 delta，那一筆假掉幀直接進新一輪的第一個窗 ——
     * 這是原本註解唯一駁斥的錯誤選項。但「不動」同樣是錯的，只是症狀藏得更深：
     * runtime 的順序是先 `await mod.setMode()`（同步阻塞主執行緒）再 `reset()`，
     * 切換期間沒有任何 rAF tick 跑得成，所以 reset 當下沒東西可清；
     * 等切換結束、下一個 tick 觸發時，它算的 delta **跨越整段切換工作**，
     * 那筆 miss 就被推進剛清空的陣列，記在新 mode 頭上。
     *
     * 受害最深的是標本 #4 的 `fixed-observer`：進入該 mode 要跑 8000 次
     * `observer.observe()`，是四個 mode 裡最重的切換成本，卻整份記在治療版帳上。
     * 偏差方向對治療版不利（結論不會反轉），但主指標的絕對值會失真。
     * warmup 窗擋不住它 —— `droppedPeak` 在 flush() 裡是無條件更新的。
     */
    this.#last = performance.now();
  }

  /** 最近 windowMs 內的掉幀數 */
  dropped(): number {
    this.#prune(performance.now());
    let total = 0;
    for (const m of this.#misses) total += m.frames;
    return total;
  }

  /**
   * 具名函式：它會出現在 LoAF 的 sourceFunctionName。
   * 匿名的話，標本 #4／#6 的面板上會冒出一支看不出來歷的 script。
   */
  readonly #tick = (now: DOMHighResTimeStamp): void => {
    const delta = now - this.#last;
    this.#last = now;

    // round 而非 floor：delta 落在 1.4 幀以內算沒掉幀（rAF 本來就有抖動），
    // 2.4 幀算掉 1 幀。floor 會把每一次正常抖動都算成掉幀。
    const missed = Math.max(0, Math.round(delta / this.#targetFrameMs) - 1);
    if (missed > 0) this.#misses.push({ at: now, frames: missed });
    this.#prune(now);

    if (this.#running) this.#rafId = requestAnimationFrame(this.#tick);
  };

  #prune(now: number): void {
    const cutoff = now - this.#windowMs;
    // 陣列是時間遞增的，所以砍前綴就好
    let i = 0;
    while (i < this.#misses.length && this.#misses[i].at < cutoff) i++;
    if (i > 0) this.#misses.splice(0, i);
  }
}
