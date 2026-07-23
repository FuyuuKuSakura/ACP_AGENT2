/**
 * ResumeSessionMenu — 聊天视图会话设置区的「恢复历史会话」入口。
 *
 * 数据流：点击按钮发 cli_session_list_request（traceId 关联）→ core 委托
 * 策略侧索引能力（kimi：~/.kimi-code/session_index.jsonl）按该会话工作目录
 * 过滤返回 → 选中某条发 /resume <id>（client_command，沿用斜杠命令通道）。
 * 助手无会话索引能力（supported=false）时标注「该助手暂不支持」。
 */
import { useEffect, useState } from 'react'

import type { ClientTransport } from '@dionysus/client-core'
import type { CliSessionIndexEntry } from '@dionysus/protocol'

import { Icon } from '../Icon.js'
import { formatRelativeTime } from '../sidebar/format.js'
import { sendChatText } from './chatActions.js'

/** cli_session_list_request 的 traceId（响应经它关联；含 sessionId 防串会话）。 */
function traceFor(sessionId: string): string {
  return `chat:cli-session-list:${sessionId}`
}

export interface ResumeSessionMenuProps {
  sessionId: string
  transport: ClientTransport
}

export function ResumeSessionMenu({ sessionId, transport }: ResumeSessionMenuProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    supported: boolean
    sessions: CliSessionIndexEntry[]
  } | null>(null)

  useEffect(() => {
    const trace = traceFor(sessionId)
    transport.onMessage((msg) => {
      if (msg.type === 'cli_session_list_response' && msg.traceId === trace) {
        setLoading(false)
        setResult({ supported: msg.payload.supported, sessions: msg.payload.sessions })
      }
    })
  }, [sessionId, transport])

  const handleOpen = () => {
    setOpen((v) => !v)
    if (open) return
    setLoading(true)
    setResult(null)
    transport.send({
      v: 1,
      type: 'cli_session_list_request',
      traceId: traceFor(sessionId),
      ts: Date.now(),
      payload: { sessionId },
    })
  }

  const handleResume = (cliSessionId: string) => {
    sendChatText(transport, sessionId, `/resume ${cliSessionId}`)
    setOpen(false)
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        data-testid="resume-history-button"
        title="恢复该工作目录下的 CLI 历史会话"
        aria-expanded={open}
        onClick={handleOpen}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--dn-border)] px-2 py-0.5 text-xs text-[var(--dn-muted)] hover:bg-[var(--dn-button-secondary-bg)]"
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={10} />
        恢复历史会话
      </button>
      {open ? (
        <div
          data-testid="resume-history-panel"
          className="absolute right-0 top-full z-10 mt-1 flex max-h-64 w-72 flex-col overflow-y-auto rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] p-1.5 shadow-lg"
        >
          {loading ? (
            <p className="px-2 py-2 text-xs text-[var(--dn-muted)]">查询中…</p>
          ) : !result ? null : !result.supported ? (
            <p data-testid="resume-history-unsupported" className="px-2 py-2 text-xs text-[var(--dn-muted)]">
              该助手暂不支持
            </p>
          ) : result.sessions.length === 0 ? (
            <p data-testid="resume-history-empty" className="px-2 py-2 text-xs text-[var(--dn-muted)]">
              该工作目录下没有历史会话
            </p>
          ) : (
            result.sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                data-testid={`resume-item-${s.id}`}
                title={`${s.workDir}\n/resume ${s.id}`}
                onClick={() => handleResume(s.id)}
                className="flex w-full flex-col rounded-[var(--dn-radius-sm)] px-2 py-1.5 text-left hover:bg-[var(--dn-list-hover-bg)]"
              >
                <span className="truncate text-xs text-[var(--dn-fg)]">{s.title ?? s.id}</span>
                <span className="truncate text-[10px] text-[var(--dn-muted)]">
                  {s.title ? `${s.id} · ` : ''}
                  {s.updatedAt ? formatRelativeTime(s.updatedAt, Date.now()) : s.workDir}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
