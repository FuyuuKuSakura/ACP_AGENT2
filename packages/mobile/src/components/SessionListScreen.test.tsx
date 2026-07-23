/**
 * 首屏会话状态列表渲染测试（P0 门禁，ux-core-flows.md §2.2 同规格）：
 * 状态点/未读角标/待决策警示标/摘要 `3/7 · 动作`/顶部聚合条三段/排序/
 * 归来摘要卡/adapter 徽标。
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  useCompanionStore,
  useDigestStore,
  useSessionStore,
  useStreamStore,
  type ClientTransport,
  type DigestEntry,
} from '@dionysus/client-core'
import type { SessionDigestUpdatePayload } from '@dionysus/protocol'

import { useConnectionStore } from '../stores/connectionStore.js'
import { usePersonaStore } from '../stores/personaStore.js'
import { useReturnSummaryStore } from '../stores/returnSummaryStore.js'
import { SessionListScreen } from './SessionListScreen.js'

const NOW = 1_800_000_000_000

function digest(
  sessionId: string,
  over: Partial<SessionDigestUpdatePayload> = {},
): SessionDigestUpdatePayload {
  return {
    sessionId,
    title: sessionId,
    status: 'idle',
    pendingOptionRequest: false,
    lastActivityAt: NOW - 60_000,
    seq: 1,
    ...over,
  }
}

const transport: ClientTransport = { send() {}, onMessage() {} }

beforeEach(() => {
  useSessionStore.getState().reset()
  useStreamStore.getState().reset()
  useDigestStore.getState().reset()
  useCompanionStore.getState().reset()
  useConnectionStore.getState().reset()
  useReturnSummaryStore.getState().reset()
  usePersonaStore.getState().reset()
})

afterEach(cleanup)

describe('SessionListScreen', () => {
  it('渲染摘要 `3/7 · 动作`、状态点与相对时间', () => {
    useDigestStore.getState().upsertDigest(
      digest('s1', {
        title: 'auth 重构',
        status: 'running',
        currentAction: '正在改 auth.ts',
        todoProgress: { done: 3, total: 7 },
        seq: 5,
      }),
    )
    render(<SessionListScreen transport={transport} now={NOW} />)
    expect(screen.getByTestId('summary-s1').textContent).toBe('3/7 · 正在改 auth.ts')
    expect(screen.getByTestId('status-dot-s1').getAttribute('aria-label')).toBe('进行中')
    expect(screen.getByTestId('reltime-s1').textContent).toBe('1 分钟前')
  })

  it('待决策警示标与未读角标互斥（待决策优先）', () => {
    useDigestStore.getState().upsertDigest(
      digest('s1', { status: 'waiting_option', pendingOptionRequest: true, seq: 4 }),
    )
    useDigestStore.getState().upsertDigest(digest('s2', { status: 'done', seq: 3 }))
    render(<SessionListScreen transport={transport} now={NOW} />)
    expect(screen.getByTestId('pending-badge-s1')).toBeTruthy()
    expect(screen.queryByTestId('unread-badge-s1')).toBeNull()
    expect(screen.getByTestId('unread-badge-s2').textContent).toBe('3')
  })

  it('顶部聚合条三段：N 进行中 / M 待决策 / K 已完成', () => {
    useDigestStore.getState().upsertDigest(digest('s1', { status: 'running' }))
    useDigestStore.getState().upsertDigest(digest('s2', { status: 'running' }))
    useDigestStore.getState().upsertDigest(
      digest('s3', { status: 'waiting_option', pendingOptionRequest: true }),
    )
    useDigestStore.getState().upsertDigest(digest('s4', { status: 'done' }))
    render(<SessionListScreen transport={transport} now={NOW} />)
    expect(screen.getByTestId('aggregate-running').textContent).toContain('2 进行中')
    expect(screen.getByTestId('aggregate-waiting').textContent).toContain('1 待决策')
    expect(screen.getByTestId('aggregate-done').textContent).toContain('1 已完成')
  })

  it('digest 带 adapterId 时列表项渲染 adapter 徽标，无则隐藏', () => {
    // adapterId 为 protocol digest 追加的可选字段（client-core 透传由并行任务补齐），
    // 这里直接注入 store 状态验证展示层消费
    const entry = (
      over: (Partial<DigestEntry> & { sessionId: string }) | { sessionId: string; adapterId: string },
    ) =>
      ({
        title: over.sessionId,
        status: 'idle',
        pendingOptionRequest: false,
        lastActivityAt: NOW - 60_000,
        seq: 1,
        readSeq: 0,
        ...over,
      }) as DigestEntry & { adapterId?: string }
    useDigestStore.setState({
      digests: {
        s1: entry({ sessionId: 's1', status: 'running', adapterId: 'kimi' }),
        s2: entry({ sessionId: 's2', status: 'done' }),
      },
    })
    render(<SessionListScreen transport={transport} now={NOW} />)
    expect(screen.getByTestId('adapter-badge-s1').textContent).toBe('kimi')
    expect(screen.queryByTestId('adapter-badge-s2')).toBeNull()
  })

  it('排序：waiting_option 置顶，组内 lastActivityAt 倒序', () => {
    useDigestStore.getState().upsertDigest(
      digest('s-run', { status: 'running', lastActivityAt: NOW }),
    )
    useDigestStore.getState().upsertDigest(
      digest('s-wait', { status: 'waiting_option', lastActivityAt: NOW - 5000 }),
    )
    useDigestStore.getState().upsertDigest(
      digest('s-err', { status: 'error', lastActivityAt: NOW - 1000 }),
    )
    render(<SessionListScreen transport={transport} now={NOW} />)
    const items = screen
      .getAllByTestId(/^session-item-/)
      .map((el) => el.getAttribute('data-testid'))
    expect(items).toEqual([
      'session-item-s-wait',
      'session-item-s-err',
      'session-item-s-run',
    ])
  })

  it('空列表提示', () => {
    render(<SessionListScreen transport={transport} now={NOW} />)
    expect(screen.getByTestId('session-list-empty')).toBeTruthy()
  })

  it('归来摘要在首屏顶部卡片呈现', () => {
    useReturnSummaryStore
      .getState()
      .show('你离开期间：会话 auth 重构 完成 1 回合（成功）、调用工具 14 次', NOW)
    render(<SessionListScreen transport={transport} now={NOW} />)
    const card = screen.getByTestId('return-summary-card')
    expect(card.textContent).toContain('你离开期间')
  })

  it('断连超 3 次显示「无法连接电脑」横幅', () => {
    useConnectionStore.getState().setConnection('reconnecting', 4)
    render(<SessionListScreen transport={transport} now={NOW} />)
    const banner = screen.getByTestId('reconnect-banner')
    expect(banner.getAttribute('data-unreachable')).toBe('true')
    expect(banner.textContent).toContain('无法连接电脑，可能已休眠或 VS Code 已退出')
  })
})
