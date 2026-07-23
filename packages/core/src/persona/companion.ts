/**
 * persona/companion.ts — 陪伴层装配：把 loader/engine/scheduler/supervisor/
 * todo-tracker 接成 SessionManager 可挂载的 {@link CompanionHooks}。
 *
 * 职责边界：
 * - SessionManager 只面向 CompanionHooks 接口（定义于 session/manager.ts，
 *   保持 manager 对 persona 层零实现依赖）；本模块是唯一接线点；
 * - 台词/播报一律经 CompanionScheduler 统一出队口外发（仲裁见 scheduler.ts），
 *   本模块把出队结果转成协议消息（companion_message + emotion_update）；
 * - todo_update 在列表变化时即时外发；每回合末的 todo_update 终态快照与
 *   会话级 companion_message 经 `persist` 追加写入会话 JSONL event 行
 *   （architecture.md §4.1 落盘策略；写者不变量——会话级落盘只发生在
 *   runAgentTurn 调用栈内的 hook 里）；
 * - 归来摘要的口吻改写：BroadcastHub 内置模板文本经 `returnSummaryRewriter`
 *   挂钩过一遍 rewriter（BroadcastHub 公开接口不变，仅新增可选 option）。
 */
import type { ServerMessage, TransientEvent } from '@dionysus/protocol'

import type { AgentEvent } from '../adapters/types.js'
import type { CompanionHooks } from '../session/manager.js'
import type { SessionMeta } from '../session/types.js'
import { CompanionEngine } from './engine.js'
import { DEFAULT_PERSONA, PersonaLoader, type Persona } from './loader.js'
import { TemplateRewriter, type RewriterEngine } from './rewriter.js'
import { CompanionScheduler, type EmittedCompanion } from './scheduler.js'
import {
  CompanionSupervisor,
  DEFAULT_SUPERVISOR_INTERVAL_SECONDS,
  type SupervisorConfig,
  type SupervisorSessionSnapshot,
} from './supervisor.js'
import { TodoTracker } from './todo-tracker.js'

export interface CompanionDeps {
  loader: PersonaLoader
  /** 无 persona 会话/未知 persona 的兜底 id（缺省 'default' → 中立默认） */
  defaultPersonaId?: string
  /** 协议消息出口（宿主接 BroadcastHub.broadcast） */
  emit: (msg: ServerMessage) => void
  /** 会话 JSONL event 行落盘（宿主接 SessionStore.appendMessage） */
  persist?: (sessionId: string, ev: TransientEvent) => void | Promise<void>
  /** 宿主告知的已连接客户端数（supervisor 无观众不生成的判定源） */
  audienceCount: () => number
  /** 全 fleet 会话元数据来源（宿主接 SessionManager.listSessions） */
  listSessions: () => SessionMeta[] | Promise<SessionMeta[]>
  /** supervisor 配置（缺省 template / 15s；intervalSeconds 下限 5 由 supervisor 钳制） */
  supervisor?: Partial<SupervisorConfig>
  rewriter?: RewriterEngine
  now?: () => number
  random?: () => number
  /** scheduler 定时器注入点（测试用手动 flush） */
  scheduleFlush?: (cb: () => void, waitMs: number) => void
}

export interface Companion {
  /** SessionManager 挂载点（deps.companion） */
  hooks: CompanionHooks
  scheduler: CompanionScheduler
  supervisor: CompanionSupervisor
  start(): void
  stop(): void
  /** BroadcastHubOptions.returnSummaryRewriter 的接线实现 */
  returnSummaryRewriter: (text: string) => string
  /** 预载 persona（宿主装配时可提前调用，避免首个回合的加载延迟） */
  preloadPersona: (personaId: string) => Promise<void>
}

