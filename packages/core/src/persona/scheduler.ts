/**
 * persona/scheduler.ts — CompanionScheduler：跨会话聚合 + **多声源统一出队口仲裁**
 *（architecture.md §5.4）。
 *
 * 三个声源——回合内 CompanionEngine（每会话）、跨会话聚合、周期 Supervisor——
 * 的台词候选统一进本类的单一出队口，仲裁六规则：
 * 1. 每条可见台词最小间隔 3 秒（`minIntervalMs`，广播为全局扇出，所有客户端
 *    看到同一条台词流，间隔即全局生效）；
 * 2. 优先级：error/打断插播(alert) > 回合完成(turn_complete) > Supervisor
 *    周期播报(supervisor) > 状态短语(status_phrase)；
 * 3. 同一出队窗口内多条候选合并为一条聚合句（走 persona YAML 的
 *    `scheduler_templates`，聚合口径为本类跟踪的会话 4 桶状态）；
 * 4. 安静期跳过（由 Supervisor 侧保证，见 supervisor.ts）；
 * 5. 无观众不生成（由 Supervisor 侧保证）；
 * 6. 语义重复去抖：候选与近 `dedupeWindowMs` 内已发台词 dedupeKey 相同或
 *    归一化文本相同则丢弃（以 v2 的 idle 去抖为基线扩展）。
 *
 * rewriter 改写在此统一执行：出队文本一律经 RewriterEngine 改写为角色口吻后
 * 才外发（engine/supervisor 只提供草稿）。
 */
import type { AgentEvent } from '../adapters/types.js'
import { resolveCues, type CompanionCandidateKind, type Live2dCues } from './engine.js'
import type { Persona } from './loader.js'
import type { RewriterEngine } from './rewriter.js'

/** 仲裁四级优先级（数值大者优先） */
export const CANDIDATE_PRIORITY: Record<CompanionCandidate['kind'], number> = {
  alert: 4,
  turn_complete: 3,
  supervisor: 2,
  status_phrase: 1,
}

export interface CompanionCandidate {
  kind: CompanionCandidateKind | 'supervisor'
  personaId: string
  scope: 'session' | 'global'
  sessionId?: string
  sourceSessionId?: string
  sourceTitle?: string
  /** 未改写的台词草稿 */
  draft: string
  /** emotion 解析用的状态键 */
  status: string
  /** 语义重复去抖键（缺省不参与按键去抖，仍参与文本去抖） */
  dedupeKey?: string
}

export interface EmittedCompanion {
  text: string
  emotion: string
  expression?: string
  motion?: string
  scope: 'session' | 'global'
  sessionId?: string
  sourceSessionId?: string
  sourceTitle?: string
  personaId: string
}

export interface CompanionSchedulerDeps {
  /** 按 id 取已加载 persona（缺省回退由调用方保证） */
  personaFor: (personaId: string) => Persona
  rewriter: RewriterEngine
  emit: (e: EmittedCompanion) => void
  now?: () => number
  random?: () => number
  /** 规则 1：最小间隔，默认 3000ms */
  minIntervalMs?: number
  /** 规则 6：语义去抖窗口，默认 30000ms */
  dedupeWindowMs?: number
  /** 定时器注入点（测试用手动触发替代 setTimeout） */
  schedule?: (cb: () => void, waitMs: number) => void
}

/** 会话聚合 4 桶（extract/persona.md §3.1 归一化语义） */
type AggregateBucket = 'idle' | 'working' | 'success' | 'error'

const WORKING_STATUSES = new Set([
  'working',
  'running',
  'processing',
  'streaming',
  'thinking',
  'reading_file',
  'executing',
  'outputting',
  'waiting_option',
])
const SUCCESS_STATUSES = new Set(['success', 'completed', 'complete', 'done'])
const ERROR_STATUSES = new Set(['error', 'failed', 'failure', 'interrupted'])

