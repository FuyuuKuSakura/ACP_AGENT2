// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientTransport } from '@dionysus/client-core'
import { useDigestStore } from '@dionysus/client-core'
import type { SessionDigestUpdatePayload } from '@dionysus/protocol'

import SidebarApp from './index.js'
import { SessionListItem } from './SessionListItem.js'

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

function seed(...payloads: SessionDigestUpdatePayload[]) {
  for (const p of payloads) useDigestStore.getState().upsertDigest(p)
}

function itemIds(): string[] {
  return [...document.querySelectorAll('[data-testid^="session-item-"]')].map(
    (el) => el.getAttribute('data-testid')!.replace('session-item-', ''),
  )
}

beforeEach(() => {
  useDigestStore.getState().reset()
})
afterEach(cleanup)

describe('SidebarApp 聚合条', () => {
  it('显示运行中 / 待决策 / 已完成计数（Icon 图标 + 数字）', () => {
    seed(
      digest({ sessionId: 'r1', status: 'running' }),
      digest({ sessionId: 'r2', status: 'running' }),
      digest({
        sessionId: 'w1',
        status: 'waiting_option',
        pendingOptionRequest: true,
      }),
      digest({ sessionId: 'd1', status: 'done' }),
      digest({ sessionId: 'i1', status: 'idle' }),
    )
    render(<SidebarApp now={NOW} />)
    const running = screen.getByTestId('aggregate-running')
    const waiting = screen.getByTestId('aggregate-waiting')
    const done = screen.getByTestId('aggregate-done')
    expect(running.textContent).toBe('2 运行中')
    expect(running.querySelector('[data-icon="running"]')).toBeTruthy()
    expect(waiting.textContent).toBe('1 待决策')
    expect(waiting.querySelector('[data-icon="waiting_option"]')).toBeTruthy()
    expect(done.textContent).toBe('1 已完成')
    expect(done.querySelector('[data-icon="done"]')).toBeTruthy()
  })

  it('点击聚合条触发 onFocusCompanion', () => {
    seed(digest({ sessionId: 's1' }))
    const onFocusCompanion = vi.fn()
    render(<SidebarApp now={NOW} onFocusCompanion={onFocusCompanion} />)
    fireEvent.click(screen.getByTestId('aggregate-bar'))
    expect(onFocusCompanion).toHaveBeenCalledTimes(1)
  })
})

describe('SidebarApp 列表排序（selectSortedDigests）', () => {
  it('waiting_option → error → running → idle/done，组内 lastActivityAt 倒序', () => {
    seed(
      digest({
        sessionId: 'idle-old',
        status: 'idle',
        lastActivityAt: NOW - 9000,
      }),
      digest({
        sessionId: 'run-old',
        status: 'running',
        lastActivityAt: NOW - 8000,
      }),
      digest({
        sessionId: 'done-new',
        status: 'done',
        lastActivityAt: NOW - 1000,
      }),
      digest({ sessionId: 'err', status: 'error', lastActivityAt: NOW - 7000 }),
      digest({
        sessionId: 'wait',
        status: 'waiting_option',
        pendingOptionRequest: true,
        lastActivityAt: NOW - 6000,
      }),
      digest({
        sessionId: 'run-new',
        status: 'running',
        lastActivityAt: NOW - 2000,
      }),
      digest({
        sessionId: 'idle-new',
        status: 'idle',
        lastActivityAt: NOW - 3000,
      }),
    )
    render(<SidebarApp now={NOW} />)
    expect(itemIds()).toEqual([
      'wait',
      'err',
      'run-new',
      'run-old',
      'done-new',
      'idle-new',
      'idle-old',
    ])
  })
})

