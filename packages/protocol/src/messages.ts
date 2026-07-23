/**
 * @dionysus/protocol — 消息类型与 zod schema（v3 协议，docs/v3/architecture.md §4）。
 *
 * 传输无关的单真源：webview / mobile / core 三方共享。
 * 字段命名一律 camelCase；枚举字面量沿用 architecture.md / v2 的取值
 * （如 session status 的 'waiting_option'、agent status 的 'reading_file'）。
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// 共享结构
// ---------------------------------------------------------------------------

/** 会话状态机（architecture.md §5.3；枚举值按 §4.1 session_digest_update 原文）。 */
export const sessionStatusSchema = z.enum([
  'idle',
  'running',
  'waiting_option',
  'done',
  'error',
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/** agent 工作状态标签（v2 StatusEnum 原值沿用，extract/protocol.md §5.2）。 */
export const agentStatusSchema = z.enum([
  'thinking',
  'reading_file',
  'executing',
  'outputting',
  'error',
  'idle',
])
export type AgentStatus = z.infer<typeof agentStatusSchema>

/** 附件（C→S，user_input 携带）。v2 Attachment 字段 camelCase 化，null 统一改 optional。 */
export const attachmentSchema = z.object({
  id: z.string().optional(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  /** base64 内容或 URL */
  data: z.string(),
})
export type Attachment = z.infer<typeof attachmentSchema>

/** 产物（S→C，agent_complete 携带）。v2 四类沿用：image/file/mermaid/latex。 */
export const artifactSchema = z.object({
  type: z.enum(['image', 'file', 'mermaid', 'latex']),
  mimeType: z.string().optional(),
  /** base64 或 URL；mermaid/latex 时可直接是源码文本 */
  data: z.string().optional(),
  caption: z.string().optional(),
})
export type Artifact = z.infer<typeof artifactSchema>

/** 任务清单条目；todo_update 每次发全量快照。 */
export const todoItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
})
export type TodoItem = z.infer<typeof todoItemSchema>

/** option_request 的单个选项。 */
export const optionItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
})
export type OptionItem = z.infer<typeof optionItemSchema>

/** 会话元数据（session_list_response 用，字段清单见 architecture.md §4.1）。 */
export const sessionMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  personaId: z.string(),
  status: sessionStatusSchema,
  lastMessagePreview: z.string().optional(),
  /** Unix 毫秒整数 */
  updatedAt: z.number().int(),
  unreadCount: z.number().int().nonnegative(),
  /** 会话工作目录（additive；缺省 = 跟随全局 dionysus.workingDir） */
  workingDir: z.string().optional(),
})
export type SessionMeta = z.infer<typeof sessionMetaSchema>

/** JSONL 落盘的 message 行（history_response / SessionStore 共用）。 */
export const messageLineSchema = z.object({
  type: z.literal('message'),
  id: z.string(),
  role: z.enum(['user', 'agent', 'system']),
  text: z.string(),
  attachments: z.array(attachmentSchema).optional(),
  artifacts: z.array(artifactSchema).optional(),
  /** Unix 毫秒整数 */
  ts: z.number().int(),
})
export type MessageLine = z.infer<typeof messageLineSchema>

/**
 * JSONL 落盘的瞬态 event 行（architecture.md §4.1 落盘策略）：
 * companion_message 与每回合末 todo_update 终态快照，除在线广播外追加写入
 * 会话 JSONL 作为 type: 'event' 行；汇报不持久化为 Message、不进会话消息流。
 */
export const transientEventSchema = z.discriminatedUnion('eventType', [
  z.object({
    type: z.literal('event'),
    eventType: z.literal('companion_message'),
    payload: z.lazy((): z.ZodType<CompanionMessagePayload> => companionMessagePayloadSchema),
    ts: z.number().int(),
  }),
  z.object({
    type: z.literal('event'),
    eventType: z.literal('todo_update'),
    payload: z.lazy((): z.ZodType<TodoUpdatePayload> => todoUpdatePayloadSchema),
    ts: z.number().int(),
  }),
])
export type TransientEvent = z.infer<typeof transientEventSchema>

// ---------------------------------------------------------------------------
// 信封
// ---------------------------------------------------------------------------

/** 消息信封（architecture.md §4.1）。 */
export interface Envelope<T extends string, P> {
  /** 协议版本，冻结为 1 */
  v: 1
  /** 消息类型，全词命名 */
  type: T
  /** 请求-响应关联 */
  traceId?: string
  /** 会话相关消息携带；全局消息省略并以 payload.scope 表达 */
  sessionId?: string
  /** per-session 单调递增序号，由 BroadcastHub 在扇出前赋值（断连补拉游标） */
  seq?: number
  /** 回合内全部下游消息共享（打断去重/幂等） */
  turnId?: string
  /** Unix 毫秒整数 */
  ts: number
  payload: P
}

const envelopeBase = z.object({
  v: z.literal(1),
  traceId: z.string().optional(),
  sessionId: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
  turnId: z.string().optional(),
  ts: z.number().int(),
})

function messageSchema<L extends string, P extends z.ZodTypeAny>(type: L, payload: P) {
  return envelopeBase.extend({ type: z.literal(type), payload })
}

// ---------------------------------------------------------------------------
// C → S payload
// ---------------------------------------------------------------------------