export function createCompanion(deps: CompanionDeps): Companion {
  const now = deps.now ?? Date.now
  const random = deps.random ?? Math.random
  const rewriter = deps.rewriter ?? new TemplateRewriter()
  const defaultPersonaId = deps.defaultPersonaId ?? 'default'

  const personaCache = new Map<string, Persona>()
  const engines = new Map<string, CompanionEngine>()
  const trackers = new Map<string, TodoTracker>()
  /** 会话标题（companion_message 的 sourceTitle 标注数据源） */
  const sessionTitles = new Map<string, string>()
  let lastActivePersonaId = defaultPersonaId

  async function preloadPersona(personaId: string): Promise<void> {
    if (personaCache.has(personaId)) return
    try {
      personaCache.set(personaId, await deps.loader.load(personaId))
    } catch {
      // 未知/损坏 persona 回退中立默认（缺键回退 default persona，§5.4）
      personaCache.set(personaId, DEFAULT_PERSONA)
    }
  }

  function personaFor(personaId: string): Persona {
    return personaCache.get(personaId) ?? DEFAULT_PERSONA
  }

  // --- 统一出队口 → 协议消息 -------------------------------------------------

  function emitCompanion(e: EmittedCompanion): void {
    const ts = now()
    const sessionId = e.scope === 'session' ? e.sessionId : undefined
    const payload = {
      text: e.text,
      scope: e.scope,
      emotion: e.emotion,
      ...(e.sourceSessionId ? { sourceSessionId: e.sourceSessionId } : {}),
      ...(e.sourceTitle ? { sourceTitle: e.sourceTitle } : {}),
    } as const
    deps.emit({
      v: 1,
      type: 'companion_message',
      ...(sessionId ? { sessionId } : {}),
      ts,
      payload,
    })
    deps.emit({
      v: 1,
      type: 'emotion_update',
      ...(sessionId ? { sessionId } : {}),
      ts,
      payload: {
        emotion: e.emotion,
        confidence: 1,
        ...(e.expression !== undefined ? { expression: e.expression } : {}),
        ...(e.motion !== undefined ? { motion: e.motion } : {}),
      },
    })
    // 会话级汇报落盘 event 行（global 无归属会话，不落；§4.1 落盘策略）
    if (sessionId && deps.persist) {
      void deps.persist(sessionId, { type: 'event', eventType: 'companion_message', payload, ts })
    }
  }

  const scheduler = new CompanionScheduler({
    personaFor,
    rewriter,
    emit: emitCompanion,
    now,
    random,
    ...(deps.scheduleFlush ? { schedule: deps.scheduleFlush } : {}),
  })

  // --- Supervisor -------------------------------------------------------------

  async function snapshots(): Promise<SupervisorSessionSnapshot[]> {
    const metas = await deps.listSessions()
    return metas.map((meta) => ({
      sessionId: meta.id,
      personaId: meta.personaId,
      title: meta.title,
      status: meta.status,
      updatedAt: meta.updatedAt,
      todo: trackers.get(meta.id)?.progress() ?? { done: 0, total: 0 },
    }))
  }

  function snapshotOf(meta: SessionMeta): SupervisorSessionSnapshot {
    return {
      sessionId: meta.id,
      personaId: meta.personaId,
      title: meta.title,
      status: meta.status,
      updatedAt: meta.updatedAt,
      todo: trackers.get(meta.id)?.progress() ?? { done: 0, total: 0 },
    }
  }

  const supervisorConfig: SupervisorConfig = {
    mode: deps.supervisor?.mode ?? 'template',
    intervalSeconds: deps.supervisor?.intervalSeconds ?? DEFAULT_SUPERVISOR_INTERVAL_SECONDS,
    ...(deps.supervisor?.adapterId ? { adapterId: deps.supervisor.adapterId } : {}),
    ...(deps.supervisor?.llm ? { llm: deps.supervisor.llm } : {}),
  }

  const supervisor = new CompanionSupervisor({
    config: supervisorConfig,
    listSessions: snapshots,
    audienceCount: deps.audienceCount,
    personaFor,
    scheduler,
    now,
    random,
  })

  // --- CompanionHooks（SessionManager 挂载） -----------------------------------

  const hooks: CompanionHooks = {
    async onTurnStart(meta) {
      await preloadPersona(meta.personaId)
      lastActivePersonaId = meta.personaId
      sessionTitles.set(meta.id, meta.title)
      engines.set(meta.id, new CompanionEngine(personaFor(meta.personaId), { random, now }))
      trackers.set(meta.id, new TodoTracker())
    },

    onTurnEvent(sessionId, ev: AgentEvent) {
      const tracker = trackers.get(sessionId)
      if (tracker) {
        const items = tracker.onEvent(ev)
        if (items) {
          deps.emit({
            v: 1,
            type: 'todo_update',
            sessionId,
            ts: now(),
            payload: { items },
          })
        }
      }
      const engine = engines.get(sessionId)
      const line = engine?.onEvent(ev)
      if (engine && line) {
        scheduler.enqueue({
          kind: line.kind,
          personaId: engine.personaId,
          scope: 'session',
          sessionId,
          ...(sessionTitles.has(sessionId) ? { sourceTitle: sessionTitles.get(sessionId)! } : {}),
          draft: line.draft,
          status: line.status,
          dedupeKey: `engine:${sessionId}:${line.status}:${line.kind}`,
        })
      }
    },

    async onTurnEnd(meta, status) {
      // 回合末 todo_update 终态快照落盘（§4.1；此时 runAgentTurn 调用栈内，
      // 写者不变量成立）
      const tracker = trackers.get(meta.id)
      if (tracker && deps.persist) {
        const items = tracker.currentItems()
        if (items.length > 0) {
          await deps.persist(meta.id, {
            type: 'event',
            eventType: 'todo_update',
            payload: { items },
            ts: now(),
          })
        }
      }
      supervisor.notifyTurnEnd(snapshotOf(meta), status)
    },

    onSessionCreated(meta) {
      sessionTitles.set(meta.id, meta.title)
      void preloadPersona(meta.personaId)
      supervisor.notifySessionChanged(`新会话「${meta.title}」`)
    },

    onSessionDeleted(sessionId) {
      engines.delete(sessionId)
      trackers.delete(sessionId)
      sessionTitles.delete(sessionId)
      scheduler.removeSession(sessionId)
      supervisor.notifySessionChanged(`会话 ${sessionId} 已关闭`)
    },

    onSessionStatus(meta) {
      sessionTitles.set(meta.id, meta.title)
      scheduler.onSessionStatus(meta.id, meta.status)
      supervisor.notifySessionChanged(`「${meta.title}」状态变为 ${meta.status}`)
    },

    todoProgress(sessionId) {
      return trackers.get(sessionId)?.progress()
    },
  }

  return {
    hooks,
    scheduler,
    supervisor,
    start: () => supervisor.start(),
    stop: () => supervisor.stop(),
    returnSummaryRewriter: (text) =>
      rewriter.rewrite(text, personaFor(lastActivePersonaId), { random }),
    preloadPersona,
  }
}
