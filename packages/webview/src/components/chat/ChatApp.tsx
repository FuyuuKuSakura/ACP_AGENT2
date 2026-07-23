/**
 * ChatApp — 聊天主视图（role='chat'）。
 *
 * 布局：标题栏 → todo 进度面板（有清单时）→ 全局 system_notice 条 →
 * 消息列表（气泡 + 操作条带 + 流式区 + 选项组）→ 输入框。数据全部经 client-core stores 的 hook 订阅，
 * 发送经 chatActions；本组件不含消息解析逻辑（在 messageRouter/dispatch）。
 *
 * 当前会话选择：sessionStore.currentSessionId 为唯一真源；未选定时自动
 * 落到最近活动的会话（digest.lastActivityAt 最大），进入即 markSessionRead
 * 清零未读并拉取最近历史。
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  selectCurrentMessages,
  selectStreamState,
  useDigestStore,
  useSessionStore,
  useStreamStore,
} from '@dionysus/client-core'
import type { ClientTransport } from '@dionysus/client-core'

import { sendHistoryRequest, sendNewSession } from './chatActions.js'
import { ChatHeader } from './ChatHeader.js'
import { ChatInput } from './ChatInput.js'
import { MessageList } from './MessageList.js'
import { OptionGroup } from './OptionGroup.js'
import { StreamingView } from './StreamingView.js'
import { SystemNoticeBar } from './SystemNoticeBar.js'
import { TodoPanel } from './TodoPanel.js'
import { ToolCallList } from './ToolCallList.js'
import { CompanionArea, usePersonaCompanionConfig } from '../companion/index.js'

/** 会话绑定（助手/角色）数据源的 traceId（ChatHeader 徽标用）。 */
const SESSION_LIST_TRACE = 'chat:session-list'

export interface ChatAppProps {
  clientId: string
  transport: ClientTransport
  /** init.personaId（当前 persona）；陪伴区据此从 persona_list 选中并灌配置 */
  personaId?: string
}

