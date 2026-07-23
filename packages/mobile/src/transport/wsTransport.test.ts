/**
 * WsTransport 重连策略测试（假 WS + 假计时器）：
 * 30s 心跳、指数退避 1s→30s、上限 10 次、visibilitychange 立即重连、
 * 主动断开不重连、hello 先行 + 排队冲刷、消息 parseServerMessage 校验。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TransportConnectionState } from '@dionysus/client-core'
import type { ServerMessage } from '@dionysus/protocol'

import { WsTransport, type WebSocketLike } from './wsTransport.js'

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  // 测试驱动
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  serverClose(): void {
    this.readyState = 3
    this.onclose?.()
  }

  receive(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) })
  }

  receiveRaw(data: string): void {
    this.onmessage?.({ data })
  }
}

const HELLO = {
  v: 1 as const,
  type: 'hello' as const,
  ts: 1,
  payload: { minVersion: 1, maxVersion: 1 },
}

function makeTransport(): WsTransport {
  return new WsTransport({
    url: () => 'ws://test/ws?token=D',
    createSocket: (url) => new FakeSocket(url),
    helloMessage: () => ({ ...HELLO, ts: Date.now() }),
  })
}

function lastSocket(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1]
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('连接与发送', () => {
  it('open 后 hello 最先发，断线期间排队的消息随 open 冲刷', () => {
    const t = makeTransport()
    t.connect()
    const ws = lastSocket()
    // 未 open 时 send 排队
    t.send({ v: 1, type: 'ping', ts: 0, payload: {} }) // ping 不排队，直接丢
    t.send({
      v: 1,
      type: 'user_input',
      sessionId: 's1',
      ts: 1,
      payload: { text: 'hi', attachments: [], mode: 'normal' },
    })
    expect(ws.sent).toHaveLength(0)
    ws.open()
    expect(ws.sent).toHaveLength(2)
    expect(JSON.parse(ws.sent[0]).type).toBe('hello')
    expect(JSON.parse(ws.sent[1]).type).toBe('user_input')
    t.disconnect()
  })

  it('S→C 帧经 parseServerMessage 校验后回调；非法帧忽略', () => {
    const t = makeTransport()
    const got: ServerMessage[] = []
    t.onMessage((m) => got.push(m))
    t.connect()
    lastSocket().open()
    lastSocket().receive({
      v: 1,
      type: 'pong',
      ts: Date.now(),
      payload: {},
    })
    expect(got.map((m) => m.type)).toEqual(['pong'])
    lastSocket().receiveRaw('not json')
    lastSocket().receive({ type: 'pong' }) // 缺 v/ts，schema 不通过
    expect(got).toHaveLength(1)
    t.disconnect()
  })
})

describe('心跳', () => {
  it('连接后每 30s 发 ping；断开后停发', () => {
    const t = makeTransport()
    t.connect()
    const ws = lastSocket()
    ws.open()
    ws.sent = []
    vi.advanceTimersByTime(30_000)
    expect(ws.sent.filter((s) => JSON.parse(s).type === 'ping')).toHaveLength(1)
    vi.advanceTimersByTime(60_000)
    expect(ws.sent.filter((s) => JSON.parse(s).type === 'ping')).toHaveLength(3)
    ws.serverClose()
    const before = ws.sent.length
    vi.advanceTimersByTime(90_000)
    expect(ws.sent.length).toBe(before)
    t.disconnect()
  })
})

describe('指数退避重连', () => {
  it('1s → 2s → 4s … 封顶 30s（连续失败，无成功 open 介于其间）', () => {
    const t = makeTransport()
    t.connect()
    lastSocket().open()
    lastSocket().serverClose() // attempt 1: 1s
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(999)
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(2)
    lastSocket().serverClose() // attempt 2: 2s（未 open 即失败，退避继续翻倍）
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(3)
    lastSocket().serverClose() // attempt 3: 4s
    vi.advanceTimersByTime(4000)
    expect(FakeSocket.instances).toHaveLength(4)
    lastSocket().serverClose() // attempt 4: 8s
    vi.advanceTimersByTime(8000)
    expect(FakeSocket.instances).toHaveLength(5)
    lastSocket().serverClose() // attempt 5: 16s
    vi.advanceTimersByTime(16_000)
    expect(FakeSocket.instances).toHaveLength(6)
    lastSocket().serverClose() // attempt 6: 32s → 封顶 30s
    vi.advanceTimersByTime(29_999)
    expect(FakeSocket.instances).toHaveLength(6)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.instances).toHaveLength(7)
    t.disconnect()
  })

  it('重连成功后 attempts 归零、状态回 connected 并再发 hello', () => {
    const t = makeTransport()
    const states: TransportConnectionState[] = []
    t.onConnectionChange((s) => states.push(s))
    t.connect()
    lastSocket().open()
    lastSocket().serverClose()
    expect(t.attempts).toBe(1)
    vi.advanceTimersByTime(1000)
    const ws2 = lastSocket()
    ws2.open()
    expect(t.attempts).toBe(0)
    expect(JSON.parse(ws2.sent[0]).type).toBe('hello')
    expect(states).toEqual(['connected', 'reconnecting', 'connected'])
    t.disconnect()
  })

  it('重连上限 10 次后不再开新连接', () => {
    const t = makeTransport()
    t.connect()
    lastSocket().open()
    for (let i = 0; i < 12; i += 1) {
      lastSocket().serverClose()
      vi.advanceTimersByTime(31_000)
    }
    // 首个连接 + 10 次重试 = 11
    expect(FakeSocket.instances.length).toBe(11)
    expect(t.attempts).toBe(10)
    expect(t.connectionState).toBe('reconnecting')
    t.disconnect()
  })

  it('主动断开（intentionalClose）不重连', () => {
    const t = makeTransport()
    t.connect()
    lastSocket().open()
    t.disconnect()
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(t.connectionState).toBe('disconnected')
  })
})

describe('visibilitychange 回前台', () => {
  it('断连中回到前台：取消退避立即重连', () => {
    const t = makeTransport()
    t.connect()
    lastSocket().open()
    lastSocket().serverClose()
    expect(FakeSocket.instances).toHaveLength(1)
    // jsdom visibilityState 默认 visible；不等 1s 退避，立即重连
    t.handleVisibilityChange()
    expect(FakeSocket.instances).toHaveLength(2)
    expect(t.attempts).toBe(0)
    t.disconnect()
  })

  it('已连接时不动作', () => {
    const t = makeTransport()
    t.connect()
    lastSocket().open()
    t.handleVisibilityChange()
    expect(FakeSocket.instances).toHaveLength(1)
    t.disconnect()
  })
})
