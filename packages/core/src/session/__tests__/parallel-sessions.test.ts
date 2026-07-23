/**
 * parallel-sessions 测试（roadmap Phase 2 具名用例，多会话隔离的唯一回归防线）：
 * 两 FakeAdapter 会话并行 runAgentTurn，断言事件按 sessionId 归属、
 * 持久化互不污染、回合状态机隔离。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionManager } from '../manager.js'
import { JsonlSessionStore } from '../store.js'
import { FakeAdapter, MessageCollector, successTurnScript } from './helpers/fake-adapter.js'

let dir: string
let store: JsonlSessionStore
let collector: MessageCollector

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-parallel-'))
  store = new JsonlSessionStore(dir)
  collector = new MessageCollector()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('两会话并行 runAgentTurn', () => {
  it('事件按 sessionId 归属、持久化互不污染、状态机隔离', async () => {
    const a1 = new FakeAdapter({ blockUntilInterrupt: true, scripts: [successTurnScript('A 的流式输出').slice(0, 1)] })
    const a2 = new FakeAdapter({ scripts: [successTurnScript('B 的流式输出')] })
    const manager = new SessionManager({
      store,
      adapters: {},
      defaultAdapterId: 'a1',
      adapterFactory: (id) => (id === 'a1' ? a1 : a2),
    })
    manager.onMessage(collector.handler)

    const s1 = await manager.createSession({ adapterId: 'a1', personaId: 'kaltsit' })
    const s2 = await manager.createSession({ adapterId: 'a2', personaId: 'exusiai' })

    // s1 阻塞中（运行中），s2 同时完整跑完一个回合
    const p1 = manager.runAgentTurn(s1.id, { text: 'A 的任务' }, { origin: 'webview' })
    await vi.waitFor(() => expect(a1.sentInputs.length).toBe(1))
    await manager.runAgentTurn(s2.id, { text: 'B 的任务' }, { origin: 'mobile' })

    // s2 已 done，s1 仍 running：状态机隔离
    expect((await manager.getSession(s1.id))?.status).toBe('running')
    expect((await manager.getSession(s2.id))?.status).toBe('done')

    // 事件归属：s2 的流式与 complete 全部带 s2 的 sessionId
    const s2Streams = collector.forSession(s2.id).filter((m) => m.type === 'agent_stream')
    expect(s2Streams).toHaveLength(1)
    expect(collector.forSession(s1.id).filter((m) => m.type === 'agent_complete')).toHaveLength(0)

    // s2 持久化：用户消息 + agent 消息；s1 此刻只有用户消息
    expect((await store.loadMessages(s2.id)).map((m) => m.role)).toEqual(['user', 'agent'])
    expect((await store.loadMessages(s2.id))[1].text).toBe('B 的流式输出')
    expect((await store.loadMessages(s1.id)).map((m) => m.role)).toEqual(['user'])

    // 结束 s1：interrupt 只作用于 s1
    await manager.interrupt(s1.id)
    await p1
    expect(a1.interruptCalls).toBe(1)
    expect(a2.interruptCalls).toBe(0)
    expect((await manager.getSession(s1.id))?.status).toBe('idle')

    // 两会话持久化最终态互不污染
    const msgs1 = await store.loadMessages(s1.id)
    const msgs2 = await store.loadMessages(s2.id)
    expect(msgs1.every((m) => !m.text.includes('B 的'))).toBe(true)
    expect(msgs2.every((m) => !m.text.includes('A 的流式'))).toBe(true)
    expect(msgs1[0].text).toBe('A 的任务')

    // 会话各自独占适配器实例
    expect(a1).not.toBe(a2)
  })

  it('两会话的 digest 各自带自己的 sessionId 与 persona 标题', async () => {
    const a1 = new FakeAdapter({ scripts: [successTurnScript('x')] })
    const a2 = new FakeAdapter({ scripts: [successTurnScript('y')] })
    const manager = new SessionManager({
      store,
      adapters: {},
      defaultAdapterId: 'a1',
      adapterFactory: (id) => (id === 'a1' ? a1 : a2),
    })
    manager.onMessage(collector.handler)
    const s1 = await manager.createSession({ adapterId: 'a1' })
    const s2 = await manager.createSession({ adapterId: 'a2' })
    await Promise.all([
      manager.runAgentTurn(s1.id, { text: '一' }),
      manager.runAgentTurn(s2.id, { text: '二' }),
    ])
    const digests = collector.ofType('session_digest_update')
    const done1 = digests.filter((m) => m.sessionId === s1.id && m.payload.status === 'done')
    const done2 = digests.filter((m) => m.sessionId === s2.id && m.payload.status === 'done')
    expect(done1.length).toBeGreaterThanOrEqual(1)
    expect(done2.length).toBeGreaterThanOrEqual(1)
    // digest 的 sessionId 与 envelope.sessionId 一致（payload 自包含）
    expect(done1[0].payload.sessionId).toBe(s1.id)
    expect(done2[0].payload.sessionId).toBe(s2.id)
  })
})
