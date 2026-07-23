/**
 * WebviewTransport 消息分发单测（假 webview + 纯 node core-host）：
 * - parseClientMessage 校验失败 → 只给来源端回 system_notice(warning)；
 * - hello/ping/session_list_request/sync_request 的请求-响应（单播 + traceId 透传）；
 * - user_input → runAgentTurn 全链路（广播到全部已接入 webview）；
 * - interrupt → 只作用于指定会话的适配器；
 * - client_command → 斜杠命令结果广播；
 * - postMessage 返回 false → 断连注销（transport 与 hub 双向）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { ClientMessage } from '@dionysus/protocol'

import { FakeWebview, makeTestHost, successTurnScript, until, type TestHostContext } from './test-utils.js'

function userInput(sessionId: string, text: string): ClientMessage {
  return {
    v: 1,
    type: 'user_input',
    sessionId,
    ts: Date.now(),
    payload: { text, attachments: [], mode: 'normal' },
  }
}

describe('WebviewTransport 消息分发', () => {
  let ctx: TestHostContext | null = null
  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
  })

  it('非法消息：parseClientMessage 拒绝后只给来源端回 warning，不影响其他端', async () => {
    ctx = await makeTestHost()
    const a = new FakeWebview()
    const b = new FakeWebview()
    ctx.host.attachWebview('webview:chat', a)
    ctx.host.attachWebview('webview:sidebar', b)

    a.emit({ v: 1, type: 'no_such_type', ts: Date.now(), payload: {} })
    await until(() => a.ofType('system_notice').length === 1)

    const notice = a.ofType('system_notice')[0]
    expect(notice.payload.level).toBe('warning')
    expect(notice.payload.text).toContain('无法识别的消息')
    expect(b.posted).toHaveLength(0)
  })

  it('hello → handshake 单播（含会话快照与 latestSeq）；ping → pong', async () => {
    ctx = await makeTestHost()
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    const a = new FakeWebview()
    const b = new FakeWebview()
    ctx.host.attachWebview('webview:chat', a)
    ctx.host.attachWebview('webview:sidebar', b)
    a.posted.length = 0 // 丢掉 createSession 的 digest 广播，只看响应

    a.emit({ v: 1, type: 'hello', ts: Date.now(), payload: { minVersion: 1, maxVersion: 1 } })
    await until(() => a.ofType('handshake').length === 1)

    const handshake = a.ofType('handshake')[0]
    expect(handshake.payload.v).toBe(1)
    expect(handshake.payload.clientId).toBe('webview:chat')
    expect(handshake.payload.sessions).toEqual([
      { sessionId: meta.id, title: meta.title, status: 'idle', latestSeq: ctx.host.hub.latestSeq(meta.id) },
    ])
    expect(b.ofType('handshake')).toHaveLength(0) // 单播，不扇出

    a.emit({ v: 1, type: 'ping', ts: Date.now(), payload: {} })
    await until(() => a.ofType('pong').length === 1)
    expect(b.ofType('pong')).toHaveLength(0)
  })

  it('user_input → runAgentTurn：回合事件广播到全部已接入 webview', async () => {
    ctx = await makeTestHost({ adapterScripts: [successTurnScript('收到')] })
    const a = new FakeWebview()
    const b = new FakeWebview()
    ctx.host.attachWebview('webview:chat', a)
    ctx.host.attachWebview('webview:sidebar', b)
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })

    a.emit(userInput(meta.id, 'hi'))
    await until(() => a.ofType('agent_complete').length === 1)

    for (const wv of [a, b]) {
      const types = wv.postedMessages().map((m) => m.type)
      expect(types).toContain('user_message_echo')
      expect(types).toContain('agent_stream')
      expect(types).toContain('agent_complete')
      expect(types).toContain('session_digest_update')
    }
    // adapter 真的收到了输入
    expect(ctx.adapters.get('kimi_cli')?.sentInputs[0]?.text).toBe('hi')
  })

  it('interrupt → 指定会话的适配器被打断，回合以 interrupted 收尾', async () => {
    ctx = await makeTestHost({ blockUntilInterrupt: true })
    const host = ctx.host
    const adapters = ctx.adapters
    const a = new FakeWebview()
    host.attachWebview('webview:chat', a)
    const meta = await host.manager.createSession({ adapterId: 'kimi_cli' })

    a.emit(userInput(meta.id, '长任务'))
    await until(() => adapters.get('kimi_cli')?.sentInputs.length === 1)

    a.emit({
      v: 1,
      type: 'interrupt',
      sessionId: meta.id,
      ts: Date.now(),
      payload: { reason: 'user_request' },
    })
    await until(() => a.ofType('agent_complete').length === 1)

    expect(ctx.adapters.get('kimi_cli')?.interruptCalls).toBe(1)
    expect(a.ofType('agent_complete')[0].payload.status).toBe('interrupted')
  })

  it('session_list_request → session_list_response 单播且 traceId 透传', async () => {
    ctx = await makeTestHost()
    await ctx.host.manager.createSession({ adapterId: 'kimi_cli', title: '会话甲' })
    const a = new FakeWebview()
    const b = new FakeWebview()
    ctx.host.attachWebview('webview:chat', a)
    ctx.host.attachWebview('webview:sidebar', b)

    a.emit({ v: 1, type: 'session_list_request', traceId: 'trace-1', ts: Date.now(), payload: {} })
    await until(() => a.ofType('session_list_response').length === 1)

    const resp = a.ofType('session_list_response')[0]
    expect(resp.traceId).toBe('trace-1')
    expect(resp.payload.sessions).toHaveLength(1)
    expect(resp.payload.sessions[0].title).toBe('会话甲')
    expect(b.ofType('session_list_response')).toHaveLength(0)
  })

  it('sync_request → hub 回放（sync_response 单播，按 afterSeq 过滤）', async () => {
    ctx = await makeTestHost({ adapterScripts: [successTurnScript('chunk')] })
    const a = new FakeWebview()
    ctx.host.attachWebview('webview:chat', a)
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })

    a.emit(userInput(meta.id, 'hi'))
    await until(() => a.ofType('agent_complete').length === 1)
    const latestSeq = ctx.host.hub.latestSeq(meta.id)
    expect(latestSeq).toBeGreaterThan(2)

    a.posted.length = 0
    a.emit({
      v: 1,
      type: 'sync_request',
      ts: Date.now(),
      payload: { sessionId: meta.id, afterSeq: 1 },
    })
    await until(() => a.ofType('sync_response').length === 1)

    const resp = a.ofType('sync_response')[0]
    expect(resp.payload.sessionId).toBe(meta.id)
    expect(resp.payload.truncated).toBe(false)
    expect(resp.payload.latestSeq).toBe(latestSeq)
    expect(resp.payload.events.length).toBeGreaterThan(0)
    for (const ev of resp.payload.events) expect(ev.seq ?? 0).toBeGreaterThan(1)
  })

  it('client_command → 斜杠命令结果经 system_notice 广播', async () => {
    ctx = await makeTestHost()
    const a = new FakeWebview()
    ctx.host.attachWebview('webview:chat', a)

    a.emit({
      v: 1,
      type: 'client_command',
      ts: Date.now(),
      payload: { command: '/new' },
    })
    await until(() => a.ofType('system_notice').length >= 1)

    expect(a.ofType('system_notice')[0].payload.text).toContain('已创建新会话')
    expect(await ctx.host.manager.listSessions()).toHaveLength(1)
  })

  it('postMessage 返回 false → 判定断连并从 BroadcastHub 注销', async () => {
    ctx = await makeTestHost()
    const host = ctx.host
    const a = new FakeWebview()
    host.attachWebview('webview:chat', a)
    expect(host.hub.hasClient('webview:chat')).toBe(true)

    a.postMessageResult = false
    await host.manager.createSession({ adapterId: 'kimi_cli' }) // 触发一次 digest 广播
    await until(() => !host.hub.hasClient('webview:chat'))
    expect(host.transport.hasClient('webview:chat')).toBe(false)
  })
})
