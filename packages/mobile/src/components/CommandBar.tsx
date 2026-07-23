/**
 * 底部短指令栏（ux-core-flows.md §6.2）：「继续 / 打断 / 确认选项（waiting_option
 * 时出现，点击聚焦顶部确认条）+ 输入框」+ 「离开模式」快捷开关（yolo 模式，
 * 走既有 user_input.mode，无协议改动）。
 *
 * IME composition 保护（extract/pairing-mobile.md §4.3-3）：中文输入法
 * 组字期间 Enter 不发送——同时看 nativeEvent.isComposing 与
 * compositionstart/end 状态位（部分手机浏览器 isComposing 不可靠）。
 */
import { useRef, useState } from 'react'

import type { ClientTransport } from '@dionysus/client-core'

import { sendInterrupt, sendUserInput } from '../actions.js'

export interface CommandBarProps {
  sessionId: string
  transport: ClientTransport
  /** 有进行中回合时「打断」可用 */
  running: boolean
  /** 有待决策选项组时显示「确认选项」键（点击聚焦顶部确认条，§6.2 三键） */
  waitingOption: boolean
  /** 离开模式（yolo）：父组件持有，发消息时作为 mode 传出 */
  awayMode: boolean
  onAwayModeChange(on: boolean): void
}

export function CommandBar({
  sessionId,
  transport,
  running,
  waitingOption,
  awayMode,
  onAwayModeChange,
}: CommandBarProps) {
  const [text, setText] = useState('')
  const composingRef = useRef(false)

  function submit() {
    const value = text.trim()
    if (!value) return
    sendUserInput(transport, sessionId, value, awayMode ? 'yolo' : 'normal')
    setText('')
  }

  // 「确认选项」：定位到顶部常驻确认条并聚焦第一个选项按钮
  function focusOptionBar() {
    const bar = document.querySelector<HTMLElement>(
      '[data-testid="option-confirm-bar"]',
    )
    bar?.scrollIntoView?.({ block: 'start' })
    bar?.querySelector<HTMLElement>('button:not([disabled])')?.focus?.()
  }

  return (
    <div
      data-testid="command-bar"
      className="flex-none border-t border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          data-testid="continue-button"
          onClick={() => sendUserInput(transport, sessionId, '继续', awayMode ? 'yolo' : 'normal')}
          className="rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-secondary-bg)] px-3 py-1 text-xs text-[var(--dn-button-secondary-fg)]"
        >
          继续
        </button>
        <button
          type="button"
          data-testid="interrupt-button"
          disabled={!running}
          onClick={() => sendInterrupt(transport, sessionId)}
          className="rounded-[var(--dn-radius-sm)] bg-[var(--dn-error)] px-3 py-1 text-xs text-white disabled:cursor-not-allowed disabled:bg-[var(--dn-button-secondary-bg)] disabled:text-[var(--dn-muted)]"
        >
          打断
        </button>
        {waitingOption && (
          <button
            type="button"
            data-testid="focus-option-button"
            onClick={focusOptionBar}
            className="rounded-[var(--dn-radius-sm)] bg-[var(--dn-attention-bg)] px-3 py-1 text-xs font-medium text-[var(--dn-attention-fg)]"
          >
            确认选项
          </button>
        )}
        <span className="flex-1" />
        <label
          data-testid="away-mode-label"
          className="flex items-center gap-1.5 text-xs text-[var(--dn-muted)]"
          title="离开模式：yolo 模式自动确认，降低无人值守阻塞点"
        >
          离开模式
          <button
            type="button"
            role="switch"
            aria-checked={awayMode}
            data-testid="away-mode-switch"
            onClick={() => onAwayModeChange(!awayMode)}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              awayMode ? 'bg-[var(--dn-accent)]' : 'bg-[var(--dn-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                awayMode ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          data-testid="command-input"
          rows={1}
          value={text}
          placeholder="发短指令…"
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            composingRef.current = false
          }}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              !composingRef.current
            ) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-bg)] px-3 py-2 text-sm text-[var(--dn-fg)] outline-none placeholder:text-[var(--dn-muted)] focus:border-[var(--dn-accent)]"
        />
        <button
          type="button"
          data-testid="command-send"
          disabled={!text.trim()}
          onClick={submit}
          className="rounded-[var(--dn-radius-md)] bg-[var(--dn-button-bg)] px-4 py-2 text-sm text-[var(--dn-button-fg)] disabled:cursor-not-allowed disabled:bg-[var(--dn-button-secondary-bg)] disabled:text-[var(--dn-muted)]"
        >
          发送
        </button>
      </div>
    </div>
  )
}
