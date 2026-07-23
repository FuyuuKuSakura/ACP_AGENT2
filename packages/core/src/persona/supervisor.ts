/**
 * persona/supervisor.ts — CompanionSupervisor：周期轮询全 fleet 的后台播报员
 *（architecture.md §5.4；完整语义基线 extract/persona.md §4，非「回合后回放」）。
 *
 * - 周期轮询（默认 15s、下限 5s，可配）**全部**会话：fleet 聚合（N 工作/M
 *   出错 + 各会话 todo 进度）+ 变动检测（会话创建/关闭/状态跃迁）+ 安静期
 *   跳过（无变动且无 working 会话本轮静默）；
 * - **仅在有客户端连接时才生成**（宿主经 `audienceCount` 告知连接数；无观众
 *   时更新快照基线但不产出台词，避免恢复观众后的伪变动播报）；
 * - 回合结束即时播报（notifyTurnEnd）：成功走「回合完成」优先级，error/打断
 *   走最高优先级插播；
 * - 播报 emotion 按播报语义（working/success/error/changed）经 persona 的
 *   status→emotion 链解析（修复 v2「恒用 working 情绪」缺陷，extract §7-7）；
 * - 播报目标 persona 取「最近活跃会话」（优先 working，否则 updatedAt 最新），
 *   与客户端可见性无关（多端广播模型下「当前可见」无意义）；
 * - 模式：template（默认，supervisor_templates + 内置中立模板，零 LLM 依赖）
 *   与预留的 agent_session/deepseek_api（本 Phase 未实现：LLM 路径抛
 *   not implemented，tick 捕获后静默降级 template，ADR-13/R-8）；
 * - 播报草稿统一进 CompanionScheduler 出队口，rewriter 改写由 scheduler 执行。
 *
 * v2 的 `provider.__self__` 反射废除：LLM 模式所需的 adapter 能力预留为
 * 显式注入的 `adapterFactory`（architecture.md §5.4），本 Phase 不接线。
 */
import type { IAgentAdapter } from '../adapters/types.js'
import type { Persona } from './loader.js'
import { renderTemplate, type CompanionScheduler } from './scheduler.js'

export type SupervisorMode = 'disabled' | 'template' | 'agent_session' | 'deepseek_api'

export interface SupervisorConfig {
  mode: SupervisorMode
  /** 轮询间隔秒，默认 15，下限 5（构造时钳制，R-8 防误配） */
  intervalSeconds: number
  /** agent_session 模式复用的 CLI adapter id；空 = 跟随 default（预留） */
  adapterId?: string
  /** deepseek_api 模式（预留；API key 由宿主 SecretStorage 提供，禁止落配置） */
  llm?: { baseUrl: string; model: string }
}

export const DEFAULT_SUPERVISOR_INTERVAL_SECONDS = 15
export const MIN_SUPERVISOR_INTERVAL_SECONDS = 5

/** supervisor 视角的会话快照（由宿主/装配层从 SessionManager + TodoTracker 供给）。 */
export interface SupervisorSessionSnapshot {
  sessionId: string
  personaId: string
  title: string
  /** SessionManager 状态机取值：idle|running|waiting_option|done|error */
  status: string
  updatedAt: number
  todo: { done: number; total: number }
}

export interface FleetState {
  total: number
  working: number
  error: number
  idle: number
}

export type SupervisorCategory = 'working' | 'error' | 'changed' | 'idle'

