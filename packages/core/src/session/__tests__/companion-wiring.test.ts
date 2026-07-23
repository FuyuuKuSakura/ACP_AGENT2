/**
 * manager × 陪伴层接线端到端测试（roadmap Phase 4 门禁相关）：
 * FakeAdapter 回合 → engine 台词 + supervisor 即时播报 + rewriter 口吻 +
 * digest.todoProgress 接通 + todo_update 广播与终态落盘。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PersonaLoader } from '../../persona/loader.js'
import { createCompanion, type Companion } from '../../persona/companion.js'
import { SessionManager } from '../manager.js'
import { JsonlSessionStore } from '../store.js'
import { FakeAdapter, MessageCollector } from './helpers/fake-adapter.js'
import type { AgentEvent } from '../../adapters/types.js'

const FIXTURES = fileURLToPath(new URL('../../persona/__tests__/fixtures', import.meta.url))

let dir: string
let store: JsonlSessionStore
let collector: MessageCollector
let scheduled: Array<() => void>
let now: number

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-companion-'))
  store = new JsonlSessionStore(dir)
  collector = new MessageCollector()
  scheduled = []
  now = 0
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function drainCompanion(): void {
  for (let i = 0; i < 10 && scheduled.length > 0; i++) {
    const cbs = scheduled.splice(0)
    for (const cb of cbs) cb()
  }
}

function makeWired(adapters: Record<string, FakeAdapter>): {
  manager: SessionManager
  companion: Companion
} {
  const companion = createCompanion({
    loader: new PersonaLoader({ builtinDir: FIXTURES }),
    emit: collector.handler,
    persist: (sessionId, ev) => store.appendMessage(sessionId, ev),
    audienceCount: () => 1,
    listSessions: () => manager.listSessions(),
    now: () => now,
    random: () => 0,
    scheduleFlush: (cb) => scheduled.push(cb),
  })
  const manager = new SessionManager({
    store,
    adapters: {},
    defaultAdapterId: 'fake',
    adapterFactory: (id) => adapters[id] ?? new FakeAdapter(),
    companion: companion.hooks,
  })
  manager.onMessage(collector.handler)
  return { manager, companion }
}

const TURN_SCRIPT: AgentEvent[] = [
  { type: 'status', status: 'thinking', detail: '思考中' },
  { type: 'tool_call', toolCallId: 'c1', name: 'read_file', kind: 'read', args: {}, displayTarget: 'a.ts' },
  { type: 'tool_result', toolCallId: 'c1', ok: true, summary: 'ok' },
  { type: 'stream', chunk: '完成', isFinal: true, status: 'outputting', isThinking: false },
  { type: 'complete', status: 'success', artifacts: [] },
]

describe('manager 接线端到端（FakeAdapter 回合）', () => {
  it('digest.todoProgress 接通 TodoTracker，todo_update 随变化广播', async () => {
    const { manager } = makeWired({ fake: new FakeAdapter({ scripts: [TURN_SCRIPT] }) })
    const meta = await manager.createSession({ personaId: 'companion-test' })
    await manager.runAgentTurn(meta.id, { text: '读一下 a.ts' }, { origin: 'test' })

    const digests = collector.ofType('session_digest_update')
    // tool_call 之后的 digest：think 未完成 + 工具项 → {done:0,total:2}
    expect(digests.some((m) => m.payload.todoProgress?.total === 2 && m.payload.todoProgress?.done === 0)).toBe(true)
    // 回合末 digest：complete 全量收尾 → {done:2,total:2}
    const last = digests[digests.length - 1]
    expect(last.payload.todoProgress).toEqual({ done: 2, total: 2 })

    // todo_update 全量快照序列：thinking → +tool_call → tool_result 配对 → complete 全 done
    const todos = collector.ofType('todo_update')
    expect(todos.length).toBeGreaterThanOrEqual(4)
    expect(todos[0].payload.items).toEqual([{ id: 'status:think', text: '思考方案', done: false }])
    const finalTodo = todos[todos.length - 1]
    expect(finalTodo.payload.items.every((i) => i.done)).toBe(true)

    // 回合末终态快照落盘 event 行
    const entries = await store.loadEntries(meta.id)
    const todoEvents = entries.filter((e) => e.type === 'event' && e.eventType === 'todo_update')
    expect(todoEvents).toHaveLength(1)
    expect(todoEvents[0]).toMatchObject({ payload: { items: expect.arrayContaining([expect.objectContaining({ done: true })]) } })
  })

  it('回合产出 engine 台词与 supervisor 即时播报（同 tick 聚合为一句），经 rewriter 改写', async () => {
    const { manager } = makeWired({ fake: new FakeAdapter({ scripts: [TURN_SCRIPT] }) })
    const meta = await manager.createSession({ personaId: 'companion-test' })
    await manager.runAgentTurn(meta.id, { text: '读一下 a.ts' }, { origin: 'test' })
    drainCompanion()

    const cm = collector.ofType('companion_message')
    expect(cm).toHaveLength(1) // work_start + 成功台词 + 即时播报 同 tick 聚合为一句
    const payload = cm[0].payload
    expect(payload.scope).toBe('global')
    // 聚合句：scheduler_templates.all_success + rewriter（random=0 → 前缀+口癖）
    expect(payload.text).toBe('报告：聚合：全部 1 个完成。嗯，就这样。')
    expect(payload.sourceSessionId).toBe(meta.id)
    expect(payload.sourceTitle).toBe('新会话') // 聚合句取最高优先候选（engine 成功台词）的标题标注

    const eu = collector.ofType('emotion_update')
    expect(eu).toHaveLength(1)
    // 聚合桶 success → success → persona 映射 happy / 微笑
    expect(eu[0].payload).toMatchObject({ emotion: 'happy', expression: '微笑' })
  })

  it('打断回合：error/打断插播走 alert 优先级（打断不视为成功）', async () => {
    const adapter = new FakeAdapter({
      blockUntilInterrupt: true,
      scripts: [[{ type: 'status', status: 'executing', detail: '跑命令' }]],
    })
    const { manager } = makeWired({ fake: adapter })
    const meta = await manager.createSession({ personaId: 'companion-test' })
    const turn = manager.runAgentTurn(meta.id, { text: '长任务' }, { origin: 'test' })
    // 让 send 的异步迭代器消费到挂起点
    await new Promise((r) => setTimeout(r, 10))
    drainCompanion()

    // 回合中：engine work_start 单候选 → session scope 台词
    const mid = collector.ofType('companion_message')
    expect(mid).toHaveLength(1)
    expect(mid[0].payload.scope).toBe('session')
    expect(mid[0].sessionId).toBe(meta.id)
    expect(mid[0].payload.text).toBe('报告：开工。嗯，就这样。')
    // 会话级台词落盘 event 行
    await new Promise((r) => setTimeout(r, 0))
    const entriesMid = await store.loadEntries(meta.id)
    expect(entriesMid.some((e) => e.type === 'event' && e.eventType === 'companion_message')).toBe(true)

    await manager.interrupt(meta.id)
    await turn
    now += 3_000 // 越过 3s 最小间隔，放行打断插播
    drainCompanion()
    const all = collector.ofType('companion_message')
    expect(all.length).toBeGreaterThanOrEqual(2)
    // 打断后会话状态为 idle（非 error），回合正常收尾不卡死
    expect((await manager.getSession(meta.id))?.status).toBe('idle')
  })
})
