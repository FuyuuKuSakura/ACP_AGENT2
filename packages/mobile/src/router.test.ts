import { beforeEach, describe, expect, it } from 'vitest'

import { parseHashRoute } from './router.js'

describe('parseHashRoute（hash 路由，刷新可恢复）', () => {
  beforeEach(() => {
    window.location.hash = ''
  })

  it('空 hash 与 #/ 回落首屏列表', () => {
    expect(parseHashRoute('')).toEqual({ name: 'list' })
    expect(parseHashRoute('#/')).toEqual({ name: 'list' })
  })

  it('#/list → 列表', () => {
    expect(parseHashRoute('#/list')).toEqual({ name: 'list' })
  })

  it('#/chat/:id → 对话页（id 解码）', () => {
    expect(parseHashRoute('#/chat/s-1')).toEqual({ name: 'chat', sessionId: 's-1' })
    expect(parseHashRoute(`#/chat/${encodeURIComponent('a/b')}`)).toEqual({
      name: 'chat',
      sessionId: 'a/b',
    })
  })

  it('#/status/:id → 工作状态页', () => {
    expect(parseHashRoute('#/status/s-2')).toEqual({ name: 'status', sessionId: 's-2' })
  })

  it('#/settings → 设置页', () => {
    expect(parseHashRoute('#/settings')).toEqual({ name: 'settings' })
  })

  it('#/pair 与 #/pair/<token> → 配对页', () => {
    expect(parseHashRoute('#/pair')).toEqual({ name: 'pair' })
    expect(parseHashRoute('#/pair/T123')).toEqual({ name: 'pair', pairToken: 'T123' })
  })

  it('缺 id 的 chat/status 与未知路径回落列表', () => {
    expect(parseHashRoute('#/chat')).toEqual({ name: 'list' })
    expect(parseHashRoute('#/status')).toEqual({ name: 'list' })
    expect(parseHashRoute('#/nope')).toEqual({ name: 'list' })
  })
})