/** hello：声明支持的协议版本范围，服务端以 handshake 回选定版本。 */
export const helloPayloadSchema = z.object({
  minVersion: z.number().int().min(1).default(1),
  maxVersion: z.number().int().min(1).default(1),
})
export type HelloPayload = z.infer<typeof helloPayloadSchema>

export const pingPayloadSchema = z.object({})
export type PingPayload = z.infer<typeof pingPayloadSchema>

export const newSessionPayloadSchema = z.object({
  personaId: z.string().optional(),
  /** 指定适配器（additive；缺省 = 宿主默认 adapter） */
  adapterId: z.string().optional(),
  /** 指定标题（additive；缺省 = 「新会话」，首回合后自动命名） */
  title: z.string().optional(),
  /** 会话工作目录（additive；缺省 = 全局 dionysus.workingDir） */
  workingDir: z.string().optional(),
})
export type NewSessionPayload = z.infer<typeof newSessionPayloadSchema>

/** 斜杠命令透传（命令行为见 architecture.md §5.3 session/commands.ts）。 */
export const clientCommandPayloadSchema = z.object({
  command: z.string(),
  args: z.string().optional(),
  /** 备用文本参数（后端取 args or text，沿用 v2 语义） */
  text: z.string().optional(),
})
export type ClientCommandPayload = z.infer<typeof clientCommandPayloadSchema>

export const inputModeSchema = z.enum(['normal', 'plan', 'yolo', 'plan_yolo'])
export type InputMode = z.infer<typeof inputModeSchema>

export const userInputPayloadSchema = z.object({
  text: z.string(),
  attachments: z.array(attachmentSchema).default([]),
  /** agent 运行模式，透传给 adapter */
  mode: inputModeSchema.default('normal'),
})
export type UserInputPayload = z.infer<typeof userInputPayloadSchema>

export const optionSelectedPayloadSchema = z.object({
  selectedId: z.string(),
  selectedLabel: z.string(),
})
export type OptionSelectedPayload = z.infer<typeof optionSelectedPayloadSchema>

export const interruptPayloadSchema = z.object({
  reason: z.enum(['user_request', 'timeout', 'system']).default('user_request'),
  /** 打断后顺带插入的一条用户消息（作为 USER 消息持久化） */
  insertMessage: z.string().optional(),
})
export type InterruptPayload = z.infer<typeof interruptPayloadSchema>

/** 断连补拉（architecture.md §4.1 / ADR-11）。 */
export const syncRequestPayloadSchema = z.object({
  sessionId: z.string(),
  afterSeq: z.number().int().nonnegative(),
})
export type SyncRequestPayload = z.infer<typeof syncRequestPayloadSchema>

export const sessionListRequestPayloadSchema = z.object({})
export type SessionListRequestPayload = z.infer<typeof sessionListRequestPayloadSchema>

/** 历史分页。 */
export const historyRequestPayloadSchema = z.object({
  sessionId: z.string(),
  beforeTs: z.number().int().optional(),
  limit: z.number().int().positive(),
})
export type HistoryRequestPayload = z.infer<typeof historyRequestPayloadSchema>

/**
 * focus_session（C→S）：sidebar 点击会话项——宿主聚焦聊天面板并向 chat
 * webview 单播 session_switched（跨 webview 切换不经广播，避免多端互抢）。
 */
export const focusSessionPayloadSchema = z.object({
  sessionId: z.string().min(1),
})
export type FocusSessionPayload = z.infer<typeof focusSessionPayloadSchema>

/**
 * cli_session_list_request（C→S）：查询指定会话对应 CLI 的历史会话索引
 * （kimi：~/.kimi-code/session_index.jsonl，按会话工作目录过滤）。
 */
export const cliSessionListRequestPayloadSchema = z.object({
  sessionId: z.string().min(1),
})
export type CliSessionListRequestPayload = z.infer<typeof cliSessionListRequestPayloadSchema>

/**
 * working_dir_pick_request（C→S）：请求宿主弹目录选择框（新建会话的
 * 「选择工作目录」步骤）；响应经 working_dir_pick_response 单播，traceId 关联。
 */
export const workingDirPickRequestPayloadSchema = z.object({
  /** 选择框默认打开目录（可选） */
  defaultPath: z.string().optional(),
})
export type WorkingDirPickRequestPayload = z.infer<typeof workingDirPickRequestPayloadSchema>

// ---------------------------------------------------------------------------
// S → C payload
// ---------------------------------------------------------------------------

/** handshake：hello 的响应，重连时同样下发；携带全量会话 digest 快照与各会话 latestSeq。 */
export const handshakePayloadSchema = z.object({
  /** 服务端选定的协议版本 */
  v: z.literal(1),
  clientId: z.string(),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      title: z.string(),
      status: sessionStatusSchema,
      latestSeq: z.number().int().nonnegative(),
    }),
  ),
})
export type HandshakePayload = z.infer<typeof handshakePayloadSchema>

export const pongPayloadSchema = z.object({})
export type PongPayload = z.infer<typeof pongPayloadSchema>

/** agent 输出流式 chunk；thinking 复用 isThinking 标志，无独立 thinking_stream 类型。 */
export const agentStreamPayloadSchema = z.object({
  chunk: z.string(),
  isFinal: z.boolean().default(false),
  status: agentStatusSchema.default('outputting'),
  isThinking: z.boolean().default(false),
})
export type AgentStreamPayload = z.infer<typeof agentStreamPayloadSchema>

