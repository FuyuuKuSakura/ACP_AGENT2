/**
 * streamStore 关键行为：tool_call 配对折叠、finalizeTurn 幂等、选项组竞态解决。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { ToolCallPayload } from '@dionysus/protocol'

import { selectOpenToolCallCount, useStreamStore } from './streamStore.js'

function toolCall(id: string): ToolCallPayload {
  return { toolCallId: id, name: 'Bash', kind: 'bash', args: {}, displayTarget: 'npm test' }
}

describe('streamStore tool_call 配对折叠', () => {
  beforeEach(() => {
    useStreamStore.getState().reset()
  })

  it('tool_result 按 toolCallId 配对，结果挂到同一条目（折叠为单卡，不新增条目）', () => {
    const s = useStreamStore.getState()
    s.addToolCall('s1', toolCall('tc1'), 't1')
    s.addToolCall('s1', toolCall('tc2'), 't1')
    s.resolveToolCall('s1', { toolCallId: 'tc1', ok: true, summary: 'ok', durationMs: 5 })

    const st = useStreamStore.getState().bySession.s1
    expect(st.toolCalls).toHaveLength(2)
    expect(st.toolCalls[0].result).toEqual({ ok: true, summary: 'ok', durationMs: 5 })
    expect(st.toolCalls[1].result).toBeUndefined()
    expect(selectOpenToolCallCount(useStreamStore.getState(), 's1')).toBe(1)
  })

  it('toolCallId 无匹配时 FIFO 配对最近一个未闭合条目', () => {
    const s = useStreamStore.getState()
    s.addToolCall('s1', toolCall('tc1'))
    s.addToolCall('s1', toolCall('tc2'))
    s.resolveToolCall('s1', { toolCallId: 'unknown', ok: false, summary: 'fail' })

    const st = useStreamStore.getState().bySession.s1
    expect(st.toolCalls[0].result).toBeUndefined()
    expect(st.toolCalls[1].result).toMatchObject({ ok: false, summary: 'fail' })
  })

  it('全部闭合后迟到结果静默忽略', () => {
    const s = useStreamStore.getState()
    s.addToolCall('s1', toolCall('tc1'))
    s.resolveToolCall('s1', { toolCallId: 'tc1', ok: true, summary: 'a' })
    s.resolveToolCall('s1', { toolCallId: 'tc1', ok: true, summary: 'b' })
    expect(useStreamStore.getState().bySession.s1.toolCalls[0].result?.summary).toBe('a')
  })

  it('多会话工具调用按 sessionId 隔离', () => {
    const s = useStreamStore.getState()
    s.addToolCall('s1', toolCall('tc1'))
    s.addToolCall('s2', toolCall('tc2'))
    s.resolveToolCall('s2', { toolCallId: 'tc2', ok: true, summary: 'ok' })
    const state = useStreamStore.getState()
    expect(selectOpenToolCallCount(state, 's1')).toBe(1)
    expect(selectOpenToolCallCount(state, 's2')).toBe(0)
  })
})

describe('streamStore 回合收尾与幂等', () => {
  beforeEach(() => {
    useStreamStore.getState().reset()
  })

  it('finalizeTurn 返回累积文本并重置流式态', () => {
    const s = useStreamStore.getState()
    s.appendStream('s1', 'hello ', { isThinking: false, status: 'outputting' })
    s.appendStream('s1', '在想', { isThinking: true, status: 'thinking' })
    s.appendStream('s1', 'world', { isThinking: false, status: 'outputting' })

    const r = useStreamStore.getState().finalizeTurn('s1', 't1')
    expect(r).toEqual({ applied: true, text: 'hello world', thinking: '在想' })
    const st = useStreamStore.getState().bySession.s1
    expect(st.isStreaming).toBe(false)
    expect(st.streamText).toBe('')
  })

  it('同 turnId 的重复 agent_complete 幂等忽略（v2 双 complete 回归）', () => {
    const s = useStreamStore.getState()
    s.appendStream('s1', 'x', { isThinking: false, status: 'outputting' })
    expect(useStreamStore.getState().finalizeTurn('s1', 't1').applied).toBe(true)
    const dup = useStreamStore.getState().finalizeTurn('s1', 't1')
    expect(dup.applied).toBe(false)
    // 新 turnId 不受影响
    expect(useStreamStore.getState().finalizeTurn('s1', 't2').applied).toBe(true)
  })

  it('回合结束清除待决选项组', () => {
    const s = useStreamStore.getState()
    s.showOptions('s1', {
      requestTraceId: 'tr-1',
      question: 'q',
      options: [],
      uiType: 'button_group',
      timeoutSeconds: 60,
    })
    useStreamStore.getState().finalizeTurn('s1', 't1')
    expect(useStreamStore.getState().bySession.s1.optionGroup).toBeNull()
  })
})

describe('streamStore 选项组竞态解决', () => {
  beforeEach(() => {
    useStreamStore.getState().reset()
  })

  it('resolveOptions 置已决态；重复解决幂等忽略', () => {
    const s = useStreamStore.getState()
    s.showOptions('s1', {
      requestTraceId: 'tr-1',
      question: 'q',
      options: [{ id: 'y', label: '是' }],
      uiType: 'button_group',
      timeoutSeconds: 60,
    })
    s.resolveOptions('s1', 'tr-1', 'y', 'mobile')
    let g = useStreamStore.getState().bySession.s1.optionGroup
    expect(g?.resolved).toEqual({ selectedId: 'y', origin: 'mobile' })

    useStreamStore.getState().resolveOptions('s1', 'tr-1', 'n', 'desktop')
    g = useStreamStore.getState().bySession.s1.optionGroup
    expect(g?.resolved?.selectedId).toBe('y') // 首个解决生效（竞态）
  })

  it('requestTraceId 不匹配时不解决', () => {
    const s = useStreamStore.getState()
    s.showOptions('s1', {
      requestTraceId: 'tr-1',
      question: 'q',
      options: [],
      uiType: 'button_group',
      timeoutSeconds: 60,
    })
    s.resolveOptions('s1', 'tr-other', 'y', 'mobile')
    expect(useStreamStore.getState().bySession.s1.optionGroup?.resolved).toBeUndefined()
  })
})
