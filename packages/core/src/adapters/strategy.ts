/**
 * 策略层：CliAdapterStrategy 接口 + JsonStreamStrategy 基类
 *（extract/adapters.md §1、§4；architecture.md §5.2）。
 *
 * 进程管理（GenericCliAdapter）与 CLI 方言（策略）彻底分离：5 个 CLI 共用一个
 * 适配器，差异全部收敛在策略里。基类解析器本质就是 "kimi 方言解析器"，其余
 * 4 个 CLI 的策略先匹配自己的形状、不匹配再 super 落回基类。
 */
import type { AgentStatus, InputMode, OptionItem, ToolKind } from '@dionysus/protocol'

import type { AgentEvent, AgentInput } from './types.js'

/** 适配器实例配置（由宿主注入，core 不读文件；v2 server.yaml 键的 camelCase 化）。 */
export interface AdapterConfig {
  /** 适配器类型别名（如 'kimi_code_cli'），registry 用之推策略名 */
  type?: string
  /** 策略名；type 无映射时的兜底 */
  strategy?: string
  /** 可执行文件名；缺省 = 策略的 adapterId */
  command?: string
  /** 子进程工作目录（路径解析由宿主完成，core 按给定值使用） */
  workingDir?: string
  /** 模型名（仅 supportsModel 的策略消费；null/缺省 = 不传） */
  model?: string | null
  /** 输出格式参数（kimi 默认 'stream-json'） */
  outputFormat?: string
  /** 单行读取超时（秒），默认 120（extract/adapters.md §2.1） */
  requestTimeoutSeconds?: number
  /** false 时 registry 拒绝实例化 */
  enabled?: boolean
  /** 其余 CLI 专有键前向兼容保留 */
  [key: string]: unknown
}

/** buildArgs 的上下文：当前 CLI 会话 id（resume 语义）+ 适配器配置。 */
export interface AdapterContext {
  cliSessionId: string | null
  config: AdapterConfig
}

export type SystemPromptSupport = 'native' | 'prompt-prefix' | 'none'

/** CLI 历史会话索引条目（kimi：~/.kimi-code/session_index.jsonl 行；与 protocol cliSessionIndexEntrySchema 同形）。 */
export interface CliSessionIndexEntry {
  /** CLI 侧会话 id（/resume <id> 的入参） */
  id: string
  /** 该 CLI 会话的工作目录 */
  workDir: string
  title?: string
  /** Unix 毫秒整数（索引提供时携带） */
  updatedAt?: number
}

/**
 * 每 CLI 一个策略：拼命令行 + 解析一行 stdout。
 *
 * v2 → v3 修正：
 * - parseLine 显式返回 { events, cliSessionId? }，废除 session_holder 可变 dict
 *   带外通道（extract/adapters.md §7.3）；
 * - supportsModel / supportsSystemPrompt 为声明式元数据（v2 需实例化读取，§7.4）；
 * - wrapFirstTurnInput 默认实现在 JsonStreamStrategy 基类：systemPrompt + '\n\n' + text。
 */
export interface CliAdapterStrategy {
  /** 稳定 id，如 'kimi_cli' */
  readonly adapterId: string
  readonly supportsModel: boolean
  /** 逐 CLI 结论性赋值；无法核实的保守标 'prompt-prefix'（architecture.md §5.2） */
  readonly supportsSystemPrompt: SystemPromptSupport
  /** 策略理解的模式；不在列表内的 mode 由适配器降级为 'normal' */
  readonly supportedModes: readonly InputMode[]
  buildArgs(input: AgentInput, ctx: AdapterContext): string[]
  parseLine(line: string): { events: AgentEvent[]; cliSessionId?: string }
  /** prompt-prefix 注入（可选增强 dionysus.persona.injectIntoAgent 的载体） */
  wrapFirstTurnInput?(systemPrompt: string, input: AgentInput): AgentInput
  /** 每轮 send 开始时的钩子（重置工具配对等回合内状态） */
  beginTurn?(): void
  /**
   * CLI 历史会话索引能力（/sessions 列表与 webview「恢复历史会话」数据源）；
   * 无索引能力的策略不实现（UI 标注「该助手暂不支持」）。
   * indexPath 为测试注入点，缺省用各 CLI 的约定路径。
   */
  listSessionIndex?(indexPath?: string): Promise<CliSessionIndexEntry[]>
}

