/**
 * messageRouter — 纯函数消息路由（architecture.md §7「消息路由为纯函数模块」）。
 *
 * 输入一条 ServerMessage，输出一组路由动作（RouteAction 判别联合），
 * 不触碰任何 store；store 应用见 dispatch.ts。19 种 S→C 消息每种都有
 * 显式分支，或带注释的显式 ignore（pong）。未识别的消息类型（如未来协议
 * 版本新增）容错为 ignore 动作，不抛异常。
 */
import type {
  AgentCompletePayload,
  AgentStatus,
  Artifact,
  Attachment,
  HandshakePayload,
  HistoryResponsePayload,
  OptionItem,
  OptionRequestPayload,
  ServerMessage,
  SessionDigestUpdatePayload,
  SessionMeta,
  SessionStatus,
  StatusUpdatePayload,
  TodoItem,
  ToolCallPayload,
  ToolResultPayload,
} from '@dionysus/protocol'

// ---------------------------------------------------------------------------
// 路由动作（判别联合）
// ---------------------------------------------------------------------------

/** handshake：连接建立/重连，携带全量会话快照与各会话 latestSeq。 */
export interface HandshakeAction {
  kind: 'handshake'
  clientId: string
  sessions: HandshakePayload['sessions']
}

/** session_list_response / handshake 快照 → 会话元数据 upsert。 */
export interface UpdateSessionAction {
  kind: 'updateSession'
  sessions: SessionMeta[]
}

/** agent_stream → 流式追加（thinking 经 isThinking 分流，无独立类型）。 */
export interface AppendStreamAction {
  kind: 'appendStream'
  sessionId: string
  chunk: string
  isThinking: boolean
  isFinal: boolean
  status: AgentStatus
  turnId?: string
  seq?: number
}

/** agent_complete → 回合收尾（按 turnId 幂等，v2 双 complete 缺陷不复现）。 */
export interface FinalizeTurnAction {
  kind: 'finalizeTurn'
  sessionId: string
  status: AgentCompletePayload['status']
  errorMessage?: string
  durationMs?: number
  artifacts: Artifact[]
  turnId?: string
  seq?: number
}

/** status_update → 流式状态行（「正在读 auth.ts」）。 */
export interface UpdateStreamStatusAction {
  kind: 'updateStreamStatus'
  sessionId: string
  status: StatusUpdatePayload['status']
  detail: string
  progress?: number
}

/** tool_call → 新增工具卡片。 */
export interface AddToolCallAction {
  kind: 'addToolCall'
  sessionId: string
  toolCall: ToolCallPayload
  turnId?: string
  seq?: number
}

/** tool_result → 与既有 tool_call 配对折叠（按 toolCallId，缺 id 时 FIFO）。 */
export interface ResolveToolCallAction {
  kind: 'resolveToolCall'
  sessionId: string
  result: ToolResultPayload
}

/** option_request → 展示选项组；requestTraceId 取自信封 traceId（竞态关联键）。 */
export interface ShowOptionsAction {
  kind: 'showOptions'
  sessionId: string
  requestTraceId?: string
  question: string
  options: OptionItem[]
  uiType: OptionRequestPayload['uiType']
  timeoutSeconds: number
}

/** option_resolved → 多端竞态解决，选项组置已决态。 */
export interface ResolveOptionsAction {
  kind: 'resolveOptions'
  sessionId?: string
  requestTraceId: string
  selectedId: string
  origin: string
}

/** session_digest_update → QQ 式会话列表数据源（客户端不自行推断状态）。 */
export interface UpdateDigestAction {
  kind: 'updateDigest'
  digest: SessionDigestUpdatePayload
}

/**
 * companion_message → 角色旁白，一律进 companionStore、不进任何 sessionStore。
 * scope='global' 是显式路由分支：envelope.sessionId 省略（或即使有也不按会话
 * 过滤丢弃，ADR-17）。
 */
export interface CompanionAction {
  kind: 'companion'
  scope: 'session' | 'global'
  text: string
  emotion?: string
  sourceSessionId?: string
  sourceTitle?: string
  sessionId?: string
  ts: number
}

/** emotion_update → 陪伴情绪/Live2D 表情动作（v3 已删除 live2d_action）。 */
export interface EmotionAction {
  kind: 'emotion'
  emotion: string
  expression?: string
  motion?: string
  sessionId?: string
}

