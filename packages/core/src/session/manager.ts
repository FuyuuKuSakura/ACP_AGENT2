/**
 * SessionManager：会话 CRUD + 适配器生命周期 + 单一回合管线 runAgentTurn
 *（architecture.md §5.3）。
 *
 * - 会话 ↔ 适配器一对一：每会话经 registry.createAdapter 工厂新建独占实例
 *   （可由 deps.adapterFactory 覆盖，测试注入 FakeAdapter），懒创建于首个回合；
 * - v2 双管线（handle_user_input / handle_option_selected）合并为单一
 *   runAgentTurn(sessionId, input)：option_selected 仅负责把选项转成 input；
 * - 并发模型：单会话 send 串行（回合中新 user_input 排队 + system_notice
 *   提示）；任意数量会话并行 runAgentTurn；事件按 sessionId 归属；
 *   dionysus.maxConcurrentAgents 上限（默认 3），超限发起回合回 system_notice；
 * - turnId 幂等：入口生成 turnId，本回合全部下游消息携带；已终态 turnId
 *   的迟到 complete 忽略（修复 v2 打断后双 agent_complete）；
 * - 会话状态机 idle|running|waiting_option|done|error：option_request 置
 *   waiting_option（正式启用），option_selected 或回合结束清除；每次跃迁
 *   发 session_digest_update（todoProgress 由陪伴层 TodoTracker 经
 *   CompanionHooks 供给，未挂载时占位 {done:0,total:0}）；option 超时按
 *   optionTimeoutAction（deny|default|keep，默认 keep）处理并广播 system_notice；
 * - 陪伴层挂载（Phase 4）：deps.companion 挂 CompanionHooks——runAgentTurn
 *   的回合开始/每个 adapter 事件/回合结束，会话创建/删除/状态跃迁，以及
 *   digest.todoProgress 数据源；manager 不感知 persona 实现（唯一实现方
 *   为 persona/companion.ts）；
 * - 可选注入增强（injectIntoAgent，默认关）：首轮且 !systemPromptInjected 时
 *   按 supportsSystemPrompt 分流（native→adapter.injectSystemPrompt；
 *   prompt-prefix→wrapFirstTurnInput 拼文本），adapter.send 产生首个事件后
 *   置 systemPromptInjected=true 并持久化；包装/发送失败按原始输入重发
 *   （不阻断回合）+ system_notice(warning)；
 * - 标题自动生成：首个回合成功后以首条用户消息截断 20 字符更新标题，
 *   用户手动重命名（titleLocked）后不再覆盖；
 * - 会话事件经 onMessage(cb) 回调外发（不 import vscode/WS），由宿主接
 *   BroadcastHub/Transport；seq 由 BroadcastHub 在扇出前赋值。
 */
import { randomUUID } from 'node:crypto'

import type {
  AgentCompletePayload,
  InterruptPayload,
  OptionItem,
  OptionSelectedPayload,
  ServerMessage,
  SessionDigestUpdatePayload,
  UserInputPayload,
} from '@dionysus/protocol'

import { createAdapter, resolveStrategy } from '../adapters/registry.js'
import type { AdapterConfig, CliSessionIndexEntry, SystemPromptSupport } from '../adapters/strategy.js'
import type { AgentEvent, AgentInput, IAgentAdapter } from '../adapters/types.js'
import type {
  Message,
  OptionTimeoutAction,
  SessionMeta,
  SessionStatus,
  SessionStore,
} from './types.js'

const DEFAULT_MAX_CONCURRENT_AGENTS = 3
const DEFAULT_TITLE = '新会话'
const AUTO_TITLE_MAX_LEN = 20
const TOOL_DISPLAY_TARGET_MAX = 120
const TOOL_RESULT_SUMMARY_MAX = 2000
const MESSAGE_PREVIEW_MAX = 50

/**
 * 陪伴层挂载点（Phase 4；persona/companion.ts 是唯一实现方）。
 * 全部方法可选、返回 void 或 Promise；manager 只在生命周期节点回调，
 * 不感知 engine/scheduler/supervisor/todo-tracker 的任何实现细节。
 */
