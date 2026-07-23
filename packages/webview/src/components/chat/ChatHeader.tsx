/**
 * ChatHeader — 会话标题栏：会话名 + adapter/persona 标识 + 打断按钮。
 *
 * adapter/persona 徽标显示**当前会话实际绑定**的助手与角色（会话创建时确定，
 * 1 对 1 不可切换）：adapterId 来自 digest，角色显示名由 ChatApp 经
 * session_list + persona_list 解析后经 props 注入。徽标为纯展示（不可点击），
 * 避免被误解为可在此切换；切换默认值走「Dionysus: 选择 AI 助手 / 选择角色」命令。
 * 打断按钮仅在流式进行中可见，点击发 interrupt（§5.3）。
 */
import type { ClientTransport } from '@dionysus/client-core'

import { Icon } from '../Icon.js'
import { sendInterrupt } from './chatActions.js'
import { ResumeSessionMenu } from './ResumeSessionMenu.js'

export interface ChatHeaderProps {
  title: string
  sessionId: string | null
  isStreaming: boolean
  waitingOption: boolean
  transport: ClientTransport
  /** 当前会话实际绑定的助手 id（digest.adapterId）；undefined = 尚未知晓 */
  adapterId?: string
  /** 当前会话实际绑定的角色显示名（session_list personaId 经 persona_list 解析） */
  personaLabel?: string
}

export function ChatHeader({
  title,
  sessionId,
  isStreaming,
  waitingOption,
  transport,
  adapterId,
  personaLabel,
}: ChatHeaderProps) {
  return (
    <header className="flex items-center gap-2 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-2">
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--dn-fg)]">
        {title || 'Dionysus'}
      </h1>
      {waitingOption && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--dn-badge-bg)] px-2 py-0.5 text-xs text-[var(--dn-badge-fg)]">
          <Icon name="waiting_option" size={12} />
          待决策
        </span>
      )}
      {sessionId && (
        <span
          data-testid="adapter-persona-badges"
          title="当前会话绑定的助手与角色（创建时确定，不可在此切换）"
          className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--dn-muted)]"
        >
          <span
            data-testid="persona-badge"
            className="rounded-full border border-[var(--dn-border)] px-2 py-0.5"
          >
            {personaLabel ?? '…'}
          </span>
          <span
            data-testid="adapter-badge"
            className="rounded-full border border-[var(--dn-border)] px-2 py-0.5"
          >
            {adapterId ?? '…'}
          </span>
        </span>
      )}
      {sessionId && <ResumeSessionMenu sessionId={sessionId} transport={transport} />}
      {isStreaming && sessionId && (
        <button
          type="button"
          data-testid="interrupt-button"
          onClick={() => sendInterrupt(transport, sessionId)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--dn-error)] px-2.5 py-0.5 text-xs text-[var(--dn-error)] hover:bg-[var(--dn-button-secondary-bg)]"
        >
          <Icon name="stop" size={10} />
          打断
        </button>
      )}
    </header>
  )
}
