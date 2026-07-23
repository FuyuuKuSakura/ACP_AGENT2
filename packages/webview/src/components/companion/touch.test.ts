import { describe, expect, it } from 'vitest'

import { HEAD_ZONE_RATIO, hitZoneFromPoint, pickTouchReaction } from './touch.js'

describe('hitZoneFromPoint', () => {
  it('顶部阈值内为 head，其余为 body', () => {
    expect(hitZoneFromPoint(0)).toBe('head')
    expect(hitZoneFromPoint(HEAD_ZONE_RATIO - 0.01)).toBe('head')
    expect(hitZoneFromPoint(HEAD_ZONE_RATIO)).toBe('body')
    expect(hitZoneFromPoint(0.9)).toBe('body')
  })
})

describe('pickTouchReaction（ADR-16 纯前端选句）', () => {
  const zones = {
    head: { expression: '惊讶', lines: ['博士，有事吗？', '不要碰我的耳朵。'] },
    body: { expression: '烦躁', lines: ['……请注意分寸。'] },
  }

  it('从对应 zone 的 lines 随机选句并带 expression', () => {
    const r = pickTouchReaction(zones, 'head', () => 0.99)
    expect(r).toEqual({ line: '不要碰我的耳朵。', expression: '惊讶' })
    const r2 = pickTouchReaction(zones, 'head', () => 0)
    expect(r2).toEqual({ line: '博士，有事吗？', expression: '惊讶' })
  })

  it('zone 未配置 / lines 为空 / touch_zones 缺失 → null（缺失容错）', () => {
    expect(pickTouchReaction(zones, 'body' as never, () => 0)).toEqual({
      line: '……请注意分寸。',
      expression: '烦躁',
    })
    expect(pickTouchReaction({}, 'head', () => 0)).toBeNull()
    expect(pickTouchReaction({ head: { lines: [] } }, 'head', () => 0)).toBeNull()
  })
})
