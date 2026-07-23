/**
 * returnSummary — 归来摘要卡（architecture.md §8 / ux-core-flows.md §6.3）。
 *
 * core 侧（BroadcastHub.maybeSendReturnSummary）在重连落后超阈值/断连 >60s
 * 时向本客户端单播一条 scope='global' 的 companion_message 摘要。协议没有
 * 专门的消息类型/标志位，mobile 用两条启发式把它从普通播报里认出来：
 * 1. 文本以内置模板前缀「你离开期间」开头（rewriter 改写后保留前缀是
 *    core 侧约定，见 broadcast.ts 模板拼装）；
 * 2. 重连成功后的 RETURN_SUMMARY_WINDOW_MS 内收到的首条 global 播报。
 * 摘要在首屏顶部卡片呈现，可手动关闭。
 */
import { create } from 'zustand'

import type { ServerMessage } from '@dionysus/protocol'

export const RETURN_SUMMARY_PREFIX = '你离开期间'
export const RETURN_SUMMARY_WINDOW_MS = 15_000

export interface ReturnSummaryStoreState {
  card: { text: string; ts: number } | null
  show(text: string, ts: number): void
  dismiss(): void
  reset(): void
}

export const useReturnSummaryStore = create<ReturnSummaryStoreState>()(
  (set) => ({
    card: null,
    show(text, ts) {
      set({ card: { text, ts } })
    },
    dismiss() {
      set({ card: null })
    },
    reset() {
      set({ card: null })
    },
  }),
)

/** 最近一次（重）连成功的时间戳；0 表示尚未连接过。 */
let lastReconnectAt = 0

/** 重连成功时调用：开启归来摘要识别窗口。 */
export function noteReconnected(now = Date.now()): void {
  lastReconnectAt = now
}

/**
 * 消息管线拦截：是归来摘要则落卡并返回 true（调用方继续正常 dispatch，
 * 摘要同时保留在 companionStore 汇报流里，不吞消息）。
 */
export function detectReturnSummary(
  msg: ServerMessage,
  now = Date.now(),
): boolean {
  if (msg.type !== 'companion_message') return false
  if (msg.payload.scope !== 'global') return false
  const text = msg.payload.text
  const byPrefix = text.startsWith(RETURN_SUMMARY_PREFIX)
  const byWindow =
    lastReconnectAt > 0 && now - lastReconnectAt <= RETURN_SUMMARY_WINDOW_MS
  if (!byPrefix && !byWindow) return false
  useReturnSummaryStore.getState().show(text, msg.ts)
  // 命中后关窗，避免后续普通播报连环覆盖摘要卡
  lastReconnectAt = 0
  return true
}
