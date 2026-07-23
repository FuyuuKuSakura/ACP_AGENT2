/**
 * 会话列表项（ux-core-flows.md §2.2 联系人卡片，紧凑密度单行 ~48px）：
 * 状态点（头像左侧 8px 五态圆点）+ persona 圆形头像（无图首字母色块）
 * + adapter 徽标（头像右下角小圆标，adapterId 首字母，区分「同角色不同
 * agent」，有 adapterId 才渲染）+ 会话名 + 一行摘要（右端相对时间）
 * + 未读角标 / 待决策警示图标角标（互斥，待决策优先）。
 * 纯 UI 组件：数据经 props 注入，点击经 onSelect 回调，不感知 transport。
 */
import type { DigestEntry } from '@dionysus/client-core'
import { selectUnreadCount } from '@dionysus/client-core'
import type { SessionStatus } from '@dionysus/protocol'

import { Icon } from '../Icon.js'

import {
  adapterBadgeLabel,
  avatarColorFor,
  avatarInitial,
  formatDigestSummary,
  formatRelativeTime,
} from './format.js'

/** 状态点五态（§2.2）：className 配色见 sidebar.css。 */
export const STATUS_DOT: Record<
  SessionStatus,
  { dotClass: string; label: string }
> = {
  idle: { dotClass: 'dio-dot-idle', label: '空闲' },
  running: { dotClass: 'dio-dot-running', label: '运行中' },
  waiting_option: { dotClass: 'dio-dot-waiting_option', label: '待决策' },
  error: { dotClass: 'dio-dot-error', label: '出错' },
  done: { dotClass: 'dio-dot-done', label: '已完成' },
}

export interface SessionListItemProps {
  /**
   * 列表项数据（digestStore 条目）。adapterId/workingDir 为 protocol 追加的
   * 可选字段（digest payload → client-core 透传），本地宽化以兼容尚未
   * 携带该字段的 DigestEntry 类型。
   */
  digest: DigestEntry & { adapterId?: string; workingDir?: string }
  /** 当前聚焦会话（高亮选中态） */
  active?: boolean
  /** persona 头像 URL（宿主已解析为可加载 URL）；缺省用首字母色块 */
  avatarUrl?: string
  /** 会话绑定的角色显示名（session_list 的 personaId 解析；title 属性数据源） */
  personaLabel?: string
  /** 相对时间渲染基准（Unix 毫秒） */
  now: number
  onSelect?: (sessionId: string) => void
}

export function SessionListItem({
  digest,
  active,
  avatarUrl,
  personaLabel,
  now,
  onSelect,
}: SessionListItemProps) {
  const unread = selectUnreadCount(digest)
  // 待决策角标与未读数字互斥，待决策优先级更高（§2.2）
  const showPending = digest.pendingOptionRequest
  const dot = STATUS_DOT[digest.status]

  // title 属性：会话创建时绑定的助手/角色（1 对 1，不可切换）+ 工作目录（ux 约定）
  const titleLines: string[] = []
  if (digest.adapterId || personaLabel) {
    titleLines.push(
      `助手：${digest.adapterId ?? '默认'} · 角色：${personaLabel ?? '默认'}`,
    )
  }
  if (digest.workingDir) titleLines.push(`工作目录：${digest.workingDir}`)

  return (
    <button
      type="button"
      data-testid={`session-item-${digest.sessionId}`}
      data-status={digest.status}
      data-active={active ? 'true' : 'false'}
      {...(titleLines.length > 0 ? { title: titleLines.join('\n') } : {})}
      onClick={() => onSelect?.(digest.sessionId)}
      className={`flex min-h-[48px] w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--dn-list-hover-bg)] focus:outline-none ${
        active ? 'bg-[var(--dn-list-active-bg)]' : ''
      }`}
    >
      <span
        data-testid={`status-dot-${digest.sessionId}`}
        title={dot.label}
        aria-label={dot.label}
        className={`dio-status-dot ${dot.dotClass}`}
      />
      <span className="relative flex-none">
        {avatarUrl ? (
          <img
            data-testid={`avatar-img-${digest.sessionId}`}
            src={avatarUrl}
            alt=""
            draggable={false}
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span
            data-testid={`avatar-fallback-${digest.sessionId}`}
            aria-hidden
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-[var(--dn-button-fg)]"
            style={{
              background: avatarColorFor(digest.title || digest.sessionId),
            }}
          >
            {avatarInitial(digest.title)}
          </span>
        )}
        {digest.adapterId ? (
          <span
            data-testid={`adapter-badge-${digest.sessionId}`}
            title={digest.adapterId}
            aria-label={`适配器 ${digest.adapterId}`}
            className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--dn-panel-bg)] bg-[var(--dn-badge-bg)] text-[8px] font-semibold leading-none text-[var(--dn-badge-fg)]"
          >
            {adapterBadgeLabel(digest.adapterId)}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm leading-tight text-[var(--dn-fg)]">
          {digest.title || '新会话'}
        </span>
        <span className="flex items-baseline gap-1 text-xs leading-tight text-[var(--dn-muted)]">
          <span
            data-testid={`summary-${digest.sessionId}`}
            className="min-w-0 flex-1 truncate"
          >
            {formatDigestSummary(digest)}
          </span>
          <span
            data-testid={`reltime-${digest.sessionId}`}
            className="flex-none whitespace-nowrap"
          >
            {formatRelativeTime(digest.lastActivityAt, now)}
          </span>
        </span>
      </span>
      {showPending ? (
        <span
          data-testid={`pending-badge-${digest.sessionId}`}
          title="待决策"
          aria-label="待决策"
          className="flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[var(--dn-attention-bg)] px-1 text-[10px] leading-none text-[var(--dn-attention-fg)]"
        >
          <Icon name="waiting_option" size={10} />
        </span>
      ) : unread > 0 ? (
        <span
          data-testid={`unread-badge-${digest.sessionId}`}
          title={`${unread} 条未读`}
          aria-label={`${unread} 条未读`}
          className="flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[var(--dn-badge-bg)] px-1 text-[10px] leading-none text-[var(--dn-badge-fg)]"
        >
          {unread}
        </span>
      ) : null}
    </button>
  )
}
