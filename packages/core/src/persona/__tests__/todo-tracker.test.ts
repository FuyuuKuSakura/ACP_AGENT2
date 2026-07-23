/**
 * TodoTracker 测试（architecture.md §5.4；extract/persona.md §5 的结构化事件版）：
 * status 序列推进、tool_call/tool_result 配对（原生 id + FIFO 兜底）、
 * complete 全量收尾、快照仅在变化时返回、digest todoProgress 口径。
 */
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../adapters/types.js'
import { TodoTracker } from '../todo-tracker.js'

const status = (s: string): AgentEvent => ({ type: 'status', status: s as never, detail: '' })
const toolCall = (id: string, name: string): AgentEvent => ({
  type: 'tool_call',
  toolCallId: id,
  name,
  kind: 'other',
  args: {},
  displayTarget: name,
})
const toolResult = (id: string, ok = true): AgentEvent => ({
  type: 'tool_result',
  toolCallId: id,
  ok,
  summary: '',
})
const complete = (): AgentEvent => ({ type: 'complete', status: 'success', artifacts: [] })

describe('TodoTracker status 序列', () => {
  it('新状态把固定顺序中之前的项标记完成并追加新项', () => {
    const t = new TodoTracker()
    const s1 = t.onEvent(status('thinking'))
    expect(s1).toEqual([{ id: 'status:think', text: '思考方案', done: false }])
    expect(t.progress()).toEqual({ done: 0, total: 1 })

    const s2 = t.onEvent(status('executing'))
    expect(s2).toEqual([
      { id: 'status:think', text: '思考方案', done: true },
      { id: 'status:exec', text: '执行操作', done: false },
    ])
    expect(t.progress()).toEqual({ done: 1, total: 2 })

    const s3 = t.onEvent(status('outputting'))
    expect(s3?.map((i) => [i.id, i.done])).toEqual([
      ['status:think', true],
      ['status:exec', true],
      ['status:output', false],
    ])
  })

  it('重复/回退状态按 id 去重；无变化时返回 null', () => {
    const t = new TodoTracker()
    t.onEvent(status('reading_file'))
    // reading_file 再次出现：项已存在且无新完成项 → 无快照
    expect(t.onEvent(status('reading_file'))).toBeNull()
    // thinking 排在 reading_file 之前：追加但不把 read 标完成
    const snap = t.onEvent(status('thinking'))
    expect(snap?.map((i) => [i.id, i.done])).toEqual([
      ['status:read', false],
      ['status:think', false],
    ])
  })

  it('未映射状态与非 todo 事件不产生变化', () => {
    const t = new TodoTracker()
    expect(t.onEvent({ type: 'stream', chunk: 'x', isFinal: false, status: 'outputting', isThinking: false })).toBeNull()
    expect(t.progress()).toEqual({ done: 0, total: 0 })
  })
})

describe('TodoTracker 工具事件', () => {
  it('tool_call 新增「调用 <tool>」项，tool_result 按 toolCallId 配对完成', () => {
    const t = new TodoTracker()
    t.onEvent(toolCall('c1', 'read_file'))
    const snap = t.onEvent(toolCall('c2', 'Bash'))
    expect(snap?.map((i) => i.text)).toEqual(['调用 read_file', '调用 Bash'])
    expect(t.progress()).toEqual({ done: 0, total: 2 })

    const done = t.onEvent(toolResult('c2'))
    expect(done?.find((i) => i.id === 'tool:c2')?.done).toBe(true)
    expect(done?.find((i) => i.id === 'tool:c1')?.done).toBe(false)
    expect(t.progress()).toEqual({ done: 1, total: 2 })
  })

  it('tool_result 无原生 id 配对时按 FIFO 完成最近未闭合工具项', () => {
    const t = new TodoTracker()
    t.onEvent(toolCall('c1', 'read_file'))
    t.onEvent(toolCall('c2', 'edit'))
    const snap = t.onEvent(toolResult('unknown-id'))
    expect(snap?.find((i) => i.id === 'tool:c1')?.done).toBe(true)
    expect(snap?.find((i) => i.id === 'tool:c2')?.done).toBe(false)
  })

  it('重复的 tool_call 去重；对无未闭合项的 tool_result 返回 null', () => {
    const t = new TodoTracker()
    t.onEvent(toolCall('c1', 'read_file'))
    expect(t.onEvent(toolCall('c1', 'read_file'))).toBeNull()
    t.onEvent(toolResult('c1'))
    expect(t.onEvent(toolResult('c1'))).toBeNull()
  })
})

describe('TodoTracker complete 收尾', () => {
  it('complete 把全部项标记完成（回合末终态口径）', () => {
    const t = new TodoTracker()
    t.onEvent(status('thinking'))
    t.onEvent(toolCall('c1', 'Bash'))
    const snap = t.onEvent(complete())
    expect(snap?.every((i) => i.done)).toBe(true)
    expect(t.progress()).toEqual({ done: 2, total: 2 })
    expect(t.onEvent(complete())).toBeNull()
  })
})
