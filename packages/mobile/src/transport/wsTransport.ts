/**
 * WsTransport — mobile 的 ClientTransport 实现（architecture.md §8）。
 *
 * 沿用 v2 已验证的重连策略：
 * - 30s ping 心跳；
 * - 指数退避 1s → 30s（2^n，封顶），上限 10 次；
 * - 主动断开（disconnect()/intentionalClose）不重连；
 * - visibilitychange 回到前台立即重连（取消挂起的退避计时器、重置次数）。
 *
 * 连接期间发出的非 ping 消息排队，open 后随 hello 一起冲刷；
 * S→C 帧一律经 parseServerMessage 校验（client-core ClientTransport 契约）。
 */
import {
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@dionysus/protocol'
import type {
  ClientTransport,
  TransportConnectionState,
} from '@dionysus/client-core'

/** 浏览器 WebSocket 的最小结构（测试注入假实现）。 */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export interface WsTransportOptions {
  /** WS URL（/ws?token=…），每次（重）连时重新求值 */
  url: () => string
  /** WebSocket 工厂；缺省用全局 WebSocket */
  createSocket?: (url: string) => WebSocketLike
  heartbeatMs?: number
  backoffBaseMs?: number
  backoffMaxMs?: number
  maxAttempts?: number
  /** 每次（重）连成功后要发的第一条消息（hello） */
  helloMessage?: () => ClientMessage
}

const WS_OPEN = 1

export class WsTransport implements ClientTransport {
  private ws: WebSocketLike | null = null
  private messageCbs: ((msg: ServerMessage) => void)[] = []
  private connCbs: ((state: TransportConnectionState) => void)[] = []
  private openCbs: (() => void)[] = []
  private outbox: ClientMessage[] = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionalClose = false
  private state: TransportConnectionState = 'disconnected'
  /** 本轮断连后已尝试的重连次数（横幅「超 3 次」判定依据） */
  attempts = 0

  private readonly heartbeatMs: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly maxAttempts: number

  constructor(private readonly opts: WsTransportOptions) {
    this.heartbeatMs = opts.heartbeatMs ?? 30_000
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000
    this.backoffMaxMs = opts.backoffMaxMs ?? 30_000
    this.maxAttempts = opts.maxAttempts ?? 10
  }

  // ------------------------------------------------------------ ClientTransport

  send(msg: ClientMessage): void {
    if (msg.type === 'ping') {
      // 心跳帧不排队：只在连接上时直发（断线期间的 ping 无意义）
      if (this.ws && this.ws.readyState === WS_OPEN) {
        this.ws.send(JSON.stringify(msg))
      }
      return
    }
    if (this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.outbox.push(msg)
    }
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.messageCbs.push(cb)
  }

  onConnectionChange(cb: (state: TransportConnectionState) => void): void {
    this.connCbs.push(cb)
  }

  // ------------------------------------------------------------ 扩展接口

  /** 每次（重）连成功后回调——App 在此发 sync_request 补拉。 */
  onOpen(cb: () => void): void {
    this.openCbs.push(cb)
  }

  get connectionState(): TransportConnectionState {
    return this.state
  }

  connect(): void {
    this.intentionalClose = false
    this.openSocket()
  }

  /** 主动断开：不再重连（撤销设备/解除配对路径）。 */
  disconnect(): void {
    this.intentionalClose = true
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.ws?.close()
    this.ws = null
    this.setState('disconnected')
  }

  // ------------------------------------------------------------ 内部

  private openSocket(): void {
    const create =
      this.opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)
    const ws = create(this.opts.url())
    this.ws = ws

    ws.onopen = () => {
      this.attempts = 0
      this.setState('connected')
      // hello 最先发，其后冲刷断线期间排队的消息
      const hello = this.opts.helloMessage?.()
      if (hello) ws.send(JSON.stringify(hello))
      const queued = this.outbox
      this.outbox = []
      for (const msg of queued) ws.send(JSON.stringify(msg))
      this.startHeartbeat()
      for (const cb of this.openCbs) cb()
    }

    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = parseServerMessage(JSON.parse(String(ev.data)))
      } catch {
        // 非法帧忽略（协议校验失败不炸连接）
        return
      }
      for (const cb of this.messageCbs) cb(msg)
    }

    ws.onerror = () => {
      // 错误后必然跟 close，重连逻辑集中在 onclose
    }

    ws.onclose = () => {
      this.stopHeartbeat()
      if (this.ws === ws) this.ws = null
      if (this.intentionalClose) {
        this.setState('disconnected')
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.attempts >= this.maxAttempts) {
      // 退避上限：停在 reconnecting 态，等 visibilitychange/手动恢复
      this.setState('reconnecting', true)
      return
    }
    this.attempts += 1
    // 强制推送：attempts 变化也要让横幅更新「第 N 次」/超 3 次休眠提示
    this.setState('reconnecting', true)
    const delay = Math.min(
      this.backoffBaseMs * 2 ** (this.attempts - 1),
      this.backoffMaxMs,
    )
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.intentionalClose) this.openSocket()
    }, delay)
  }

  /** 回到前台：取消挂起的退避，重置次数，立即重连。 */
  private reconnectNow(): void {
    this.attempts = 0
    this.clearReconnectTimer()
    this.openSocket()
  }

  handleVisibilityChange(): void {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    if (this.state !== 'connected' && !this.intentionalClose) {
      this.reconnectNow()
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ v: 1, type: 'ping', ts: Date.now(), payload: {} })
    }, this.heartbeatMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private setState(state: TransportConnectionState, force = false): void {
    if (!force && this.state === state) return
    this.state = state
    for (const cb of this.connCbs) cb(state)
  }
}
