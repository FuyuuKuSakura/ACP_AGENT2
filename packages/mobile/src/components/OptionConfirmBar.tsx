/**
 * 选项确认条（ux-core-flows.md §6.2 / architecture.md §8 无人值守交互闭环）：
 * 会话 waiting_option 时对话页顶部常驻高对比确认条，选项按钮直接内联；
 * 已决态（多端竞态 option_resolved）置灰标注；重连后由 ChatScreen
 * scrollIntoView 自动定位（「回来 3 秒看懂」的 P0 交互）。
 */
import { useEffect, useRef } from 'react'

import type {
  ClientTransport,
  OptionGroupState,
} from '@dionysus/client-core'

import { sendOptionSelected } from '../actions.js'
import { Icon } from './Icon.js'

export interface OptionConfirmBarProps {
  sessionId: string
  /** 未决选项组（streamStore.optionGroup 且未 resolved 时传入） */
  group: OptionGroupState | null
  transport: ClientTransport
}

export function OptionConfirmBar({
  sessionId,
  group,
  transport,
}: OptionConfirmBarProps) {
  const barRef = useRef<HTMLDivElement>(null)

  // 出现即定位：重连/进会话时不用翻屏就能看到待决策项
  useEffect(() => {
    barRef.current?.scrollIntoView?.({ block: 'start' })
  }, [group?.requestTraceId])

  if (!group) return null
  const resolved = group.resolved

  return (
    <div
      ref={barRef}
      data-testid="option-confirm-bar"
      data-resolved={resolved ? 'true' : 'false'}
      className="dn-wedge flex w-full flex-col gap-2 border-b-2 border-[var(--dn-attention-fg)] bg-[var(--dn-attention-bg)] px-4 py-3"
    >
      <p className="flex items-start gap-1.5 text-sm font-semibold text-[var(--dn-attention-fg)]">
        {resolved ? (
          group.question
        ) : (
          <>
            <span className="mt-0.5 flex-none">
              <Icon name="waiting_option" size={15} />
            </span>
            <span>需要你确认：{group.question}</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {group.options.map((opt) => {
          const isSelected = resolved?.selectedId === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`option-button-${opt.id}`}
              disabled={!!resolved}
              title={opt.description}
              onClick={() =>
                sendOptionSelected(transport, sessionId, opt.id, opt.label)
              }
              className={`flex items-center gap-1 rounded-[var(--dn-radius-sm)] border px-4 py-1.5 text-sm font-medium ${
                isSelected
                  ? 'border-[var(--dn-fg)] bg-[var(--dn-fg)] text-[var(--dn-bg)]'
                  : resolved
                    ? 'border-[var(--dn-attention-fg)]/40 bg-black/10 text-[var(--dn-attention-fg)] opacity-60'
                    : 'border-[var(--dn-fg)] bg-[var(--dn-fg)] text-[var(--dn-bg)] active:opacity-80'
              } disabled:cursor-not-allowed`}
            >
              {opt.label}
              {isSelected && <Icon name="done" size={13} />}
            </button>
          )
        })}
      </div>
      {resolved && (
        <p className="text-xs text-[var(--dn-attention-fg)] opacity-80">
          已选择（来自 {resolved.origin}）
        </p>
      )}
    </div>
  )
}
