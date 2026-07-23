/**
 * 「全部会话」聚合条（ux-core-flows.md §2.3）：
 * 常驻列表顶部、非会话、不可删除；与 StatusBarItem 口径同源
 * （client-core selectStatusBarAggregate），点击聚焦 Live2D 陪伴区。
 * 计数前缀为 Icon 图标体系（禁止 emoji）。
 */
import { Icon } from '../Icon.js'

export interface AggregateBarProps {
  running: number
  waitingOption: number
  done: number
  onClick?: () => void
}

export function AggregateBar({
  running,
  waitingOption,
  done,
  onClick,
}: AggregateBarProps) {
  return (
    <button
      type="button"
      data-testid="aggregate-bar"
      onClick={onClick}
      title="全部会话总览（点击聚焦角色陪伴区）"
      className="flex min-h-[32px] w-full items-center gap-1 whitespace-nowrap border-b border-[var(--dn-border)] px-2 py-1 text-xs text-[var(--dn-fg)] hover:bg-[var(--dn-list-hover-bg)] focus:outline-none"
    >
      <span
        data-testid="aggregate-running"
        className="inline-flex items-center gap-0.5"
      >
        <Icon name="running" size={12} />
        {running} 运行中
      </span>
      <span className="text-[var(--dn-muted)]">·</span>
      <span
        data-testid="aggregate-waiting"
        className="inline-flex items-center gap-0.5 text-[var(--dn-attention)]"
      >
        <Icon name="waiting_option" size={12} />
        {waitingOption} 待决策
      </span>
      <span className="text-[var(--dn-muted)]">·</span>
      <span
        data-testid="aggregate-done"
        className="inline-flex items-center gap-0.5"
      >
        <Icon name="done" size={12} />
        {done} 已完成
      </span>
    </button>
  )
}