describe('SidebarApp 列表项字段', () => {
  it('状态点五态 class 映射', () => {
    seed(
      digest({ sessionId: 's-idle', status: 'idle' }),
      digest({ sessionId: 's-run', status: 'running' }),
      digest({ sessionId: 's-wait', status: 'waiting_option' }),
      digest({ sessionId: 's-err', status: 'error' }),
      digest({ sessionId: 's-done', status: 'done' }),
    )
    render(<SidebarApp now={NOW} />)
    expect(screen.getByTestId('status-dot-s-idle').className).toContain(
      'dio-dot-idle',
    )
    expect(screen.getByTestId('status-dot-s-run').className).toContain(
      'dio-dot-running',
    )
    expect(screen.getByTestId('status-dot-s-wait').className).toContain(
      'dio-dot-waiting_option',
    )
    expect(screen.getByTestId('status-dot-s-err').className).toContain(
      'dio-dot-error',
    )
    expect(screen.getByTestId('status-dot-s-done').className).toContain(
      'dio-dot-done',
    )
  })

  it('摘要格式：todo 进度优先，无 todo 退化 currentAction', () => {
    seed(
      digest({
        sessionId: 'todo',
        status: 'running',
        currentAction: '正在改 auth.ts',
        todoProgress: { done: 3, total: 7 },
      }),
      digest({
        sessionId: 'act',
        status: 'running',
        currentAction: '正在读取 auth.ts',
      }),
    )
    render(<SidebarApp now={NOW} />)
    expect(screen.getByTestId('summary-todo').textContent).toBe(
      '3/7 · 正在改 auth.ts',
    )
    expect(screen.getByTestId('summary-act').textContent).toBe(
      '正在读取 auth.ts',
    )
  })

  it('相对时间显示（3 分钟前）', () => {
    seed(digest({ sessionId: 's1', lastActivityAt: NOW - 3 * 60_000 }))
    render(<SidebarApp now={NOW} />)
    expect(screen.getByTestId('reltime-s1').textContent).toBe('3 分钟前')
  })

  it('未读角标 = seq - readSeq；无头像图时用首字母色块，有图用 img', () => {
    seed(digest({ sessionId: 's1', title: '重构 auth', seq: 5 }))
    render(
      <SidebarApp now={NOW} avatarUrls={{ s2: 'https://example.com/a.png' }} />,
    )
    expect(screen.getByTestId('unread-badge-s1').textContent).toBe('5')
    expect(screen.getByTestId('avatar-fallback-s1').textContent).toBe('重')
  })

  it('头像 URL 命中时渲染 img', () => {
    seed(digest({ sessionId: 's1', title: '重构 auth' }))
    render(
      <SidebarApp now={NOW} avatarUrls={{ s1: 'https://example.com/a.png' }} />,
    )
    const img = screen.getByTestId('avatar-img-s1') as HTMLImageElement
    expect(img.src).toBe('https://example.com/a.png')
    expect(screen.queryByTestId('avatar-fallback-s1')).toBeNull()
  })

  it('待决策警示角标与未读互斥且优先级更高', () => {
    seed(
      digest({
        sessionId: 's1',
        status: 'waiting_option',
        pendingOptionRequest: true,
        seq: 4,
      }),
    )
    render(<SidebarApp now={NOW} />)
    const badge = screen.getByTestId('pending-badge-s1')
    expect(badge.querySelector('[data-icon="waiting_option"]')).toBeTruthy()
    expect(screen.queryByTestId('unread-badge-s1')).toBeNull()
  })
})

describe('SidebarApp 交互', () => {
  it('点击列表项：markSessionRead 清零未读 + 回调 onSelectSession', () => {
    seed(digest({ sessionId: 's1', seq: 3 }))
    const onSelectSession = vi.fn()
    render(<SidebarApp now={NOW} onSelectSession={onSelectSession} />)
    fireEvent.click(screen.getByTestId('session-item-s1'))
    expect(onSelectSession).toHaveBeenCalledWith('s1')
    const entry = useDigestStore.getState().digests.s1
    expect(entry.readSeq).toBe(3)
    expect(screen.queryByTestId('unread-badge-s1')).toBeNull()
  })

  it('点击「新建会话」：transport 发 new_session + 回调 onNewSession', () => {
    const send = vi.fn()
    const transport: ClientTransport = { send, onMessage: vi.fn() }
    const onNewSession = vi.fn()
    render(
      <SidebarApp
        now={NOW}
        transport={transport}
        onNewSession={onNewSession}
      />,
    )
    fireEvent.click(screen.getByTestId('new-session-button'))
    // 挂载时会发 persona_list_request（列表项 title 数据源），此处只关心 new_session
    const msgs = (send.mock.calls.map((c) => c[0]) as { type: string; ts?: unknown }[]).filter(
      (m) => m.type === 'new_session',
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ v: 1, type: 'new_session', payload: {} })
    expect(typeof msgs[0].ts).toBe('number')
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })

  it('空列表显示占位文案', () => {
    render(<SidebarApp now={NOW} />)
    expect(screen.getByTestId('session-list-empty')).toBeTruthy()
  })

  it('digest 更新驱动重渲染（数据来自 digestStore）', () => {
    seed(digest({ sessionId: 's1', status: 'idle', title: '旧标题' }))
    render(<SidebarApp now={NOW} />)
    act(() => {
      useDigestStore
        .getState()
        .upsertDigest(
          digest({
            sessionId: 's1',
            status: 'running',
            title: '旧标题',
            currentAction: '正在跑测试',
            seq: 2,
          }),
        )
    })
    expect(screen.getByTestId('summary-s1').textContent).toBe('正在跑测试')
    expect(screen.getByTestId('status-dot-s1').className).toContain(
      'dio-dot-running',
    )
  })
})

describe('SessionListItem adapter 徽标（ux-core-flows §2.2 第八字段）', () => {
  const base = {
    sessionId: 's1',
    title: '重构 auth',
    status: 'idle' as const,
    pendingOptionRequest: false,
    lastActivityAt: NOW,
    seq: 1,
    readSeq: 1,
  }

  it('有 adapterId 时头像右下角渲染首字母徽标（title 标全名）', () => {
    render(
      <SessionListItem digest={{ ...base, adapterId: 'kimi_cli' }} now={NOW} />,
    )
    const badge = screen.getByTestId('adapter-badge-s1')
    expect(badge.textContent).toBe('K')
    expect(badge.getAttribute('title')).toBe('kimi_cli')
  })

  it('有头像图时徽标同样渲染', () => {
    render(
      <SessionListItem
        digest={{ ...base, adapterId: 'claude_cli' }}
        avatarUrl="https://example.com/a.png"
        now={NOW}
      />,
    )
    expect(screen.getByTestId('avatar-img-s1')).toBeTruthy()
    expect(screen.getByTestId('adapter-badge-s1').textContent).toBe('C')
  })

  it('无 adapterId 时不渲染徽标', () => {
    render(<SessionListItem digest={base} now={NOW} />)
    expect(screen.queryByTestId('adapter-badge-s1')).toBeNull()
  })
})