/** 一回合结束；错误经 status='error' + errorMessage 表达，无独立 error 类型。 */
export const agentCompletePayloadSchema = z.object({
  status: z.enum(['success', 'error', 'interrupted']),
  durationMs: z.number().nonnegative().optional(),
  artifacts: z.array(artifactSchema).default([]),
  errorMessage: z.string().optional(),
})
export type AgentCompletePayload = z.infer<typeof agentCompletePayloadSchema>

export const statusUpdatePayloadSchema = z.object({
  status: agentStatusSchema,
  detail: z.string(),
  progress: z.number().optional(),
})
export type StatusUpdatePayload = z.infer<typeof statusUpdatePayloadSchema>

export const toolKindSchema = z.enum(['read', 'edit', 'bash', 'search', 'other'])
export type ToolKind = z.infer<typeof toolKindSchema>

/**
 * tool_call（architecture.md §4.1 字段级 schema）：
 * 结构化工具调用，取代 v2 前端 emoji 正则刮文本流的做法。
 */
export const toolCallPayloadSchema = z.object({
  /** 优先取 CLI 原生 id；无则由策略合成 `${turnId}-${n}` */
  toolCallId: z.string(),
  /** 原始工具名，如 read_file / Bash / edit */
  name: z.string(),
  /** 策略按工具名映射表归类 */
  kind: toolKindSchema,
  /** 结构化参数（kimi 的 arguments JSON 字符串须先 JSON.parse） */
  args: z.record(z.unknown()),
  /** 文件路径或命令行摘要，core 侧截断至 120 字符 */
  displayTarget: z.string(),
})
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>

/**
 * tool_result（architecture.md §4.1 字段级 schema）。
 */
export const toolResultPayloadSchema = z.object({
  /** 有原生 id 直接配对；无则策略按 FIFO 配对最近一个未闭合 tool_call */
  toolCallId: z.string(),
  /** codex exit_code==0 / codebuddy is_error 取反；无信息默认 true */
  ok: z.boolean(),
  /** 结果摘要，core 侧统一截断 2000 字符，超出标注 truncated */
  summary: z.string(),
  durationMs: z.number().nonnegative().optional(),
})
export type ToolResultPayload = z.infer<typeof toolResultPayloadSchema>

export const optionRequestPayloadSchema = z.object({
  question: z.string(),
  options: z.array(optionItemSchema),
  uiType: z.enum(['button_group', 'dropdown', 'card_list', 'input_confirm']).default('button_group'),
  timeoutSeconds: z.number().int().positive().default(60),
})
export type OptionRequestPayload = z.infer<typeof optionRequestPayloadSchema>

/**
 * session_digest_update（广播；会话状态每次跃迁时由 core 发出，QQ 式列表的数据源）。
 * 注意 payload 内自带 seq（与 envelope.seq 同值，digest 快照自包含）。
 */
export const sessionDigestUpdatePayloadSchema = z.object({
  sessionId: z.string(),
  title: z.string(),
  status: sessionStatusSchema,
  /** 一行当前动作摘要，如「正在读 auth.ts」 */
  currentAction: z.string().optional(),
  /** 按该会话 todo 的进度（「7 步做到第 3 步」） */
  todoProgress: z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).optional(),
  pendingOptionRequest: z.boolean(),
  lastActivityAt: z.number().int(),
  seq: z.number().int().nonnegative(),
  /** 会话绑定的适配器 id（Phase 5 追加，additive；列表项 adapter 徽标数据源，ux-core-flows §2.2） */
  adapterId: z.string().optional(),
  /** 会话工作目录（additive；列表项 title 属性数据源） */
  workingDir: z.string().optional(),
  /** 会话绑定的 persona id（additive；列表项头像数据源） */
  personaId: z.string().optional(),
})
export type SessionDigestUpdatePayload = z.infer<typeof sessionDigestUpdatePayloadSchema>

export const sessionListResponsePayloadSchema = z.object({
  sessions: z.array(sessionMetaSchema),
})
export type SessionListResponsePayload = z.infer<typeof sessionListResponsePayloadSchema>

/** 历史分页响应：entries 含 message 行与 event 行。 */
export const historyResponsePayloadSchema = z.object({
  sessionId: z.string(),
  entries: z.array(z.union([messageLineSchema, transientEventSchema])),
  hasMore: z.boolean(),
})
export type HistoryResponsePayload = z.infer<typeof historyResponsePayloadSchema>

/** user_message_echo：多端回显；向除来源 clientId 外的所有客户端广播。 */
export const userMessageEchoPayloadSchema = z.object({
  text: z.string(),
  attachments: z.array(attachmentSchema).optional(),
  /** 来源标识，供 UI 标注「来自手机」 */
  origin: z.string(),
})
export type UserMessageEchoPayload = z.infer<typeof userMessageEchoPayloadSchema>

/** option_resolved：选项竞态解决；各端收到后将对应选项组置为已决态。 */
export const optionResolvedPayloadSchema = z.object({
  requestTraceId: z.string(),
  selectedId: z.string(),
  origin: z.string(),
})
export type OptionResolvedPayload = z.infer<typeof optionResolvedPayloadSchema>

