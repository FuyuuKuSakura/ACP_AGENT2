/**
 * WebviewTransport：webview postMessage 传输（architecture.md §6.2）。
 *
 * - 持有 webview 引用集合（clientId → webview），send/broadcast 经 webview.postMessage；
 * - 收消息：onDidReceiveMessage → parseClientMessage（zod 校验）后分发给
 *   onMessage 监听者（core-host 的消息分发口）；校验失败只给来源端回
 *   system_notice(warning)，不影响其他客户端；
 * - postMessage 返回 false 或抛错即判定断连：注销并触发 onDisconnect
 *   （core-host 据此从 BroadcastHub 注销，单点失败隔离语义同 §4.1）；
 * - 零 vscode 依赖：webview 以 WebviewLike 结构类型接入，假 webview 可单测。
 *   WsTransport（移动端）留 Phase 5。
 */
import { parseClientMessage, type ClientMessage, type ServerMessage } from '@dionysus/protocol'

/** vscode.Webview 的最小结构（实际传入 webview 即可；测试用假实现）。 */
export interface WebviewLike {
  postMessage(message: unknown): unknown
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
}

export type TransportMessageListener = (clientId: string, msg: ClientMessage) => void
export type TransportDisconnectListener = (clientId: string) => void

/** architecture.md §6.2 的 Transport 接口。 */
export interface Transport {
  send(clientId: string, msg: ServerMessage): void
  broadcast(msg: ServerMessage): void
  onMessage(cb: TransportMessageListener): () => void
  onDisconnect(cb: TransportDisconnectListener): () => void
}

export class WebviewTransport implements Transport {
  private readonly clients = new Map<string, WebviewLike>()
  private readonly messageListeners = new Set<TransportMessageListener>()
  private readonly disconnectListeners = new Set<TransportDisconnectListener>()

  onMessage(cb: TransportMessageListener): () => void {
    this.messageListeners.add(cb)
    return () => this.messageListeners.delete(cb)
  }

  onDisconnect(cb: TransportDisconnectListener): () => void {
    this.disconnectListeners.add(cb)
    return () => this.disconnectListeners.delete(cb)
  }

  get clientIds(): string[] {
    return [...this.clients.keys()]
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId)
  }

  /**
   * 绑定一个 webview 到 clientId（重复绑定视为重连，替换旧引用）。
   * 校验通过的消息分发给全部 onMessage 监听者；返回的 dispose 解除消息监听并注销该客户端。
   */
  attach(clientId: string, webview: WebviewLike): { dispose(): void } {
    this.clients.set(clientId, webview)
    const subscription = webview.onDidReceiveMessage((raw: unknown) => {
      let msg: ClientMessage
      try {
        msg = parseClientMessage(raw)
      } catch (err) {
        this.send(clientId, {
          v: 1,
          type: 'system_notice',
          ts: Date.now(),
          payload: { text: `无法识别的消息：${(err as Error).message}`, level: 'warning' },
        })
        return
      }
      for (const cb of [...this.messageListeners]) cb(clientId, msg)
    })
    return {
      dispose: () => {
        subscription.dispose()
        this.detach(clientId)
      },
    }
  }

  /** 注销客户端并通知 onDisconnect（显式 dispose 与发送失败共用此路径）。 */
  detach(clientId: string): void {
    if (!this.clients.delete(clientId)) return
    for (const cb of [...this.disconnectListeners]) cb(clientId)
  }

  send(clientId: string, msg: ServerMessage): void {
    const webview = this.clients.get(clientId)
    if (!webview) return
    let result: unknown
    try {
      result = webview.postMessage(msg)
    } catch {
      this.detach(clientId)
      return
    }
    // vscode.Webview.postMessage 返回 Thenable<boolean>：false/异常 = 死连接
    if (result && typeof (result as Promise<boolean>).then === 'function') {
      void (result as Promise<boolean>).then(
        (ok) => {
          if (ok === false) this.detach(clientId)
        },
        () => this.detach(clientId),
      )
    }
  }

  broadcast(msg: ServerMessage): void {
    for (const clientId of [...this.clients.keys()]) this.send(clientId, msg)
  }
}