/** plan-mode 英文前缀（claude/codex/opencode/codebuddy 逐字相同，extract §6-3）。 */
export const PLAN_MODE_PREFIX_EN =
  'Please enter plan mode: list clear execution steps first, then wait for confirmation before implementing.\n\n'

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const AGENT_STATUSES: readonly AgentStatus[] = [
  'thinking',
  'reading_file',
  'executing',
  'outputting',
  'error',
  'idle',
]

function agentStatusOr(v: unknown, fallback: AgentStatus): AgentStatus {
  return typeof v === 'string' && (AGENT_STATUSES as readonly string[]).includes(v)
    ? (v as AgentStatus)
    : fallback
}

/**
 * 从一行文本中贪心提取连续的顶层 JSON 对象（extract/adapters.md §4.2）。
 * 有的 CLI 一行连发多个对象：`{"role":"assistant"} {"role":"tool"} 残余文本`。
 * 返回解析出的对象列表与剩余裸文本（右 trim）。
 */
export function extractJsonObjects(text: string): {
  objects: Record<string, unknown>[]
  remaining: string
} {
  const objects: Record<string, unknown>[] = []
  let idx = 0
  while (idx < text.length) {
    while (idx < text.length && (text[idx] === ' ' || text[idx] === '\t' || text[idx] === '\r' || text[idx] === '\n')) {
      idx++
    }
    if (idx >= text.length || text[idx] !== '{') break
    const end = findJsonObjectEnd(text, idx)
    if (end === -1) break
    let parsed: unknown
    try {
      parsed = JSON.parse(text.slice(idx, end))
    } catch {
      break
    }
    if (isRecord(parsed)) objects.push(parsed)
    idx = end
  }
  return { objects, remaining: text.slice(idx).trimEnd() }
}

/** 定位从 start（'{'）开始的 JSON 对象结束下标（exclusive）；括号配平且跳过字符串字面量。 */
function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * NDJSON 策略基类（extract/adapters.md §4）。统一假设：stdout 是换行分隔 JSON。
 * 基类 normalizeObject 即 "kimi 方言" 的五分支映射（兼作其余 CLI 的 fallback），
 * 但按 v3 协议产出结构化 tool_call / tool_result 事件（不再是 v2 的 emoji 文本）。
 */
export abstract class JsonStreamStrategy implements CliAdapterStrategy {
  abstract readonly adapterId: string
  abstract buildArgs(input: AgentInput, ctx: AdapterContext): string[]
  readonly supportsModel: boolean = false
  readonly supportsSystemPrompt: SystemPromptSupport = 'prompt-prefix'
  readonly supportedModes: readonly InputMode[] = ['normal', 'plan', 'yolo', 'plan_yolo']
  /** plan/plan_yolo 模式注入的前缀；kimi 覆写为中文版，其余 4 个 CLI 用英文版 */
  protected readonly planModePrefix: string = PLAN_MODE_PREFIX_EN

  /** 回合内工具调用配对状态（beginTurn 重置）：kimi 多数行无原生 id，靠 FIFO 配对 */
  private toolCallCounter = 0
  private pendingToolCallIds: string[] = []

  beginTurn(): void {
    this.toolCallCounter = 0
    this.pendingToolCallIds = []
  }

  /** 默认 prompt-prefix 包装：text = systemPrompt + '\n\n' + input.text，其余字段原样。 */
  wrapFirstTurnInput(systemPrompt: string, input: AgentInput): AgentInput {
    return { ...input, text: `${systemPrompt}\n\n${input.text}` }
  }

  /**
   * 解析一行 stdout（extract §4.1）：0..N 个 JSON 事件 + 0..1 段裸文本。
   * 裸文本（非 JSON 的 CLI 日志噪声，如 kimi 的 "Reading additional input from
   * stdin..."）不再无条件泄进 agent_stream（v2/extract §4.2 行为）：kimi 正文全部
   * 经 stream-json 的 JSON 行承载（extract §5.1，基类五分支无裸文本正文语义），
   * 故降级为 status_update(detail) 显示在状态行——输出不丢，但不污染正文。
   */
  parseLine(line: string): { events: AgentEvent[]; cliSessionId?: string } {
    const events: AgentEvent[] = []
    let cliSessionId: string | undefined
    const { objects, remaining } = extractJsonObjects(line)
    for (const parsed of objects) {
      const sid = this.extractSessionId(parsed)
      if (sid) cliSessionId = sid
      events.push(...this.normalizeObject(parsed))
    }
    if (remaining) {
      events.push({ type: 'status', status: 'outputting', detail: remaining })
    }
    return { events, cliSessionId }
  }