export interface CompanionHooks {
  /** 回合开始（状态已跃迁 running）：建 engine/tracker、预载 persona */
  onTurnStart?(meta: SessionMeta): void | Promise<void>
  /** 回合内每个 adapter 事件（todo 提取、台词触发） */
  onTurnEvent?(sessionId: string, ev: AgentEvent): void
  /** 回合收尾（恰好一次）：终态 todo 落盘、回合结束即时播报 */
  onTurnEnd?(meta: SessionMeta, status: AgentCompletePayload['status']): void | Promise<void>
  onSessionCreated?(meta: SessionMeta): void
  onSessionDeleted?(sessionId: string): void
  /** 会话状态机实际跃迁时（supervisor 变动检测、scheduler 聚合跟踪） */
  onSessionStatus?(meta: SessionMeta): void
  /** digest.todoProgress 数据源；无 tracker 时返回 undefined → 占位 {0,0} */
  todoProgress?(sessionId: string): { done: number; total: number } | undefined
}

/** 可选注入增强配置（persona system prompt 由宿主/persona 层供给）。 */
export interface InjectConfig {
  enabled: boolean
  /** 取该会话 persona 的 system_prompt；返回 null 表示无可注入内容 */
  getSystemPrompt: (meta: SessionMeta) => string | null
  /** 策略元数据分流；默认 'prompt-prefix'，'none' 忽略开关 */
  supportsSystemPrompt?: SystemPromptSupport
  /** prompt-prefix 包装；缺省 = systemPrompt + '\n\n' + input.text（同策略基类默认实现） */
  wrapFirstTurnInput?: (systemPrompt: string, input: AgentInput) => AgentInput
}

export interface SessionManagerDeps {
  store: SessionStore
  /** 宿主注入的适配器配置（core 不读文件） */
  adapters: Record<string, AdapterConfig>
  defaultAdapterId: string
  defaultPersonaId?: string
  /** dionysus.maxConcurrentAgents，默认 3 */
  maxConcurrentAgents?: number
  /** dionysus.session.optionTimeoutAction，默认 'keep' */
  optionTimeoutAction?: OptionTimeoutAction
  inject?: InjectConfig
  /** 陪伴层挂载（Phase 4，persona/companion.ts 的 createCompanion().hooks） */
  companion?: CompanionHooks
  /** 测试注入点：替代 registry.createAdapter（如 FakeAdapter） */
  adapterFactory?: (adapterId: string) => IAgentAdapter
  /** 全局默认工作目录（dionysus.workingDir，宿主已解析占位符）；getter 形式支持配置热更新 */
  defaultWorkingDir?: () => string | undefined
  /** 测试注入点：CLI 会话索引文件路径（缺省用各策略约定路径，如 ~/.kimi-code/session_index.jsonl） */
  cliSessionIndexPath?: string
  now?: () => number
  idGen?: () => string
}

interface QueuedInput {
  input: AgentInput
  origin: string
}

interface PendingOption {
  traceId: string
  timer: ReturnType<typeof setTimeout>
  options: OptionItem[]
}

/** 会话运行时句柄（回合状态/适配器/队列均以 sessionId 为键隔离）。 */
interface SessionHandle {
  meta: SessionMeta
  adapter: IAgentAdapter | null
  running: boolean
  queue: QueuedInput[]
  currentTurnId: string | null
  /** 已终态 turnId 集合：迟到的 complete 据此幂等忽略 */
  completedTurnIds: Set<string>
  pendingOption: PendingOption | null
  currentAction?: string
  firstUserMessage?: string
  /** 当前回合累积的 agent 输出文本（回合末落一条 agent message） */
  accumulatedText: string
}

export class SessionManager {
  private readonly store: SessionStore
  private readonly adaptersConfig: Record<string, AdapterConfig>
  private readonly defaultAdapterId: string
  private readonly defaultPersonaId: string
  private readonly maxConcurrentAgents: number
  private readonly defaultOptionTimeoutAction: OptionTimeoutAction
  private readonly inject?: InjectConfig
  private readonly companion?: CompanionHooks
  private readonly adapterFactory?: (adapterId: string) => IAgentAdapter
  private readonly defaultWorkingDir?: () => string | undefined
  private readonly cliSessionIndexPath?: string
  private readonly now: () => number
  private readonly idGen: () => string

  private readonly handles = new Map<string, SessionHandle>()
  private readonly listeners = new Set<(msg: ServerMessage) => void>()

