/**
 * MessageList — 会话消息流（user/agent/system 气泡）。
 *
 * 气泡形态沿用 extract/design-style.md §1.4 规范：--dn-radius-lg（气泡档）+ 方向小角
 * （user 右上、agent 左上），色值全部换为 --dn-*（var(--vscode-*) 映射）。
 * agent 正文走 markdown 渲染；user/system 纯文本（保留换行）。
 */
import type { ChatMessage } from '@dionysus/client-core'

import { Markdown } from './Markdown.js'

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-end" data-testid="msg-user">
      <div className="max-w-[80%] rounded-[var(--dn-radius-lg)] rounded-tr-sm bg-[var(--dn-user-bubble-bg)] px-3.5 py-2 text-[var(--dn-user-bubble-fg)]">
        <p className="whitespace-pre-wrap break-words">{msg.text}</p>
        {msg.origin && msg.origin !== 'webview:chat' && (
          <p className="mt-1 text-right text-[10px] opacity-70">
            来自 {msg.origin}
          </p>
        )}
      </div>
    </div>
  )
}

function AgentBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-start" data-testid="msg-agent">
      <div className="max-w-[85%] rounded-[var(--dn-radius-lg)] rounded-tl-sm border border-[var(--dn-border)] bg-[var(--dn-agent-bubble-bg)] px-3.5 py-2 text-[var(--dn-fg)]">
        <Markdown text={msg.text} />
      </div>
    </div>
  )
}

function SystemLine({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-center" data-testid="msg-system">
      <p className="max-w-[90%] rounded-full bg-[var(--dn-panel-bg)] px-3 py-1 text-center text-xs text-[var(--dn-system-fg)]">
        {msg.text}
      </p>
    </div>
  )
}

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <>
      {messages.map((msg) => {
        switch (msg.role) {
          case 'user':
            return <UserBubble key={msg.id} msg={msg} />
          case 'agent':
            return <AgentBubble key={msg.id} msg={msg} />
          default:
            return <SystemLine key={msg.id} msg={msg} />
        }
      })}
    </>
  )
}
