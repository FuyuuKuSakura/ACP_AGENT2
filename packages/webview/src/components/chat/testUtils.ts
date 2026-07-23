/**
 * 组件测试共用工具：假 transport、server 消息注入、store 复位。
 */
import type { ClientMessage, ServerMessage } from '@dionysus/protocol'

import {
  dispatchRouteActions,
  routeServerMessage,
  useCompanionStore,
  useDigestStore,
  useSessionStore,
  useSettingsStore,
  useStreamStore,
} from '@dionysus/client-core'
import type { ClientTransport } from '@dionysus/client-core'

/** 假 transport：记录发出帧，emit 模拟 S→C 帧（多监听，与生产 WebviewTransport 一致）。 */
export class FakeTransport implements ClientTransport {
  readonly sent: ClientMessage[] = []
  private readonly listeners = new Set<(msg: ServerMessage) => void>()

  send(msg: ClientMessage): void {
    this.sent.push(msg)
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.listeners.add(cb)
  }

  emit(msg: ServerMessage): void {
    for (const cb of [...this.listeners]) cb(msg)
  }

  ofType<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ClientMessage, { type: T }>[]
  }
}

/** 构造并注入一条 S→C 消息（走真实 messageRouter + dispatch 链路）。 */
export function serverMsg(msg: ServerMessage): void {
  dispatchRouteActions(routeServerMessage(msg))
}

/** 便捷构造信封。 */
export function envelope<T extends ServerMessage['type']>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>['payload'],
  extra: Partial<Pick<ServerMessage, 'sessionId' | 'turnId' | 'seq' | 'traceId'>> = {},
): ServerMessage {
  return { v: 1, type, ts: 1_700_000_000_000, ...extra, payload } as ServerMessage
}

export function resetAllStores(): void {
  useSessionStore.getState().reset()
  useStreamStore.getState().reset()
  useDigestStore.getState().reset()
  useCompanionStore.getState().reset()
  useSettingsStore.getState().reset()
}
