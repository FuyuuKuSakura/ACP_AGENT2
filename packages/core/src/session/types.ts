/**
 * 会话层类型（docs/v3/architecture.md §5.3）。
 *
 * SessionMeta / Message 与 @dionysus/protocol 的 sessionMetaSchema /
 * messageLineSchema 对齐（SessionMeta 在其上扩展 core 内部字段）；
 * 存储行格式：首行 meta，其后 message 行（type:'message'）与
 * TransientEvent event 行（type:'event'，companion_message / todo_update 终态）。
 */
import type {
  MessageLine,
  SessionStatus,
  TransientEvent,
} from '@dionysus/protocol'

export type { MessageLine, SessionStatus, TransientEvent }

/** 一条会话消息（JSONL message 行，与 protocol MessageLine 同形）。 */
export type Message = MessageLine

/** option 超时动作（会话级配置 dionysus.session.optionTimeoutAction）。 */
export type OptionTimeoutAction = 'deny' | 'default' | 'keep'

/**
 * 会话元数据。字段 id/title/personaId/status/lastMessagePreview/updatedAt/
 * unreadCount 与 protocol SessionMeta 一致；其余为 core 内部扩展，
 * 随 JSONL 首行 meta 持久化。
 */
export interface SessionMeta {
  id: string
  title: string
  personaId: string
  status: SessionStatus
  /** 绑定的适配器配置 key（adaptersConfig 中的条目名） */
  adapterId: string
  lastMessagePreview?: string
  /** Unix 毫秒整数 */
  updatedAt: number
  /** Unix 毫秒整数 */
  createdAt: number
  unreadCount: number
  /** 用户手动重命名后置 true，自动标题不再覆盖 */
  titleLocked?: boolean
  /** 可选注入增强：system prompt 已成功注入（首轮事件产生）并持久化 */
  systemPromptInjected?: boolean
  /** CLI 侧会话 id（resume 用；仅内存态更新，不落盘——首行 meta 仅低频重写） */
  cliSessionId?: string
  /** option 超时动作；缺省由 SessionManager 配置兜底（默认 'keep'） */
  optionTimeoutAction?: OptionTimeoutAction
  /** 会话工作目录（additive；缺省回落全局 dionysus.workingDir，随首行 meta 持久化） */
  workingDir?: string
  /** list() 检出首行 meta 损坏时标注（会话不静默消失） */
  corrupt?: boolean
}

/** SessionStore.create/get 的返回载体。 */
export interface Session {
  meta: SessionMeta
}

/**
 * 会话持久化接口（architecture.md §5.3）。
 *
 * 写者不变量：同一 sessionId 的 appendMessage 调用方只有该会话串行的
 * runAgentTurn（单会话同一时刻至多一个进行中回合），单会话 jsonl 文件
 * 不存在多写者；首行 meta 的重写（updateTitle/updateMeta）只发生在
 * create 及 title/persona/adapter 变更等低频、用户驱动、天然串行的路径。
 */
export interface SessionStore {
  create(meta: SessionMeta): Promise<Session>
  get(id: string): Promise<Session | null>
  /** 扫 sessions/*.jsonl 读各文件首行 meta（无 index.json），只读元数据 */
  list(): Promise<SessionMeta[]>
  appendMessage(sessionId: string, msg: Message | TransientEvent): Promise<void>
  /** 只取 message 行；坏行跳过 + warning（容忍进程被杀留下的截断半行） */
  loadMessages(sessionId: string): Promise<Message[]>
  /** message 行 + event 行（history_request 的数据源）；坏行同样容忍 */
  loadEntries(sessionId: string): Promise<(Message | TransientEvent)[]>
  updateTitle(sessionId: string, title: string): Promise<void>
  /** 首行 meta 的低频原子重写（临时文件 + rename） */
  updateMeta(sessionId: string, patch: Partial<SessionMeta>): Promise<void>
  delete(id: string): Promise<void>
}