/** emotion_update：陪伴情绪/Live2D 表情动作（v3 删除 live2d_action，统一走此消息）。 */
export const emotionUpdatePayloadSchema = z.object({
  /** 情绪名由 persona 配置决定，协议层不枚举 */
  emotion: z.string(),
  confidence: z.number().min(0).max(1).default(1),
  /** 要播放的 Live2D 表情名 */
  expression: z.string().optional(),
  /** 要播放的 Live2D 动作名 */
  motion: z.string().optional(),
})
export type EmotionUpdatePayload = z.infer<typeof emotionUpdatePayloadSchema>

/**
 * companion_message：角色旁白（Scheduler 聚合句 / Supervisor 播报 / 会话级台词），全部单向。
 * scope='global' 时 envelope.sessionId 省略，客户端不得按会话过滤丢弃（ADR-17）。
 */
export const companionMessagePayloadSchema = z.object({
  text: z.string(),
  scope: z.enum(['session', 'global']),
  emotion: z.string().optional(),
  /** 来源会话标注（如「来自：重构 auth」气泡角标），点击可跳转 */
  sourceSessionId: z.string().optional(),
  sourceTitle: z.string().optional(),
})
export type CompanionMessagePayload = z.infer<typeof companionMessagePayloadSchema>

/** todo_update：任务清单全量快照（非增量）。 */
export const todoUpdatePayloadSchema = z.object({
  items: z.array(todoItemSchema),
})
export type TodoUpdatePayload = z.infer<typeof todoUpdatePayloadSchema>

/** system_notice：斜杠命令结果、错误提示的通用载体。 */
export const systemNoticePayloadSchema = z.object({
  text: z.string(),
  level: z.enum(['info', 'warning', 'error']).default('info'),
})
export type SystemNoticePayload = z.infer<typeof systemNoticePayloadSchema>

/**
 * session_switched（S→C，单播）：宿主确认 focus_session 后发给 chat webview，
 * chat 据此把 currentSessionId 切到目标会话（并复用进入会话逻辑拉历史/清未读）。
 */
export const sessionSwitchedPayloadSchema = z.object({
  sessionId: z.string().min(1),
})
export type SessionSwitchedPayload = z.infer<typeof sessionSwitchedPayloadSchema>

/** CLI 历史会话索引条目（cli_session_list_response 元素；kimi session_index.jsonl 行）。 */
export const cliSessionIndexEntrySchema = z.object({
  /** CLI 侧会话 id（/resume <id> 的入参） */
  id: z.string(),
  /** 该 CLI 会话的工作目录 */
  workDir: z.string(),
  title: z.string().optional(),
  /** Unix 毫秒整数（索引提供时携带） */
  updatedAt: z.number().int().optional(),
})
export type CliSessionIndexEntry = z.infer<typeof cliSessionIndexEntrySchema>

/**
 * cli_session_list_response（S→C，单播）：supported=false 表示该会话绑定的
 * 助手无会话索引能力（UI 标注「该助手暂不支持」）。
 */
export const cliSessionListResponsePayloadSchema = z.object({
  sessionId: z.string(),
  supported: z.boolean(),
  sessions: z.array(cliSessionIndexEntrySchema),
})
export type CliSessionListResponsePayload = z.infer<typeof cliSessionListResponsePayloadSchema>

/** working_dir_pick_response（S→C，单播）：用户取消时 canceled=true 且无 path。 */
export const workingDirPickResponsePayloadSchema = z.object({
  path: z.string().optional(),
  canceled: z.boolean(),
})
export type WorkingDirPickResponsePayload = z.infer<typeof workingDirPickResponsePayloadSchema>

// ---------------------------------------------------------------------------
// 角色素材库与 persona voice 客制化（architecture.md §7 / ux-core-flows.md §5.5）
// ---------------------------------------------------------------------------

/** 「平淡汇报 → 角色口吻」改写样例对（voice.examples 的元素）。 */
export const voiceExampleSchema = z.object({
  plain: z.string(),
  styled: z.string(),
})
export type VoiceExample = z.infer<typeof voiceExampleSchema>

/**
 * persona voice 段全量形状（persona_list_response 携带，camelCase 协议风格；
 * YAML 文件的蛇形键 rewriter_prompt 在此为 rewriterPrompt）。
 */
export const personaVoiceSchema = z.object({
  /** 语气自然语言描述，如「冷静克制、偶尔毒舌」 */
  tone: z.string(),
  /** 口头禅/句尾口癖 */
  catchphrases: z.array(z.string()),
  /** 角色绝不会说的词句（rewriter 输出校验用） */
  taboos: z.array(z.string()),
  /** 3-5 对改写样例（LLM few-shot / template 风格基准） */
  examples: z.array(voiceExampleSchema),
  /** LLM 模式指令模板，支持 {tone} {examples} 占位符 */
  rewriterPrompt: z.string(),
})
export type PersonaVoice = z.infer<typeof personaVoiceSchema>

/** persona_update / voice_preview 的 voice 增量：五字段逐键可选，只写 diff 键。 */
export const personaVoiceUpdateSchema = personaVoiceSchema.partial()
export type PersonaVoiceUpdate = z.infer<typeof personaVoiceUpdateSchema>

/** Live2D 触摸区域配置（ADR-16：随 persona 下发，前端本地选句）。 */
export const touchZoneSchema = z.object({
  expression: z.string().optional(),
  lines: z.array(z.string()),
})
export type TouchZone = z.infer<typeof touchZoneSchema>

