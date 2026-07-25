/**
 * 瀏覽器實驗性 API 的型別補丁。
 * lib.dom 目前沒有 Long Animation Frames 與 scheduler.yield()。
 */

/** Vite define 注入，見 vite.config.ts */
declare const __BUILD_ID__: string;

/** https://w3c.github.io/long-animation-frames/#sec-PerformanceScriptTiming */
type ScriptInvokerType =
  | 'classic-script'
  | 'module-script'
  | 'event-listener'
  | 'user-callback'
  | 'resolve-promise'
  | 'reject-promise';

/**
 * W3C LoAF 規格的完整列舉，只有這五個值。
 * 不存在 'same-origin-descendant' 之類的值，別自己加（spec §3.3）。
 */
type ScriptWindowAttribution = 'self' | 'descendant' | 'ancestor' | 'same-page' | 'other';

interface PerformanceScriptTiming extends PerformanceEntry {
  readonly startTime: DOMHighResTimeStamp;
  readonly duration: DOMHighResTimeStamp;
  readonly executionStart: DOMHighResTimeStamp;
  readonly invoker: string;
  readonly invokerType: ScriptInvokerType;
  readonly sourceURL: string;
  readonly sourceFunctionName: string;
  readonly sourceCharPosition: number;
  /** 標本 #3 的核心指標：逐 script，可乾淨過濾外殼 */
  readonly forcedStyleAndLayoutDuration: DOMHighResTimeStamp;
  readonly pauseDuration: DOMHighResTimeStamp;
  readonly window: Window | null;
  readonly windowAttribution: ScriptWindowAttribution;
}

interface PerformanceLongAnimationFrameTiming extends PerformanceEntry {
  readonly renderStart: DOMHighResTimeStamp;
  readonly styleAndLayoutStart: DOMHighResTimeStamp;
  /** 整幀的值，規格上無法拆到單一 script。UI 必須標明「含外殼」 */
  readonly blockingDuration: DOMHighResTimeStamp;
  readonly firstUIEventTimestamp: DOMHighResTimeStamp;
  readonly scripts: ReadonlyArray<PerformanceScriptTiming>;
}

/** https://wicg.github.io/scheduling-apis/ */
interface SchedulerPostTaskOptions {
  priority?: 'user-blocking' | 'user-visible' | 'background';
  signal?: AbortSignal;
  delay?: number;
}

interface Scheduler {
  /** Chrome / Edge / Firefox 有，Safari 沒有，非 Baseline（spec 標本 #1） */
  yield?: () => Promise<void>;
  postTask?: <T>(cb: () => T, opts?: SchedulerPostTaskOptions) => Promise<T>;
}

interface Window {
  readonly scheduler?: Scheduler;
}

interface Navigator {
  /** 非標準，Chromium only */
  readonly deviceMemory?: number;
}