/** user_message_echo → 多端回显（origin 供 UI 标注「来自手机」）。 */
export interface EchoAction {
  kind: 'echo'
  sessionId: string
  text: string
  attachments?: Attachment[]
  origin: string
  ts: number
}

/** system_notice → 会话内系统消息（有 sessionId）或全局通知。 */
export interface NoticeAction {
  kind: 'notice'
  text: string
  level: 'info' | 'warning' | 'error'
  sessionId?: string
  ts: number
}

/** todo_update → 任务清单全量快照（非增量）。 */
export interface TodoAction {
  kind: 'todo'
  sessionId: string
  items: TodoItem[]
}

/** history_response → 历史分页（message 行 + event 行）。 */
export interface HistoryAction {
  kind: 'history'
  sessionId: string
  entries: HistoryResponsePayload['entries']
  hasMore: boolean
}

/** session_switched → 切换当前会话（sidebar focus_session 经宿主确认后的单播）。 */
export interface SessionSwitchedAction {
  kind: 'sessionSwitched'
  sessionId: string
}

/**
 * sync_response → 断连补拉：events 逐条经 routeServerMessage 回放为本动作的
 * 内嵌动作序列，消费方按序应用；latestSeq 用于推进本地已见游标。
 */
export interface SyncReplayAction {
  kind: 'syncReplay'
  sessionId: string
  latestSeq: number
  truncated: boolean
  actions: RouteAction[]
}

/** 显式忽略（pong 等无需客户端状态变化的消息，及未知类型容错）。 */
export interface IgnoreAction {
  kind: 'ignore'
  reason: string
}

export type RouteAction =
  | HandshakeAction
  | UpdateSessionAction
  | AppendStreamAction
  | FinalizeTurnAction
  | UpdateStreamStatusAction
  | AddToolCallAction
  | ResolveToolCallAction
  | ShowOptionsAction
  | ResolveOptionsAction
  | UpdateDigestAction
  | CompanionAction
  | EmotionAction
  | EchoAction
  | NoticeAction
  | TodoAction
  | HistoryAction
  | SessionSwitchedAction
  | SyncReplayAction
  | IgnoreAction

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

/**
 * 把一条 ServerMessage 路由为动作数组。
 *
 * 多数消息产生单动作；sync_response 递归回放产生一个 SyncReplayAction。
 * 未知消息类型（未来协议版本）容错为 ignore，不抛异常。
 */
