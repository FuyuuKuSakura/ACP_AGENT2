/**
 * 断线重连横幅（architecture.md §8）：
 * - reconnecting 且 attempts ≤ 3：「连接已断开，正在重连…」；
 * - attempts > 3 或重连次数耗尽：「无法连接电脑，可能已休眠或 VS Code 已退出」
 *   （R-6 防线，不无限转圈）；
 * - connected 时不渲染。
 */
import { useConnectionStore } from '../stores/connectionStore.js'

/** 重连失败横幅阈值（spec：重连中超 3 次显示休眠提示）。 */
export const RECONNECT_BANNER_THRESHOLD = 3

export function ReconnectBanner() {
  const { state, attempts } = useConnectionStore()
  if (state === 'connected') return null

  const unreachable = attempts > RECONNECT_BANNER_THRESHOLD
  return (
    <div
      data-testid="reconnect-banner"
      data-unreachable={unreachable ? 'true' : 'false'}
      role="alert"
      className={`flex w-full items-center justify-center gap-2 px-3 py-2 text-sm ${
        unreachable
          ? 'bg-[var(--dn-error)] text-white'
          : 'bg-[var(--dn-attention-bg)] text-[var(--dn-attention-fg)]'
      }`}
    >
      {unreachable ? (
        '无法连接电脑，可能已休眠或 VS Code 已退出'
      ) : (
        <>
          <span className="dn-loader" aria-hidden />
          {state === 'reconnecting'
            ? `连接已断开，正在重连…（第 ${Math.max(attempts, 1)} 次）`
            : '连接已断开'}
        </>
      )}
    </div>
  )
}