  constructor(deps: SessionManagerDeps) {
    this.store = deps.store
    this.adaptersConfig = deps.adapters
    this.defaultAdapterId = deps.defaultAdapterId
    this.defaultPersonaId = deps.defaultPersonaId ?? 'default'
    this.maxConcurrentAgents = deps.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT_AGENTS
    this.defaultOptionTimeoutAction = deps.optionTimeoutAction ?? 'keep'
    this.inject = deps.inject
    this.companion = deps.companion
    this.adapterFactory = deps.adapterFactory
    this.defaultWorkingDir = deps.defaultWorkingDir
    this.cliSessionIndexPath = deps.cliSessionIndexPath
    this.now = deps.now ?? Date.now
    this.idGen = deps.idGen ?? randomUUID
  }

  // -------------------------------------------------------------------------
  // 事件出口
  // -------------------------------------------------------------------------

  /** 订阅会话事件（宿主接 BroadcastHub.broadcast / Transport）。返回退订函数。 */
  onMessage(cb: (msg: ServerMessage) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(msg: ServerMessage): void {
    for (const cb of [...this.listeners]) cb(msg)
  }

  private notice(sessionId: string | undefined, text: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    this.emit({
      v: 1,
      type: 'system_notice',
      ...(sessionId ? { sessionId } : {}),
      ts: this.now(),
      payload: { text, level },
    })
  }

  // -------------------------------------------------------------------------
  // 会话 CRUD
  // -------------------------------------------------------------------------

  async createSession(
    opts: { personaId?: string; adapterId?: string; title?: string; workingDir?: string } = {},
  ): Promise<SessionMeta> {
    const now = this.now()
    const meta: SessionMeta = {
      id: this.idGen(),
      title: opts.title ?? DEFAULT_TITLE,
      personaId: opts.personaId ?? this.defaultPersonaId,
      status: 'idle',
      adapterId: opts.adapterId ?? this.defaultAdapterId,
      updatedAt: now,
      createdAt: now,
      unreadCount: 0,
      optionTimeoutAction: this.defaultOptionTimeoutAction,
      ...(opts.workingDir ? { workingDir: opts.workingDir } : {}),
    }
    await this.store.create(meta)
    this.handles.set(meta.id, this.newHandle(meta))
    this.emitDigest(this.handles.get(meta.id)!)
    this.companion?.onSessionCreated?.(meta)
    return meta
  }

  /** 列出会话：store 扫目录的元数据叠加内存中的运行时状态。 */
  async listSessions(): Promise<SessionMeta[]> {
    const stored = await this.store.list()
    return stored.map((meta) => {
      const handle = this.handles.get(meta.id)
      if (!handle) return meta
      return {
        ...meta,
        status: handle.meta.status,
        title: handle.meta.title,
        lastMessagePreview: handle.meta.lastMessagePreview ?? meta.lastMessagePreview,
      }
    })
  }

  async getSession(id: string): Promise<SessionMeta | null> {
    const handle = this.handles.get(id)
    if (handle) return handle.meta
    const session = await this.store.get(id)
    return session?.meta ?? null
  }

  /** 手动重命名：titleLocked=true，自动标题不再覆盖。 */
  async renameSession(id: string, title: string): Promise<void> {
    const handle = await this.ensureHandle(id)
    if (!handle) throw new Error(`Unknown session: ${id}`)
    handle.meta.title = title
    handle.meta.titleLocked = true
    await this.store.updateMeta(id, { title, titleLocked: true })
    this.emitDigest(handle)
  }

  async deleteSession(id: string): Promise<void> {
    const handle = this.handles.get(id)
    if (handle) {
      this.clearPendingOption(handle)
      await handle.adapter?.shutdown()
      this.handles.delete(id)
    }
    await this.store.delete(id)
    this.companion?.onSessionDeleted?.(id)
    this.notice(id, '会话已删除', 'info')
  }

  /** 切换 CLI 会话 id（/resume 委托 adapter.switchSession）；重置注入标志。 */
  async switchCliSession(id: string, cliSessionId: string): Promise<void> {
    const handle = await this.ensureHandle(id)
    if (!handle) throw new Error(`Unknown session: ${id}`)
    const adapter = await this.ensureAdapter(handle)
    if (!adapter.switchSession) {
      this.notice(id, `适配器 ${adapter.agentId} 不支持切换 CLI 会话`, 'error')
      return
    }
    await adapter.switchSession(cliSessionId)
    handle.meta.cliSessionId = cliSessionId
    // 标志生命周期（§5.3）：switch_session 后重置注入标志
    handle.meta.systemPromptInjected = false
    await this.store.updateMeta(id, { systemPromptInjected: false })
    this.notice(id, `已切换 CLI 会话：${cliSessionId}`, 'info')
  }

  /** 会话生效工作目录：meta.workingDir 优先，缺省回落全局默认（getter 取值，随配置热更新）。 */
  effectiveWorkingDir(meta: SessionMeta): string | undefined {
    return meta.workingDir ?? this.defaultWorkingDir?.()
  }

  /**
   * 列出该会话工作目录下的 CLI 历史会话（/sessions 与 webview「恢复历史会话」数据源）。
   * 委托策略侧索引能力（kimi：~/.kimi-code/session_index.jsonl）；策略无索引能力
   * 时 supported=false（UI 标注「该助手暂不支持」）。
   */
  async listCliSessions(
    sessionId: string,
  ): Promise<{ supported: boolean; sessions: CliSessionIndexEntry[] }> {
    const meta = await this.getSession(sessionId)
    if (!meta) throw new Error(`Unknown session: ${sessionId}`)
    const strategy = resolveStrategy(meta.adapterId, this.adaptersConfig)
    if (!strategy?.listSessionIndex) return { supported: false, sessions: [] }
    const all = await strategy.listSessionIndex(this.cliSessionIndexPath)
    const dir = this.effectiveWorkingDir(meta)
    const sessions = dir ? all.filter((e) => e.workDir === dir) : all
    return { supported: true, sessions }
  }

  // -------------------------------------------------------------------------
  // 单一回合管线
  // -------------------------------------------------------------------------

  /**
   * 唯一回合入口。会话不存在回 system_notice(error)；回合进行中排队；
   * 并行回合数达 maxConcurrentAgents 上限回 system_notice(error) 不启动。
   */
  async runAgentTurn(sessionId: string, input: AgentInput, opts: { origin?: string } = {}): Promise<void> {
    const origin = opts.origin ?? 'unknown'
    const handle = await this.ensureHandle(sessionId)
    if (!handle) {
      this.notice(sessionId, `会话不存在：${sessionId}`, 'error')
      return
    }
    if (handle.running) {
      // 单会话 send 串行：回合中新 user_input 排队为下一回合（UI 提示语义）
      handle.queue.push({ input, origin })
      this.notice(sessionId, '当前回合进行中，新输入已排队，回合结束后自动发送', 'info')
      return
    }
    if (this.runningCount() >= this.maxConcurrentAgents) {
      this.notice(
        sessionId,
        `并行会话数已达上限（maxConcurrentAgents=${this.maxConcurrentAgents}），请等待其他会话完成`,
        'error',
      )
      return
    }
    await this.executeTurn(handle, input, origin)
    // 回合结束后依次排空队列
    while (handle.queue.length > 0) {
      if (this.runningCount() >= this.maxConcurrentAgents) {
        this.notice(
          sessionId,
          `并行会话数已达上限（maxConcurrentAgents=${this.maxConcurrentAgents}），排队输入暂缓执行`,
          'warning',
        )
        return
      }
      const next = handle.queue.shift()!
      await this.executeTurn(handle, next.input, next.origin)
    }
  }

  /** user_input 消息入口：payload → AgentInput，走统一管线。 */
  async handleUserInput(sessionId: string, payload: UserInputPayload, origin: string): Promise<void> {
    await this.runAgentTurn(
      sessionId,
      { text: payload.text, attachments: payload.attachments, mode: payload.mode },
      { origin },
    )
  }

  /**
   * option_selected 仅负责把选项转成 input（双管线合并后的唯一职责）。
   * 无待确认选项（重复提交/已被其他端解决）时幂等忽略 + system_notice(info)。
   */
  async handleOptionSelected(sessionId: string, payload: OptionSelectedPayload, origin: string): Promise<void> {
    const handle = await this.ensureHandle(sessionId)
    if (!handle) {
      this.notice(sessionId, `会话不存在：${sessionId}`, 'error')
      return
    }
    const pending = handle.pendingOption
    if (!pending) {
      this.notice(sessionId, '没有待确认的选项（可能已被其他端处理），本次选择已忽略', 'info')
      return
    }
    this.clearPendingOption(handle)
    this.emit({
      v: 1,
      type: 'option_resolved',
      sessionId,
      ts: this.now(),
      payload: { requestTraceId: pending.traceId, selectedId: payload.selectedId, origin },
    })
    if (handle.meta.status === 'waiting_option') this.setStatus(handle, 'running')
    await this.runAgentTurn(sessionId, { text: payload.selectedLabel }, { origin })
  }

  /** 打断指定会话的当前回合（只作用于该 sessionId 的适配器）。 */
  async interrupt(sessionId: string, payload?: InterruptPayload): Promise<void> {
    const handle = this.handles.get(sessionId)
    if (!handle?.adapter) {
      this.notice(sessionId, '会话当前没有运行中的回合', 'info')
      return
    }
    await handle.adapter.interrupt()
    if (payload?.insertMessage) {
      const msg: Message = {
        type: 'message',
        id: this.idGen(),
        role: 'user',
        text: payload.insertMessage,
        ts: this.now(),
      }
      await this.store.appendMessage(sessionId, msg)
    }
  }

  // -------------------------------------------------------------------------
  // 回合执行（内部）
  // -------------------------------------------------------------------------

  private async executeTurn(handle: SessionHandle, input: AgentInput, origin: string): Promise<void> {
    handle.running = true
    const sessionId = handle.meta.id
    const turnId = this.idGen()
    handle.currentTurnId = turnId
    handle.accumulatedText = ''
    try {
      // 1. 用户消息落盘 + 多端回显
      const ts = this.now()
      const userMsg: Message = {
        type: 'message',
        id: this.idGen(),
        role: 'user',
        text: input.text,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        ts,
      }
      await this.store.appendMessage(sessionId, userMsg)
      this.emit({
        v: 1,
        type: 'user_message_echo',
        sessionId,
        turnId,
        ts,
        payload: {
          text: input.text,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
          origin,
        },
      })
      if (!handle.firstUserMessage) handle.firstUserMessage = input.text

      // 2. 状态跃迁 running
      this.setStatus(handle, 'running')

      // 2.5 陪伴层：回合开始（建 engine/tracker、预载 persona）
      await this.companion?.onTurnStart?.(handle.meta)

      // 3. 可选注入增强（默认关闭）
      const adapter = await this.ensureAdapter(handle)
      let effectiveInput = input
      let attemptedInject = false
      if (this.inject?.enabled && !handle.meta.systemPromptInjected) {
        const prompt = this.inject.getSystemPrompt(handle.meta)
        const support = this.inject.supportsSystemPrompt ?? 'prompt-prefix'
        if (prompt && support !== 'none') {
          if (support === 'native' && adapter.injectSystemPrompt) {
            try {
              await adapter.injectSystemPrompt(prompt, {
                session_id: sessionId,
                working_dir: this.effectiveWorkingDir(handle.meta) ?? process.cwd(),
              })
              attemptedInject = true
            } catch (err) {
              this.notice(sessionId, `system prompt 注入失败，按原始输入发送：${(err as Error).message}`, 'warning')
            }
          } else if (support === 'prompt-prefix') {
            try {
              const wrap = this.inject.wrapFirstTurnInput ?? defaultWrapFirstTurnInput
              effectiveInput = wrap(prompt, input)
              attemptedInject = true
            } catch (err) {
              this.notice(sessionId, `system prompt 包装失败，按原始输入发送：${(err as Error).message}`, 'warning')
              effectiveInput = input
            }
          }
        }
      }

      // 4. adapter.send 流式消费；注入后的首轮发送若立即失败则按原始输入重发
      let iterable = adapter.send(effectiveInput)
      let iterator = iterable[Symbol.asyncIterator]()
      let first: IteratorResult<AgentEvent> | null = null
      if (attemptedInject) {
        try {
          first = await iterator.next()
          if (!first.done) {
            // 注入成功（产生首个事件）→ 置标志并持久化
            handle.meta.systemPromptInjected = true
            await this.store.updateMeta(sessionId, { systemPromptInjected: true })
          }
        } catch (err) {
          this.notice(sessionId, `注入后发送失败，按原始输入重发：${(err as Error).message}`, 'warning')
          iterable = adapter.send(input)
          iterator = iterable[Symbol.asyncIterator]()
          first = null
        }
      }

      if (first && !first.done) await this.processEvent(handle, turnId, first.value)
      for (;;) {
        const r = await iterator.next()
        if (r.done) break
        await this.processEvent(handle, turnId, r.value)
      }

      // 适配器契约保证一轮恰好一条 complete；缺失时兜底收尾，避免状态卡死
      if (!handle.completedTurnIds.has(turnId)) {
        await this.finalizeTurn(handle, turnId, {
          status: 'error',
          artifacts: [],
          errorMessage: 'adapter ended without complete event',
        })
      }
    } finally {
      handle.running = false
      handle.currentTurnId = null
      handle.accumulatedText = ''
    }
  }

  /** AgentEvent → 协议消息转换 + 状态机跃迁 + 落盘。 */
  private async processEvent(handle: SessionHandle, turnId: string, ev: AgentEvent): Promise<void> {
    const sessionId = handle.meta.id
    const ts = this.now()
    // 陪伴层：todo 提取 + 台词触发（先于此处的事件转换，complete 也先经 tracker 全量收尾）
    this.companion?.onTurnEvent?.(sessionId, ev)
    switch (ev.type) {
      case 'stream':
      case 'thinking':
        handle.accumulatedText += ev.chunk
        this.emit({
          v: 1,
          type: 'agent_stream',
          sessionId,
          turnId,
          ts,
          payload: { chunk: ev.chunk, isFinal: ev.isFinal, status: ev.status, isThinking: ev.isThinking },
        })
        break
      case 'status':
        handle.currentAction = ev.detail
        this.emit({
          v: 1,
          type: 'status_update',
          sessionId,
          turnId,
          ts,
          payload: { status: ev.status, detail: ev.detail, ...(ev.progress !== undefined ? { progress: ev.progress } : {}) },
        })
        this.emitDigest(handle)
        break
      case 'tool_call': {
        handle.currentAction = `正在调用 ${ev.name}`
        this.emit({
          v: 1,
          type: 'tool_call',
          sessionId,
          turnId,
          ts,
          payload: {
            toolCallId: ev.toolCallId,
            name: ev.name,
            kind: ev.kind,
            args: ev.args,
            displayTarget: ev.displayTarget.slice(0, TOOL_DISPLAY_TARGET_MAX),
          },
        })
        this.emitDigest(handle)
        break
      }
      case 'tool_result': {
        const truncated = ev.summary.length > TOOL_RESULT_SUMMARY_MAX
        this.emit({
          v: 1,
          type: 'tool_result',
          sessionId,
          turnId,
          ts,
          payload: {
            toolCallId: ev.toolCallId,
            ok: ev.ok,
            summary: truncated ? ev.summary.slice(0, TOOL_RESULT_SUMMARY_MAX) + '…(truncated)' : ev.summary,
            ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
          },
        })
        break
      }
      case 'option_request': {
        const traceId = this.startOptionWait(handle, ev)
        this.emit({
          v: 1,
          type: 'option_request',
          sessionId,
          turnId,
          traceId,
          ts,
          payload: {
            question: ev.question,
            options: ev.options,
            uiType: ev.uiType,
            timeoutSeconds: ev.timeoutSeconds,
          },
        })
        break
      }
      case 'session_id':
        // CLI 会话 id 变更仅内存态更新（首行 meta 不为此高频事件重写）
        handle.meta.cliSessionId = ev.cliSessionId
        break
      case 'complete':
        // turnId 幂等：已终态 turnId 的迟到 complete 忽略
        if (handle.completedTurnIds.has(turnId)) return
        await this.finalizeTurn(handle, turnId, ev)
        break
    }
  }

  /** 回合收尾（恰好一次）：落 agent message、清待决选项、状态跃迁、自动标题。 */
  private async finalizeTurn(
    handle: SessionHandle,
    turnId: string,
    complete: AgentCompletePayload,
  ): Promise<void> {
    handle.completedTurnIds.add(turnId)
    const sessionId = handle.meta.id
    const ts = this.now()
    this.emit({
      v: 1,
      type: 'agent_complete',
      sessionId,
      turnId,
      ts,
      payload: {
        status: complete.status,
        ...(complete.durationMs !== undefined ? { durationMs: complete.durationMs } : {}),
        artifacts: complete.artifacts ?? [],
        ...(complete.errorMessage ? { errorMessage: complete.errorMessage } : {}),
      },
    })

    if (complete.status === 'success' && handle.accumulatedText.trim()) {
      const agentMsg: Message = {
        type: 'message',
        id: this.idGen(),
        role: 'agent',
        text: handle.accumulatedText,
        ts,
      }
      await this.store.appendMessage(sessionId, agentMsg)
      handle.meta.lastMessagePreview = handle.accumulatedText.trim().slice(0, MESSAGE_PREVIEW_MAX)
    } else if (complete.errorMessage) {
      handle.meta.lastMessagePreview = complete.errorMessage.slice(0, MESSAGE_PREVIEW_MAX)
    }
    handle.meta.updatedAt = ts

    // 回合结束清除待决选项（waiting_option 的退出口之一）
    this.clearPendingOption(handle)
    // 清除回合内动作摘要（否则 digest 的 currentAction 会停在「正在输出回复…」不刷新）
    handle.currentAction = undefined
    const nextStatus: SessionStatus =
      complete.status === 'success' ? 'done' : complete.status === 'error' ? 'error' : 'idle'
    this.setStatus(handle, nextStatus)

    // 陪伴层：回合结束（终态 todo 落盘 + supervisor 即时播报）
    await this.companion?.onTurnEnd?.(handle.meta, complete.status)

    // 自动标题：首个回合成功后取首条用户消息截断 20 字符；手动重命名后不覆盖
    if (
      complete.status === 'success' &&
      !handle.meta.titleLocked &&
      handle.meta.title === DEFAULT_TITLE &&
      handle.firstUserMessage
    ) {
      const title = handle.firstUserMessage.slice(0, AUTO_TITLE_MAX_LEN)
      handle.meta.title = title
      await this.store.updateMeta(sessionId, { title })
      this.emitDigest(handle)
    }
  }

  // -------------------------------------------------------------------------
  // option 状态机
  // -------------------------------------------------------------------------

  /** option_request → waiting_option（正式启用该枚举），启动超时计时。 */
  private startOptionWait(handle: SessionHandle, ev: AgentEvent & { type: 'option_request' }): string {
    this.clearPendingOption(handle)
    const traceId = `${handle.currentTurnId ?? this.idGen()}:option`
    const timer = setTimeout(() => {
      void this.onOptionTimeout(handle, traceId)
    }, ev.timeoutSeconds * 1000)
    timer.unref?.()
    handle.pendingOption = { traceId, timer, options: ev.options }
    this.setStatus(handle, 'waiting_option')
    return traceId
  }

  private clearPendingOption(handle: SessionHandle): void {
    if (handle.pendingOption) {
      clearTimeout(handle.pendingOption.timer)
      handle.pendingOption = null
    }
  }

  /** option 超时：deny 拒绝 / default 自动选默认项 / keep 维持现状可查。 */
  private async onOptionTimeout(handle: SessionHandle, traceId: string): Promise<void> {
    const pending = handle.pendingOption
    if (!pending || pending.traceId !== traceId) return
    const sessionId = handle.meta.id
    const action = handle.meta.optionTimeoutAction ?? this.defaultOptionTimeoutAction
    if (action === 'keep') {
      this.notice(sessionId, '选项确认已超时，按配置保持等待（optionTimeoutAction=keep）', 'info')
      return
    }
    this.clearPendingOption(handle)
    if (action === 'deny') {
      this.emit({
        v: 1,
        type: 'option_resolved',
        sessionId,
        ts: this.now(),
        payload: { requestTraceId: traceId, selectedId: '', origin: 'system' },
      })
      this.notice(sessionId, '选项确认超时，已按配置拒绝（optionTimeoutAction=deny）', 'warning')
      if (handle.meta.status === 'waiting_option') this.setStatus(handle, 'running')
      return
    }
    // default：自动选择第一个选项，转为下一轮输入
    const fallback = pending.options[0]
    if (!fallback) {
      this.notice(sessionId, '选项确认超时，但无默认项可选（optionTimeoutAction=default）', 'warning')
      if (handle.meta.status === 'waiting_option') this.setStatus(handle, 'running')
      return
    }
    this.emit({
      v: 1,
      type: 'option_resolved',
      sessionId,
      ts: this.now(),
      payload: { requestTraceId: traceId, selectedId: fallback.id, origin: 'system' },
    })
    this.notice(sessionId, `选项确认超时，已按配置选择默认项「${fallback.label}」`, 'info')
    if (handle.meta.status === 'waiting_option') this.setStatus(handle, 'running')
    await this.runAgentTurn(sessionId, { text: fallback.label }, { origin: 'system' })
  }

  // -------------------------------------------------------------------------
  // 状态与 digest
  // -------------------------------------------------------------------------

  private setStatus(handle: SessionHandle, status: SessionStatus): void {
    if (handle.meta.status === status) {
      this.emitDigest(handle)
      return
    }
    handle.meta.status = status
    handle.meta.updatedAt = this.now()
    this.emitDigest(handle)
    // 陪伴层：状态跃迁通知（supervisor 变动检测 / scheduler 聚合跟踪）
    this.companion?.onSessionStatus?.(handle.meta)
  }

  /** 每次状态跃迁发 session_digest_update；seq 由 BroadcastHub 扇出前赋值。 */
  private emitDigest(handle: SessionHandle): void {
    const payload: SessionDigestUpdatePayload = {
      sessionId: handle.meta.id,
      title: handle.meta.title,
      status: handle.meta.status,
      ...(handle.currentAction ? { currentAction: handle.currentAction } : {}),
      // TodoTracker 接通（无挂载/无 tracker 时占位 {0,0}）
      todoProgress: this.companion?.todoProgress?.(handle.meta.id) ?? { done: 0, total: 0 },
      pendingOptionRequest: handle.pendingOption !== null,
      lastActivityAt: this.now(),
      seq: 0,
      // 列表项 adapter 徽标数据源（ux-core-flows §2.2）；空串（损坏恢复兜底）不下发
      ...(handle.meta.adapterId ? { adapterId: handle.meta.adapterId } : {}),
      // 列表项工作目录展示数据源（additive；无生效目录不下发）
      ...(this.effectiveWorkingDir(handle.meta) ? { workingDir: this.effectiveWorkingDir(handle.meta) } : {}),
      // 列表项头像数据源（additive；空串兜底不下发）
      ...(handle.meta.personaId ? { personaId: handle.meta.personaId } : {}),
    }
    this.emit({
      v: 1,
      type: 'session_digest_update',
      sessionId: handle.meta.id,
      ts: this.now(),
      payload,
    })
  }

  // -------------------------------------------------------------------------
  // 句柄与适配器
  // -------------------------------------------------------------------------

  private newHandle(meta: SessionMeta): SessionHandle {
    return {
      meta,
      adapter: null,
      running: false,
      queue: [],
      currentTurnId: null,
      completedTurnIds: new Set(),
      pendingOption: null,
      accumulatedText: '',
    }
  }

  private async ensureHandle(sessionId: string): Promise<SessionHandle | null> {
    let handle = this.handles.get(sessionId)
    if (handle) return handle
    const session = await this.store.get(sessionId)
    if (!session) return null
    handle = this.newHandle(session.meta)
    // 磁盘恢复的会话视为空闲（崩溃恢复：不残留 running 假象）
    handle.meta.status = session.meta.status === 'running' || session.meta.status === 'waiting_option' ? 'idle' : session.meta.status
    this.handles.set(sessionId, handle)
    return handle
  }

  /** 会话 ↔ 适配器一对一：懒创建独占实例（registry 工厂，不暴露共享实例）。 */
  private async ensureAdapter(handle: SessionHandle): Promise<IAgentAdapter> {
    if (handle.adapter) return handle.adapter
    const adapter = this.adapterFactory
      ? this.adapterFactory(handle.meta.adapterId)
      : createAdapter(handle.meta.adapterId, this.adaptersFor(handle.meta))
    await adapter.start()
    handle.adapter = adapter
    return adapter
  }

  /**
   * 该会话的适配器配置视图：会话生效工作目录（meta.workingDir 优先，缺省全局默认）
   * 覆盖配置条目的 workingDir 键；无生效目录时配置原样（不重拷贝 record）。
   */
  private adaptersFor(meta: SessionMeta): Record<string, AdapterConfig> {
    return applySessionWorkingDir(this.adaptersConfig, meta.adapterId, this.effectiveWorkingDir(meta))
  }

  private runningCount(): number {
    let n = 0
    for (const h of this.handles.values()) if (h.running) n += 1
    return n
  }
}

/** prompt-prefix 默认包装（与 JsonStreamStrategy.wrapFirstTurnInput 默认实现同形）。 */
function defaultWrapFirstTurnInput(systemPrompt: string, input: AgentInput): AgentInput {
  return { ...input, text: `${systemPrompt}\n\n${input.text}` }
}

/**
 * 会话生效工作目录覆盖适配器配置条目（adapter 创建前调用）：
 * workingDir 定义且与条目现值不同时返回浅拷贝 record（原 record 不被修改）；
 * 无覆盖时返回原 record 引用。
 */
export function applySessionWorkingDir(
  adaptersConfig: Record<string, AdapterConfig>,
  adapterId: string,
  workingDir: string | undefined,
): Record<string, AdapterConfig> {
  if (!workingDir) return adaptersConfig
  const entry = adaptersConfig[adapterId]
  if (!entry || entry.workingDir === workingDir) return adaptersConfig
  return { ...adaptersConfig, [adapterId]: { ...entry, workingDir } }
}