/** 显式动作/表情文件清单条目（model3.json 未声明 Motions/Expressions 段时回退注入）。 */
export const live2dManifestEntrySchema = z.object({
  /** 表情名 / 动作组名（playExpression/playMotion 的入参） */
  name: z.string(),
  /** 相对模型目录的文件路径 */
  file: z.string(),
})
export type Live2DManifestEntry = z.infer<typeof live2dManifestEntrySchema>

/**
 * persona companion.live2d 段的 webview 消费面（persona_list_response 追加字段，
 * 全部可选）。core 侧只做蛇形键 → camelCase 透传，不逐项解释。
 */
export const personaLive2dSchema = z.object({
  /** emotion → Live2D 表情名 */
  expressions: z.record(z.string()).optional(),
  /** emotion/语义 → Live2D 动作组名 */
  motions: z.record(z.string()).optional(),
  defaultExpression: z.string().optional(),
  /** 模型缩放系数（persona live2d.scale） */
  scale: z.number().optional(),
  expressionFiles: z.array(live2dManifestEntrySchema).optional(),
  motionFiles: z.array(live2dManifestEntrySchema).optional(),
})
export type PersonaLive2d = z.infer<typeof personaLive2dSchema>

/** persona 摘要（persona_list_response 元素）。 */
export const personaSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** 头像相对其素材根（builtin = 内嵌 assets/，user = character-library/）的 POSIX 路径 */
  avatarPath: z.string().optional(),
  avatarSource: z.enum(['builtin', 'user']).optional(),
  voice: personaVoiceSchema,
  touchZones: z.record(touchZoneSchema),
  /** asWebviewUri 解析后的 model3.json URL（有 live2d 素材且宿主注入了 uriResolver 时存在） */
  modelUrl: z.string().optional(),
  /** emotion → asWebviewUri 解析后的立绘 URL（有 static 素材时存在） */
  portraitUrls: z.record(z.string()).optional(),
  /** persona live2d 段透传（表情/动作映射 + 显式文件清单） */
  live2d: personaLive2dSchema.optional(),
})
export type PersonaSummary = z.infer<typeof personaSummarySchema>

export const personaListRequestPayloadSchema = z.object({})
export type PersonaListRequestPayload = z.infer<typeof personaListRequestPayloadSchema>

export const personaListResponsePayloadSchema = z.object({
  personas: z.array(personaSummarySchema),
})
export type PersonaListResponsePayload = z.infer<typeof personaListResponsePayloadSchema>

/** 更新 voice 段五字段 + 可选 name/description；服务端写 runtime persona YAML（只写 diff 键）。 */
export const personaUpdateRequestPayloadSchema = z.object({
  personaId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  voice: personaVoiceUpdateSchema.optional(),
})
export type PersonaUpdateRequestPayload = z.infer<typeof personaUpdateRequestPayloadSchema>

export const personaUpdateResponsePayloadSchema = z.object({
  personaId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
})
export type PersonaUpdateResponsePayload = z.infer<typeof personaUpdateResponsePayloadSchema>

/** 试听：输入平淡文本，返回 template 引擎改写结果；voice 增量可预览未保存的表单编辑。 */
export const voicePreviewRequestPayloadSchema = z.object({
  personaId: z.string().min(1),
  text: z.string(),
  voice: personaVoiceUpdateSchema.optional(),
})
export type VoicePreviewRequestPayload = z.infer<typeof voicePreviewRequestPayloadSchema>

export const voicePreviewResponsePayloadSchema = z.object({
  personaId: z.string(),
  original: z.string(),
  rewritten: z.string(),
  error: z.string().optional(),
})
export type VoicePreviewResponsePayload = z.infer<typeof voicePreviewResponsePayloadSchema>

/** 素材库条目（character_list_response 元素）。 */
export const characterAssetEntrySchema = z.object({
  /** 覆盖键：`${personaId}:${kind}` */
  id: z.string(),
  name: z.string(),
  personaId: z.string(),
  kind: z.enum(['live2d', 'static']),
  source: z.enum(['builtin', 'user']),
  /** asWebviewUri 解析后的 model3.json URL（kind='live2d' 且宿主注入了 uriResolver 时存在） */
  modelUrl: z.string().optional(),
})
export type CharacterAssetEntry = z.infer<typeof characterAssetEntrySchema>

/** 角色展示模式（per-device 可配，§6.5）。 */
export const displayModeSchema = z.enum(['live2d', 'static'])
export type DisplayModeSetting = z.infer<typeof displayModeSchema>

export const characterListRequestPayloadSchema = z.object({})
export type CharacterListRequestPayload = z.infer<typeof characterListRequestPayloadSchema>

export const characterListResponsePayloadSchema = z.object({
  characters: z.array(characterAssetEntrySchema),
  /** 当前 per-device 展示模式（dionysus.character.display.* 设置值） */
  display: z.object({
    desktop: displayModeSchema,
    mobile: displayModeSchema,
  }),
  /** dionysus.persona.default 原始设置值；空串 = 自动按素材探测 */
  defaultPersonaId: z.string(),
})
export type CharacterListResponsePayload = z.infer<typeof characterListResponsePayloadSchema>

