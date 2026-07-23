/**
 * OptionGroup — waiting_option 时的选项按钮组（ux-core-flows.md §5.3）。
 *
 * 未决态醒目展示（attention 色描边 + 问题文案）；点击发 option_selected，
 * 服务端 option_resolved 广播后置已决态：全部按钮置灰、选中项标注。
 */
import type { ClientTransport, OptionGroupState } from '@dionysus/client-core'

import { Icon } from '../Icon.js'
import { sendOptionSelected } from './chatActions.js'

export interface OptionGroupProps {
  sessionId: string
  group: OptionGroupState
  transport: ClientTransport
}

export function OptionGroup({ sessionId, group, transport }: OptionGroupProps) {
  const resolved = group.resolved
  return (
    <div
      data-testid="option-group"
      data-resolved={resolved ? 'true' : 'false'}
      className={`rounded-[var(--dn-radius-md)] border px-3 py-2.5 ${
        resolved
          ? 'border-[var(--dn-border)] bg-[var(--dn-panel-bg)]'
          : 'border-[var(--dn-attention)] bg-[var(--dn-agent-bubble-bg)]'
      }`}
    >
      <p
        className={`mb-2 text-sm font-medium ${
          resolved ? 'text-[var(--dn-muted)]' : 'text-[var(--dn-fg)]'
        }`}
      >
        {resolved ? group.question : `需要你确认：${group.question}`}
      </p>
      <div className="flex flex-wrap gap-2">
        {group.options.map((opt) => {
          const isSelected = resolved?.selectedId === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              disabled={!!resolved}
              title={opt.description}
              onClick={() =>
                sendOptionSelected(transport, sessionId, opt.id, opt.label)
              }
              className={`rounded-full px-3 py-1 text-sm ${
                isSelected
                  ? 'bg-[var(--dn-badge-bg)] text-[var(--dn-badge-fg)]'
                  : resolved
                    ? 'bg-[var(--dn-button-secondary-bg)] text-[var(--dn-button-secondary-fg)] opacity-60'
                    : 'bg-[var(--dn-button-bg)] text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)]'
              } disabled:cursor-not-allowed`}
            >
              <span className="inline-flex items-center gap-1">
                {opt.label}
                {isSelected && <Icon name="done" size={12} />}
              </span>
            </button>
          )
        })}
      </div>
      {resolved && (
        <p className="mt-1.5 text-xs text-[var(--dn-muted)]">
          已选择（来自 {resolved.origin}）
        </p>
      )}
    </div>
  )
}