export function normalizeAggregateStatus(status: string | null | undefined): AggregateBucket {
  if (!status) return 'idle'
  const s = status.toLowerCase()
  if (WORKING_STATUSES.has(s)) return 'working'
  if (SUCCESS_STATUSES.has(s)) return 'success'
  if (ERROR_STATUSES.has(s)) return 'error'
  return 'idle'
}

/** 聚合桶 → emotion 解析用的状态键 */
const BUCKET_TO_STATUS: Record<AggregateBucket, string> = {
  working: 'executing',
  success: 'success',
  error: 'error',
  idle: 'idle',
}

interface RecentEmission {
  dedupeKey?: string
  normText: string
  at: number
}

/** 模板占位符渲染：{working} {total} {error} {todos} {changes} */
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

export class CompanionScheduler {
  private readonly deps: CompanionSchedulerDeps
  private readonly now: () => number
  private readonly random: () => number
  private readonly minIntervalMs: number
  private readonly dedupeWindowMs: number
  private readonly schedule: (cb: () => void, waitMs: number) => void

  private readonly sessionStates = new Map<string, AggregateBucket>()
  private pending: CompanionCandidate[] = []
  private lastEmitAt = Number.NEGATIVE_INFINITY
  private recents: RecentEmission[] = []
  private flushScheduled = false

  constructor(deps: CompanionSchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.minIntervalMs = deps.minIntervalMs ?? 3_000
    this.dedupeWindowMs = deps.dedupeWindowMs ?? 30_000
    this.schedule =
      deps.schedule ??
      ((cb, waitMs) => {
        const timer = setTimeout(cb, waitMs)
        timer.unref?.()
      })
  }

  /** 候选入队（唯一入口）；按规则 1 的间隔调度出队。 */
  enqueue(candidate: CompanionCandidate): void {
    if (!candidate.draft.trim()) return
    this.pending.push(candidate)
    this.scheduleFlush()
  }

  /** 跟踪会话聚合状态（跨会话聚合句的数据源）。 */
  onSessionStatus(sessionId: string, status: string | null): void {
    this.sessionStates.set(sessionId, normalizeAggregateStatus(status))
  }

  removeSession(sessionId: string): void {
    this.sessionStates.delete(sessionId)
  }

  /** 当前聚合桶统计（supervisor/测试可读）。 */
  aggregateCounts(): { total: number; working: number; success: number; error: number; idle: number } {
    const counts = { total: 0, working: 0, success: 0, error: 0, idle: 0 }
    for (const bucket of this.sessionStates.values()) {
      counts.total += 1
      counts[bucket] += 1
    }
    return counts
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    const wait = Math.max(0, this.lastEmitAt + this.minIntervalMs - this.now())
    this.schedule(() => {
      this.flushScheduled = false
      this.flush()
    }, wait)
  }

  /**
   * 出队（定时器回调与测试的公共入口）。遵守规则 1：距上次出队不足
   * minIntervalMs 时不发射并重新调度。
   */
  flush(): void {
    if (this.pending.length === 0) return
    const now = this.now()
    const elapsed = now - this.lastEmitAt
    if (elapsed < this.minIntervalMs) {
      if (!this.flushScheduled) {
        this.flushScheduled = true
        this.schedule(() => {
          this.flushScheduled = false
          this.flush()
        }, this.minIntervalMs - elapsed)
      }
      return
    }

    // 规则 6：语义重复去抖（先修剪窗口外记录，再过滤候选）
    this.recents = this.recents.filter((r) => now - r.at < this.dedupeWindowMs)
    const candidates = this.pending.filter((c) => !this.isDuplicate(c, now))
    this.pending = []
    if (candidates.length === 0) return

    const emitted = this.compose(candidates)
    if (!emitted) return
    this.deps.emit(emitted)
    this.lastEmitAt = now
    for (const c of candidates) {
      this.recents.push({ dedupeKey: c.dedupeKey, normText: normalizeText(c.draft), at: now })
    }
    this.recents.push({ normText: normalizeText(emitted.text), at: now })
  }

  private isDuplicate(c: CompanionCandidate, now: number): boolean {
    const norm = normalizeText(c.draft)
    return this.recents.some(
      (r) =>
        now - r.at < this.dedupeWindowMs &&
        ((c.dedupeKey !== undefined && r.dedupeKey === c.dedupeKey) || r.normText === norm),
    )
  }