/** 设置页可写回的设置键白名单（其余 dionysus.* 一律经 VS Code 设置 UI，不走协议）。 */
export const settingsKeySchema = z.enum([
  'persona.default',
  'character.display.desktop',
  'character.display.mobile',
])
export type SettingsKey = z.infer<typeof settingsKeySchema>

export const settingsUpdateRequestPayloadSchema = z.object({
  key: settingsKeySchema,
  value: z.string(),
})
export type SettingsUpdateRequestPayload = z.infer<typeof settingsUpdateRequestPayloadSchema>

export const settingsUpdateResponsePayloadSchema = z.object({
  key: settingsKeySchema,
  ok: z.boolean(),
  error: z.string().optional(),
})
export type SettingsUpdateResponsePayload = z.infer<typeof settingsUpdateResponsePayloadSchema>

// ---------------------------------------------------------------------------
// AI 助手（adapter）清单与模型配置（additive：设置页/新建会话的模型选择能力）
// ---------------------------------------------------------------------------

/** adapter_list_response 的单条助手信息。 */
export const adapterListEntrySchema = z.object({
  /** 适配器 id（dionysus.adapters 的键，如 kimi_cli） */
  id: z.string(),
  /** CLI 可执行文件名 */
  command: z.string(),
  /** cli-detect 探测到已安装（用户手动配置的自定义适配器视为已安装） */
  installed: z.boolean(),
  /**
   * 是否消费 dionysus.adapters.<id>.model；false 时 UI 标注「该助手不支持选模型」
   * （kimi 无 --model 参数；codex 的 model 是死配置，extract/adapters.md §5.3/§7.7）。
   */
  supportsModel: z.boolean(),
  /** 当前配置的模型名；空串 = 未指定（用 CLI 默认模型） */
  model: z.string(),
})
export type AdapterListEntry = z.infer<typeof adapterListEntrySchema>

export const adapterListRequestPayloadSchema = z.object({})
export type AdapterListRequestPayload = z.infer<typeof adapterListRequestPayloadSchema>

export const adapterListResponsePayloadSchema = z.object({
  adapters: z.array(adapterListEntrySchema),
  /** 当前生效的默认助手 id（dionysus.adapter.default 或首个可用 CLI；空串 = 无） */
  defaultAdapterId: z.string(),
})
export type AdapterListResponsePayload = z.infer<typeof adapterListResponsePayloadSchema>

/**
 * adapter_model_update_request（C→S）：写入 dionysus.adapters.<adapterId>.model
 * （空串 = 清除，恢复 CLI 默认模型）。独立于 settings_update_request——其 key 白名单
 * 是枚举，无法表达 per-adapter 动态键，故新增本 additive 消息。
 */
export const adapterModelUpdateRequestPayloadSchema = z.object({
  adapterId: z.string().min(1),
  model: z.string(),
})
export type AdapterModelUpdateRequestPayload = z.infer<typeof adapterModelUpdateRequestPayloadSchema>

export const adapterModelUpdateResponsePayloadSchema = z.object({
  adapterId: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
})
export type AdapterModelUpdateResponsePayload = z.infer<typeof adapterModelUpdateResponsePayloadSchema>

export const personaListRequestSchema = messageSchema('persona_list_request', personaListRequestPayloadSchema)
export const personaListResponseSchema = messageSchema('persona_list_response', personaListResponsePayloadSchema)
export const personaUpdateRequestSchema = messageSchema('persona_update_request', personaUpdateRequestPayloadSchema)
export const personaUpdateResponseSchema = messageSchema('persona_update_response', personaUpdateResponsePayloadSchema)
export const voicePreviewRequestSchema = messageSchema('voice_preview_request', voicePreviewRequestPayloadSchema)
export const voicePreviewResponseSchema = messageSchema('voice_preview_response', voicePreviewResponsePayloadSchema)
export const characterListRequestSchema = messageSchema('character_list_request', characterListRequestPayloadSchema)
export const characterListResponseSchema = messageSchema('character_list_response', characterListResponsePayloadSchema)
export const settingsUpdateRequestSchema = messageSchema('settings_update_request', settingsUpdateRequestPayloadSchema)
export const settingsUpdateResponseSchema = messageSchema('settings_update_response', settingsUpdateResponsePayloadSchema)
export const adapterListRequestSchema = messageSchema('adapter_list_request', adapterListRequestPayloadSchema)
export const adapterListResponseSchema = messageSchema('adapter_list_response', adapterListResponsePayloadSchema)
export const adapterModelUpdateRequestSchema = messageSchema('adapter_model_update_request', adapterModelUpdateRequestPayloadSchema)
export const adapterModelUpdateResponseSchema = messageSchema('adapter_model_update_response', adapterModelUpdateResponsePayloadSchema)

