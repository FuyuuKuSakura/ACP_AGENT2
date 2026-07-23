/**
 * connectionStore — WS 连接状态（断线重连横幅数据源，architecture.md §8）。
 *
 * - reconnecting 且 attempts ≤ 3：「正在重连」；
 * - attempts > 3：「无法连接电脑，可能已休眠或 VS Code 已退出」（R-6 防线）。
 */
import { create } from 'zustand'

import type { TransportConnectionState } from '@dionysus/client-core'

export interface ConnectionStoreState {
  state: TransportConnectionState
  /** 本轮断连的重连尝试次数（WsTransport.attempts 的镜像） */
  attempts: number
  setConnection(state: TransportConnectionState, attempts: number): void
  reset(): void
}

export const useConnectionStore = create<ConnectionStoreState>()((set) => ({
  state: 'disconnected',
  attempts: 0,
  setConnection(state, attempts) {
    set({ state, attempts })
  },
  reset() {
    set({ state: 'disconnected', attempts: 0 })
  },
}))
