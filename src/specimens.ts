/**
 * 標本註冊表 —— 外殼與標本共用同一份 metadata。
 *
 * id 就是 URL 就是文章連結，改了斷連結（spec §5.2 第 22 項）。
 * viewport 凍結，改這裡等於讓歷史數字作廢（spec §4.6）。
 */
import type { SpecimenId, SpecimenMeta } from './protocol';

/** 全站凍結的實驗區尺寸。不要用百分比或 vh */
const FROZEN_VIEWPORT = { width: 800, height: 600 } as const;

/**
 * 校準標本 —— 不是六個標本之一，是 Phase 0 的驗收工具（spec §5.5）。
 *
 * 兩個 mode 的忙迴圈時間是 300ms / 30ms，比值 10× 有解析解，
 * 所以它同時校準「絕對量級」與「病變 vs 治療的比值」這兩件事。
 */
export const CALIBRATION_META: SpecimenMeta = {
  id: '00-calibration',
  order: 0,
  title: '校準標本',
  subtitle: '每個負載都有解析解可以反推 —— 用來證明量測層本身是對的',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'busy-300', label: '忙迴圈 300ms', kind: 'pathological', order: 0 },
    { id: 'busy-30', label: '忙迴圈 30ms', kind: 'treatment', order: 1 },
  ],

  primaryMetric: 'inp.processing',
  secondaryMetrics: ['inp', 'loaf.specimenScriptDuration', 'loaf.forcedStyleAndLayout'],
  culprit: 'processing',

  // 每秒一下 —— 刻意讓互動之間不重疊，這樣 processing 段才會乾淨等於忙迴圈時間，
  // 驗收第 2 條（processing 落在 270~330ms）才有解析解可比。
  protocol: {
    action: 'click',
    repetitions: 10,
    intervalMs: 1000,
    instruction: '每次節拍亮起時點一下「忙迴圈」按鈕，共十次。不要連打。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/00-calibration.html',
  status: 'ready',
  difficulty: 1,
  drama: 1,
  tags: ['calibration', 'phase-0'],
};

/**
 * 標本 #1 —— 主執行緒阻塞。
 *
 * 兇手是 input delay，不是 processing：單獨點一下只會看到 processing 爆掉，
 * 要連打才會看到事件排在後面等主執行緒（spec §4.1）。
 * 所以 protocol.intervalMs 必須是 null（盡快連續）—— 操作程序是凍結變因的一部分。
 */
export const MAIN_THREAD_BLOCK_META: SpecimenMeta = {
  id: '01-main-thread-block',
  order: 1,
  title: '主執行緒阻塞',
  subtitle: '在事件處理器裡同步排序五萬筆訂單，期間整個 UI 凍結',

  class: 'A',
  switchKind: 'live',
  modes: [
    { id: 'broken', label: '病變：同步排序', kind: 'pathological', order: 0 },
    {
      id: 'fixed-yield',
      label: '治療一：切 chunk + yield',
      kind: 'treatment',
      order: 1,
      requires: ['scheduler.yield'],
    },
    {
      id: 'fixed-worker',
      label: '治療二：丟 Web Worker',
      kind: 'treatment',
      order: 2,
      requires: ['web-worker'],
    },
  ],

  primaryMetric: 'inp.inputDelay',
  secondaryMetrics: ['inp', 'inp.processing', 'loaf.specimenScriptDuration'],
  culprit: 'inputDelay',

  protocol: {
    action: 'click',
    repetitions: 10,
    intervalMs: null,
    instruction: '連續快速點擊「排序訂單」十次，不要等畫面回應 —— 越快越好。',
  },

  viewport: FROZEN_VIEWPORT,
  entry: '/specimens/01-main-thread-block.html',
  status: 'ready',
  difficulty: 1,
  drama: 5,
  tags: ['inp', 'input-delay', 'scheduler', 'web-worker'],
};

export const SPECIMENS: SpecimenMeta[] = [CALIBRATION_META, MAIN_THREAD_BLOCK_META].sort(
  (a, b) => a.order - b.order,
);

export function getSpecimen(id: SpecimenId): SpecimenMeta | undefined {
  return SPECIMENS.find((s) => s.id === id);
}