  /**
   * 规则 2/3：单条候选直接放行；多条候选按优先级排序后取最高优先候选的
   * persona 与来源标注，文本合并为一条聚合句（scheduler_templates）。
   */
  private compose(candidates: CompanionCandidate[]): EmittedCompanion | null {
    const sorted = [...candidates].sort(
      (a, b) => CANDIDATE_PRIORITY[b.kind] - CANDIDATE_PRIORITY[a.kind],
    )
    const top = sorted[0]
    const persona = this.deps.personaFor(top.personaId)

    let text: string
    let status: string
    let scope: 'session' | 'global'
    if (sorted.length === 1) {
      text = top.draft
      status = top.status
      scope = top.scope
    } else {
      const aggregate = this.aggregateLine(persona)
      if (!aggregate) return null // 聚合句被 idle 去抖（v2 基线）
      text = aggregate.text
      status = BUCKET_TO_STATUS[aggregate.bucket]
      scope = 'global'
    }

    // rewriter 统一在出队口改写（ADR-12：角色语气的默认通道）
    const rewritten = this.deps.rewriter.rewrite(text, persona, { random: this.random })
    const cues: Live2dCues = resolveCues(persona, status)
    return {
      text: rewritten,
      emotion: cues.emotion,
      ...(cues.expression !== undefined ? { expression: cues.expression } : {}),
      ...(cues.motion !== undefined ? { motion: cues.motion } : {}),
      scope,
      ...(scope === 'session' && top.sessionId ? { sessionId: top.sessionId } : {}),
      ...(top.sourceTitle ? { sourceTitle: top.sourceTitle } : {}),
      ...(top.sourceSessionId ?? top.sessionId
        ? { sourceSessionId: (top.sourceSessionId ?? top.sessionId)! }
        : {}),
      personaId: persona.id,
    }
  }

  /**
   * 跨会话聚合句（extract/persona.md §3.3 的 YAML 化）：按 4 桶统计选择
   * scheduler_templates 键；全 idle 重复去抖（v2 基线）。
   */
  private aggregateLine(persona: Persona): { text: string; bucket: AggregateBucket } | null {
    const counts = this.aggregateCounts()
    const t = persona.schedulerTemplates
    let key: keyof typeof t
    let bucket: AggregateBucket
    if (counts.total === 0) {
      key = 'noSession'
      bucket = 'idle'
    } else if (counts.working > 0) {
      key = 'anyWorking'
      bucket = 'working'
    } else if (counts.success === counts.total) {
      key = 'allSuccess'
      bucket = 'success'
    } else if (counts.error === counts.total) {
      key = 'allError'
      bucket = 'error'
    } else if (counts.error === 1) {
      key = 'partialErrorSingle'
      bucket = 'error'
    } else if (counts.error > 1) {
      key = 'partialErrorMulti'
      bucket = 'error'
    } else {
      key = 'allIdle'
      bucket = 'idle'
    }

    const dedupeKey = `agg:${key}:${counts.working}:${counts.error}:${counts.total}`
    const now = this.now()
    if (
      this.recents.some(
        (r) => r.dedupeKey === dedupeKey && now - r.at < this.dedupeWindowMs,
      )
    ) {
      return null
    }
    const templates = t[key]
    const template = templates.length > 0 ? templates[0] : ''
    if (!template) return null
    const text = renderTemplate(template, {
      working: counts.working,
      total: counts.total,
      error: counts.error,
    })
    // 聚合句自身也登记 dedupeKey，避免同状态反复聚合刷屏
    this.recents.push({ dedupeKey, normText: normalizeText(text), at: now })
    return { text, bucket }
  }
}

/** AgentEvent → 状态键提取的公共小工具（companion 装配层用）。 */
export function statusOfEvent(ev: AgentEvent): string | null {
  if (ev.type === 'status') return ev.status
  if (ev.type === 'complete') return ev.status
  return null
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '')
}
