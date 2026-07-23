/**
 * 首屏 = 会话状态列表（architecture.md §8 信息架构，仿手机 QQ）：
 * 顶部聚合条（「N 进行中 / M 待决策 / K 已完成」三段，与 StatusBar 口径同源，
 * 图标走 Icon 体系禁 emoji）+ 归来摘要卡 + digest 驱动的会话列表 +
 * 新建会话/设置入口。
 * 「离开电脑场景下用户打开手机看到的第一屏必须是哪些 agent 在跑、哪个要我决策」。
 */
import { useMemo } from 'react'

import {
  selectSortedDigests,
  selectStatusBarAggregate,
  useDigestStore,
} from '@dionysus/client-core'
import type { ClientTransport } from '@dionysus/client-core'

import { sendNewSession } from '../actions.js'
import { navigate } from '../router.js'
import { usePersonaStore } from '../stores/personaStore.js'
import { Icon } from './Icon.js'
import { ReconnectBanner } from './ReconnectBanner.js'
import { ReturnSummaryCard } from './ReturnSummaryCard.js'
import { SessionListItem } from './SessionListItem.js'

export interface SessionListScreenProps {
  transport: ClientTransport
  now?: number
}

export function SessionListScreen({ transport, now = Date.now() }: SessionListScreenProps) {
  const digestMap = useDigestStore((s) => s.digests)
  const digests = useMemo(() => selectSortedDigests({ digests: digestMap }), [digestMap])
  const aggregate = useMemo(
    () => selectStatusBarAggregate({ digests: digestMap }),
    [digestMap],
  )
  const personaState = usePersonaStore()
  // 聚合条第三段「已完成」计数（selectStatusBarAggregate 只产 running/waiting 两段）
  const doneCount = useMemo(
    () => digests.reduce((n, d) => (d.status === 'done' ? n + 1 : n), 0),
    [digests],
  )

  return (
    <div data-testid="session-list-screen" className="flex h-full flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-4 py-3">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">Dionysus</h1>
        <button
          type="button"
          data-testid="new-session-button"
          aria-label="新建会话"
          onClick={() => sendNewSession(transport)}
          className="flex items-center gap-1 rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-bg)] px-3 py-1.5 text-sm font-medium text-[var(--dn-button-fg)]"
        >
          <Icon name="plus" size={14} />
          新会话
        </button>
        <button
          type="button"
          data-testid="settings-button"
          aria-label="设置"
          onClick={() => navigate({ name: 'settings' })}
          className="flex items-center rounded-full bg-[var(--dn-button-secondary-bg)] px-3 py-1.5 text-sm text-[var(--dn-button-secondary-fg)]"
        >
          <Icon name="settings" size={15} />
        </button>
      </header>
      <ReconnectBanner />
      {/* endfield 校准刻度线：首屏舞台顶部的细刻度装饰（minimal-moderate） */}
      <div aria-hidden className="dn-ticks flex-none" />
      {/* 聚合条（§2.3「全部会话」口径三段：N 进行中 / M 待决策 / K 已完成） */}
      <div
        data-testid="aggregate-bar"
        className="flex flex-none items-center gap-3 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-4 py-2 text-sm"
      >
        {/* 进行中计数坐信号黄校准块（endfield 信号块承载进度语义） */}
        <span
          data-testid="aggregate-running"
          className="inline-flex items-center gap-1 rounded-[var(--dn-radius-sm)] bg-[var(--dn-signal)] px-1.5 py-0.5 text-[#191919]"
        >
          <Icon name="running" size={14} />
          {aggregate.running} 进行中
        </span>
        <span
          data-testid="aggregate-waiting"
          className="inline-flex items-center gap-1 text-[var(--dn-attention)]"
        >
          <Icon name="waiting_option" size={14} />
          {aggregate.waitingOption} 待决策
        </span>
        <span
          data-testid="aggregate-done"
          className="inline-flex items-center gap-1 text-[var(--dn-success)]"
        >
          <Icon name="done" size={14} />
          {doneCount} 已完成
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ReturnSummaryCard />
        {digests.length === 0 ? (
          <p
            data-testid="session-list-empty"
            className="px-4 py-10 text-center text-sm text-[var(--dn-muted)]"
          >
            还没有会话。点右上角「新会话」开始。
          </p>
        ) : (
          digests.map((d) => (
            <SessionListItem
              key={d.sessionId}
              digest={d}
              avatarUrl={personaState.personas[personaState.sessionPersona[d.sessionId] ?? '']?.avatarUrl}
              now={now}
              onSelect={(sessionId) => navigate({ name: 'chat', sessionId })}
            />
          ))
        )}
      </div>
    </div>
  )
}
