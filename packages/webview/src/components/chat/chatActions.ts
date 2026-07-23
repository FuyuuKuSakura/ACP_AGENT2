/**
 * chatActions — 聊天视图的 C→S 发送助手（protocol §4.1 信封直发）。
 *
 * 用户消息不做本地乐观追加：core 持久化后以 user_message_echo 广播回全部
 * 客户端（含来源端），经 dispatch 落 sessionStore，保证多端时序一致。
 */
import type { ClientTransport } from '@dionysus/client-core'
import { useSessionStore } from '@dionysus/client-core'

/** 发送用户输入；text 为斜杠命令时改发 client_command。 */
export function sendChatText(
  transport: ClientTransport,
  sessionId: string,
  text: string,
): void {
  const trimmed = text.trim()
  if (trimmed.startsWith('/')) {
    const [command, ...rest] = trimmed.split(/\s+/)
    transport.send({
      v: 1,
      type: 'client_command',
      sessionId,
      ts: Date.now(),
      payload: { command, args: rest.join(' '), text: trimmed },
    })
    return
  }
  transport.send({
    v: 1,
    type: 'user_input',
    sessionId,
    ts: Date.now(),
    payload: { text, attachments: [], mode: 'normal' },
  })
}

/** 打断当前回合（标题栏打断按钮）。 */
export function sendInterrupt(transport: ClientTransport, sessionId: string): void {
  transport.send({
    v: 1,
    type: 'interrupt',
    sessionId,
    ts: Date.now(),
    payload: { reason: 'user_request' },
  })
}

/** 选项组点击。 */
export function sendOptionSelected(
  transport: ClientTransport,
  sessionId: string,
  selectedId: string,
  selectedLabel: string,
): void {
  transport.send({
    v: 1,
    type: 'option_selected',
    sessionId,
    ts: Date.now(),
    payload: { selectedId, selectedLabel },
  })
}

/** 新建会话（空状态「开始新会话」/ sidebar 按钮）；会话创建经 session_digest_update 广播回同步并自动切入。 */
export function sendNewSession(
  transport: ClientTransport,
  opts: { workingDir?: string; title?: string; adapterId?: string; personaId?: string } = {},
): void {
  useSessionStore.getState().expectNewSession()
  transport.send({
    v: 1,
    type: 'new_session',
    ts: Date.now(),
    payload: {
      ...(opts.workingDir ? { workingDir: opts.workingDir } : {}),
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.adapterId ? { adapterId: opts.adapterId } : {}),
      ...(opts.personaId ? { personaId: opts.personaId } : {}),
    },
  })
}

/** 进入会话时拉取最近历史（重开面板后恢复消息流）。 */export function sendHistoryRequest(
  transport: ClientTransport,
  sessionId: string,
  limit = 50,
): void {
  transport.send({
    v: 1,
    type: 'history_request',
    ts: Date.now(),
    payload: { sessionId, limit },
  })
}

/**
 * 切换当前会话（旁白气泡来源标注点击跳转，ux-core-flows.md §4.1）。
 * 纯本地 UI 状态切换，无需经 core。
 */
export function switchToSession(sessionId: string): void {
  useSessionStore.getState().setCurrentSession(sessionId)
}
