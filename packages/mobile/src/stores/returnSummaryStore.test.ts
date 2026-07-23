/**
 * 归来摘要识别测试（§6.3）：模板前缀命中 + 重连窗口内首条 global 播报；
 * 普通 session 级播报不误判；命中后关窗。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { CompanionMessageMessage } from '@dionysus/protocol'

import {
  detectReturnSummary,
  noteReconnected,
  RETURN_SUMMARY_WINDOW_MS,
  useReturnSummaryStore,
} from './returnSummaryStore.js'

function companion(
  text: string,
  scope: 'session' | 'global' = 'global',
): CompanionMessageMessage {
  return { v: 1, type: 'companion_message', ts: Date.now(), payload: { text, scope } }
}

beforeEach(() => {
  useReturnSummaryStore.getState().reset()
  // 关掉窗口（noteReconnected(0) 不算；用一个极旧时间使窗口过期）
  noteReconnected(1)
})

describe('detectReturnSummary', () => {
  it('「你离开期间」前缀的 global 播报 → 落卡', () => {
    const hit = detectReturnSummary(companion('你离开期间：会话 A 完成 1 回合（成功）'))
    expect(hit).toBe(true)
    expect(useReturnSummaryStore.getState().card?.text).toContain('你离开期间')
  })

  it('重连窗口内的首条 global 播报 → 落卡并关窗', () => {
    noteReconnected()
    expect(detectReturnSummary(companion('会话 B 在等待你确认选项'))).toBe(true)
    // 窗口已关：后续普通播报不再覆盖摘要卡
    expect(detectReturnSummary(companion('又一条普通播报'))).toBe(false)
    expect(useReturnSummaryStore.getState().card?.text).toContain('等待你确认选项')
  })

  it('窗口过期后普通播报不落卡', () => {
    noteReconnected(Date.now() - RETURN_SUMMARY_WINDOW_MS - 1)
    expect(detectReturnSummary(companion('普通播报'))).toBe(false)
    expect(useReturnSummaryStore.getState().card).toBeNull()
  })

  it('session 级播报永不当作归来摘要', () => {
    expect(
      detectReturnSummary(companion('你离开期间也不该算', 'session')),
    ).toBe(false)
  })

  it('dismiss 清空卡片', () => {
    useReturnSummaryStore.getState().show('你离开期间：…', 1)
    useReturnSummaryStore.getState().dismiss()
    expect(useReturnSummaryStore.getState().card).toBeNull()
  })
})
