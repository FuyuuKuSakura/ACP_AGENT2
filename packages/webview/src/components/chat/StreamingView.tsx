/**
 * StreamingView — 当前回合的流式输出区。
 *
 * - streamText 实时追加渲染为 agent 气泡（markdown）；
 * - thinking 区域默认折叠（「思考过程」+ 呼吸动画，展开查看原文）；
 * - status_update 状态行（「正在读 auth.ts」）显示在气泡下方。
 */
import { useState } from 'react'

import type { SessionStreamState } from '@dionysus/client-core'

import { Icon } from '../Icon.js'
import { Markdown } from './Markdown.js'

function ThinkingSection({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-1.5 text-xs">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="dn-breathe flex w-full items-center gap-1.5 text-left text-[var(--dn-muted)]"
      >
        <span
          className="inline-flex transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        >
          <Icon name="chevron-right" size={12} />
        </span>
        思考过程
      </button>
      {expanded && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[var(--dn-muted)]">
          {text}
        </p>
      )}
    </div>
  )
}

export function StreamingView({ stream }: { stream: SessionStreamState }) {
  if (!stream.isStreaming && !stream.streamText && !stream.thinkingText)
    return null
  return (
    <div className="flex flex-col gap-1.5" data-testid="streaming-view">
      {stream.thinkingText && <ThinkingSection text={stream.thinkingText} />}
      {stream.streamText && (
        <div className="flex justify-start">
          <div
            data-testid="streaming-text"
            className="max-w-[85%] rounded-[var(--dn-radius-lg)] rounded-tl-sm border border-[var(--dn-border)] bg-[var(--dn-agent-bubble-bg)] px-3.5 py-2"
          >
            <Markdown text={stream.streamText} />
          </div>
        </div>
      )}
      {stream.streamingStatus && (
        <p
          data-testid="streaming-status"
          className="dn-breathe px-1 text-xs text-[var(--dn-muted)]"
        >
          {stream.streamingStatus.detail || stream.streamingStatus.status}
        </p>
      )}
    </div>
  )
}
