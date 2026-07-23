/**
 * WsTransport：移动端 WebSocket 传输（architecture.md §6.2/§6.3），
 * 与 WebviewTransport 地位对等的 Transport 第二实现。
 *
 * - **upgrade 前验票**（§6.3，修复 v2 `is_device_valid` 形同虚设的漏洞）：
 *   `/ws?token=` 在 Node http server 的 upgrade 回调内、`wss.handleUpgrade`
 *   之前校验设备 token，失败直接 `401 + socket.destroy()`，不产生 WS 连接——
 *   先 accept 再校验会给未授权方一个已建立的 WS 通道窗口；
 * - 每连接分配一个 clientId（`mobile:<id>`）；经 onConnect/onDisconnect
 *   钩子与 BroadcastHub 注册/注销对接（**断连只注销自己，绝不触碰适配器
 *   进程**，§5.3 BroadcastHub 语义）；
 * - 收消息：JSON.parse → parseClientMessage（zod 校验）→ onMessage 监听者
 *   （core-host 的 handleClientMessage，与 webview 链路同一分发口）；
 *   校验失败只给来源端回 system_notice(warning)，不影响其他客户端；
 * - 心跳与死连接清理（§4.1）：客户端 30s 协议 ping；本端 75s 未收到
 *   任何帧即 terminate 并注销；send 失败立即注销（单点失败隔离）。
 *
 * 零 vscode 依赖：纯 node + ws 库，可单测。
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import { parseClientMessage, type ClientMessage, type ServerMessage } from '@dionysus/protocol'
import { WebSocket, WebSocketServer } from 'ws'

import type { PairingManager } from './pairing.js'
import type { TransportDisconnectListener, TransportMessageListener } from './transport.js'

/** §4.1：75s 未收到任何帧即主动断开并注销 */
export const WS_FRAME_TIMEOUT_MS = 75_000
/** 心跳巡检间隔（周期扫描超期连接） */
export const WS_HEARTBEAT_CHECK_MS = 15_000

export type TransportConnectListener = (clientId: string) => void

export interface WsTransportOptions {
  pairing: PairingManager
  /** 无帧断开阈值（默认 WS_FRAME_TIMEOUT_MS；测试可注入短值） */
  frameTimeoutMs?: number
  /** 巡检间隔（默认 WS_HEARTBEAT_CHECK_MS） */
  heartbeatCheckMs?: number
  idGen?: () => string
  now?: () => number
}

interface Conn {
  ws: WebSocket
  lastFrameAt: number
}

export class WsTransport {
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly pairing: PairingManager
  private readonly frameTimeoutMs: number
  private readonly idGen: () => string
  private readonly now: () => number

  private readonly conns = new Map<string, Conn>()
  private readonly messageListeners = new Set<TransportMessageListener>()
  private readonly connectListeners = new Set<TransportConnectListener>()
  private readonly disconnectListeners = new Set<TransportDisconnectListener>()
  private readonly heartbeatTimer: NodeJS.Timeout
  private nextId = 0

  constructor(options: WsTransportOptions) {
    this.pairing = options.pairing
    this.frameTimeoutMs = options.frameTimeoutMs ?? WS_FRAME_TIMEOUT_MS
    this.idGen = options.idGen ?? (() => `${Date.now().toString(36)}-${(this.nextId += 1)}`)
    this.now = options.now ?? Date.now
    this.heartbeatTimer = setInterval(
      () => this.checkHeartbeats(),
      options.heartbeatCheckMs ?? WS_HEARTBEAT_CHECK_MS,
    )
    this.heartbeatTimer.unref()
  }

  onMessage(cb: TransportMessageListener): () => void {
    this.messageListeners.add(cb)
    return () => this.messageListeners.delete(cb)
  }

  /** 新连接建立（core-host 据此向 BroadcastHub 注册 clientId）。 */
  onConnect(cb: TransportConnectListener): () => void {
    this.connectListeners.add(cb)
    return () => this.connectListeners.delete(cb)
  }