  /** 覆写以捕获 CLI 的 session resume hint（kimi：meta + session.resume_hint）。 */
  protected extractSessionId(_parsed: Record<string, unknown>): string | undefined {
    return undefined
  }

  /**
   * 基类五分支映射（extract §4.3，按优先级；产出已升级为 v3 结构化事件）：
   * 1. role=assistant：content → status+stream 双事件；tool_calls → 结构化 tool_call
   * 2. role=tool：结构化 tool_result（FIFO 配对最近未闭合 tool_call）
   * 3. role=meta：零事件（session hint 已被 extractSessionId 消费）
   * 4. 协议事件透传：type ∈ {agent_stream, status_update, option_request, agent_complete}
   * 5. 未知形状：原始 JSON 文本流（调试用）
   */
  protected normalizeObject(parsed: Record<string, unknown>): AgentEvent[] {
    const role = parsed.role
    const msgType = parsed.type

    if (role === 'assistant') {
      const events: AgentEvent[] = []
      const content = parsed.content
      if (typeof content === 'string' && content) {
        events.push(...this.textBlockEvents(content, '正在输出回复...'))
      }
      const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : []
      for (const tc of toolCalls) {
        events.push(this.toolCallEvent(tc))
      }
      return events
    }

    if (role === 'tool') {
      const content = typeof parsed.content === 'string' ? parsed.content : ''
      if (!content) return []
      return [
        {
          type: 'tool_result',
          toolCallId: this.pairToolResult(),
          ok: true,
          summary: content,
        },
      ]
    }

    if (role === 'meta') {
      return []
    }

    if (
      msgType === 'agent_stream' ||
      msgType === 'status_update' ||
      msgType === 'option_request' ||
      msgType === 'agent_complete'
    ) {
      return [this.passthroughEvent(msgType, parsed)]
    }

    return [this.streamEvent(JSON.stringify(parsed) + '\n')]
  }

  // -------------------------------------------------------------------------
  // 共享 helper（extract §6：v2 在 4 个策略中重复约 10 处的模式）
  // -------------------------------------------------------------------------

  /** 文本块 → status_update + stream 双事件。 */
  protected textBlockEvents(chunk: string, detail: string): AgentEvent[] {
    return [{ type: 'status', status: 'outputting', detail }, this.streamEvent(chunk)]
  }

  /** content/text/message 首个非空字符串（extract §6-2：codex 与 opencode 完全相同的取值链）。 */
  protected pickContent(parsed: Record<string, unknown>): string {
    for (const key of ['content', 'text', 'message']) {
      const v = parsed[key]
      if (typeof v === 'string' && v) return v
    }
    return ''
  }

  protected streamEvent(chunk: string, status: AgentStatus = 'outputting'): AgentEvent {
    return { type: 'stream', chunk, isFinal: false, status, isThinking: false }
  }

  protected thinkingEvent(chunk: string): AgentEvent {
    return { type: 'thinking', chunk, isFinal: false, status: 'thinking', isThinking: true }
  }

  /** 按工具名归类（protocol §4.1 kind 映射表）。 */
  protected toolKindFor(name: string): ToolKind {
    const n = name.toLowerCase()
    if (/read|view|cat|open|load/.test(n)) return 'read'
    if (/edit|write|patch|replace|create|insert|delete/.test(n)) return 'edit'
    if (/bash|shell|cmd|command|exec|run|terminal/.test(n)) return 'bash'
    if (/search|grep|find|glob|query/.test(n)) return 'search'
    return 'other'
  }

  /** 展示目标：从结构化参数里挑文件路径或命令行摘要（core 侧负责截断 120 字符）。 */
  protected displayTargetFor(name: string, args: Record<string, unknown>): string {
    for (const key of ['path', 'file', 'filePath', 'file_path', 'filename', 'command', 'cmd', 'query', 'pattern']) {
      const v = args[key]
      if (typeof v === 'string' && v) return v
    }
    return name
  }

