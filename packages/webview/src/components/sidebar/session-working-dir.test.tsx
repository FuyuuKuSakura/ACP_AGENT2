// @vitest-environment jsdom
/**
 * sidebar 会话工作目录 UI 测试：
 * - 列表项 title 属性展示工作目录（digest.workingDir 透传）；
 * - 「目录」面板：手输路径 → new_session 携带 workingDir；
 * - 「选择目录…」→ working_dir_pick_request，响应经 traceId 回填输入框。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDigestStore } from '@dionysus/client-core'
import type { SessionDigestUpdatePayload } from '@dionysus/protocol'

import SidebarApp from './index.js'
import { FakeTransport, resetAllStores } from '../chat/testUtils.js'

const NOW = 1_000_000_000_000

function digest(
  partial: Partial<SessionDigestUpdatePayload> & { sessionId: string },
): SessionDigestUpdatePayload {
  return {
    title: partial.sessionId,
    status: 'idle',
    pendingOptionRequest: false,
    lastActivityAt: NOW,
    seq: 1,
    ...partial,
  }
}

beforeEach(() => {
  resetAllStores()
})
afterEach(cleanup)

describe('会话列表项工作目录展示', () => {
  it('digest 带 workingDir：列表项 title 属性展示；不带则无 title', () => {
    useDigestStore.getState().upsertDigest(digest({ sessionId: 's1', workingDir: '/proj/a' }))
    useDigestStore.getState().upsertDigest(digest({ sessionId: 's2' }))
    render(<SidebarApp now={NOW} />)

    expect(screen.getByTestId('session-item-s1').getAttribute('title')).toBe('工作目录：/proj/a')
    expect(screen.getByTestId('session-item-s2').getAttribute('title')).toBeNull()
  })
})

describe('新建会话「选择工作目录」面板', () => {
  it('手输路径 → new_session 携带 workingDir；面板关闭', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-dir-button'))
    fireEvent.change(screen.getByTestId('new-session-dir-input'), { target: { value: '/proj/a' } })
    fireEvent.click(screen.getByTestId('new-session-dir-submit'))

    const msgs = transport.ofType('new_session')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].payload).toEqual({ workingDir: '/proj/a' })
    expect(screen.queryByTestId('new-session-dir-panel')).toBeNull()
  })

  it('留空提交 → new_session 不带 workingDir（跟随默认目录）', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-dir-button'))
    fireEvent.click(screen.getByTestId('new-session-dir-submit'))

    expect(transport.ofType('new_session')[0].payload).toEqual({})
  })

  it('「选择目录…」发 working_dir_pick_request，响应经 traceId 回填输入框', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-dir-button'))
    fireEvent.click(screen.getByTestId('pick-dir-button'))

    const picks = transport.ofType('working_dir_pick_request')
    expect(picks).toHaveLength(1)
    expect(picks[0].traceId).toBe('sidebar:working-dir-pick')

    act(() => {
      transport.emit({
        v: 1,
        type: 'working_dir_pick_response',
        traceId: 'sidebar:working-dir-pick',
        ts: Date.now(),
        payload: { path: '/picked/dir', canceled: false },
      })
    })
    expect((screen.getByTestId('new-session-dir-input') as HTMLInputElement).value).toBe('/picked/dir')

    // 回填后新建：workingDir 随会话发出
    fireEvent.click(screen.getByTestId('new-session-dir-submit'))
    expect(transport.ofType('new_session')[0].payload).toEqual({ workingDir: '/picked/dir' })
  })

  it('用户取消选择（canceled）→ 输入框不变', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-dir-button'))
    fireEvent.change(screen.getByTestId('new-session-dir-input'), { target: { value: '/keep' } })
    fireEvent.click(screen.getByTestId('pick-dir-button'))
    act(() => {
      transport.emit({
        v: 1,
        type: 'working_dir_pick_response',
        traceId: 'sidebar:working-dir-pick',
        ts: Date.now(),
        payload: { canceled: true },
      })
    })
    expect((screen.getByTestId('new-session-dir-input') as HTMLInputElement).value).toBe('/keep')
  })
})