  onDisconnect(cb: TransportDisconnectListener): () => void {
    this.disconnectListeners.add(cb)
    return () => this.disconnectListeners.delete(cb)
  }

  get clientIds(): string[] {
    return [...this.conns.keys()]
  }

  /**
   * lan-server upgrade 钩子的实现（§6.3）：
   * 校验在 handleUpgrade **之前**——非 /ws 路径 404、token 无效 401，
   * 失败一律写响应头后 destroy，不建立 WS 连接。
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    let url: URL
    try {
      url = new URL(req.url ?? '', 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const token = url.searchParams.get('token') ?? ''
    if (!token || !this.pairing.validateDeviceToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws))
  }

  send(clientId: string, msg: ServerMessage): void {
    const conn = this.conns.get(clientId)
    if (!conn) return
    if (conn.ws.readyState !== WebSocket.OPEN) {
      this.drop(clientId)
      return
    }
    conn.ws.send(JSON.stringify(msg), (err) => {
      // §4.1：send 失败立即注销并从广播表移除，记 warning 不影响其他连接
      if (err) {
        console.warn(`[dionysus] ws send to ${clientId} failed, unregister: ${err.message}`)
        this.drop(clientId)
      }
    })
  }

  broadcast(msg: ServerMessage): void {
    for (const clientId of [...this.conns.keys()]) this.send(clientId, msg)
  }

  /** 注销全部连接并停止心跳巡检（core-host dispose 路径）。 */
  dispose(): void {
    clearInterval(this.heartbeatTimer)
    for (const clientId of [...this.conns.keys()]) this.drop(clientId)
    this.wss.close()
  }

  // ── 连接生命周期 ──────────────────────────────────────────────────────────

  private onConnection(ws: WebSocket): void {
    const clientId = `mobile:${this.idGen()}`
    this.conns.set(clientId, { ws, lastFrameAt: this.now() })
    ws.on('message', (data: Buffer) => this.onFrame(clientId, data))
    ws.on('pong', () => this.touch(clientId))
    ws.on('close', () => this.drop(clientId))
    ws.on('error', () => this.drop(clientId))
    for (const cb of [...this.connectListeners]) cb(clientId)
  }

  private onFrame(clientId: string, data: Buffer): void {
    this.touch(clientId)
    let raw: unknown
    try {
      raw = JSON.parse(data.toString('utf8'))
    } catch {
      this.sendWarning(clientId, '无法识别的消息：非 JSON')
      return
    }
    let msg: ClientMessage
    try {
      msg = parseClientMessage(raw)
    } catch (err) {
      this.sendWarning(clientId, `无法识别的消息：${(err as Error).message}`)
      return
    }
    for (const cb of [...this.messageListeners]) cb(clientId, msg)
  }

  private sendWarning(clientId: string, text: string): void {
    this.send(clientId, {
      v: 1,
      type: 'system_notice',
      ts: this.now(),
      payload: { text, level: 'warning' },
    })
  }

  private touch(clientId: string): void {
    const conn = this.conns.get(clientId)
    if (conn) conn.lastFrameAt = this.now()
  }

  /** 注销连接并通知 onDisconnect（显式断开、发送失败、心跳超期共用此路径）。 */
  private drop(clientId: string): void {
    const conn = this.conns.get(clientId)
    if (!conn) return
    this.conns.delete(clientId)
    try {
      conn.ws.terminate()
    } catch {
      // terminate 抛错不阻断注销
    }
    for (const cb of [...this.disconnectListeners]) cb(clientId)
  }

  private checkHeartbeats(): void {
    const deadline = this.now() - this.frameTimeoutMs
    for (const [clientId, conn] of [...this.conns]) {
      if (conn.lastFrameAt < deadline) this.drop(clientId)
    }
  }
}
