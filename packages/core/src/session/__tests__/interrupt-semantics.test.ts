/**
 * interrupt-semantics 测试（roadmap 具名用例，v2「打断后双 agent_complete +
 * 伪错误」回归）：interrupt 后客户端恰好收到一条
 * agent_complete(status='interrupted')，无 error 级 complete。
 *
 * 说明：roadmap 原命名为 adapters/interrupt-semantics.test.ts；本波次文件
 * 所有权限定在 session/ 与 src 根，且该语义需经 SessionManager 回合管线
 * 验证（客户端视角），故落于 session/__tests__/。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SessionManager } from '../manager.js'
import { JsonlSessionStore } from '../store.js'
import { FakeAdapter, MessageCollector } from './helpers/fake-adapter.js'

let dir: string
let store: JsonlSessionStore
let collector: MessageCollector

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-interrupt-'))
  store = new JsonlSessionStore(dir)
  collector = new MessageCollector()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('interrupt 语义', () => {
  it('打断运行中回合：恰好一条 interrupted complete，无 error 级 complete', async () => {
    const adapter = new FakeAdapter({
      blockUntilInterrupt: true,
      scripts: [
        [{ type: 'stream', chunk: '半截输出', isFinal: false, status: 'outputting', isThinking: false }],
      ],
    })
    const manager = new SessionManager({
      store,
      adapters: {},
      defaultAdapterId: 'fake',
      adapterFactory: () => adapter,
    })
    manager.onMessage(collector.handler)
    const meta = await manager.createSession()
    const turn = manager.runAgentTurn(meta.id, { text: '长任务' })
    await vi.waitFor(() => expect(adapter.sentInputs.length).toBe(1))

    await manager.interrupt(meta.id, { reason: 'user_request' })
    await turn

    const completes = collector.ofType('agent_complete')
    expect(completes).toHaveLength(1)
    expect(completes[0].payload.status).toBe('interrupted')
    expect(completes[0].payload.errorMessage).toBeUndefined()
    // 无 error 级 system_notice（v2 的 "exited with code -9" 伪错误不重现）
    const errorNotices = collector
      .ofType('system_notice')
      .filter((m) => m.payload.level === 'error')
    expect(errorNotices).toHaveLength(0)
    // 打断后会话回到 idle（digest 可见）
    expect((await manager.getSession(meta.id))?.status).toBe('idle')
  })

  it('无运行中回合时 interrupt 是安全的空操作（info 提示）', async () => {
    const adapter = new FakeAdapter()
    const manager = new SessionManager({
      store,
      adapters: {},
      defaultAdapterId: 'fake',
      adapterFactory: () => adapter,
    })
    manager.onMessage(collector.handler)
    const meta = await manager.createSession()
    await manager.interrupt(meta.id)
    expect(adapter.interruptCalls).toBe(0)
    const notices = collector.ofType('system_notice')
    expect(notices).toHaveLength(1)
    expect(notices[0].payload.level).toBe('info')
  })

  it('interrupt 携带 insertMessage 时落盘为 user 消息', async () => {
    const adapter = new FakeAdapter({ blockUntilInterrupt: true })
    const manager = new SessionManager({
      store,
      adapters: {},
      defaultAdapterId: 'fake',
      adapterFactory: () => adapter,
    })
    manager.onMessage(collector.handler)
    const meta = await manager.createSession()
    const turn = manager.runAgentTurn(meta.id, { text: '任务' })
    await vi.waitFor(() => expect(adapter.sentInputs.length).toBe(1))
    await manager.interrupt(meta.id, { reason: 'user_request', insertMessage: '先停一下' })
    await turn
    const msgs = await store.loadMessages(meta.id)
    expect(msgs.map((m) => m.text)).toEqual(['任务', '先停一下'])
  })
})
