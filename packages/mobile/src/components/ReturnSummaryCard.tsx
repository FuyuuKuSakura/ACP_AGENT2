/**
 * 归来摘要卡（ux-core-flows.md §6.3）：首屏顶部呈现
 * 「离开期间发生了什么」（core 单播的 Supervisor 内置模板摘要，零 LLM 依赖）。
 */
import { useReturnSummaryStore } from '../stores/returnSummaryStore.js'
import { Icon } from './Icon.js'

export function ReturnSummaryCard() {
  const { card, dismiss } = useReturnSummaryStore()
  if (!card) return null
  return (
    <div
      data-testid="return-summary-card"
      className="mx-3 mt-2 flex items-start gap-2 rounded-[var(--dn-radius-md)] border border-[var(--dn-attention)] bg-[var(--dn-panel-bg)] px-3 py-2.5 shadow-sm"
    >
      <span className="mt-0.5 flex-none text-[var(--dn-attention)]">
        <Icon name="bell" size={15} />
      </span>
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--dn-fg)]">
        {card.text}
      </p>
      <button
        type="button"
        data-testid="return-summary-dismiss"
        aria-label="关闭摘要"
        onClick={dismiss}
        className="flex-none px-1 text-lg leading-none text-[var(--dn-muted)]"
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}
