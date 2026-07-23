/**
 * 会话列表行（ux-core-flows.md §2.2 同规格，仿手机 QQ 列表项）：
 * 角色头像（无图首字母色块）+ 状态点（五色，叠在头像右下）+ 会话名 +
 * 一行摘要（`3/7 · 动作`，右端相对时间）+ 未读角标 / 待决策警示标记
 * （互斥，待决策优先）；digest 带 adapterId 时头像左下叠 adapter 徽标。
 */
import {
  selectUnreadCount,
  type DigestEntry,
} from '@dionysus/client-core'
import type { SessionStatus } from '@dionysus/protocol'

import {
  avatarColorFor,
  avatarInitial,
  formatDigestSummary,
  formatRelativeTime,
  STATUS_LABEL,
} from '../format.js'
import { Icon } from './Icon.js'

export const STATUS_DOT: Record<SessionStatus, { dotClass: string; label: string }> = {
  idle: { dotClass: 'dn-dot-idle', label: STATUS_LABEL.idle },
  running: { dotClass: 'dn-dot-running', label: STATUS_LABEL.running },
  waiting_option: { dotClass: 'dn-dot-waiting_option', label: STATUS_LABEL.waiting_option },
  error: { dotClass: 'dn-dot-error', label: STATUS_LABEL.error },
  done: { dotClass: 'dn-dot-done', label: STATUS_LABEL.done },
}

export interface SessionListItemProps {
  digest: DigestEntry
  avatarUrl?: string
  now: number
  onSelect?: (sessionId: string) => void
}

export function SessionListItem({
  digest,
  avatarUrl,
  now,
  onSelect,
}: SessionListItemProps) {
  const unread = selectUnreadCount(digest)
  const showPending = digest.pendingOptionRequest
  const dot = STATUS_DOT[digest.status]
  // adapterId 为 digest 可选字段（protocol 追加）；无则不渲染徽标
  const adapterId = (digest as DigestEntry & { adapterId?: string }).adapterId
  // endfield 分区舞台：左侧 2px 引导线标记「活跃行」——待决策/出错常亮、
  // 进行中呼吸（breathing signal block）；idle/done 无线，保持列表安静
  const guideClass =
    digest.status === 'waiting_option'
      ? 'bg-[var(--dn-signal)]'
      : digest.status === 'running'
        ? 'bg-[var(--dn-signal)] dn-guide-breathe'
        : digest.status === 'error'
          ? 'bg-[var(--dn-error)]'
          : ''

  return (
    <button
      type="button"
      data-testid={`session-item-${digest.sessionId}`}
      data-status={digest.status}
      onClick={() => onSelect?.(digest.sessionId)}
      className="relative flex min-h-[64px] w-full items-center gap-3 border-b border-[var(--dn-border)] px-4 py-2.5 text-left active:bg-[var(--dn-list-active-bg)]"
    >
      {guideClass && (
        <span
          aria-hidden
          data-testid={`guide-line-${digest.sessionId}`}
          className={`absolute inset-y-0 left-0 w-[2px] ${guideClass}`}
        />
      )}
      <span className="relative flex-none">
        {avatarUrl ? (
          <img
            data-testid={`avatar-img-${digest.sessionId}`}
            src={avatarUrl}
            alt=""
            draggable={false}
            className="h-12 w-12 rounded-full object-cover"
          />
        ) : (
          <span
            data-testid={`avatar-fallback-${digest.sessionId}`}
            aria-hidden
            className="flex h-12 w-12 items-center justify-center rounded-full text-lg font-semibold text-white"
            style={{ background: avatarColorFor(digest.title || digest.sessionId) }}
          >
            {avatarInitial(digest.title)}
          </span>
        )}
        <span
          data-testid={`status-dot-${digest.sessionId}`}
          title={dot.label}
          aria-label={dot.label}
          className={`dn-status-dot absolute -bottom-0.5 -right-0.5 ring-2 ring-[var(--dn-bg)] ${dot.dotClass}`}
        />
        {adapterId && (
          <span
            data-testid={`adapter-badge-${digest.sessionId}`}
            title={`adapter：${adapterId}`}
            aria-label={`adapter：${adapterId}`}
            className="absolute -bottom-0.5 -left-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--dn-accent)] px-1 text-[10px] font-semibold leading-none text-[var(--dn-bg)] ring-2 ring-[var(--dn-bg)]"
          >
            {adapterId}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-base leading-tight text-[var(--dn-fg)]">
            {digest.title || '新会话'}
          </span>
          <span
            data-testid={`reltime-${digest.sessionId}`}
            className="flex-none whitespace-nowrap text-xs text-[var(--dn-muted)]"
          >
            {formatRelativeTime(digest.lastActivityAt, now)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            data-testid={`summary-${digest.sessionId}`}
            className="min-w-0 flex-1 truncate text-sm leading-tight text-[var(--dn-muted)]"
          >
            {formatDigestSummary(digest)}
          </span>
          {showPending ? (
            <span
              data-testid={`pending-badge-${digest.sessionId}`}
              title="待决策"
              aria-label="待决策"
              className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-[var(--dn-attention-bg)] px-1.5 text-xs leading-none text-[var(--dn-attention-fg)]"
            >
              <Icon name="waiting_option" size={12} />
            </span>
          ) : unread > 0 ? (
            <span
              data-testid={`unread-badge-${digest.sessionId}`}
              title={`${unread} 条未读`}
              aria-label={`${unread} 条未读`}
              className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-[var(--dn-badge-bg)] px-1.5 text-xs leading-none text-[var(--dn-badge-fg)]"
            >
              {unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
