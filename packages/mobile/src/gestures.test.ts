/**
 * 手势判定测试：左滑/右滑/上滑/下拉阈值与主轴约束（防滚动误判）。
 */
import { describe, expect, it } from 'vitest'

import { detectSwipe, SWIPE_THRESHOLD_PX } from './gestures.js'

describe('detectSwipe', () => {
  it('水平位移达标且主导 → left/right', () => {
    expect(detectSwipe({ x: 200, y: 100 }, { x: 80, y: 110 })).toBe('left')
    expect(detectSwipe({ x: 80, y: 100 }, { x: 200, y: 90 })).toBe('right')
  })

  it('垂直位移达标且主导 → up/down', () => {
    expect(detectSwipe({ x: 100, y: 300 }, { x: 110, y: 180 })).toBe('up')
    expect(detectSwipe({ x: 100, y: 100 }, { x: 90, y: 240 })).toBe('down')
  })

  it('位移不足阈值 → null', () => {
    expect(
      detectSwipe(
        { x: 100, y: 100 },
        { x: 100 - (SWIPE_THRESHOLD_PX - 1), y: 100 },
      ),
    ).toBeNull()
  })

  it('斜滑/垂直滚动不误判为横滑', () => {
    // 垂直滚动带轻微横向偏移
    expect(detectSwipe({ x: 100, y: 400 }, { x: 60, y: 100 })).toBe('up')
    // 对角线（两轴都达标但都不够主导）
    expect(detectSwipe({ x: 0, y: 0 }, { x: 100, y: 90 })).toBeNull()
  })

  it('零位移 → null', () => {
    expect(detectSwipe({ x: 50, y: 50 }, { x: 50, y: 50 })).toBeNull()
  })
})
