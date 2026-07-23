/**
 * CompanionSupervisor 测试（architecture.md §5.4 完整语义；
 * legacy/backend/tests/test_supervisor.py 语义的 vitest 翻译 + v3 新增规则）。
 *
 * 翻译对应：
 * - test_disabled_mode_emits_nothing → disabled 模式 tick/start 均不产生播报
 * - test_detects_status_change_and_emits → 快照 diff 检出状态跃迁并播报
 * - test_no_sessions_emits_nothing → 无会话不产生播报
 * - test_fleet_state_summary → computeFleet/todoSummary 聚合口径
 * - test_settings_roundtrip → 不翻译：v3 配置由宿主 settings.json 注入，
 *   core 不做文件持久化（architecture.md §6.5，ADR-6）
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_PERSONA, type Persona } from '../loader.js'
import { TemplateRewriter } from '../rewriter.js'
import { CompanionScheduler, type EmittedCompanion } from '../scheduler.js'
import {
  CompanionSupervisor,
  computeFleet,
  todoSummary,
  type SupervisorConfig,
  type SupervisorSessionSnapshot,
} from '../supervisor.js'

const PERSONA: Persona = {
  ...DEFAULT_PERSONA,
  id: 'sup-test',
  companion: {
    ...DEFAULT_PERSONA.companion,
    statusToEmotion: { ...DEFAULT_PERSONA.companion.statusToEmotion, error: 'worried', executing: 'confident', success: 'happy' },
  },
  supervisorTemplates: {
    working: ['播报：{working} 个在跑，进度 {todos}。'],
    error: ['播报：异常 {changes}。'],
    changed: ['播报：变动 {changes}。'],
    idle: ['播报：无变化。'],
  },
}

function snap(overrides: Partial<SupervisorSessionSnapshot> = {}): SupervisorSessionSnapshot {
  return {
    sessionId: 's1',
    personaId: 'sup-test',
    title: '重构 auth',
    status: 'idle',
    updatedAt: 1,
    todo: { done: 0, total: 0 },
    ...overrides,
  }
}

interface Harness {
  supervisor: CompanionSupervisor
  emitted: EmittedCompanion[]
  drain: () => void
  advance: (ms: number) => void
}

function makeHarness(
  sessions: () => SupervisorSessionSnapshot[],
  opts: { config?: Partial<SupervisorConfig>; audience?: () => number } = {},
): Harness {
  let now = 0
  const emitted: EmittedCompanion[] = []
  const scheduled: Array<() => void> = []
  const scheduler = new CompanionScheduler({
    personaFor: () => PERSONA,
    rewriter: new TemplateRewriter(),
    emit: (e) => emitted.push(e),
    now: () => now,
    random: () => 0.99,
    schedule: (cb) => scheduled.push(cb),
  })
  const supervisor = new CompanionSupervisor({
    config: { mode: 'template', intervalSeconds: 15, ...opts.config },
    listSessions: sessions,
    audienceCount: opts.audience ?? (() => 1),
    personaFor: () => PERSONA,
    scheduler,
    now: () => now,
    random: () => 0,
  })
  return {
    supervisor,
    emitted,
    drain: () => {
      for (let i = 0; i < 10 && scheduled.length > 0; i++) {
        const cbs = scheduled.splice(0)
        for (const cb of cbs) cb()
      }
    },
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('legacy test_supervisor.py 语义翻译', () => {
  it('disabled 模式：tick 与 start 均不产生播报', async () => {
    const h = makeHarness(() => [snap()], { config: { mode: 'disabled' } })
    let intervalCalls = 0
    const sv = new CompanionSupervisor({
      config: { mode: 'disabled', intervalSeconds: 15 },
      listSessions: () => [snap()],
      audienceCount: () => 1,
      personaFor: () => PERSONA,
      scheduler: new CompanionScheduler({
        personaFor: () => PERSONA,
        rewriter: new TemplateRewriter(),
        emit: () => {},
        schedule: (cb) => cb(),
      }),
      setIntervalFn: () => {
        intervalCalls += 1
        return null
      },
    })
    sv.start() // disabled 不起任务
    expect(intervalCalls).toBe(0)

    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toEqual([])
  })

  it('检出状态跃迁并播报（created → working 各触发一轮）', async () => {
    let current = snap({ status: 'idle' })
    const h = makeHarness(() => [current])
    await h.supervisor.tick() // 首轮：新会话「重构 auth」created 变动
    h.drain()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].text).toContain('新会话「重构 auth」')

    h.advance(4_000)
    current = snap({ status: 'running', todo: { done: 1, total: 3 } })
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toHaveLength(2)
    expect(h.emitted[1].text).toContain('1 个在跑')
  })

  it('无会话不产生播报', async () => {
    const h = makeHarness(() => [])
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toEqual([])
  })

  it('fleet 聚合口径：N 工作/M 出错 + todo 进度摘要', () => {
    const fleet = computeFleet([
      snap({ sessionId: 'a', status: 'running' }),
      snap({ sessionId: 'b', status: 'error' }),
      snap({ sessionId: 'c', status: 'done' }),
    ])
    expect(fleet).toEqual({ total: 3, working: 1, error: 1, idle: 1 })
    expect(
      todoSummary([
        snap({ sessionId: 'a', title: '重构', todo: { done: 3, total: 7 } }),
        snap({ sessionId: 'b', title: '修测试', todo: { done: 0, total: 0 } }),
      ]),
    ).toBe('「重构」3/7')
  })
})

describe('v3 新增规则', () => {
  it('安静期跳过：无变动且无 working 会话，本轮静默', async () => {
    const h = makeHarness(() => [snap({ status: 'idle' })])
    await h.supervisor.tick() // 首轮 created 变动 → 播报
    h.drain()
    expect(h.emitted).toHaveLength(1)

    h.advance(20_000)
    await h.supervisor.tick() // 无变动 + 无 working → 静默
    h.drain()
    expect(h.emitted).toHaveLength(1)
  })

  it('无客户端连接时不生成（且基线更新，恢复观众后无伪变动播报）', async () => {
    let audience = 0
    let current = snap({ status: 'idle' })
    const h = makeHarness(() => [current], { audience: () => audience })
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toEqual([])

    // 无观众期间状态推进过；恢复观众后同状态 → 安静期跳过（不补播旧变动）
    audience = 1
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toEqual([])

    current = snap({ status: 'running', todo: { done: 2, total: 5 } })
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toHaveLength(1)
  })

  it('模板播报含各会话 todo 进度（{todos} 渲染）', async () => {
    const h = makeHarness(() => [snap({ status: 'running', todo: { done: 3, total: 7 } })])
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted[0].text).toBe('播报：1 个在跑，进度 「重构 auth」3/7。')
  })

  it('播报 emotion 按语义解析（error 播报不再恒用 working 表情）', async () => {
    const h = makeHarness(() => [snap({ status: 'error' })])
    await h.supervisor.tick() // error fleet → error 类别播报
    h.drain()
    expect(h.emitted[0].emotion).toBe('worried') // statusToEmotion['error']
    expect(h.emitted[0].text).toContain('播报：异常')
  })

  it('回合结束即时播报：success→turn_complete 含 todo 进度；error→alert', async () => {
    const h = makeHarness(() => [snap({ status: 'done' })])
    h.supervisor.notifyTurnEnd(snap({ status: 'done', todo: { done: 2, total: 3 } }), 'success')
    h.drain()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].text).toBe('播报：变动 「重构 auth」已完成（2/3）。')
    expect(h.emitted[0].emotion).toBe('happy') // success 语义

    h.advance(4_000)
    h.supervisor.notifyTurnEnd(snap({ status: 'error' }), 'error')
    h.drain()
    expect(h.emitted).toHaveLength(2)
    expect(h.emitted[1].text).toBe('播报：异常 「重构 auth」出现错误。')
    expect(h.emitted[1].emotion).toBe('worried')

    h.advance(4_000)
    h.supervisor.notifyTurnEnd(snap({ status: 'idle' }), 'interrupted')
    h.drain()
    expect(h.emitted[2].text).toBe('播报：异常 「重构 auth」已被打断。')
  })

  it('无观众时回合结束即时播报同样不生成', () => {
    const h = makeHarness(() => [snap()], { audience: () => 0 })
    h.supervisor.notifyTurnEnd(snap({ status: 'done' }), 'success')
    h.drain()
    expect(h.emitted).toEqual([])
  })

  it('agent_session / deepseek_api 模式：LLM 路径抛 not implemented，tick 静默降级 template', async () => {
    const h = makeHarness(() => [snap({ status: 'running' })], {
      config: { mode: 'agent_session' },
    })
    expect(() =>
      h.supervisor.composeLine(PERSONA, 'working', computeFleet([snap()]), [snap()], []),
    ).toThrow(/not implemented/)
    // tick 捕获后降级模板，仍有播报产出
    await h.supervisor.tick()
    h.drain()
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0].text).toContain('播报：')
  })

  it('intervalSeconds 下限 5s 钳制', () => {
    let captured = 0
    const sv = new CompanionSupervisor({
      config: { mode: 'template', intervalSeconds: 1 },
      listSessions: () => [],
      audienceCount: () => 1,
      personaFor: () => PERSONA,
      scheduler: new CompanionScheduler({
        personaFor: () => PERSONA,
        rewriter: new TemplateRewriter(),
        emit: () => {},
        schedule: () => {},
      }),
      setIntervalFn: (_cb, ms) => {
        captured = ms
        return null
      },
    })
    sv.start()
    expect(captured).toBe(5_000)
  })
})
