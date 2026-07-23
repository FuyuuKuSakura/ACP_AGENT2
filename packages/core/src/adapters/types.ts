/**
 * 适配器层类型契约（docs/v3/architecture.md §5.2）。
 *
 * 适配器对上层（SessionManager）输出的唯一事件类型是 AgentEvent 判别联合，
 * 各成员的 payload 字段与 @dionysus/protocol 的对应 payload 类型对齐（取交集），
 * 仅判别值用短名（'stream' 而非 'agent_stream'）——适配器层是进程内接口，
 * 信封与全词消息名由 SessionManager/BroadcastHub 在协议边界处组装。
 */
import type {
  AgentCompletePayload,
  AgentStreamPayload,
  Attachment,
  InputMode,
  OptionRequestPayload,
  StatusUpdatePayload,
  ToolCallPayload,
  ToolResultPayload,
} from '@dionysus/protocol'

/** 一轮用户输入（extract/adapters.md §1.2；attachments 目前无 CLI 通道，仅透传保留）。 */
export interface AgentInput {
  text: string
  attachments?: Attachment[]
  /** 缺省视为 'normal'；策略不支持的模式由适配器静默降级为 'normal' */
  mode?: InputMode
}

/**
 * 适配器层事件判别联合。type 成员：
 * - `stream`：增量输出文本（对齐 AgentStreamPayload）
 * - `thinking`：思维块（同 payload 形状，isThinking=true / status='thinking'）
 * - `status`：工作状态提示（对齐 StatusUpdatePayload）
 * - `tool_call` / `tool_result`：结构化工具调用/结果（对齐 protocol §4.1 新增 schema，
 *   取代 v2 的 emoji 文本流）
 * - `option_request`：选项请求（对齐 OptionRequestPayload；5 个 CLI 目前均不产出，透传路径保留）
 * - `complete`：回合收尾（对齐 AgentCompletePayload；一轮 send 必然恰好产出一条）
 * - `session_id`：CLI 会话 id 变更通知（v2 由 session_holder 带外通道承载，v3 显式化）
 */
export type AgentEvent =
  | ({ type: 'stream' } & AgentStreamPayload)
  | ({ type: 'thinking' } & AgentStreamPayload)
  | ({ type: 'status' } & StatusUpdatePayload)
  | ({ type: 'tool_call' } & ToolCallPayload)
  | ({ type: 'tool_result' } & ToolResultPayload)
  | ({ type: 'option_request' } & OptionRequestPayload)
  | ({ type: 'complete' } & AgentCompletePayload)
  | { type: 'session_id'; cliSessionId: string }

/**
 * 适配器接口（architecture.md §5.2）。
 *
 * 会话 ↔ 适配器一对一：每个会话持有独占实例（registry 只暴露 createAdapter
 * 工厂），实例级单回合互斥——send 进行中再次调用立即产出
 * complete{status:'error', errorMessage:'adapter busy'}。
 */
export interface IAgentAdapter {
  /** 适配器唯一 id，来自策略而非配置 key，如 'kimi_cli' */
  readonly agentId: string
  /** 启动后台资源。GenericCliAdapter 为空操作（进程在 send() 时才创建） */
  start(): Promise<void>
  /** 发送一轮输入，流式产出事件；一轮结束（成功/失败/打断）必然以一条 complete 收尾 */
  send(input: AgentInput): AsyncIterable<AgentEvent>
  /**
   * 打断当前生成：置内部标志后杀进程；收尾产出 complete{status:'interrupted'}
   * 而非 v2 的 "exited with code -9" 伪错误（extract/adapters.md §2.5 缺陷修复）。
   */
  interrupt(): Promise<void>
  /** 清理资源 = 杀当前子进程 */
  shutdown(): Promise<void>
  /** 仅 supportsSystemPrompt === 'native' 的策略对应适配器实现 */
  injectSystemPrompt?(prompt: string, vars?: Record<string, unknown>): Promise<void>
  /** 切换 CLI 会话 id（下轮 send 以其 resume）并杀掉当前进程；v3 提升为正式可选方法 */
  switchSession?(cliSessionId: string): Promise<void>
}
