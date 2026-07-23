/**
 * ChatInput — 底部输入框。
 *
 * - Enter 发送、Shift+Enter 换行；
 * - 输入 / 弹出斜杠命令候选（/new /sessions /resume，附一句话说明，
 *   ux-core-flows.md §5），点击或 Tab 补全；
 * - 流式中保持可输入（打断走标题栏按钮）；无会话时禁用并提示。
 */
import { useRef, useState } from 'react'

import type { ClientTransport } from '@dionysus/client-core'

import { sendChatText } from './chatActions.js'
import { filterSlashCommands } from './slashCommands.js'

export interface ChatInputProps {
  sessionId: string | null
  transport: ClientTransport
}

export function ChatInput({ sessionId, transport }: ChatInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const disabled = !sessionId

  const candidates = disabled ? [] : filterSlashCommands(text)

  function submit() {
    if (disabled) return
    const value = text.trim()
    if (!value) return
    sendChatText(transport, sessionId!, value)
    setText('')
  }

  function pickCommand(command: string) {
    setText(`${command} `)
    textareaRef.current?.focus()
  }

  return (
    <div className="relative border-t border-[var(--dn-border)] bg-[var(--dn-panel-bg)] p-2.5">
      {candidates.length > 0 && (
        <ul
          data-testid="slash-candidates"
          className="absolute bottom-full left-2.5 right-2.5 mb-1 overflow-hidden rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-agent-bubble-bg)] shadow-lg"
        >
          {candidates.map((c) => (
            <li key={c.command}>
              <button
                type="button"
                onClick={() => pickCommand(c.command)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--dn-button-secondary-bg)]"
              >
                <span className="font-mono text-[var(--dn-accent)]">
                  {c.command}
                </span>
                <span className="text-xs text-[var(--dn-muted)]">
                  {c.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          rows={2}
          value={text}
          disabled={disabled}
          placeholder={
            disabled
              ? '先新建一个会话…'
              : '输入消息，Enter 发送，Shift+Enter 换行；输入 / 查看命令'
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault()
              submit()
            }
          }}
          className="min-h-[2.5rem] flex-1 resize-none rounded-[var(--dn-radius-md)] border border-[var(--dn-input-border)] bg-[var(--dn-input-bg)] px-3 py-2 text-sm text-[var(--dn-input-fg)] outline-none placeholder:text-[var(--dn-muted)] focus:border-[var(--dn-focus-border)] disabled:border-[var(--dn-border)] disabled:text-[var(--dn-muted)]"
        />
        <button
          type="button"
          data-testid="chat-send"
          disabled={disabled || !text.trim()}
          onClick={submit}
          className="rounded-[var(--dn-radius-md)] bg-[var(--dn-button-bg)] px-3.5 py-2 text-sm text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)] disabled:cursor-not-allowed disabled:bg-[var(--dn-button-secondary-bg)] disabled:text-[var(--dn-muted)]"
        >
          发送
        </button>
      </div>
    </div>
  )
}