  /**
   * OpenAI 风格 tool_calls[] 项 → 结构化 tool_call 事件。
   * arguments 是 JSON 字符串，先 JSON.parse（extract §4.3）；原生 id 缺失时合成。
   */
  protected toolCallEvent(tc: unknown): AgentEvent {
    const rec = isRecord(tc) ? tc : {}
    const fn = isRecord(rec.function) ? rec.function : {}
    const name = typeof fn.name === 'string' && fn.name ? fn.name : 'tool'
    const rawArgs = typeof fn.arguments === 'string' ? fn.arguments : '{}'
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(rawArgs)
      args = isRecord(parsed) ? parsed : {}
    } catch {
      args = { raw: rawArgs }
    }
    const toolCallId = typeof rec.id === 'string' && rec.id ? rec.id : this.nextToolCallId()
    this.pendingToolCallIds.push(toolCallId)
    return {
      type: 'tool_call',
      toolCallId,
      name,
      kind: this.toolKindFor(name),
      args,
      displayTarget: this.displayTargetFor(name, args),
    }
  }

  /**
   * 合成工具调用 id。protocol 口径为 `${turnId}-${n}`，但 turnId 由 SessionManager
   * 在回合入口生成、适配器层不可得，故用 `${adapterId}-${n}`（beginTurn 重置 n）；
   * 上层如需 turnId 口径可再命名。
   */
  protected nextToolCallId(): string {
    this.toolCallCounter += 1
    return `${this.adapterId}-${this.toolCallCounter}`
  }

  /** FIFO 配对最近一个未闭合 tool_call；无未闭合调用时合成 id 兜底（保持 schema 合法）。 */
  protected pairToolResult(): string {
    return this.pendingToolCallIds.shift() ?? this.nextToolCallId()
  }

  /**
   * 非 OpenAI 形状的工具调用行 → 结构化 tool_call（claude/codex/opencode/codebuddy
   * 各自的 tool_use / tool_call / command_execution 行共用；extract §5.2-5.5）。
   * 原生 id 缺失时合成，入 FIFO 队列等待 tool_result 配对。
   */
  protected makeToolCall(
    name: string,
    args: Record<string, unknown>,
    nativeId?: string,
  ): AgentEvent {
    const toolCallId = nativeId ?? this.nextToolCallId()
    this.pendingToolCallIds.push(toolCallId)
    return {
      type: 'tool_call',
      toolCallId,
      name,
      kind: this.toolKindFor(name),
      args,
      displayTarget: this.displayTargetFor(name, args),
    }
  }

  /** 结构化 tool_result：默认 FIFO 配对最近未闭合 tool_call（基类分支 2 同语义）。 */
  protected makeToolResult(summary: string, ok = true, toolCallId?: string): AgentEvent {
    return { type: 'tool_result', toolCallId: toolCallId ?? this.pairToolResult(), ok, summary }
  }

  /** 协议事件透传（extract §4.3 分支 4；payload 缺失时用除 type 外的全部字段拼一个）。 */
  private passthroughEvent(
    msgType: 'agent_stream' | 'status_update' | 'option_request' | 'agent_complete',
    parsed: Record<string, unknown>,
  ): AgentEvent {
    const payload = isRecord(parsed.payload)
      ? parsed.payload
      : Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== 'type'))
    switch (msgType) {
      case 'agent_stream':
        return {
          type: 'stream',
          chunk: typeof payload.chunk === 'string' ? payload.chunk : '',
          isFinal: payload.isFinal === true,
          status: agentStatusOr(payload.status, 'outputting'),
          isThinking: payload.isThinking === true,
        }
      case 'status_update':
        return {
          type: 'status',
          status: agentStatusOr(payload.status, 'outputting'),
          detail: typeof payload.detail === 'string' ? payload.detail : '',
          ...(typeof payload.progress === 'number' ? { progress: payload.progress } : {}),
        }
      case 'option_request':
        return {
          type: 'option_request',
          question: typeof payload.question === 'string' ? payload.question : '',
          options: (Array.isArray(payload.options) ? payload.options : []) as OptionItem[],
          uiType: 'button_group',
          timeoutSeconds:
            typeof payload.timeoutSeconds === 'number' ? payload.timeoutSeconds : 60,
        }
      case 'agent_complete': {
        const status =
          payload.status === 'error' || payload.status === 'interrupted'
            ? payload.status
            : 'success'
        return {
          type: 'complete',
          status,
          artifacts: [],
          ...(typeof payload.errorMessage === 'string'
            ? { errorMessage: payload.errorMessage }
            : {}),
          ...(typeof payload.durationMs === 'number' ? { durationMs: payload.durationMs } : {}),
        }
      }
    }
  }
}
