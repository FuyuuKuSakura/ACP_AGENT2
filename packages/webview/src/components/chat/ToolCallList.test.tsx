// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { selectStreamState, useStreamStore } from '@dionysus/client-core'
import type { ToolCallPayload } from '@dionysus/protocol'

import { envelope, resetAllStores, serverMsg } from './testUtils.js'
import { ToolCallList } from './ToolCallList.js'

const SID = 's1'

afterEach(cleanup)
beforeEach(resetAllStores)

function Harness() {
  const stream = useStreamStore((s) => selectStreamState(s, SID))
  return <ToolCallList toolCalls={stream?.toolCalls ?? []} />
}

function toolCall(
  payload: Partial<ToolCallPayload> &
    Pick<ToolCallPayload, 'toolCallId' | 'name'>,
) {
  serverMsg(
    envelope(
      'tool_call',
      { kind: 'read', args: {}, displayTarget: '', ...payload },
      { sessionId: SID, turnId: 't1' },
    ),
  )
}

describe('ToolCallList（tool_call 卡片）', () => {
  it('L1 自然语言动作按 kind 模板渲染，不渲染工具原名', () => {
    render(<Harness />)
    act(() => {
      toolCall({
        toolCallId: 'c1',
        name: 'read_file',
        kind: 'read',
        displayTarget: 'auth.ts',
      })
      toolCall({
        toolCallId: 'c2',
        name: 'edit',
        kind: 'edit',
        displayTarget: 'login.tsx',
      })
      toolCall({
        toolCallId: 'c3',
        name: 'Bash',
        kind: 'bash',
        displayTarget: 'pnpm test',
      })
    })
    const cards = screen.getAllByTestId('tool-call-card')
    expect(cards).toHaveLength(3)
    expect(cards[0].textContent).toContain('正在读取文件')
    expect(cards[0].textContent).toContain('auth.ts')
    expect(cards[1].textContent).toContain('正在修改')
    expect(cards[1].getAttribute('data-kind')).toBe('edit')
    expect(cards[2].textContent).toContain('正在运行')
    expect(cards[2].getAttribute('data-status')).toBe('running')
    // kind → 图标映射
    expect(cards[0].querySelector('[data-icon="tool-read"]')).toBeTruthy()
    expect(cards[1].querySelector('[data-icon="tool-edit"]')).toBeTruthy()
    expect(cards[2].querySelector('[data-icon="tool-bash"]')).toBeTruthy()
    // 不直接渲染工具原名
    expect(cards[0].textContent).not.toContain('read_file')
  })

  it('卡片左侧 2px 引导线随 kind 着色（endfield minimal 几何点缀）', () => {
    render(<Harness />)
    act(() => {
      toolCall({ toolCallId: 'c1', name: 'read_file', kind: 'read', displayTarget: 'a.ts' })
      toolCall({ toolCallId: 'c2', name: 'edit', kind: 'edit', displayTarget: 'b.ts' })
      toolCall({ toolCallId: 'c3', name: 'Bash', kind: 'bash', displayTarget: 'pnpm test' })
    })
    const cards = screen.getAllByTestId('tool-call-card')
    expect(cards[0].className).toContain('shadow-[inset_2px_0_0_var(--dn-border)]')
    expect(cards[1].className).toContain('shadow-[inset_2px_0_0_var(--dn-accent)]')
    expect(cards[2].className).toContain('shadow-[inset_2px_0_0_var(--dn-attention)]')
  })

  it('tool_result 到达后配对折叠为单卡，显示耗时', () => {
    render(<Harness />)
    act(() =>
      toolCall({
        toolCallId: 'c1',
        name: 'Bash',
        kind: 'bash',
        displayTarget: 'npm test',
      }),
    )
    act(() => {
      serverMsg(
        envelope(
          'tool_result',
          { toolCallId: 'c1', ok: true, summary: '全部通过', durationMs: 1200 },
          { sessionId: SID },
        ),
      )
    })
    // 仍是一张卡（配对折叠），状态转 ok 且显示耗时
    const cards = screen.getAllByTestId('tool-call-card')
    expect(cards).toHaveLength(1)
    expect(cards[0].getAttribute('data-status')).toBe('ok')
    expect(cards[0].textContent).toContain('1.2s')
  })

  it('失败的 tool_result 标红（data-status=error）', () => {
    render(<Harness />)
    act(() =>
      toolCall({
        toolCallId: 'c1',
        name: 'edit',
        kind: 'edit',
        displayTarget: 'a.ts',
      }),
    )
    act(() => {
      serverMsg(
        envelope(
          'tool_result',
          { toolCallId: 'c1', ok: false, summary: '写入失败', durationMs: 30 },
          { sessionId: SID },
        ),
      )
    })
    const card = screen.getByTestId('tool-call-card')
    expect(card.getAttribute('data-status')).toBe('error')
    expect(card.querySelector('[data-icon="error"]')).toBeTruthy()
  })

  it('详情默认折叠，展开后可见原始参数与结果摘要', () => {
    render(<Harness />)
    act(() =>
      toolCall({
        toolCallId: 'c1',
        name: 'read_file',
        kind: 'read',
        displayTarget: 'auth.ts',
        args: { path: 'src/auth.ts' },
      }),
    )
    expect(screen.queryByText('参数')).toBeNull()
    const toggle = screen.getByRole('button', { name: '展开详情' })
    act(() => toggle.click())
    expect(screen.getByText('参数')).toBeTruthy()
    expect(screen.getByText(/src\/auth\.ts/)).toBeTruthy()
  })
})
