/**
 * CompanionScheduler 仲裁测试（architecture.md §5.4 六条规则）：
 * 3s 最小间隔 / 优先级 / 同 tick 聚合（scheduler_templates）/ 语义重复去抖
 * （含 v2 基线的 idle 去抖）；安静期与无观众规则在 supervisor.test.ts 覆盖。
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_PERSONA, type Persona } from '../loader.js'
import { TemplateRewriter } from '../rewriter.js'
import {
  CompanionScheduler,
  normalizeAggregateStatus,
  renderTemplate,
  type CompanionCandidate,
  type EmittedCompanion,
} from '../scheduler.js'

function makePersona(id: string, anyWorking: string): Persona {
  return {
    ...DEFAULT_PERSONA,
    id,
    schedulerTemplates: { ...DEFAULT_PERSONA.schedulerTemplates, anyWorking: [anyWorking] },
  }
}

const PERSONA_A = makePersona('pa', 'A聚合：{working} 个工作（共 {total}）')
const PERSONA_B = makePersona('pb', 'B聚合：{working} 个工作（共 {total}）')

interface Harness {
  scheduler: CompanionScheduler
  emitted: EmittedCompanion[]
  drain: () => void
  setNow: (ms: number) => void
  advance: (ms: number) => void
}

function makeHarness(opts: { minIntervalMs?: number; dedupeWindowMs?: number } = {}): Harness {
  let now = 0
  const emitted: EmittedCompanion[] = []
  const scheduled: Array<() => void> = []
  const personas = new Map([
    ['pa', PERSONA_A],
    ['pb', PERSONA_B],
  ])
  const scheduler = new CompanionScheduler({
    personaFor: (id) => personas.get(id) ?? DEFAULT_PERSONA,
    rewriter: new TemplateRewriter(),
    emit: (e) => emitted.push(e),
    now: () => now,
    random: () => 0.99, // rewriter 不掷中任何前后缀/口癖，文本可预期
    schedule: (cb) => scheduled.push(cb),
    ...opts,
  })
  return {
    scheduler,
    emitted,
    drain: () => {
      // 执行已捕获回调；阻塞重排会追加新回调，限量循环后保留剩余回调
      // （等 now 推进后再 drain 放行，模拟定时器到点）
      for (let i = 0; i < 10 && scheduled.length > 0; i++) {
        const cbs = scheduled.splice(0)
        for (const cb of cbs) cb()
      }
    },
    setNow: (ms) => {
      now = ms
    },
    advance: (ms) => {
      now += ms
    },
  }
}

function candidate(overrides: Partial<CompanionCandidate> = {}): CompanionCandidate {
  return {
    kind: 'status_phrase',
    personaId: 'pa',
    scope: 'session',
    sessionId: 's1',
    draft: '候选台词',
    status: 'executing',
    ...overrides,
  }
}

describe('规则 1：可见台词最小间隔 3 秒', () => {
  it('间隔内候选被压住，满 3s 后放行', () => {
    const h = makeHarness()
    h.scheduler.enqueue(candidate({ draft: '第一条' }))
    h.drain()
    expect(h.emitted.map((e) => e.text)).toEqual(['第一条'])

    h.scheduler.enqueue(candidate({ draft: '第二条' }))
    h.drain() // 距上次 0ms < 3000ms，压住
    expect(h.emitted).toHaveLength(1)

    h.advance(3_000)
    h.drain()
    expect(h.emitted.map((e) => e.text)).toEqual(['第一条', '第二条'])
  })
})

describe('规则 2：优先级 error/打断 > 回合完成 > Supervisor > 状态短语', () => {
  it('同窗口多候选合并时取最高优先候选的 persona/来源', () => {
    const h = makeHarness()
    h.scheduler.onSessionStatus('s1', 'running')
    // 先入队低优先（B 状态短语），再入队最高优先（A alert）
    h.scheduler.enqueue(candidate({ personaId: 'pb', draft: 'B 的状态短语' }))
    h.scheduler.enqueue(candidate({ kind: 'alert', personaId: 'pa', draft: 'A 的报错' }))
    h.drain()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].personaId).toBe('pa')
    expect(h.emitted[0].text).toContain('A聚合')
  })

  it('入队顺序不影响优先级判定', () => {
    const h = makeHarness()
    h.scheduler.onSessionStatus('s1', 'running')
    h.scheduler.enqueue(candidate({ kind: 'alert', personaId: 'pa', draft: 'A 的报错' }))
    h.scheduler.enqueue(candidate({ personaId: 'pb', draft: 'B 的状态短语' }))
    h.drain()
    expect(h.emitted[0].personaId).toBe('pa')
  })
})

describe('规则 3：同 tick 多候选合并为一条聚合句', () => {
  it('聚合句走 scheduler_templates 并渲染 {working}/{total}，scope=global', () => {
    const h = makeHarness()
    h.scheduler.onSessionStatus('s1', 'running')
    h.scheduler.onSessionStatus('s2', 'running')
    h.scheduler.enqueue(candidate({ draft: '台词一' }))
    h.scheduler.enqueue(candidate({ kind: 'turn_complete', draft: '台词二' }))
    h.drain()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].text).toBe('A聚合：2 个工作（共 2）')
    expect(h.emitted[0].scope).toBe('global')
    expect(h.emitted[0].sessionId).toBeUndefined()
    // 聚合桶 working → executing → default persona 映射 neutral
    expect(h.emitted[0].emotion).toBe('neutral')
  })

  it('单候选直接放行（不聚合），保留 session scope 与 emotion 链', () => {
    const h = makeHarness()
    h.scheduler.enqueue(
      candidate({ draft: '单条台词', status: 'success', sessionId: 's9', sourceTitle: '会话九' }),
    )
    h.drain()
    expect(h.emitted).toHaveLength(1)
    const e = h.emitted[0]
    expect(e.text).toBe('单条台词')
    expect(e.scope).toBe('session')
    expect(e.sessionId).toBe('s9')
    expect(e.sourceSessionId).toBe('s9')
    expect(e.sourceTitle).toBe('会话九')
    expect(e.emotion).toBe('neutral') // default persona success→neutral
  })

  it('聚合句同时经 rewriter 改写', () => {
    const emitted: EmittedCompanion[] = []
    const scheduled: Array<() => void> = []
    // random=0.99 时 keyword_replacements 仍生效（非掷点路径）
    const pa = {
      ...PERSONA_A,
      toneRules: { ...PERSONA_A.toneRules, keywordReplacements: { 工作: '任务' } },
    }
    const scheduler = new CompanionScheduler({
      personaFor: () => pa,
      rewriter: new TemplateRewriter(),
      emit: (e) => emitted.push(e),
      now: () => 0,
      random: () => 0.99,
      schedule: (cb) => scheduled.push(cb),
    })
    scheduler.onSessionStatus('s1', 'running')
    scheduler.enqueue(candidate({ draft: 'x' }))
    scheduler.enqueue(candidate({ draft: 'y' }))
    scheduler.flush()
    expect(emitted[0].text).toBe('A聚合：1 个任务（共 1）')
  })
})

describe('规则 6：语义重复去抖', () => {
  it('同 dedupeKey 窗口内丢弃，窗口外放行', () => {
    const h = makeHarness()
    h.scheduler.enqueue(candidate({ draft: '播报一', dedupeKey: 'sup:working:1' }))
    h.drain()
    expect(h.emitted).toHaveLength(1)

    h.advance(3_000)
    h.scheduler.enqueue(candidate({ draft: '播报一', dedupeKey: 'sup:working:1' }))
    h.drain()
    expect(h.emitted).toHaveLength(1) // 去抖丢弃

    h.advance(31_000)
    h.scheduler.enqueue(candidate({ draft: '播报一', dedupeKey: 'sup:working:1' }))
    h.drain()
    expect(h.emitted).toHaveLength(2) // 出窗口放行
  })

  it('归一化文本相同（无 dedupeKey）同样去抖', () => {
    const h = makeHarness()
    h.scheduler.enqueue(candidate({ draft: '同一句 话' }))
    h.drain()
    h.advance(3_000)
    h.scheduler.enqueue(candidate({ draft: '同一句话' }))
    h.drain()
    expect(h.emitted).toHaveLength(1)
  })

  it('全 idle 聚合重复去抖（v2 idle 去抖基线）', () => {
    const h = makeHarness()
    h.scheduler.onSessionStatus('s1', 'idle')
    h.scheduler.enqueue(candidate({ draft: 'x' }))
    h.scheduler.enqueue(candidate({ draft: 'y' }))
    h.drain()
    expect(h.emitted.map((e) => e.text)).toEqual(['所有会话均处于空闲状态。'])

    h.advance(3_000)
    h.scheduler.enqueue(candidate({ draft: 'p' }))
    h.scheduler.enqueue(candidate({ draft: 'q' }))
    h.drain()
    expect(h.emitted).toHaveLength(1) // 同状态聚合被去抖
  })
})

describe('小工具', () => {
  it('normalizeAggregateStatus 归一化 4 桶', () => {
    expect(normalizeAggregateStatus('running')).toBe('working')
    expect(normalizeAggregateStatus('waiting_option')).toBe('working')
    expect(normalizeAggregateStatus('done')).toBe('success')
    expect(normalizeAggregateStatus('interrupted')).toBe('error')
    expect(normalizeAggregateStatus('idle')).toBe('idle')
    expect(normalizeAggregateStatus(null)).toBe('idle')
  })

  it('renderTemplate 渲染已知占位符，未知保留原样', () => {
    expect(renderTemplate('{working}/{total}/{error}/{unknown}', { working: 1, total: 2, error: 0 })).toBe(
      '1/2/0/{unknown}',
    )
  })
})