export interface SupervisorLogger {
  debug(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

const defaultLogger: SupervisorLogger = {
  debug: (message) => console.debug(`[persona/supervisor] ${message}`),
  warn: (message) => console.warn(`[persona/supervisor] ${message}`),
}

export interface CompanionSupervisorDeps {
  config: SupervisorConfig
  /** 全 fleet 会话快照来源（SessionManager.listSessions 的薄封装） */
  listSessions: () => SupervisorSessionSnapshot[] | Promise<SupervisorSessionSnapshot[]>
  /** 宿主告知的已连接客户端数（无观众不生成的判定源） */
  audienceCount: () => number
  personaFor: (personaId: string) => Persona
  /** 多声源统一出队口 */
  scheduler: CompanionScheduler
  /** agent_session 模式预留：显式注入的适配器工厂（废除 v2 __self__ 反射） */
  adapterFactory?: (personaId?: string) => Promise<IAgentAdapter>
  now?: () => number
  random?: () => number
  logger?: SupervisorLogger
  /** 定时器注入点（测试用手动 tick，不起后台定时器） */
  setIntervalFn?: (cb: () => void, intervalMs: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
}

/** 播报语义 → emotion 解析用状态键（修复 v2 恒 working） */
const CATEGORY_TO_STATUS: Record<SupervisorCategory, string> = {
  working: 'executing',
  error: 'error',
  changed: 'success',
  idle: 'idle',
}

/** SessionManager 状态机 → fleet 桶 */
function isWorkingStatus(status: string): boolean {
  return status === 'running' || status === 'waiting_option' || status === 'working'
}
function isErrorStatus(status: string): boolean {
  return status === 'error' || status === 'interrupted'
}

export class CompanionSupervisor {
  private readonly deps: CompanionSupervisorDeps
  private readonly config: SupervisorConfig
  private readonly random: () => number
  private readonly logger: SupervisorLogger

  private timer: unknown = null
  private lastStates = new Map<string, { status: string; title: string }>()
  /** manager 变动通知（创建/关闭/状态跃迁），下个 tick 消费 */
  private pendingChanges: string[] = []

  constructor(deps: CompanionSupervisorDeps) {
    this.deps = deps
    this.config = {
      ...deps.config,
      intervalSeconds: Math.max(
        MIN_SUPERVISOR_INTERVAL_SECONDS,
        deps.config.intervalSeconds || DEFAULT_SUPERVISOR_INTERVAL_SECONDS,
      ),
    }
    this.random = deps.random ?? Math.random
    this.logger = deps.logger ?? defaultLogger
  }

  get mode(): SupervisorMode {
    return this.config.mode
  }

  /** 启动周期轮询；disabled 模式直接不起任务（v2 同语义）。 */
  start(): void {
    if (this.config.mode === 'disabled' || this.timer !== null) return
    const setIntervalFn =
      this.deps.setIntervalFn ??
      ((cb: () => void, ms: number) => {
        const t = setInterval(cb, ms)
        t.unref?.()
        return t
      })
    this.timer = setIntervalFn(() => {
      void this.tick().catch((err) => {
        this.logger.warn(`supervisor tick failed: ${(err as Error).message}`)
      })
    }, this.config.intervalSeconds * 1000)
  }

  stop(): void {
    if (this.timer === null) return
    const clearIntervalFn =
      this.deps.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout))
    clearIntervalFn(this.timer)
    this.timer = null
  }

  /** manager 变动通知（会话创建/关闭/状态跃迁），并入下一轮 tick 的变动表。 */
  notifySessionChanged(description: string): void {
    this.pendingChanges.push(description)
  }

  /**
   * 回合结束即时播报（architecture.md §5.4）：成功按「回合完成」优先级，
   * error/打断按最高优先级插播；含该会话 todo 进度。
   */
  notifyTurnEnd(
    snapshot: SupervisorSessionSnapshot,
    outcome: 'success' | 'error' | 'interrupted',
  ): void {
    if (this.config.mode === 'disabled') return
    if (this.deps.audienceCount() === 0) return // 无观众不生成
    const persona = this.deps.personaFor(snapshot.personaId)
    const category: SupervisorCategory = outcome === 'success' ? 'changed' : 'error'
    const changeText =
      outcome === 'success'
        ? `「${snapshot.title}」已完成${snapshot.todo.total > 0 ? `（${snapshot.todo.done}/${snapshot.todo.total}）` : ''}`
        : outcome === 'error'
          ? `「${snapshot.title}」出现错误`
          : `「${snapshot.title}」已被打断`
    const draft = this.renderCategoryTemplate(persona, category, {
      changes: changeText,
      todos: todoSummary([snapshot]),
    })
    this.deps.scheduler.enqueue({
      kind: outcome === 'success' ? 'turn_complete' : 'alert',
      personaId: persona.id,
      scope: 'global',
      sourceSessionId: snapshot.sessionId,
      sourceTitle: snapshot.title,
      draft,
      status: outcome === 'success' ? 'success' : 'error',
      dedupeKey: `sup:turn:${snapshot.sessionId}:${outcome}:${snapshot.todo.done}:${snapshot.todo.total}`,
    })
  }

  /**
   * 一轮周期轮询（start 的定时器回调与测试的公共入口）：
   * 快照 → fleet 聚合 → 变动检测 → 安静期跳过 → 生成 → 入队仲裁。
   */
  async tick(): Promise<void> {
    if (this.config.mode === 'disabled') return
    const snapshots = await this.deps.listSessions()
    if (snapshots.length === 0) {
      this.lastStates = new Map()
      this.pendingChanges = []
      return
    }

    // 无观众不生成（仍更新基线，避免恢复观众后的伪变动播报）
    if (this.deps.audienceCount() === 0) {
      this.rememberStates(snapshots)
      this.pendingChanges = []
      return
    }

    const fleet = computeFleet(snapshots)
    const changes = this.detectChanges(snapshots)
    // 安静期跳过：无变动且无 working 会话，本轮静默
    if (changes.length === 0 && fleet.working === 0) {
      this.rememberStates(snapshots)
      return
    }

    const category: SupervisorCategory =
      fleet.working > 0 ? 'working' : fleet.error > 0 ? 'error' : changes.length > 0 ? 'changed' : 'idle'
    // 目标 persona：优先第一个 working 会话，否则最近活跃（updatedAt 最新）
    const target =
      snapshots.find((s) => isWorkingStatus(s.status)) ??
      [...snapshots].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const persona = this.deps.personaFor(target.personaId)

    const draft = this.safeCompose(persona, category, fleet, snapshots, changes)
    this.deps.scheduler.enqueue({
      kind: 'supervisor',
      personaId: persona.id,
      scope: 'global',
      sourceSessionId: target.sessionId,
      sourceTitle: target.title,
      draft,
      status: CATEGORY_TO_STATUS[category],
      dedupeKey: `sup:${category}:${fleet.working}:${fleet.error}:${fleet.total}:${todoSummary(snapshots)}`,
    })
    this.rememberStates(snapshots)
  }

  /**
   * 台词生成的模式分流。template 走 persona.supervisor_templates；
   * agent_session/deepseek_api 本 Phase 未实现（抛 not implemented，
   * tick 捕获后静默降级 template——ADR-13 的「无可用 key 静默降级」语义）。
   */
  composeLine(
    persona: Persona,
    category: SupervisorCategory,
    fleet: FleetState,
    snapshots: SupervisorSessionSnapshot[],
    changes: string[],
  ): string {
    if (this.config.mode === 'agent_session') {
      throw new Error('supervisor mode "agent_session": not implemented in Phase 4')
    }
    if (this.config.mode === 'deepseek_api') {
      throw new Error('supervisor mode "deepseek_api": not implemented in Phase 4')
    }
    return this.composeTemplate(persona, category, fleet, snapshots, changes)
  }

  /** template 模式播报：supervisor_templates[category] + fleet/todo/变动占位符。 */
  composeTemplate(
    persona: Persona,
    category: SupervisorCategory,
    fleet: FleetState,
    snapshots: SupervisorSessionSnapshot[],
    changes: string[],
  ): string {
    return this.renderCategoryTemplate(persona, category, {
      working: fleet.working,
      total: fleet.total,
      error: fleet.error,
      todos: todoSummary(snapshots),
      changes: changes.length > 0 ? changes.join('；') : '无明细',
    })
  }

  /** tick 内的安全生成：LLM 模式 not implemented 等失败静默降级 template。 */
  private safeCompose(
    persona: Persona,
    category: SupervisorCategory,
    fleet: FleetState,
    snapshots: SupervisorSessionSnapshot[],
    changes: string[],
  ): string {
    try {
      return this.composeLine(persona, category, fleet, snapshots, changes)
    } catch (err) {
      this.logger.debug(`compose failed, degrade to template: ${(err as Error).message}`)
      return this.composeTemplate(persona, category, fleet, snapshots, changes)
    }
  }

  private renderCategoryTemplate(
    persona: Persona,
    category: SupervisorCategory,
    vars: Record<string, string | number>,
  ): string {
    const templates = persona.supervisorTemplates[category]
    const template =
      templates.length > 0
        ? templates[Math.min(templates.length - 1, Math.floor(this.random() * templates.length))]
        : ''
    return renderTemplate(template, vars)
  }

  /** 变动检测：创建/关闭/状态跃迁（快照 diff ∪ manager 变动通知）。 */
  private detectChanges(snapshots: SupervisorSessionSnapshot[]): string[] {
    const changes: string[] = [...this.pendingChanges]
    this.pendingChanges = []
    const byId = new Map(snapshots.map((s) => [s.sessionId, s]))
    for (const [sid, prev] of this.lastStates) {
      const curr = byId.get(sid)
      if (!curr) changes.push(`会话「${prev.title}」已关闭`)
      else if (curr.status !== prev.status)
        changes.push(`「${curr.title}」${prev.status}→${curr.status}`)
    }
    for (const s of snapshots) {
      if (!this.lastStates.has(s.sessionId)) changes.push(`新会话「${s.title}」`)
    }
    return changes
  }

  private rememberStates(snapshots: SupervisorSessionSnapshot[]): void {
    this.lastStates = new Map(snapshots.map((s) => [s.sessionId, { status: s.status, title: s.title }]))
  }
}

/** fleet 聚合统计（N 工作/M 出错）。 */
export function computeFleet(snapshots: SupervisorSessionSnapshot[]): FleetState {
  const fleet: FleetState = { total: snapshots.length, working: 0, error: 0, idle: 0 }
  for (const s of snapshots) {
    if (isWorkingStatus(s.status)) fleet.working += 1
    else if (isErrorStatus(s.status)) fleet.error += 1
    else fleet.idle += 1
  }
  return fleet
}

/** 各会话 todo 进度摘要：「标题」done/total 列表（无 todo 的会话不占位）。 */
export function todoSummary(snapshots: SupervisorSessionSnapshot[]): string {
  const parts = snapshots
    .filter((s) => s.todo.total > 0)
    .map((s) => `「${s.title}」${s.todo.done}/${s.todo.total}`)
  return parts.length > 0 ? parts.join('、') : '暂无任务明细'
}