export type PersonaListRequestMessage = z.infer<typeof personaListRequestSchema>
export type PersonaListResponseMessage = z.infer<typeof personaListResponseSchema>
export type PersonaUpdateRequestMessage = z.infer<typeof personaUpdateRequestSchema>
export type PersonaUpdateResponseMessage = z.infer<typeof personaUpdateResponseSchema>
export type VoicePreviewRequestMessage = z.infer<typeof voicePreviewRequestSchema>
export type VoicePreviewResponseMessage = z.infer<typeof voicePreviewResponseSchema>
export type CharacterListRequestMessage = z.infer<typeof characterListRequestSchema>
export type CharacterListResponseMessage = z.infer<typeof characterListResponseSchema>
export type SettingsUpdateRequestMessage = z.infer<typeof settingsUpdateRequestSchema>
export type SettingsUpdateResponseMessage = z.infer<typeof settingsUpdateResponseSchema>
export type AdapterListRequestMessage = z.infer<typeof adapterListRequestSchema>
export type AdapterListResponseMessage = z.infer<typeof adapterListResponseSchema>
export type AdapterModelUpdateRequestMessage = z.infer<typeof adapterModelUpdateRequestSchema>
export type AdapterModelUpdateResponseMessage = z.infer<typeof adapterModelUpdateResponseSchema>

// ---------------------------------------------------------------------------
// 消息 schema（信封 + payload）
// ---------------------------------------------------------------------------

export const helloSchema = messageSchema('hello', helloPayloadSchema)
export const pingSchema = messageSchema('ping', pingPayloadSchema)
export const newSessionSchema = messageSchema('new_session', newSessionPayloadSchema)
export const clientCommandSchema = messageSchema('client_command', clientCommandPayloadSchema)
export const userInputSchema = messageSchema('user_input', userInputPayloadSchema)
export const optionSelectedSchema = messageSchema('option_selected', optionSelectedPayloadSchema)
export const interruptSchema = messageSchema('interrupt', interruptPayloadSchema)
export const syncRequestSchema = messageSchema('sync_request', syncRequestPayloadSchema)
export const sessionListRequestSchema = messageSchema('session_list_request', sessionListRequestPayloadSchema)
export const historyRequestSchema = messageSchema('history_request', historyRequestPayloadSchema)
export const focusSessionSchema = messageSchema('focus_session', focusSessionPayloadSchema)
export const cliSessionListRequestSchema = messageSchema('cli_session_list_request', cliSessionListRequestPayloadSchema)
export const workingDirPickRequestSchema = messageSchema('working_dir_pick_request', workingDirPickRequestPayloadSchema)

/** C→S 全部消息（20 种）。 */
export const clientMessageSchema = z.discriminatedUnion('type', [
  helloSchema,
  pingSchema,
  newSessionSchema,
  clientCommandSchema,
  userInputSchema,
  optionSelectedSchema,
  interruptSchema,
  syncRequestSchema,
  sessionListRequestSchema,
  historyRequestSchema,
  focusSessionSchema,
  cliSessionListRequestSchema,
  workingDirPickRequestSchema,
  personaListRequestSchema,
  personaUpdateRequestSchema,
  voicePreviewRequestSchema,
  characterListRequestSchema,
  settingsUpdateRequestSchema,
  adapterListRequestSchema,
  adapterModelUpdateRequestSchema,
])

export type HelloMessage = z.infer<typeof helloSchema>
export type PingMessage = z.infer<typeof pingSchema>
export type NewSessionMessage = z.infer<typeof newSessionSchema>
export type ClientCommandMessage = z.infer<typeof clientCommandSchema>
export type UserInputMessage = z.infer<typeof userInputSchema>
export type OptionSelectedMessage = z.infer<typeof optionSelectedSchema>
export type InterruptMessage = z.infer<typeof interruptSchema>
export type SyncRequestMessage = z.infer<typeof syncRequestSchema>
export type SessionListRequestMessage = z.infer<typeof sessionListRequestSchema>
export type HistoryRequestMessage = z.infer<typeof historyRequestSchema>
export type FocusSessionMessage = z.infer<typeof focusSessionSchema>
export type CliSessionListRequestMessage = z.infer<typeof cliSessionListRequestSchema>
export type WorkingDirPickRequestMessage = z.infer<typeof workingDirPickRequestSchema>

export type ClientMessage = z.infer<typeof clientMessageSchema>

export const handshakeSchema = messageSchema('handshake', handshakePayloadSchema)
export const pongSchema = messageSchema('pong', pongPayloadSchema)
export const agentStreamSchema = messageSchema('agent_stream', agentStreamPayloadSchema)
export const agentCompleteSchema = messageSchema('agent_complete', agentCompletePayloadSchema)
export const statusUpdateSchema = messageSchema('status_update', statusUpdatePayloadSchema)
export const toolCallSchema = messageSchema('tool_call', toolCallPayloadSchema)
export const toolResultSchema = messageSchema('tool_result', toolResultPayloadSchema)
export const optionRequestSchema = messageSchema('option_request', optionRequestPayloadSchema)
export const sessionDigestUpdateSchema = messageSchema('session_digest_update', sessionDigestUpdatePayloadSchema)
export const sessionListResponseSchema = messageSchema('session_list_response', sessionListResponsePayloadSchema)
export const historyResponseSchema = messageSchema('history_response', historyResponsePayloadSchema)
export const userMessageEchoSchema = messageSchema('user_message_echo', userMessageEchoPayloadSchema)
export const optionResolvedSchema = messageSchema('option_resolved', optionResolvedPayloadSchema)
export const emotionUpdateSchema = messageSchema('emotion_update', emotionUpdatePayloadSchema)
export const companionMessageSchema = messageSchema('companion_message', companionMessagePayloadSchema)
export const todoUpdateSchema = messageSchema('todo_update', todoUpdatePayloadSchema)
export const systemNoticeSchema = messageSchema('system_notice', systemNoticePayloadSchema)
export const sessionSwitchedSchema = messageSchema('session_switched', sessionSwitchedPayloadSchema)
export const cliSessionListResponseSchema = messageSchema('cli_session_list_response', cliSessionListResponsePayloadSchema)
export const workingDirPickResponseSchema = messageSchema('working_dir_pick_response', workingDirPickResponsePayloadSchema)

