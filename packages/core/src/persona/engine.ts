/**
 * persona/engine.ts — CompanionEngine：单会话陪伴引擎（architecture.md §5.4；
 * 行为基线 extract/persona.md §2）。
 *
 * v3 每会话一个实例（v2 每回合新建），beginTurn() 重置回合内状态（冷却、
 * 已触发标记、计时）。职责：
 * - status→emotion 映射（persona.companion.status_to_emotion，未知状态回退
 *   中立 'neutral'——代码内零角色硬编码，extract §7 缺陷 1/2 不重现）；
 * - 回合内台词候选：work_start（首个 working 类状态触发一次）、状态短语
 *   （status_phrases，5 秒冷却）、long_workflow（>12s 且状态数 >1，一次）、
 *   回合结束 success/error 台词（各一次）；
 * - emotion→expression/motion 解析全部来自 persona YAML 的 live2d 段，
 *   缺省为 undefined（不持有任何模型相关字面量）。
 *
 * 引擎只产出台词**草稿**（未改写）；rewriter 改写统一在 CompanionScheduler
 * 出队口执行（多声源仲裁的唯一出口，§5.4）。
 */
import type { AgentEvent } from '../adapters/types.js'
import type { Persona } from './loader.js'

/** 状态短语冷却（v2 `_STATUS_COOLDOWN_SECONDS`） */
export const STATUS_COOLDOWN_MS = 5_000
/** long_workflow 触发阈值（v2：12 秒） */
export const LONG_WORKFLOW_MS = 12_000

/** 台词候选的仲裁优先级类别（scheduler 的四级优先级见 scheduler.ts） */
export type CompanionCandidateKind = 'alert' | 'turn_complete' | 'status_phrase'

export interface EngineLine {
  /** 未改写的台词草稿 */
  draft: string
  /** 用于 emotion 解析的状态键 */
  status: string
  kind: CompanionCandidateKind
}

export interface Live2dCues {
  emotion: string
  expression?: string
  motion?: string
}

export interface CompanionEngineOptions {
  random?: () => number
  now?: () => number
}

function pick(list: string[], random: () => number): string {
  const index = Math.min(list.length - 1, Math.floor(random() * list.length))
  return list[Math.max(0, index)]
}

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

/** status→emotion：persona.companion.status_to_emotion，未知状态回退中立 'neutral'。 */
export function resolveEmotion(persona: Persona, status: string): string {
  return persona.companion.statusToEmotion[status] ?? 'neutral'
}

/**
 * status → (emotion, expression, motion) 全链解析（supervisor/scheduler 共用，
 * 修复 v2「Supervisor 播报恒用 working 情绪」缺陷——调用方传入播报语义对应
 * 的状态键即可）。表情/动作名完全来自 persona YAML，缺省 undefined。
 */
export function resolveCues(persona: Persona, status: string): Live2dCues {
  const emotion = resolveEmotion(persona, status)
  const live2d = persona.companion.live2d
  const expressions = asStringRecord(live2d['expressions'])
  const motions = asStringRecord(live2d['motions'])
  const defaultExpression =
    typeof live2d['default_expression'] === 'string'
      ? (live2d['default_expression'] as string)
      : undefined
  return {
    emotion,
    expression: expressions[emotion] ?? defaultExpression,
    motion: motions[emotion] ?? motions['idle'],
  }
}

export class CompanionEngine {
  private readonly persona: Persona
  private readonly random: () => number
  private readonly now: () => number

  private turnStartedAt = 0
  private statusCount = 0
  private lastStatusAt: number | null = null
  private readonly fired = new Set<string>()

  constructor(persona: Persona, opts: CompanionEngineOptions = {}) {
    this.persona = persona
    this.random = opts.random ?? Math.random
    this.now = opts.now ?? Date.now
    this.beginTurn()
  }

  get personaId(): string {
    return this.persona.id
  }

  /** 回合开始：重置冷却/已触发标记/计时（每会话一个实例，回合状态不跨回合残留）。 */
  beginTurn(): void {
    this.turnStartedAt = this.now()
    this.statusCount = 0
    this.lastStatusAt = null
    this.fired.clear()
  }

  /**
   * 消费 adapter 事件，命中触发规则时返回台词候选（草稿），否则 null。
   * 触发规则与 v2 `on_event` 一致（extract/persona.md §2.2）。
   */
  onEvent(ev: AgentEvent): EngineLine | null {
    if (ev.type === 'status') return this.onStatus(ev.status)
    if (ev.type === 'complete') return this.onComplete(ev.status)
    return null
  }

  private onStatus(status: string): EngineLine | null {
    this.statusCount += 1

    // 首个 working 类状态触发一次 work_start
    if (
      !this.fired.has('work_start') &&
      (status === 'thinking' || status === 'reading_file' || status === 'executing')
    ) {
      this.fired.add('work_start')
      return this.line('work_start', status, 'status_phrase')
    }

    // 状态短语：5 秒冷却（首次恒通过，同 v2）
    if (status in this.persona.statusPhrases && this.cooldownOk()) {
      const candidates = this.persona.statusPhrases[status]
      if (candidates.length > 0) {
        return {
          draft: pick(candidates, this.random),
          status,
          kind: 'status_phrase',
        }
      }
    }

    // long_workflow：回合耗时 >12s 且状态数 >1，每回合一次
    if (
      !this.fired.has('long_workflow') &&
      this.now() - this.turnStartedAt > LONG_WORKFLOW_MS &&
      this.statusCount > 1
    ) {
      this.fired.add('long_workflow')
      return this.line('long_workflow', 'long_workflow', 'status_phrase')
    }
    return null
  }

  private onComplete(status: 'success' | 'error' | 'interrupted'): EngineLine | null {
    if (status === 'success' && !this.fired.has('success')) {
      this.fired.add('success')
      return this.line('success', 'success', 'turn_complete')
    }
    // error 与打断同为最高优先级插播（仲裁规则：error/打断 > 回合完成）
    if (status !== 'success' && !this.fired.has('error')) {
      this.fired.add('error')
      return this.line('error', 'error', 'alert')
    }
    return null
  }

  private line(templateKey: string, status: string, kind: CompanionCandidateKind): EngineLine {
    const candidates = this.persona.companionTemplates[templateKey] ?? []
    return { draft: candidates.length > 0 ? pick(candidates, this.random) : '', status, kind }
  }

  private cooldownOk(): boolean {
    const now = this.now()
    if (this.lastStatusAt === null) {
      this.lastStatusAt = now
      return true
    }
    if (now - this.lastStatusAt >= STATUS_COOLDOWN_MS) {
      this.lastStatusAt = now
      return true
    }
    return false
  }
}
