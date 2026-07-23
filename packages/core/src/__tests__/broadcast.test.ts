/**
 * BroadcastHub 测试（roadmap 附录 A test_broadcast_callbacks 翻译 +
 * 环形缓冲/sync 回放/溢出快照/归来摘要，architecture.md §5.3 / ADR-11）。
 */
import { describe, expect, it } from 'vitest'

import type { ServerMessage, SessionStatus } from '@dionysus/protocol'

import { BroadcastHub } from '../broadcast.js'

/** 收集客户端收到消息的假发送函数。 */
function fakeClient(fail = false) {
  const received: ServerMessage[] = []
  const send = (msg: ServerMessage): void => {
    if (fail) throw new Error('socket closed')
    received.push(structuredClone(msg))
  }
  return { received, send }
}

function streamMsg(sessionId: string, chunk: string): ServerMessage {
  return {
    v: 1,
    type: 'agent_stream',
    sessionId,
    ts: Date.now(),
    payload: { chunk, isFinal: false, status: 'outputting', isThinking: false },
  }
}

function digestMsg(
  sessionId: string,
  title: string,
  status: SessionStatus = 'running',
  pendingOptionRequest = false,
): ServerMessage {
  return {
    v: 1,
    type: 'session_digest_update',
    sessionId,
    ts: Date.now(),
    payload: {
      sessionId,
      title,
      status,
      todoProgress: { done: 0, total: 0 },
      pendingOptionRequest,
      lastActivityAt: Date.now(),
      seq: 0,
    },
  }
}

function completeMsg(sessionId: string, status: 'success' | 'error' | 'interrupted'): ServerMessage {
  return { v: 1, type: 'agent_complete', sessionId, ts: Date.now(), payload: { status, artifacts: [] } }
}

function toolCallMsg(sessionId: string, toolCallId: string): ServerMessage {
  return {
    v: 1,
    type: 'tool_call',
    sessionId,
    ts: Date.now(),
    payload: { toolCallId, name: 'read_file', kind: 'read', args: {}, displayTarget: 'a.ts' },
  }
}

describe('多客户端扇出与 seq', () => {
  it('全局扇出：全部客户端收到同一消息；per-session seq 单调递增、跨会话各自独立', () => {
    const hub = new BroadcastHub()
    const c1 = fakeClient()
    const c2 = fakeClient()
    hub.registerClient('c1', c1.send)
    hub.registerClient('c2', c2.send)

    hub.broadcast(streamMsg('s1', 'a'))
    hub.broadcast(streamMsg('s1', 'b'))
    hub.broadcast(streamMsg('s2', 'x'))

    expect(c1.received).toHaveLength(3)
    expect(c2.received).toHaveLength(3)
    expect(c1.received[0].seq).toBe(1)
    expect(c1.received[1].seq).toBe(2)
    // s2 独立计数
    expect(c1.received[2].seq).toBe(1)
    expect(hub.latestSeq('s1')).toBe(2)
    expect(hub.latestSeq('s2')).toBe(1)
  })

  it('session_digest_update 的 payload.seq 与 envelope.seq 同值', () => {
    const hub = new BroadcastHub()
    const c = fakeClient()
    hub.registerClient('c', c.send)
    hub.broadcast(streamMsg('s1', 'a'))
    hub.broadcast(digestMsg('s1', '标题'))
    const digest = c.received[1]
    expect(digest.type).toBe('session_digest_update')
    expect(digest.seq).toBe(2)
    expect((digest.payload as { seq: number }).seq).toBe(2)
  })

  it('全局消息（无 sessionId）不赋 seq、不入缓冲', () => {
    const hub = new BroadcastHub()
    const c = fakeClient()
    hub.registerClient('c', c.send)
    hub.broadcast({
      v: 1,
      type: 'companion_message',
      ts: Date.now(),
      payload: { text: 'fleet 播报', scope: 'global' },
    })
    expect(c.received[0].seq).toBeUndefined()
    expect(hub.latestSeq('s1')).toBe(0)
  })
})

describe('客户端断开与失败隔离', () => {
  it('客户端断开只注销自己：其余客户端照常接收', () => {
    const hub = new BroadcastHub()
    const c1 = fakeClient()
    const c2 = fakeClient()
    hub.registerClient('c1', c1.send)
    hub.registerClient('c2', c2.send)
    hub.unregisterClient('c1')
    hub.broadcast(streamMsg('s1', 'a'))
    expect(c1.received).toHaveLength(0)
    expect(c2.received).toHaveLength(1)
    expect(hub.clientCount).toBe(1)
  })

  it('send 失败立即注销该 clientId，不影响其他连接（单点失败隔离）', () => {
    const hub = new BroadcastHub()
    const bad = fakeClient(true)
    const good = fakeClient()
    hub.registerClient('bad', bad.send)
    hub.registerClient('good', good.send)
    hub.broadcast(streamMsg('s1', 'a'))
    expect(hub.hasClient('bad')).toBe(false)
    expect(good.received).toHaveLength(1)
    // 后续广播不再触碰已注销客户端
    hub.broadcast(streamMsg('s1', 'b'))
    expect(good.received).toHaveLength(2)
  })
})

