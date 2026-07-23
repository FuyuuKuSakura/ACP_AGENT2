/**
 * 工作状态全屏页测试（视觉验收 M1/M2 回归防线）：
 * 头部状态中文映射（不裸 protocol 枚举）、操作时间线复用 KIND_VERB
 * 自然语言化（不直渲工具原名）、todo/结果标记走 Icon 体系。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  useCompanionStore,
  useDigestStore,
  useSessionStore,
  useStreamStore,
} from '@dionysus/client-core'
import type { SessionDigestUpdatePayload } from '@dionysus/protocol'

import { StatusScreen } from './StatusScreen.js'

function digest(
  sessionId: string,
  over: Partial<SessionDigestUpdatePayload> = {},
): SessionDigestUpdatePayload {
  return {
    sessionId,
    title: sessionId,
    status: 'idle',
    pendingOptionRequest: false,
    lastActivityAt: 1_800_000_000_000,
    seq: 1,
    ...over,
  }
}

beforeEach(() => {
  useSessionStore.getState().reset()
  useStreamStore.getState().reset()
  useDigestStore.getState().reset()
  useCompanionStore.getState().reset()
})

afterEach(cleanup)

describe('StatusScreen', () => {
  it('头部状态显示中文文案（running → 进行中，不裸枚举）', () => {
    useDigestStore.getState().upsertDigest(digest('s1', { status: 'running' }))
    render(<StatusScreen sessionId="s1" />)
    expect(screen.getByTestId('status-header-label').textContent).toBe('进行中')
  })

  it('操作时间线自然语言化（KIND_VERB + 目标，不直渲工具原名）', () => {
    const streams = useStreamStore.getState()
    streams.addToolCall('s1', {
      toolCallId: 't1',
      name: 'read_file',
      kind: 'read',
      args: {},
      displayTarget: 'token.ts',
    })
    streams.addToolCall('s1', {
      toolCallId: 't2',
      name: 'Bash',
      kind: 'bash',
      args: {},
      displayTarget: 'pnpm test',
    })
    streams.resolveToolCall('s1', { toolCallId: 't1', ok: true, summary: 'ok' })
    streams.resolveToolCall('s1', { toolCallId: 't2', ok: false, summary: 'exit 1' })
    render(<StatusScreen sessionId="s1" />)
    const first = screen.getByTestId('timeline-item-0')
    expect(first.textContent).toContain('读')
    expect(first.textContent).toContain('token.ts')
    expect(first.textContent).not.toContain('read_file')
    const second = screen.getByTestId('timeline-item-1')
    expect(second.textContent).toContain('跑')
    expect(second.textContent).not.toContain('Bash')
    // 结果标记走 Icon 体系（✓/✕ 已移除）
    expect(first.querySelector('[data-icon="done"]')).toBeTruthy()
    expect(second.querySelector('[data-icon="error"]')).toBeTruthy()
  })

  it('todo 完成态用 checkbox Icon（☑/☐ 已移除）', () => {
    useStreamStore.getState().setTodoItems('s1', [
      { id: '1', text: '重写 token.ts', done: true },
      { id: '2', text: '补测试', done: false },
    ])
    render(<StatusScreen sessionId="s1" />)
    const section = screen.getByTestId('status-todo')
    expect(section.querySelector('[data-icon="checkbox-checked"]')).toBeTruthy()
    expect(section.querySelector('[data-icon="checkbox"]')).toBeTruthy()
  })
})
