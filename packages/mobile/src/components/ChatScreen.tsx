/**
 * 会话详情对话页（ux-core-flows.md §6.2）：
 * 标题栏（返回 + 会话名 + 右上角唤起角色按钮）+ waiting_option 常驻确认条
 * + 消息气泡/流式 + 操作 chip 折叠计数条 + 底部短指令栏 + 角色唤起抽屉。
 *
 * 手势：左滑 → 工作状态全屏页；上滑 → 唤起角色抽屉。
 * 进入会话：切 currentSession、清未读（markSessionRead）、无消息时拉历史。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  selectSession,
  selectStreamState,
  useDigestStore,
  useSessionStore,
  useStreamStore,
  type ChatMessage,
  type ClientTransport,
} from '@dionysus/client-core'

import { sendHistoryRequest } from '../actions.js'
import { bindSwipe } from '../gestures.js'
import { navigate } from '../router.js'
import { selectPersonaForSession, usePersonaStore } from '../stores/personaStore.js'
import { CharacterDrawer } from './CharacterDrawer.js'
import { CommandBar } from './CommandBar.js'
import { Icon } from './Icon.js'
import { OptionConfirmBar } from './OptionConfirmBar.js'
import { ReconnectBanner } from './ReconnectBanner.js'
import { ToolCallChips } from './ToolCallChips.js'

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') {
    return (
      <div className="px-6 py-1 text-center text-xs text-[var(--dn-muted)]">
        {msg.text}
      </div>
    )
  }
  const isUser = msg.role === 'user'
  return (
    <div className={`flex px-3 py-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-[var(--dn-user-bubble-bg)] text-[var(--dn-user-bubble-fg)]'
            : 'rounded-bl-sm border border-[var(--dn-border)] bg-[var(--dn-agent-bubble-bg)] text-[var(--dn-fg)]'
        }`}
      >
        {msg.origin && (
          <div className="mb-0.5 text-xs text-[var(--dn-muted)]">
            来自{msg.origin}
          </div>
        )}
        {msg.text}
      </div>
    </div>
  )
}

export interface ChatScreenProps {
  sessionId: string
  transport: ClientTransport
}

export function ChatScreen({ sessionId, transport }: ChatScreenProps) {
  const session = useSessionStore((s) => selectSession(s, sessionId))
  const stream = useStreamStore((s) => selectStreamState(s, sessionId))
  const digest = useDigestStore((s) => s.digests[sessionId])
  const persona = usePersonaStore((s) => selectPersonaForSession(s, sessionId))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [awayMode, setAwayMode] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 进入会话：切入 + 清未读 + 拉历史（刷新可恢复，§6.2）
  useEffect(() => {
    useSessionStore.getState().setCurrentSession(sessionId)
    useDigestStore.getState().markSessionRead(sessionId)
    const existing = useSessionStore.getState().sessions[sessionId]
    if (!existing || existing.messages.length === 0) {
      sendHistoryRequest(transport, sessionId)
    }
  }, [sessionId, transport])

  // 手势：左滑进工作状态页，上滑唤起角色抽屉
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    return bindSwipe(el, (direction) => {
      if (direction === 'left') navigate({ name: 'status', sessionId })
      else if (direction === 'up') setDrawerOpen(true)
    })
  }, [sessionId])

  const messages = session?.messages ?? []
  const waitingOption = Boolean(
    digest?.pendingOptionRequest || (stream?.optionGroup && !stream.optionGroup.resolved),
  )
  const running = digest?.status === 'running' || Boolean(stream?.isStreaming)

  // 新内容自动滚到底（确认条出现时由 OptionConfirmBar 自行 scrollIntoView）
  const contentSize = messages.length + (stream?.streamText.length ?? 0)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [contentSize])

  // 操作 chip 的「本回合」口径：取最近一个 tool_call 的 turnId
  const currentTurnId = useMemo(() => {
    const calls = stream?.toolCalls ?? []
    return calls.length > 0 ? calls[calls.length - 1].turnId : undefined
  }, [stream?.toolCalls])

  return (
    <div ref={rootRef} data-testid="chat-screen" className="flex h-full flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-2.5">
        <button
          type="button"
          data-testid="chat-back"
          aria-label="返回列表"
          onClick={() => navigate({ name: 'list' })}
          className="flex-none px-1 text-lg text-[var(--dn-accent)]"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">
          {session?.title || digest?.title || '新会话'}
        </span>
        <button
          type="button"
          data-testid="status-page-button"
          aria-label="工作状态"
          onClick={() => navigate({ name: 'status', sessionId })}
          className="flex flex-none items-center rounded-full bg-[var(--dn-button-secondary-bg)] px-2.5 py-1 text-sm"
        >
          <Icon name="list" size={15} />
        </button>
        <button
          type="button"
          data-testid="summon-character-button"
          aria-label="唤起角色"
          onClick={() => setDrawerOpen(true)}
          className="flex flex-none items-center rounded-full bg-[var(--dn-button-secondary-bg)] px-2.5 py-1 text-sm"
        >
          <Icon name="bell" size={15} />
        </button>
      </header>
      <ReconnectBanner />
      {waitingOption && stream?.optionGroup && (
        <OptionConfirmBar
          sessionId={sessionId}
          group={stream.optionGroup}
          transport={transport}
        />
      )}
      <div ref={scrollRef} data-testid="chat-scroll" className="min-h-0 flex-1 overflow-y-auto py-2">
        {messages.length === 0 && !stream?.isStreaming && (
          <p className="px-4 py-10 text-center text-sm text-[var(--dn-muted)]">
            开始对话吧——或点底部「继续」让 agent 接着干活。
          </p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
        {stream?.isStreaming && stream.streamText && (
          <div className="flex justify-start px-3 py-1">
            <div
              data-testid="streaming-bubble"
              className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-[var(--dn-border)] bg-[var(--dn-agent-bubble-bg)] px-3 py-2 text-sm leading-relaxed"
            >
              {stream.streamText}
              <span className="dn-loader ml-1" aria-label="输出中" />
            </div>
          </div>
        )}
        <ToolCallChips
          toolCalls={stream?.toolCalls ?? []}
          currentTurnId={currentTurnId}
        />
      </div>
      <CommandBar
        sessionId={sessionId}
        transport={transport}
        running={running}
        waitingOption={waitingOption}
        awayMode={awayMode}
        onAwayModeChange={setAwayMode}
      />
      <CharacterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        persona={persona}
      />
    </div>
  )
}
