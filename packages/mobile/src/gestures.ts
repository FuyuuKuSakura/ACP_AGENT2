/**
 * 触屏手势判定（ux-core-flows.md §6.2）：
 * - 对话页左滑 → 工作状态全屏页；工作状态页右滑 → 返回对话页；
 * - 对话页上滑 → 唤起角色抽屉；抽屉下拉 → 收起。
 *
 * 纯函数判定 + touch 事件接线分离，判定可单测。
 * 横滑要求水平位移主导（|dx| > threshold 且 |dx| > 1.5|dy|），
 * 避免垂直滚动误判；竖滑同理。
 */
export interface TouchPoint {
  x: number
  y: number
}

export type SwipeDirection = 'left' | 'right' | 'up' | 'down' | null

export const SWIPE_THRESHOLD_PX = 60
/** 主轴位移须超过交叉轴的倍数（防斜滑/滚动误判） */
export const SWIPE_AXIS_RATIO = 1.5

export function detectSwipe(
  start: TouchPoint,
  end: TouchPoint,
  threshold = SWIPE_THRESHOLD_PX,
): SwipeDirection {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx >= threshold && adx > ady * SWIPE_AXIS_RATIO) {
    return dx < 0 ? 'left' : 'right'
  }
  if (ady >= threshold && ady > adx * SWIPE_AXIS_RATIO) {
    return dy < 0 ? 'up' : 'down'
  }
  return null
}

export interface SwipeHandlers {
  onSwipe(direction: SwipeDirection): void
}

/**
 * 给元素接 touchstart/touchend（passive，滚动不阻塞）。
 * 返回解绑函数。多指触摸忽略。
 */
export function bindSwipe(
  el: HTMLElement,
  onSwipe: (direction: SwipeDirection) => void,
): () => void {
  let start: TouchPoint | null = null
  const onStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      start = null
      return
    }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onEnd = (e: TouchEvent) => {
    if (!start || e.changedTouches.length !== 1) {
      start = null
      return
    }
    const end = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
    }
    const direction = detectSwipe(start, end)
    start = null
    if (direction) onSwipe(direction)
  }
  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchend', onEnd, { passive: true })
  return () => {
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchend', onEnd)
  }
}
