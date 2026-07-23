// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { selectStreamState, useStreamStore } from '@dionysus/client-core'

import { envelope, resetAllStores, serverMsg } from './testUtils.js'
import { StreamingView } from './StreamingView.js'

const SID = 's1'

afterEach(cleanup)
beforeEach(resetAllStores)

/** 订阅 store 的测试壳：流式追加经真实 dispatch 链路驱动。 */
function Harness() {
  const stream = useStreamStore((s) => selectStreamState(s, SID))
  if (!stream) return null
  return <StreamingView stream={stream} />
}

function streamChunk(chunk: string, isThinking = false) {
  serverMsg(
    envelope(
      'agent_stream',
      { chunk, isFinal: false, status: 'outputting', isThinking },
      { sessionId: SID, turnId: 't1' },
    ),
  )
}

describe('StreamingView', () => {
  it('agent_stream chunk 实时追加显示', () => {
    render(<Harness />)
    expect(screen.queryByTestId('streaming-text')).toBeNull()
    act(() => streamChunk('你好'))
    expect(screen.getByTestId('streaming-text').textContent).toContain('你好')
    act(() => streamChunk('，世界'))
    expect(screen.getByTestId('streaming-text').textContent).toContain('你好，世界')
  })

  it('thinking 区域默认折叠，点击展开原文', () => {
    render(<Harness />)
    act(() => streamChunk('让我想想……', true))
    const toggle = screen.getByRole('button', { name: /思考过程/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('让我想想……')).toBeNull()
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('让我想想……')).toBeTruthy()
  })

  it('status_update 显示流式状态行', () => {
    render(<Harness />)
    act(() => {
      serverMsg(
        envelope(
          'status_update',
          { status: 'reading_file', detail: '正在读 auth.ts' },
          { sessionId: SID },
        ),
      )
      streamChunk('x')
    })
    expect(screen.getByTestId('streaming-status').textContent).toContain('正在读 auth.ts')
  })

  it('agent_complete 后流式区清空（正文提交进消息流）', () => {
    render(<Harness />)
    act(() => streamChunk('完整回答'))
    act(() => {
      serverMsg(
        envelope(
          'agent_complete',
          { status: 'success', artifacts: [] },
          { sessionId: SID, turnId: 't1' },
        ),
      )
    })
    expect(screen.queryByTestId('streaming-text')).toBeNull()
  })
})
