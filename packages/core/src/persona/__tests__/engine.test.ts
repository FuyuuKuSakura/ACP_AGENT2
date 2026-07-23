/**
 * CompanionEngine 测试：status→emotion 映射（含未知状态回退中立）、
 * 触发规则（work_start 一次 / 状态短语 5s 冷却 / long_workflow 阈值 /
 * 回合结束 success=turn_complete、error 与 interrupted=alert）、
 * beginTurn 重置、resolveCues 全链解析全部来自 persona YAML。
 */
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../adapters/types.js'
import {
  CompanionEngine,
  LONG_WORKFLOW_MS,
  STATUS_COOLDOWN_MS,
  resolveCues,
  resolveEmotion,
} from '../engine.js'
import { DEFAULT_PERSONA, type Persona } from '../loader.js'

function makePersona(): Persona {
  return {
    ...DEFAULT_PERSONA,
    id: 'engine-test',
    companion: {
      statusToEmotion: {
        thinking: 'neutral',
        executing: 'confident',
        success: 'happy',
        error: 'worried',
        idle: 'bored',
        long_workflow: 'bored',
      },
      live2d: {
        default_expression: '原皮',
        expressions: { happy: '微笑', worried: '叹气', confident: '冷静', neutral: '原皮' },
        motions: { idle: 'Idle', happy: '挥手' },
      },
      touchZones: {},
    },
    companionTemplates: {
      work_start: ['开工台词'],
      long_workflow: ['长流程台词'],
      error: ['错误台词'],
      success: ['成功台词'],
    },
    statusPhrases: {
      thinking: ['思考短语'],
      executing: ['执行短语'],
    },
  }
}

const status = (s: string): AgentEvent => ({ type: 'status', status: s as never, detail: '' })
const complete = (s: 'success' | 'error' | 'interrupted'): AgentEvent => ({
  type: 'complete',
  status: s,
  artifacts: [],
})

describe('status→emotion 映射', () => {
  it('命中 persona.companion.status_to_emotion；未知状态回退中立 neutral', () => {
    const p = makePersona()
    expect(resolveEmotion(p, 'executing')).toBe('confident')
    expect(resolveEmotion(p, 'success')).toBe('happy')
    expect(resolveEmotion(p, 'nonexistent_status')).toBe('neutral')
  })

  it('resolveCues：expression/motion 全部来自 persona live2d 段，含缺省回退', () => {
    const p = makePersona()
    expect(resolveCues(p, 'success')).toEqual({ emotion: 'happy', expression: '微笑', motion: '挥手' })
    // bored 无 expressions 映射 → default_expression；motion 无 bored 键 → motions.idle
    expect(resolveCues(p, 'idle')).toEqual({ emotion: 'bored', expression: '原皮', motion: 'Idle' })
    // 中立默认 persona（live2d 为空）：expression/motion 为 undefined，无模型字面量
    const cues = resolveCues(DEFAULT_PERSONA, 'error')
    expect(cues.emotion).toBe('worried')
    expect(cues.expression).toBeUndefined()
    expect(cues.motion).toBeUndefined()
  })
})

describe('回合内触发规则', () => {
  it('首个 working 类状态触发一次 work_start', () => {
    const e = new CompanionEngine(makePersona(), { random: () => 0, now: () => 0 })
    const line = e.onEvent(status('thinking'))
    expect(line).toEqual({ draft: '开工台词', status: 'thinking', kind: 'status_phrase' })
    // 第二次 thinking 不再触发 work_start（走状态短语路径）
    const phrase = e.onEvent(status('thinking'))
    expect(phrase?.draft).toBe('思考短语')
  })

  it('状态短语 5 秒冷却（首次恒通过）', () => {
    let now = 0
    const e = new CompanionEngine(makePersona(), { random: () => 0, now: () => now })
    e.onEvent(status('executing')) // work_start
    now = 1_000
    expect(e.onEvent(status('executing'))?.draft).toBe('执行短语') // 首次冷却判定恒过
    now = 2_000 // 距上次 1s < 5s
    expect(e.onEvent(status('executing'))).toBeNull()
    now = 2_000 + STATUS_COOLDOWN_MS
    expect(e.onEvent(status('executing'))?.draft).toBe('执行短语')
  })

  it('long_workflow：>12s 且状态数 >1 时触发一次', () => {
    let now = 0
    const e = new CompanionEngine(makePersona(), { random: () => 0, now: () => now })
    e.onEvent(status('thinking')) // work_start，statusCount=1
    now = LONG_WORKFLOW_MS + 1
    const line = e.onEvent(status('thinking')) // statusCount=2；冷却已过 12s
    // 状态短语（冷却通过）优先于 long_workflow（v2 同序）
    expect(line?.draft).toBe('思考短语')
    const lw = e.onEvent(status('outputting')) // 无短语配置 → 落到 long_workflow
    expect(lw).toEqual({ draft: '长流程台词', status: 'long_workflow', kind: 'status_phrase' })
    expect(e.onEvent(status('outputting'))).toBeNull() // 只触发一次
  })

  it('complete：success→turn_complete，error/interrupted→alert，各一次', () => {
    const e = new CompanionEngine(makePersona(), { random: () => 0, now: () => 0 })
    expect(e.onEvent(complete('success'))).toEqual({
      draft: '成功台词',
      status: 'success',
      kind: 'turn_complete',
    })
    expect(e.onEvent(complete('success'))).toBeNull()

    const e2 = new CompanionEngine(makePersona(), { random: () => 0, now: () => 0 })
    expect(e2.onEvent(complete('error'))?.kind).toBe('alert')
    const e3 = new CompanionEngine(makePersona(), { random: () => 0, now: () => 0 })
    expect(e3.onEvent(complete('interrupted'))?.kind).toBe('alert')
  })

  it('beginTurn 重置回合状态（每会话一个实例跨回合复用）', () => {
    const e = new CompanionEngine(makePersona(), { random: () => 0, now: () => 0 })
    e.onEvent(status('thinking')) // work_start
    e.beginTurn()
    const line = e.onEvent(status('thinking'))
    expect(line?.draft).toBe('开工台词') // 新回合再次触发 work_start
  })

  it('非 status/complete 事件不反应', () => {
    const e = new CompanionEngine(makePersona(), { random: () => 0, now: () => 0 })
    expect(
      e.onEvent({ type: 'stream', chunk: 'x', isFinal: false, status: 'outputting', isThinking: false }),
    ).toBeNull()
  })
})