export type HandshakeMessage = z.infer<typeof handshakeSchema>
export type PongMessage = z.infer<typeof pongSchema>
export type AgentStreamMessage = z.infer<typeof agentStreamSchema>
export type AgentCompleteMessage = z.infer<typeof agentCompleteSchema>
export type StatusUpdateMessage = z.infer<typeof statusUpdateSchema>
export type ToolCallMessage = z.infer<typeof toolCallSchema>
export type ToolResultMessage = z.infer<typeof toolResultSchema>
export type OptionRequestMessage = z.infer<typeof optionRequestSchema>
export type SessionDigestUpdateMessage = z.infer<typeof sessionDigestUpdateSchema>
export type SessionListResponseMessage = z.infer<typeof sessionListResponseSchema>
export type HistoryResponseMessage = z.infer<typeof historyResponseSchema>
export type UserMessageEchoMessage = z.infer<typeof userMessageEchoSchema>
export type OptionResolvedMessage = z.infer<typeof optionResolvedSchema>
export type EmotionUpdateMessage = z.infer<typeof emotionUpdateSchema>
export type CompanionMessageMessage = z.infer<typeof companionMessageSchema>
export type TodoUpdateMessage = z.infer<typeof todoUpdateSchema>
export type SystemNoticeMessage = z.infer<typeof systemNoticeSchema>
export type SessionSwitchedMessage = z.infer<typeof sessionSwitchedSchema>
export type CliSessionListResponseMessage = z.infer<typeof cliSessionListResponseSchema>
export type WorkingDirPickResponseMessage = z.infer<typeof workingDirPickResponseSchema>

/**
 * sync_response（architecture.md §4.1）：断连补拉响应。
 * truncated=true 表示 afterSeq 已溢出环形缓冲，events 以一条会话快照开头，其后从缓冲头部续播。
 *
 * events 为 ServerMessage[]，与 serverMessageSchema 互相递归，故类型显式声明、
 * schema 经 z.lazy 打破循环。
 */
export interface SyncResponsePayload {
  sessionId: string
  events: ServerMessage[]
  latestSeq: number
  truncated: boolean
}
export type SyncResponseMessage = Envelope<'sync_response', SyncResponsePayload>

const serverMessageLazy: z.ZodType<ServerMessage> = z.lazy(
  () => serverMessageSchema,
) as z.ZodType<ServerMessage>

export const syncResponsePayloadSchema = z.object({
  sessionId: z.string(),
  events: z.array(serverMessageLazy),
  latestSeq: z.number().int().nonnegative(),
  truncated: z.boolean(),
}) as z.ZodType<SyncResponsePayload>

export const syncResponseSchema = messageSchema('sync_response', syncResponsePayloadSchema)

/** S→C 全部消息（28 种）。 */
export type ServerMessage =
  | HandshakeMessage
  | PongMessage
  | AgentStreamMessage
  | AgentCompleteMessage
  | StatusUpdateMessage
  | ToolCallMessage
  | ToolResultMessage
  | OptionRequestMessage
  | SessionDigestUpdateMessage
  | SessionListResponseMessage
  | HistoryResponseMessage
  | UserMessageEchoMessage
  | OptionResolvedMessage
  | EmotionUpdateMessage
  | CompanionMessageMessage
  | TodoUpdateMessage
  | SystemNoticeMessage
  | SessionSwitchedMessage
  | CliSessionListResponseMessage
  | WorkingDirPickResponseMessage
  | SyncResponseMessage
  | PersonaListResponseMessage
  | PersonaUpdateResponseMessage
  | VoicePreviewResponseMessage
  | CharacterListResponseMessage
  | SettingsUpdateResponseMessage
  | AdapterListResponseMessage
  | AdapterModelUpdateResponseMessage

// 单层 discriminatedUnion：保证 payload 级校验错误携带完整路径（z.union 会把错误塌缩到根）。
export const serverMessageSchema: z.ZodType<ServerMessage> = z.discriminatedUnion('type', [
  handshakeSchema,
  pongSchema,
  agentStreamSchema,
  agentCompleteSchema,
  statusUpdateSchema,
  toolCallSchema,
  toolResultSchema,
  optionRequestSchema,
  sessionDigestUpdateSchema,
  sessionListResponseSchema,
  historyResponseSchema,
  userMessageEchoSchema,
  optionResolvedSchema,
  emotionUpdateSchema,
  companionMessageSchema,
  todoUpdateSchema,
  systemNoticeSchema,
  sessionSwitchedSchema,
  cliSessionListResponseSchema,
  workingDirPickResponseSchema,
  syncResponseSchema,
  personaListResponseSchema,
  personaUpdateResponseSchema,
  voicePreviewResponseSchema,
  characterListResponseSchema,
  settingsUpdateResponseSchema,
  adapterListResponseSchema,
  adapterModelUpdateResponseSchema,
]) as z.ZodType<ServerMessage>
