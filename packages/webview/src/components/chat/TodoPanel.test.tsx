// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TodoPanel } from './TodoPanel.js'
import { envelope, resetAllStores, serverMsg } from './testUtils.js'

const SID = 's1'

afterEach(cleanup)
beforeEach(resetAllStores)

/** 注入 todo_update 全量快照（走真实 messageRouter + dispatch 链路）。 */
function todoUpdate(items: Array<{ id: string; text: string; done: boolean }>) {
  serverMsg(envelope('todo_update', { items }, { sessionId: SID }))
}

/** 让会话进入流式进行中态（isStreaming=true，「进行中」高亮的前提）。 */
function startStreaming() {
  serverMsg(
    envelope(
      'agent_stream',
      { chunk: '处理中', isFinal: false, status: 'executing', isThinking: false },
      { sessionId: SID, turnId: 't1' },
    ),
  )
}

describe('TodoPanel', () => {
  it('空态：无 todo 数据时不渲染（老会话/无工具回合不占空间）', () => {
    render(<TodoPanel sessionId={SID} />)
    expect(screen.queryByTestId('todo-panel')).toBeNull()
  })

  it('默认折叠为一行进度摘要，与 digest.todoProgress 同源口径', () => {
    render(<TodoPanel sessionId={SID} />)
    act(() => {
      startStreaming()
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Read', done: false },
        { id: 'tool:tc2', text: '调用 Edit', done: false },
      ])
    })
    const panel = screen.getByTestId('todo-panel')
    expect(panel.getAttribute('data-expanded')).toBe('false')
    expect(screen.getByTestId('todo-panel-summary').textContent).toBe(
      '1/3 步已完成 · 正在：调用 Read',
    )
    // 折叠态不渲染完整清单
    expect(screen.queryByTestId('todo-panel-list')).toBeNull()
  })

  it('点击展开完整清单：序号 + 状态图标 + 标题；再点击折叠', () => {
    render(<TodoPanel sessionId={SID} />)
    act(() => {
      startStreaming()
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Read', done: false },
        { id: 'tool:tc2', text: '调用 Edit', done: false },
      ])
    })
    fireEvent.click(screen.getByTestId('todo-panel-toggle'))
    const list = screen.getByTestId('todo-panel-list')
    expect(screen.getByTestId('todo-panel').getAttribute('data-expanded')).toBe('true')
    // 序号 + 标题
    expect(list.textContent).toContain('1.')
    expect(list.textContent).toContain('思考方案')
    expect(list.textContent).toContain('调用 Edit')
    // 状态：已完成 / 进行中 / 待办
    expect(screen.getByTestId('todo-item-0').getAttribute('data-status')).toBe('done')
    expect(screen.getByTestId('todo-item-1').getAttribute('data-status')).toBe('active')
    expect(screen.getByTestId('todo-item-2').getAttribute('data-status')).toBe('pending')
    // Icon 体系图标（data-icon 断言身份，禁 emoji）
    expect(screen.getByTestId('todo-item-0').querySelector('[data-icon="done"]')).toBeTruthy()
    expect(screen.getByTestId('todo-item-1').querySelector('[data-icon="running"]')).toBeTruthy()
    expect(screen.getByTestId('todo-item-2').querySelector('[data-icon="checkbox"]')).toBeTruthy()
    // 再点击折叠回一行摘要
    fireEvent.click(screen.getByTestId('todo-panel-toggle'))
    expect(screen.queryByTestId('todo-panel-list')).toBeNull()
    expect(screen.getByTestId('todo-panel-summary')).toBeTruthy()
  })

  it('进行中步骤独享呼吸动效高亮（dn-breathe）', () => {
    render(<TodoPanel sessionId={SID} />)
    act(() => {
      startStreaming()
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Read', done: false },
      ])
    })
    fireEvent.click(screen.getByTestId('todo-panel-toggle'))
    const active = screen.getByTestId('todo-item-1')
    expect(active.querySelector('.dn-breathe')).toBeTruthy()
    expect(screen.getByTestId('todo-item-0').querySelector('.dn-breathe')).toBeNull()
  })

  it('回合结束保留终态：全部打勾，面板不消失且无呼吸高亮', () => {
    render(<TodoPanel sessionId={SID} />)
    act(() => {
      startStreaming()
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Read', done: false },
      ])
    })
    act(() => {
      // complete：core TodoTracker 会把全部项标完成后发终态快照
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Read', done: true },
      ])
      serverMsg(
        envelope('agent_complete', { status: 'success', artifacts: [] }, { sessionId: SID, turnId: 't1' }),
      )
    })
    // 面板保留终态
    expect(screen.getByTestId('todo-panel-summary').textContent).toBe('2/2 步已完成')
    fireEvent.click(screen.getByTestId('todo-panel-toggle'))
    expect(screen.getByTestId('todo-item-0').getAttribute('data-status')).toBe('done')
    expect(screen.getByTestId('todo-item-1').getAttribute('data-status')).toBe('done')
    expect(document.querySelector('.dn-breathe')).toBeNull()
  })

  it('工具失败步：tool_result ok=false 反查标注失败（tracker 一律标 done，UI 覆盖）', () => {
    render(<TodoPanel sessionId={SID} />)
    act(() => {
      serverMsg(
        envelope(
          'tool_call',
          {
            toolCallId: 'tc1',
            name: 'Edit',
            kind: 'edit',
            args: { path: 'auth.ts' },
            displayTarget: 'auth.ts',
          },
          { sessionId: SID, turnId: 't1' },
        ),
      )
      serverMsg(
        envelope(
          'tool_result',
          { toolCallId: 'tc1', ok: false, summary: '写入被拒绝', durationMs: 12 },
          { sessionId: SID, turnId: 't1' },
        ),
      )
      // tracker 收到 tool_result 一律标 done（不区分 ok），失败态由 UI 反查
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Edit', done: true },
        { id: 'tool:tc2', text: '调用 Bash', done: false },
      ])
    })
    // 非流式且无进行中项时，摘要标注失败步数
    expect(screen.getByTestId('todo-panel-summary').textContent).toBe('2/3 步已完成 · 1 步失败')
    fireEvent.click(screen.getByTestId('todo-panel-toggle'))
    const failed = screen.getByTestId('todo-item-1')
    expect(failed.getAttribute('data-status')).toBe('failed')
    expect(failed.querySelector('[data-icon="error"]')).toBeTruthy()
    expect(failed.querySelector('svg[role="img"] title')?.textContent).toBe('失败')
  })

  it('非流式时未完成项显示待办而非进行中（无呼吸高亮）', () => {
    render(<TodoPanel sessionId={SID} />)
    act(() => {
      // 直接注入快照，未进入流式态（如同步迟到/历史回放）
      todoUpdate([
        { id: 'status:think', text: '思考方案', done: true },
        { id: 'tool:tc1', text: '调用 Read', done: false },
      ])
    })
    expect(screen.getByTestId('todo-panel-summary').textContent).toBe('1/2 步已完成')
    fireEvent.click(screen.getByTestId('todo-panel-toggle'))
    expect(screen.getByTestId('todo-item-1').getAttribute('data-status')).toBe('pending')
    expect(document.querySelector('.dn-breathe')).toBeNull()
  })
})
