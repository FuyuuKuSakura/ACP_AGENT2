/**
 * ClientTransport — 客户端传输抽象（architecture.md §7）。
 *
 * webview 内由 vscodeApi.postMessage 实现，mobile 由 WebSocket 实现；
 * client-core 只面向此接口，不感知宿主。
 */
import type { ClientMessage, ServerMessage } from '@dionysus/protocol'

/** 传输连接状态（mobile 断线重连 UI 依赖；webview postMessage 恒 connected）。 */
export type TransportConnectionState = 'connected' | 'disconnected' | 'reconnecting'

export interface ClientTransport {
  /** 发送 C→S 消息（协议 schema 见 @dionysus/protocol）。 */
  send(msg: ClientMessage): void
  /** 订阅 S→C 消息。实现方负责在帧到达时以 parseServerMessage 校验后回调。 */
  onMessage(cb: (msg: ServerMessage) => void): void
  /**
   * 可选：连接状态变化订阅（mobile WS 重连/断连横幅用）。
   * webview postMessage 实现可不提供。
   */
  onConnectionChange?(cb: (state: TransportConnectionState) => void): void
}
