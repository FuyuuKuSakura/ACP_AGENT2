/**
 * SystemNoticeBar — 全局 system_notice 条（无 sessionId 的通知，
 * 如 maxConcurrentAgents 超限提示；session 级 notice 已在消息流中）。
 * warning/error 着色，可逐条关闭（关闭即丢弃，不落盘）。
 */
import { useState } from 'react'

import type { SessionStoreState } from '@dionysus/client-core'

import { Icon } from '../Icon.js'

type Notice = SessionStoreState['globalNotices'][number]

const LEVEL_CLASS: Record<Notice['level'], string> = {
  info: 'text-[var(--dn-muted)]',
  warning: 'text-[var(--dn-warning)]',
  error: 'text-[var(--dn-error)]',
}

export function SystemNoticeBar({ notices }: { notices: Notice[] }) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const visible = notices.filter((n) => !dismissed.has(n.ts))
  if (visible.length === 0) return null
  return (
    <div data-testid="system-notice-bar" className="flex flex-col">
      {visible.map((n) => (
        <div
          key={n.ts}
          data-level={n.level}
          className={`flex items-center gap-2 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-1.5 text-xs ${LEVEL_CLASS[n.level]}`}
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.text}</span>
          <button
            type="button"
            aria-label="关闭通知"
            onClick={() => setDismissed((prev) => new Set(prev).add(n.ts))}
            className="inline-flex shrink-0 text-[var(--dn-muted)] hover:text-[var(--dn-fg)]"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
