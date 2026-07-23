/**
 * persona/companion.ts 装配层测试：出队结果 → 协议消息映射（session/global
 * 信封、emotion_update 随同）、会话级 companion_message 落盘、todoProgress
 * 数据源、未知 persona 回退中立默认、归来摘要 rewriter 挂钩。
 */
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@dionysus/protocol'

import { PersonaLoader } from '../loader.js'
import { createCompanion, type Companion } from '../companion.js'
import type { SessionMeta } from '../../session/types.js'

const FIXTURES = fileURLToPath(new URL('fixtures', import.meta.url))

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1',
    title: '重构 auth',
    personaId: 'companion-test',
    status: 'idle',
    adapterId: 'fake',
    updatedAt: 0,
    createdAt: 0,
    unreadCount: 0,
    ...overrides,
  }
}

interface Harness {
  companion: Companion
  messages: ServerMessage[]
  persisted: Array<{ sessionId: string; ev: unknown }>
  flushScheduled: () => void
}

function makeHarness(): Harness {
  const messages: ServerMessage[] = []
  const persisted: Array<{ sessionId: string; ev: unknown }> = []
  const scheduled: Array<() => void> = []
  const companion = createCompanion({
    loader: new PersonaLoader({ builtinDir: FIXTURES }),
    emit: (m) => messages.push(m),
    persist: (sessionId, ev) => {
      persisted.push({ sessionId, ev })
    },
    audienceCount: () => 1,
    listSessions: () => [],
    random: () => 0, // 必中前缀「报告：」与口癖「嗯，就这样。」
    scheduleFlush: (cb) => scheduled.push(cb),
  })
  return {
    companion,
    messages,
    persisted,
    flushScheduled: () => {
      for (let i = 0; i < 10 && scheduled.length > 0; i++) {
        const cbs = scheduled.splice(0)
        for (const cb of cbs) cb()
      }
    },
  }
}

const companionMessages = (msgs: ServerMessage[]) => msgs.filter((m) => m.type === 'companion_message')
const emotionUpdates = (msgs: ServerMessage[]) => msgs.filter((m) => m.type === 'emotion_update')

describe('出队 → 协议消息映射', () => {
  it('session scope：信封带 sessionId，companion_message 落盘 event 行，rewriter 口吻生效', async () => {
    const h = makeHarness()
    await h.companion.preloadPersona('companion-test')
    h.companion.scheduler.enqueue({
      kind: 'status_phrase',
      personaId: 'companion-test',
      scope: 'session',
      sessionId: 's1',
      draft: '正在处理。',
      status: 'executing',
    })
    h.flushScheduled()

    const cm = companionMessages(h.messages)
    expect(cm).toHaveLength(1)
    expect(cm[0].sessionId).toBe('s1')
    // random=0：前缀「报告：」+ 口癖「嗯，就这样。」
    expect(cm[0].payload.text).toBe('报告：正在处理。嗯，就这样。')
    expect(cm[0].payload.scope).toBe('session')
    expect(cm[0].payload.emotion).toBe('confident') // executing → confident

    const eu = emotionUpdates(h.messages)
    expect(eu).toHaveLength(1)
    expect(eu[0].sessionId).toBe('s1')
    expect(eu[0].payload).toMatchObject({ emotion: 'confident', confidence: 1, expression: '冷静' })

    // 会话级汇报落盘（§4.1 event 行）
    expect(h.persisted).toHaveLength(1)
    expect(h.persisted[0].sessionId).toBe('s1')
    expect(h.persisted[0].ev).toMatchObject({ type: 'event', eventType: 'companion_message' })
  })

  it('global scope：信封省略 sessionId，不落盘', async () => {
    const h = makeHarness()
    await h.companion.preloadPersona('companion-test')
    h.companion.scheduler.enqueue({
      kind: 'supervisor',
      personaId: 'companion-test',
      scope: 'global',
      draft: '全局播报。',
      status: 'executing',
    })
    h.flushScheduled()

    const cm = companionMessages(h.messages)
    expect(cm).toHaveLength(1)
    expect(cm[0].sessionId).toBeUndefined()
    expect(cm[0].payload.scope).toBe('global')
    expect(h.persisted).toEqual([])
  })

  it('未知 persona 回退中立默认（不抛错）', async () => {
    const h = makeHarness()
    await h.companion.preloadPersona('no-such-persona')
    h.companion.scheduler.enqueue({
      kind: 'status_phrase',
      personaId: 'no-such-persona',
      scope: 'global',
      draft: '中性台词。',
      status: 'executing',
    })
    h.flushScheduled()
    const cm = companionMessages(h.messages)
    expect(cm).toHaveLength(1)
    expect(cm[0].payload.text).toBe('中性台词。') // default persona 无前后缀/口癖
  })
})

describe('hooks 与摘要挂钩', () => {
  it('todoProgress：无 tracker 的会话返回 undefined', () => {
    const h = makeHarness()
    expect(h.companion.hooks.todoProgress?.('nope')).toBeUndefined()
  })

  it('onTurnEvent 产出 todo_update 全量快照', async () => {
    const h = makeHarness()
    await h.companion.hooks.onTurnStart?.(meta())
    h.companion.hooks.onTurnEvent?.('s1', { type: 'status', status: 'thinking', detail: '' })
    const todos = h.messages.filter((m) => m.type === 'todo_update')
    expect(todos).toHaveLength(1)
    expect(todos[0].sessionId).toBe('s1')
    expect(todos[0].payload.items).toEqual([{ id: 'status:think', text: '思考方案', done: false }])
    expect(h.companion.hooks.todoProgress?.('s1')).toEqual({ done: 0, total: 1 })
  })

  it('returnSummaryRewriter：归来摘要文本过 persona rewriter', async () => {
    const h = makeHarness()
    await h.companion.hooks.onTurnStart?.(meta()) // 建立最近活跃 persona
    const out = h.companion.returnSummaryRewriter('你离开期间：会话 A 完成 1 回合（成功）')
    expect(out).toContain('报告：')
    expect(out).toContain('嗯，就这样。')
  })
})
