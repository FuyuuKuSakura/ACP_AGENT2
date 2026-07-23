/**
 * core-host 装配单测（纯 node，无需 vscode）：
 * - adapters 配置合成与 defaultAdapterId 决策（§6.1.1）；
 * - 配置单引用热更新（ADR-6：identity 稳定、原地更新）；
 * - needCliGuide 标记；
 * - JsonlSessionStore 落点（<globalStorage>/sessions/）；
 * - manager.onMessage → BroadcastHub.broadcast（seq 赋值）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ServerMessage } from '@dionysus/protocol'

import {
  FakeWebview,
  installedCli,
  makeTestHost,
  missingCli,
  successTurnScript,
  until,
  type TestHostContext,
} from './test-utils.js'

describe('core-host 装配', () => {
  let ctx: TestHostContext | null = null
  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
  })

  it('adapter.default 为空时用首个可用 CLI；探测结果合成 adapters 缺省条目', async () => {
    ctx = await makeTestHost({
      detections: [missingCli('claude_cli', 'claude'), installedCli('kimi_cli', 'kimi')],
    })
    expect(ctx.host.resolveDefaultAdapterId()).toBe('kimi_cli')
    expect(ctx.host.adaptersConfig['kimi_cli']).toEqual({
      type: 'kimi_code_cli',
      command: 'kimi',
      model: null,
    })
    // 未安装的 CLI 不合成条目
    expect(ctx.host.adaptersConfig['claude_cli']).toBeUndefined()
    expect(ctx.host.needCliGuide).toBe(false)
  })

  it('settings 的 dionysus.adapters 条目优先于合成条目', async () => {
    ctx = await makeTestHost({
      settings: {
        adapters: { my_kimi: { type: 'kimi_code_cli', command: 'kimi-custom', model: 'k2' } },
      },
    })
    expect(ctx.host.adaptersConfig['my_kimi']).toEqual({
      type: 'kimi_code_cli',
      command: 'kimi-custom',
      model: 'k2',
    })
  })

  it('adapter.default 已设置时优先于探测结果', async () => {
    ctx = await makeTestHost({
      settings: { 'adapter.default': 'my_kimi' },
    })
    expect(ctx.host.resolveDefaultAdapterId()).toBe('my_kimi')
  })

  it('未找到任何 CLI 时 needCliGuide=true，defaultAdapterId 为空串', async () => {
    ctx = await makeTestHost({ detections: [missingCli('kimi_cli', 'kimi'), missingCli('claude_cli', 'claude')] })
    expect(ctx.host.needCliGuide).toBe(true)
    expect(ctx.host.resolveDefaultAdapterId()).toBe('')
  })

  it('配置热更新走同一引用：adapters record identity 稳定、内容原地更新', async () => {
    ctx = await makeTestHost()
    const refBefore = ctx.host.adaptersConfig
    expect(refBefore['my_kimi']).toBeUndefined()

    // 模拟 settings.json 变更：新增一个适配器条目
    ctx.reader.values['adapters'] = { my_kimi: { type: 'kimi_code_cli', command: 'kimi', model: null } }
    ctx.host.configService.refresh()

    expect(ctx.host.adaptersConfig).toBe(refBefore) // identity 稳定（单引用热更新）
    expect(ctx.host.adaptersConfig['my_kimi']).toBeDefined()
  })

  it('refreshDetections 更新 needCliGuide 并补合成条目（原地）', async () => {
    ctx = await makeTestHost({ detections: [missingCli('kimi_cli', 'kimi')] })
    expect(ctx.host.needCliGuide).toBe(true)

    const refBefore = ctx.host.adaptersConfig
    ctx.host.refreshDetections([installedCli('kimi_cli', 'kimi')])
    expect(ctx.host.needCliGuide).toBe(false)
    expect(ctx.host.resolveDefaultAdapterId()).toBe('kimi_cli')
    expect(ctx.host.adaptersConfig).toBe(refBefore)
    expect(ctx.host.adaptersConfig['kimi_cli']).toBeDefined()
  })

  it('会话文件落在 <storageDir>/sessions/ 下（JsonlSessionStore 落点）', async () => {
    ctx = await makeTestHost()
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    expect(existsSync(join(ctx.storageDir, 'sessions', `${meta.id}.jsonl`))).toBe(true)
  })

  it('manager.onMessage → BroadcastHub.broadcast：扇出前赋 per-session seq', async () => {
    ctx = await makeTestHost({ adapterScripts: [successTurnScript('你好')] })
    const received: ServerMessage[] = []
    ctx.host.hub.registerClient('test-client', (msg) => received.push(msg))

    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    await ctx.host.handleClientMessage('test-client', {
      v: 1,
      type: 'user_input',
      sessionId: meta.id,
      ts: Date.now(),
      payload: { text: 'hi', attachments: [], mode: 'normal' },
    })
    await until(() => received.some((m) => m.type === 'agent_complete'))

    const types = received.map((m) => m.type)
    expect(types).toContain('user_message_echo')
    expect(types).toContain('agent_stream')
    expect(types).toContain('agent_complete')
    // digest 的 payload.seq 与 envelope.seq 同值且 > 0（hub 扇出前赋值，§4.1）
    const digests = received.filter(
      (m): m is Extract<ServerMessage, { type: 'session_digest_update' }> => m.type === 'session_digest_update',
    )
    expect(digests.length).toBeGreaterThan(0)
    for (const d of digests) {
      expect(d.seq).toBeGreaterThan(0)
      expect(d.payload.seq).toBe(d.seq)
    }
    expect(ctx.host.hub.latestSeq(meta.id)).toBeGreaterThan(0)
  })
})

describe('归来摘要接线（BUG-P5-1）', () => {
  let ctx: TestHostContext | null = null
  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
  })

  it('断连 >60s 后重连：sync_request 先单播归来摘要，再回放补拉', async () => {
    let clock = 1_000_000
    ctx = await makeTestHost({
      // 关掉陪伴层改写挂钩，断言内置模板原文
      settings: { 'supervisor.mode': 'disabled' },
      adapterScripts: [successTurnScript('你好')],
      deps: { now: () => clock },
    })
    const clientId = 'webview:chat'
    const first = new FakeWebview()
    const att1 = ctx.host.attachWebview(clientId, first)
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    // 客户端断连前的游标（createSession 的 digest 已送达）
    const afterSeq = ctx.host.hub.latestSeq(meta.id)

    // 锁屏断连（记录断连时刻），离席期间跑完一个回合（事件入环形缓冲）
    att1.dispose()
    await ctx.host.handleClientMessage(clientId, {
      v: 1,
      type: 'user_input',
      sessionId: meta.id,
      ts: clock,
      payload: { text: 'hi', attachments: [], mode: 'normal' },
    })
    await until(() => ctx!.host.hub.latestSeq(meta.id) > afterSeq)

    // 61s 后重连：sync_request 触发归来摘要
    clock += 61_000
    const second = new FakeWebview()
    ctx.host.attachWebview(clientId, second)
    await ctx.host.handleClientMessage(clientId, {
      v: 1,
      type: 'sync_request',
      ts: clock,
      payload: { sessionId: meta.id, afterSeq },
    })

    const summaries = second.ofType('companion_message')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].payload.scope).toBe('global')
    expect(summaries[0].payload.text).toContain('你离开期间')
    expect(summaries[0].payload.text).toContain('完成 1 回合（成功）')
    expect(second.ofType('sync_response')).toHaveLength(1)
    // 摘要先于补拉到达
    const types = second.postedMessages().map((m) => m.type)
    expect(types.indexOf('companion_message')).toBeLessThan(types.indexOf('sync_response'))

    // 销账：同客户端再次 sync_request 不重复播报
    await ctx.host.handleClientMessage(clientId, {
      v: 1,
      type: 'sync_request',
      ts: clock,
      payload: { sessionId: meta.id, afterSeq },
    })
    expect(second.ofType('companion_message')).toHaveLength(1)
  })

  it('断连未超阈值且无落后：sync_request 只补拉，不播归来摘要', async () => {
    let clock = 1_000_000
    ctx = await makeTestHost({
      settings: { 'supervisor.mode': 'disabled' },
      deps: { now: () => clock },
    })
    const clientId = 'webview:chat'
    const first = new FakeWebview()
    const att1 = ctx.host.attachWebview(clientId, first)
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    const afterSeq = ctx.host.hub.latestSeq(meta.id)

    att1.dispose()
    clock += 5_000 // 断连仅 5s，且无任何落后
    const second = new FakeWebview()
    ctx.host.attachWebview(clientId, second)
    await ctx.host.handleClientMessage(clientId, {
      v: 1,
      type: 'sync_request',
      ts: clock,
      payload: { sessionId: meta.id, afterSeq },
    })

    expect(second.ofType('companion_message')).toHaveLength(0)
    expect(second.ofType('sync_response')).toHaveLength(1)
  })
})