export function routeServerMessage(msg: ServerMessage): RouteAction[] {
  switch (msg.type) {
    case 'handshake':
      return [
        {
          kind: 'handshake',
          clientId: msg.payload.clientId,
          sessions: msg.payload.sessions,
        },
      ]

    case 'pong':
      // 心跳响应无需任何客户端状态变化，显式忽略。
      return [{ kind: 'ignore', reason: 'pong: heartbeat response' }]

    case 'agent_stream':
      return [
        {
          kind: 'appendStream',
          sessionId: requireSessionId(msg),
          chunk: msg.payload.chunk,
          isThinking: msg.payload.isThinking,
          isFinal: msg.payload.isFinal,
          status: msg.payload.status,
          turnId: msg.turnId,
          seq: msg.seq,
        } satisfies AppendStreamAction,
      ]

    case 'agent_complete':
      return [
        {
          kind: 'finalizeTurn',
          sessionId: requireSessionId(msg),
          status: msg.payload.status,
          errorMessage: msg.payload.errorMessage,
          durationMs: msg.payload.durationMs,
          artifacts: msg.payload.artifacts,
          turnId: msg.turnId,
          seq: msg.seq,
        } satisfies FinalizeTurnAction,
      ]

    case 'status_update':
      return [
        {
          kind: 'updateStreamStatus',
          sessionId: requireSessionId(msg),
          status: msg.payload.status,
          detail: msg.payload.detail,
          progress: msg.payload.progress,
        } satisfies UpdateStreamStatusAction,
      ]

    case 'tool_call':
      return [
        {
          kind: 'addToolCall',
          sessionId: requireSessionId(msg),
          toolCall: msg.payload,
          turnId: msg.turnId,
          seq: msg.seq,
        } satisfies AddToolCallAction,
      ]

    case 'tool_result':
      return [
        {
          kind: 'resolveToolCall',
          sessionId: requireSessionId(msg),
          result: msg.payload,
        } satisfies ResolveToolCallAction,
      ]

    case 'option_request':
      return [
        {
          kind: 'showOptions',
          sessionId: requireSessionId(msg),
          requestTraceId: msg.traceId,
          question: msg.payload.question,
          options: msg.payload.options,
          uiType: msg.payload.uiType,
          timeoutSeconds: msg.payload.timeoutSeconds,
        } satisfies ShowOptionsAction,
      ]

    case 'option_resolved':
      return [
        {
          kind: 'resolveOptions',
          sessionId: msg.sessionId,
          requestTraceId: msg.payload.requestTraceId,
          selectedId: msg.payload.selectedId,
          origin: msg.payload.origin,
        } satisfies ResolveOptionsAction,
      ]

    case 'session_digest_update':
      return [{ kind: 'updateDigest', digest: msg.payload }]

    case 'session_list_response':
      return [{ kind: 'updateSession', sessions: msg.payload.sessions }]

    case 'history_response':
      return [
        {
          kind: 'history',
          sessionId: msg.payload.sessionId,
          entries: msg.payload.entries,
          hasMore: msg.payload.hasMore,
        } satisfies HistoryAction,
      ]

    case 'user_message_echo':
      return [
        {
          kind: 'echo',
          sessionId: requireSessionId(msg),
          text: msg.payload.text,
          attachments: msg.payload.attachments,
          origin: msg.payload.origin,
          ts: msg.ts,
        } satisfies EchoAction,
      ]

    case 'emotion_update':
      return [
        {
          kind: 'emotion',
          emotion: msg.payload.emotion,
          expression: msg.payload.expression,
          motion: msg.payload.motion,
          sessionId: msg.sessionId,
        } satisfies EmotionAction,
      ]

    case 'companion_message': {
      // 显式路由分支（architecture.md §7 / ADR-17）：scope='global' 的陪伴消息
      // 进 companionStore，不进任何 sessionStore；envelope.sessionId 省略，即使
      // 异常携带也不得按会话过滤丢弃。scope='session' 的会话级台词同样只进
      // companionStore（汇报一律不进会话消息流，ux-core-flows.md §4.1）。
      const p = msg.payload
      return [
        {
          kind: 'companion',
          scope: p.scope,
          text: p.text,
          emotion: p.emotion,
          sourceSessionId: p.sourceSessionId,
          sourceTitle: p.sourceTitle,
          sessionId: msg.sessionId,
          ts: msg.ts,
        } satisfies CompanionAction,
      ]
    }

    case 'todo_update':
      return [
        { kind: 'todo', sessionId: requireSessionId(msg), items: msg.payload.items } satisfies TodoAction,
      ]

    case 'session_switched':
      return [
        { kind: 'sessionSwitched', sessionId: msg.payload.sessionId } satisfies SessionSwitchedAction,
      ]

    case 'system_notice':
      return [
        {
          kind: 'notice',
          text: msg.payload.text,
          level: msg.payload.level,
          sessionId: msg.sessionId,
          ts: msg.ts,
        } satisfies NoticeAction,
      ]

    case 'sync_response': {
      // 断连补拉回放（ADR-11）：events 逐条递归路由为动作序列，消费方按序应用。
      // truncated=true 时 events 首条为会话快照（由 core 生成为常规事件形态），
      // 客户端无需特判，同一回放路径处理。
      const p = msg.payload
      const actions: RouteAction[] = []
      for (const event of p.events) {
        actions.push(...routeServerMessage(event))
      }
      return [
        {
          kind: 'syncReplay',
          sessionId: p.sessionId,
          latestSeq: p.latestSeq,
          truncated: p.truncated,
          actions,
        } satisfies SyncReplayAction,
      ]
    }

    default:
      // 未知消息类型（如未来协议版本新增）容错忽略，不阻断其他消息处理。
      return [
        {
          kind: 'ignore',
          reason: `unknown message type: ${(msg as { type: string }).type}`,
        },
      ]
  }
}

/** 会话相关消息必须携带 envelope.sessionId（§4.1 连接-会话绑定模型）。 */
function requireSessionId(msg: ServerMessage): string {
  if (!msg.sessionId) {
    throw new Error(`messageRouter: ${msg.type} missing envelope.sessionId`)
  }
  return msg.sessionId
}

// 仅 re-export 便于测试与消费方使用，避免二次 import protocol。
export type { SessionStatus }
