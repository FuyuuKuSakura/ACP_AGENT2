/**
 * SessionManager 回合管线测试（roadmap Phase 2：FakeAdapter 全管线
 * persist→stream→finalize、turnId 幂等、waiting_option 状态机、
 * 注入增强开/关两条路径、排队语义、并发上限、自动标题）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IAgentAdapter } from '../../adapters/types.js'
import { SessionManager, type SessionManagerDeps } from '../manager.js'
import { JsonlSessionStore } from '../store.js'
import { FakeAdapter, MessageCollector, successTurnScript } from './helpers/fake-adapter.js'

let dir: string
let store: JsonlSessionStore
let collector: MessageCollector

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-manager-'))
  store = new JsonlSessionStore(dir)
  collector = new MessageCollector()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeManager(
  adapters: Record<string, IAgentAdapter>,
  overrides: Partial<SessionManagerDeps> = {},
): SessionManager {
  const manager = new SessionManager({
    store,
    adapters: {},
    defaultAdapterId: 'fake',
    adapterFactory: (adapterId) => adapters[adapterId] ?? new FakeAdapter(),
    ...overrides,
  })
  manager.onMessage(collector.handler)
  return manager
}

const digests = () => collector.ofType('session_digest_update')
const notices = () => collector.ofType('system_notice')

describe('runAgentTurn 全管线（persist → stream → finalize）', () => {
  it('用户消息落盘 → 流式事件携带 turnId 外发 → 完成后 agent 消息落盘 + digest 跃迁 done', async () => {
    const adapter = new FakeAdapter({ scripts: [successTurnScript('你好', '世界')] })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    await manager.runAgentTurn(meta.id, { text: '打个招呼' }, { origin: 'webview' })

    // persist：用户消息 + agent 汇总消息
    const msgs = await store.loadMessages(meta.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'agent'])
    expect(msgs[0].text).toBe('打个招呼')
    expect(msgs[1].text).toBe('你好世界')

    // stream：全部下游消息共享同一 turnId
    const streams = collector.ofType('agent_stream')
    expect(streams).toHaveLength(2)
    const turnIds = new Set(streams.map((m) => m.turnId))
    expect(turnIds.size).toBe(1)
    const completes = collector.ofType('agent_complete')
    expect(completes).toHaveLength(1)
    expect(completes[0].turnId).toBe(streams[0].turnId)
    expect(completes[0].payload.status).toBe('success')

    // echo + digest 跃迁：idle → running → done（自动标题会再补一条 done digest）
    expect(collector.ofType('user_message_echo')).toHaveLength(1)
    const statuses = digests().map((m) => m.payload.status)
    expect(statuses[0]).toBe('idle')
    expect(statuses.indexOf('running')).toBeLessThan(statuses.indexOf('done'))
    expect(statuses[statuses.length - 1]).toBe('done')
    expect(digests().every((m) => m.payload.todoProgress?.total === 0)).toBe(true)
    // digest 携带会话绑定的 adapterId（列表项 adapter 徽标数据源，§2.2）
    expect(digests().every((m) => m.payload.adapterId === 'fake')).toBe(true)
    // digest 携带会话绑定的 personaId（列表项头像数据源，additive）
    expect(digests().every((m) => m.payload.personaId === 'default')).toBe(true)

    // adapter 收到的输入原样（未开注入）
    expect(adapter.sentInputs).toHaveLength(1)
    expect(adapter.sentInputs[0].text).toBe('打个招呼')
  })

  it('会话不存在时回 system_notice(error)，不启动回合', async () => {
    const manager = makeManager({})
    await manager.runAgentTurn('ghost', { text: 'x' })
    expect(notices()).toHaveLength(1)
    expect(notices()[0].payload.level).toBe('error')
  })
})

describe('turnId 幂等', () => {
  it('同回合迟到的第二条 complete 被忽略：恰好一条 agent_complete、一条 agent 消息', async () => {
    const adapter = new FakeAdapter({
      scripts: [
        [
          { type: 'stream', chunk: 'A', isFinal: false, status: 'outputting', isThinking: false },
          { type: 'complete', status: 'success', artifacts: [] },
          // v2「打断后双 agent_complete」的迟到 complete
          { type: 'complete', status: 'success', artifacts: [] },
        ],
      ],
    })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    await manager.runAgentTurn(meta.id, { text: 'q' })
    expect(collector.ofType('agent_complete')).toHaveLength(1)
    const msgs = await store.loadMessages(meta.id)
    expect(msgs.filter((m) => m.role === 'agent')).toHaveLength(1)
  })
})

describe('waiting_option 状态机', () => {
  const optionRequestEvent = {
    type: 'option_request' as const,
    question: '允许执行吗？',
    options: [
      { id: 'yes', label: '允许' },
      { id: 'no', label: '拒绝' },
    ],
    uiType: 'button_group' as const,
    timeoutSeconds: 60,
  }

  it('option_request → waiting_option（digest pendingOptionRequest=true）；option_selected 解决并转为下一轮输入', async () => {
    const adapter = new FakeAdapter({
      scripts: [
        [optionRequestEvent, { type: 'complete', status: 'success', artifacts: [] }],
        successTurnScript('已按你的选择继续'),
      ],
    })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    const turnPromise = manager.runAgentTurn(meta.id, { text: '开始' })
    await turnPromise

    // option_request 到达时置 waiting_option；回合结束清除
    const digestStates = digests().map((m) => [m.payload.status, m.payload.pendingOptionRequest])
    expect(digestStates).toContainEqual(['waiting_option', true])

    // 但回合结束已清除待决项 → 迟到的 option_selected 幂等忽略 + info notice
    await manager.handleOptionSelected(meta.id, { selectedId: 'yes', selectedLabel: '允许' }, 'mobile')
    expect(notices().some((m) => m.payload.level === 'info' && m.payload.text.includes('已忽略'))).toBe(true)
    expect(collector.ofType('option_resolved')).toHaveLength(0)
  })

  it('回合进行中 option_selected：发 option_resolved 并把选项转为下一轮输入', async () => {
    const adapter = new FakeAdapter({
      blockUntilInterrupt: true,
      scripts: [[optionRequestEvent]],
    })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    const turnPromise = manager.runAgentTurn(meta.id, { text: '需要确认' })
    // 等 option_request 出现
    await vi.waitFor(() => {
      expect(collector.ofType('option_request')).toHaveLength(1)
    })
    expect((await manager.getSession(meta.id))?.status).toBe('waiting_option')

    await manager.handleOptionSelected(meta.id, { selectedId: 'yes', selectedLabel: '允许' }, 'mobile')
    const resolved = collector.ofType('option_resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0].payload).toMatchObject({ selectedId: 'yes', origin: 'mobile' })

    // 选项转 input：当前回合仍占用适配器 → 排队；打断后排队回合自动执行
    await manager.interrupt(meta.id)
    await turnPromise
    await vi.waitFor(() => {
      expect(adapter.sentInputs.length).toBe(2)
    })
    expect(adapter.sentInputs[1].text).toBe('允许')
  })

  it('option 超时 keep（默认）：维持等待并广播 system_notice', async () => {
    const adapter = new FakeAdapter({
      scripts: [[{ ...optionRequestEvent, timeoutSeconds: 1 }]],
      blockUntilInterrupt: true,
    })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    const turnPromise = manager.runAgentTurn(meta.id, { text: 'x' })
    await vi.waitFor(() => expect(collector.ofType('option_request')).toHaveLength(1))
    await vi.waitFor(
      () => expect(notices().some((m) => m.payload.text.includes('保持等待'))).toBe(true),
      { timeout: 3000 },
    )
    expect((await manager.getSession(meta.id))?.status).toBe('waiting_option')
    await manager.interrupt(meta.id)
    await turnPromise
  })
})

describe('可选注入增强（injectIntoAgent）', () => {
  it('开启且 prompt-prefix：首轮输入被包装，首个事件后 systemPromptInjected 持久化；第二轮不再注入', async () => {
    const adapter = new FakeAdapter({ scripts: [successTurnScript('r1'), successTurnScript('r2')] })
    const manager = makeManager(
      { fake: adapter },
      {
        inject: {
          enabled: true,
          getSystemPrompt: () => '你是凯尔希。',
          supportsSystemPrompt: 'prompt-prefix',
        },
      },
    )
    const meta = await manager.createSession()
    await manager.runAgentTurn(meta.id, { text: '第一问' })
    expect(adapter.sentInputs[0].text).toBe('你是凯尔希。\n\n第一问')
    expect((await store.get(meta.id))?.meta.systemPromptInjected).toBe(true)

    await manager.runAgentTurn(meta.id, { text: '第二问' })
    expect(adapter.sentInputs[1].text).toBe('第二问')
  })

  it('关闭（默认）：输入原样发送，无注入', async () => {
    const adapter = new FakeAdapter({ scripts: [successTurnScript('r')] })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    await manager.runAgentTurn(meta.id, { text: '原文' })
    expect(adapter.sentInputs[0].text).toBe('原文')
    expect((await store.get(meta.id))?.meta.systemPromptInjected).toBeUndefined()
  })

  it('包装抛错：按原始输入发送 + system_notice(warning)，回合不阻断', async () => {
    const adapter = new FakeAdapter({ scripts: [successTurnScript('ok')] })
    const manager = makeManager(
      { fake: adapter },
      {
        inject: {
          enabled: true,
          getSystemPrompt: () => 'PROMPT',
          supportsSystemPrompt: 'prompt-prefix',
          wrapFirstTurnInput: () => {
            throw new Error('wrap boom')
          },
        },
      },
    )
    const meta = await manager.createSession()
    await manager.runAgentTurn(meta.id, { text: '原文' })
    expect(adapter.sentInputs[0].text).toBe('原文')
    expect(notices().some((m) => m.payload.level === 'warning')).toBe(true)
    expect(collector.ofType('agent_complete')[0].payload.status).toBe('success')
  })

  it('注入后发送立即失败：按原始输入重发 + warning', async () => {
    const adapter = new FakeAdapter({ failFirstSend: true, scripts: [successTurnScript('ok')] })
    const manager = makeManager(
      { fake: adapter },
      {
        inject: {
          enabled: true,
          getSystemPrompt: () => 'PROMPT',
          supportsSystemPrompt: 'prompt-prefix',
        },
      },
    )
    const meta = await manager.createSession()
    await manager.runAgentTurn(meta.id, { text: '原文' })
    expect(adapter.sentInputs).toHaveLength(2)
    expect(adapter.sentInputs[0].text).toBe('PROMPT\n\n原文')
    expect(adapter.sentInputs[1].text).toBe('原文')
    expect(notices().some((m) => m.payload.level === 'warning' && m.payload.text.includes('重发'))).toBe(true)
    expect(collector.ofType('agent_complete')[0].payload.status).toBe('success')
  })
})

describe('排队语义与并发上限', () => {
  it('回合进行中新 user_input 排队：notice 提示 + 当前回合结束后自动发送', async () => {
    const adapter = new FakeAdapter({ blockUntilInterrupt: true })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    const p1 = manager.runAgentTurn(meta.id, { text: '第一条' })
    await vi.waitFor(() => expect(adapter.sentInputs.length).toBe(1))

    const p2 = manager.runAgentTurn(meta.id, { text: '第二条' })
    await vi.waitFor(() =>
      expect(notices().some((m) => m.payload.text.includes('已排队'))).toBe(true),
    )
    expect(adapter.sentInputs.length).toBe(1) // 串行：第二条尚未发送

    await manager.interrupt(meta.id)
    await p1
    await p2
    await vi.waitFor(() => expect(adapter.sentInputs.length).toBe(2))
    expect(adapter.sentInputs[1].text).toBe('第二条')
  })

  it('maxConcurrentAgents 上限：超限发起回合回 system_notice(error)', async () => {
    const a1 = new FakeAdapter({ blockUntilInterrupt: true })
    const a2 = new FakeAdapter({ scripts: [successTurnScript('x')] })
    const adapters: Record<string, IAgentAdapter> = { fake1: a1, fake2: a2 }
    const manager = makeManager(adapters, { maxConcurrentAgents: 1 })
    const s1 = await manager.createSession({ adapterId: 'fake1' })
    const s2 = await manager.createSession({ adapterId: 'fake2' })
    const p1 = manager.runAgentTurn(s1.id, { text: '占用中' })
    await vi.waitFor(() => expect(a1.sentInputs.length).toBe(1))

    await manager.runAgentTurn(s2.id, { text: '超限' })
    expect(
      notices().some((m) => m.sessionId === s2.id && m.payload.level === 'error' && m.payload.text.includes('上限')),
    ).toBe(true)
    expect(a2.sentInputs.length).toBe(0)

    await manager.interrupt(s1.id)
    await p1
  })
})

describe('会话标题', () => {
  it('首回合成功后以首条用户消息截断 20 字符自动更新标题；手动重命名后不覆盖', async () => {
    const adapter = new FakeAdapter({ scripts: [successTurnScript('r1'), successTurnScript('r2')] })
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    const longText = '这是一条非常长的用户消息，超过二十个字符会被截断处理'
    await manager.runAgentTurn(meta.id, { text: longText })
    const titled = await manager.getSession(meta.id)
    expect(titled?.title).toBe(longText.slice(0, 20))
    expect((await store.get(meta.id))?.meta.title).toBe(longText.slice(0, 20))

    await manager.renameSession(meta.id, '我的会话')
    await manager.runAgentTurn(meta.id, { text: '另一条完全不同的消息内容' })
    expect((await manager.getSession(meta.id))?.title).toBe('我的会话')
    expect((await store.get(meta.id))?.meta.titleLocked).toBe(true)
  })
})

describe('interrupt 与 deleteSession', () => {
  it('interrupt 只作用于指定会话的适配器', async () => {
    const a1 = new FakeAdapter({ blockUntilInterrupt: true })
    const a2 = new FakeAdapter({ blockUntilInterrupt: true })
    const manager = makeManager({ fake1: a1, fake2: a2 })
    const s1 = await manager.createSession({ adapterId: 'fake1' })
    const s2 = await manager.createSession({ adapterId: 'fake2' })
    const p1 = manager.runAgentTurn(s1.id, { text: 't1' })
    const p2 = manager.runAgentTurn(s2.id, { text: 't2' })
    await vi.waitFor(() => expect(a1.sentInputs.length + a2.sentInputs.length).toBe(2))

    await manager.interrupt(s1.id)
    expect(a1.interruptCalls).toBe(1)
    expect(a2.interruptCalls).toBe(0)
    await manager.interrupt(s2.id)
    await Promise.all([p1, p2])
  })

  it('deleteSession 关闭适配器并删除持久化文件', async () => {
    const adapter = new FakeAdapter()
    const manager = makeManager({ fake: adapter })
    const meta = await manager.createSession()
    // 跑一个回合让适配器懒创建出来
    await manager.runAgentTurn(meta.id, { text: 'x' })
    await manager.deleteSession(meta.id)
    expect(adapter.shutdownCalls).toBe(1)
    expect(await store.get(meta.id)).toBeNull()
  })
})