describe('sync 回放', () => {
  it('按 afterSeq 回放缺失事件：truncated=false，单播给请求客户端', () => {
    const hub = new BroadcastHub()
    const c1 = fakeClient()
    const c2 = fakeClient()
    hub.registerClient('c1', c1.send)
    hub.registerClient('c2', c2.send)
    for (let i = 1; i <= 5; i++) hub.broadcast(streamMsg('s1', `chunk${i}`))
    c1.received.length = 0
    c2.received.length = 0

    hub.handleSyncRequest('c1', { sessionId: 's1', afterSeq: 2 })
    expect(c1.received).toHaveLength(1)
    const resp = c1.received[0]
    expect(resp.type).toBe('sync_response')
    const payload = resp.payload as {
      events: ServerMessage[]
      latestSeq: number
      truncated: boolean
    }
    expect(payload.truncated).toBe(false)
    expect(payload.latestSeq).toBe(5)
    expect(payload.events.map((m) => m.seq)).toEqual([3, 4, 5])
    // 单播：c2 收不到
    expect(c2.received).toHaveLength(0)
  })

  it('缓冲溢出：truncated=true，events 以会话快照（digest + latestSeq）开头再续播', () => {
    const hub = new BroadcastHub({ bufferCapacity: 5 })
    const c = fakeClient()
    hub.registerClient('c', c.send)
    hub.broadcast(digestMsg('s1', '重构 auth', 'running')) // seq 1
    for (let i = 0; i < 10; i++) hub.broadcast(streamMsg('s1', `c${i}`)) // seq 2..11
    c.received.length = 0

    hub.handleSyncRequest('c', { sessionId: 's1', afterSeq: 2 })
    const resp = c.received[0]
    const payload = resp.payload as { events: ServerMessage[]; latestSeq: number; truncated: boolean }
    expect(payload.truncated).toBe(true)
    expect(payload.latestSeq).toBe(11)
    // 快照 = digest，seq 取当前 latestSeq
    expect(payload.events[0].type).toBe('session_digest_update')
    expect(payload.events[0].seq).toBe(11)
    expect((payload.events[0].payload as { title: string }).title).toBe('重构 auth')
    // 其后从缓冲头部（seq 7）续播
    expect(payload.events.slice(1).map((m) => m.seq)).toEqual([7, 8, 9, 10, 11])
  })

  it('afterSeq 已最新：events 为空、truncated=false', () => {
    const hub = new BroadcastHub()
    const c = fakeClient()
    hub.registerClient('c', c.send)
    hub.broadcast(streamMsg('s1', 'a'))
    c.received.length = 0
    hub.handleSyncRequest('c', { sessionId: 's1', afterSeq: 1 })
    const payload = c.received[0].payload as { events: ServerMessage[]; truncated: boolean }
    expect(payload.events).toHaveLength(0)
    expect(payload.truncated).toBe(false)
  })
})

describe('归来摘要（单播，内置模板零 LLM）', () => {
  it('落后超阈值：向该客户端单播模板摘要，其他客户端收不到', () => {
    const hub = new BroadcastHub({ returnSummaryLagThreshold: 3 })
    const c1 = fakeClient()
    const c2 = fakeClient()
    hub.registerClient('c1', c1.send)
    hub.registerClient('c2', c2.send)
    hub.broadcast(digestMsg('s1', '重构 auth', 'waiting_option', true)) // seq 1
    hub.broadcast(completeMsg('s1', 'success')) // seq 2
    hub.broadcast(toolCallMsg('s1', 't1')) // seq 3
    hub.broadcast(toolCallMsg('s1', 't2')) // seq 4
    c1.received.length = 0
    c2.received.length = 0

    const sent = hub.maybeSendReturnSummary('c1', [{ sessionId: 's1', afterSeq: 0 }])
    expect(sent).toBe(true)
    expect(c1.received).toHaveLength(1)
    const summary = c1.received[0]
    expect(summary.type).toBe('companion_message')
    expect((summary.payload as { text: string }).text).toBe(
      '你离开期间：会话 重构 auth 完成 1 回合（成功）、调用工具 2 次、在等待你确认选项',
    )
    expect(c2.received).toHaveLength(0)
  })

  it('断连 >60s 即使无落后也触发；无进展时给出空摘要', () => {
    const hub = new BroadcastHub()
    const c = fakeClient()
    hub.registerClient('c', c.send)
    hub.broadcast(streamMsg('s1', 'a'))
    c.received.length = 0
    const sent = hub.maybeSendReturnSummary('c', [{ sessionId: 's1', afterSeq: 1 }], {
      disconnectedMs: 61_000,
    })
    expect(sent).toBe(true)
    expect((c.received[0].payload as { text: string }).text).toBe('你离开期间：各会话没有新的进展。')
  })

  it('落后与断连均未超阈值：不发送', () => {
    const hub = new BroadcastHub({ returnSummaryLagThreshold: 50 })
    const c = fakeClient()
    hub.registerClient('c', c.send)
    hub.broadcast(streamMsg('s1', 'a'))
    c.received.length = 0
    const sent = hub.maybeSendReturnSummary('c', [{ sessionId: 's1', afterSeq: 0 }], {
      disconnectedMs: 5_000,
    })
    expect(sent).toBe(false)
    expect(c.received).toHaveLength(0)
  })
})
