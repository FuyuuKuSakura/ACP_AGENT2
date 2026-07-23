/**
 * StatusBarItem 全局聚合状态面（architecture.md §6.6）：
 * 常驻显示「$(sync~spin) N 运行中 $(warning) M 待决策」（codicon 图标语法，
 * 禁止 emoji），点击聚焦 sidebar 会话列表。
 *
 * 数据源与 sidebar 列表、活动栏 badge 同源：core 广播的
 * session_digest_update（客户端不自行推断状态，ux-core-flows §2.2）。
 *
 * 零 vscode 依赖：StatusBarItem 以结构类型注入，可在 vitest 下单测。
 */
import type {
  ServerMessage,
  SessionDigestUpdatePayload,
} from '@dionysus/protocol'

/** vscode.StatusBarItem 的最小结构。 */
export interface StatusBarItemLike {
  text: string
  tooltip?: unknown
  command?: unknown
  show(): void
  hide(): void
  dispose(): void
}

/** 点击状态栏执行的命令（extension.ts 注册：聚焦 sidebar 会话列表）。 */
export const FOCUS_SESSION_LIST_COMMAND = 'dionysus.focusSessionList'

export class SessionStatusBar {
  private readonly digests = new Map<string, SessionDigestUpdatePayload>()

  constructor(private readonly item: StatusBarItemLike) {
    this.item.command = FOCUS_SESSION_LIST_COMMAND
    this.item.tooltip = 'Dionysus：点击查看会话列表'
    this.render()
    this.item.show()
  }

  /** 喂入 core 外发的服务器消息；只消费 session_digest_update。 */
  handleMessage(msg: ServerMessage): void {
    if (msg.type !== 'session_digest_update') return
    this.digests.set(msg.payload.sessionId, msg.payload)
    this.render()
  }

  /** 会话删除后从聚合中移除（extension 删除会话时调用）。 */
  dropSession(sessionId: string): void {
    if (this.digests.delete(sessionId)) this.render()
  }

  private render(): void {
    let running = 0
    let attention = 0
    for (const digest of this.digests.values()) {
      if (digest.status === 'running') running += 1
      // 待决策只计等待用户输入的会话（与列表顶部聚合条同口径）；error 不计入
      if (digest.status === 'waiting_option' || digest.pendingOptionRequest) {
        attention += 1
      }
    }
    // ux-core-flows §2.1：N 运行中 / M 待决策（与列表顶部聚合条同口径）；
    // 图标用 codicon 语法：$(sync~spin) 旋转示意运行中，$(warning) 警示待决策
    this.item.text =
      this.digests.size === 0
        ? 'Dionysus'
        : `$(sync~spin) ${running} 运行中 $(warning) ${attention} 待决策`
  }

  dispose(): void {
    this.item.dispose()
  }
}