export function ChatApp({ transport, personaId }: ChatAppProps) {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const sessionCount = useSessionStore((s) => s.sessionIds.length)
  const messages = useSessionStore(selectCurrentMessages)
  const title = useSessionStore((s) =>
    s.currentSessionId ? (s.sessions[s.currentSessionId]?.title ?? '') : '',
  )
  const globalNotices = useSessionStore((s) => s.globalNotices)
  const stream = useStreamStore((s) =>
    currentSessionId ? selectStreamState(s, currentSessionId) : undefined,
  )
  const waitingOption = useDigestStore((s) =>
    currentSessionId
      ? (s.digests[currentSessionId]?.pendingOptionRequest ?? false)
      : false,
  )

  // ── ChatHeader 徽标的「当前会话实际绑定」数据源 ────────────────────────
  // adapterId 直接读 digest（session_digest_update 已携带）；角色名经
  // session_list（SessionMeta.personaId = 创建时绑定）+ persona_list（id→显示名）
  // 解析。不用 settingsStore——那是「新会话默认值」的本地选择，不是会话绑定。
  const boundAdapterId = useDigestStore((s) =>
    currentSessionId ? s.digests[currentSessionId]?.adapterId : undefined,
  )
  const [sessionPersonas, setSessionPersonas] = useState<Record<string, string>>({})
  const [personaNames, setPersonaNames] = useState<Record<string, string>>({})

  useEffect(() => {
    transport.onMessage((msg) => {
      if (msg.type === 'session_list_response' && msg.traceId === SESSION_LIST_TRACE) {
        setSessionPersonas(
          Object.fromEntries(msg.payload.sessions.map((s) => [s.id, s.personaId])),
        )
      }
      // persona_list 由 personaSync（陪伴区）挂载时拉取，此处只消费响应不重复发请求
      if (msg.type === 'persona_list_response') {
        setPersonaNames(
          Object.fromEntries(msg.payload.personas.map((p) => [p.id, p.name])),
        )
      }
    })
  }, [transport])

  // sessionCount 变化时重算（新会话出现 → 重新拉取绑定清单）
  const sessionIdsKey = useMemo(
    () => useSessionStore.getState().sessionIds.join(','),
    [sessionCount],
  )
  useEffect(() => {
    if (!sessionIdsKey) return
    transport.send({ v: 1, type: 'session_list_request', traceId: SESSION_LIST_TRACE, ts: Date.now(), payload: {} })
  }, [transport, sessionIdsKey])

  const boundPersonaId = currentSessionId ? sessionPersonas[currentSessionId] : undefined
  const boundPersonaLabel = boundPersonaId ? (personaNames[boundPersonaId] ?? boundPersonaId) : undefined

  // 陪伴区 persona 数据（Phase 4）：挂载拉 persona_list，按 init.personaId 灌 companion store
  usePersonaCompanionConfig(transport, personaId)

  // 未选定会话时自动落到最近活动的会话（digest 时间最大者）。
  useEffect(() => {
    if (useSessionStore.getState().currentSessionId) return
    const { sessionIds } = useSessionStore.getState()
    if (sessionIds.length === 0) return
    const digests = useDigestStore.getState().digests
    let best = sessionIds[0]
    let bestTs = -1
    for (const id of sessionIds) {
      const ts = digests[id]?.lastActivityAt ?? 0
      if (ts >= bestTs) {
        best = id
        bestTs = ts
      }
    }
    useSessionStore.getState().setCurrentSession(best)
  }, [currentSessionId, sessionCount])

  // 进入会话：清零未读角标 + 拉取最近历史（每会话只拉一次）。
  const historyRequestedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!currentSessionId) return
    useDigestStore.getState().markSessionRead(currentSessionId)
    if (!historyRequestedRef.current.has(currentSessionId)) {
      historyRequestedRef.current.add(currentSessionId)
      sendHistoryRequest(transport, currentSessionId)
    }
  }, [currentSessionId, transport])

  // 新消息/流式输出时滚到底部。
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, stream?.streamText, stream?.toolCalls.length])

  const hasSessions = sessionCount > 0

  return (
    <div className="flex h-full flex-row bg-[var(--dn-bg)] text-[var(--dn-fg)]">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ChatHeader
          title={title}
          sessionId={currentSessionId}
          isStreaming={stream?.isStreaming ?? false}
          waitingOption={waitingOption}
          transport={transport}
          {...(boundAdapterId ? { adapterId: boundAdapterId } : {})}
          {...(boundPersonaLabel ? { personaLabel: boundPersonaLabel } : {})}
        />
        {currentSessionId && <TodoPanel sessionId={currentSessionId} />}
        <SystemNoticeBar notices={globalNotices} />

        {hasSessions ? (
          <>
            <div
              ref={scrollRef}
              className="dn-scroll flex-1 overflow-y-auto px-3 py-3"
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
                <MessageList messages={messages} />
                {stream && <ToolCallList toolCalls={stream.toolCalls} />}
                {stream && <StreamingView stream={stream} />}
                {stream?.optionGroup && currentSessionId && (
                  <OptionGroup
                    sessionId={currentSessionId}
                    group={stream.optionGroup}
                    transport={transport}
                  />
                )}
              </div>
            </div>
            <ChatInput sessionId={currentSessionId} transport={transport} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-[var(--dn-muted)]">
              还没有会话。新建一个，就可以让 AI 助手帮你读代码、改
              bug、跑命令了。
            </p>
            <button
              type="button"
              data-testid="new-session-button"
              onClick={() => sendNewSession(transport)}
              className="rounded-[var(--dn-radius-md)] bg-[var(--dn-button-bg)] px-4 py-2 text-sm text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)]"
            >
              开始新会话
            </button>
          </div>
        )}
      </div>

      {/* Live2D 陪伴区（ux §2.1：editor panel = 聊天流 + 陪伴区；陪伴跨会话常驻，
          空会话态同样展示） */}
      <aside className="hidden w-64 shrink-0 border-l border-[var(--dn-border)] sm:block lg:w-72">
        <CompanionArea />
      </aside>
    </div>
  )
}
