/**
 * 操作 chip 折叠计数条（architecture.md §8 操作时间线的小屏形态）：
 * 每次 tool_call 一行 chip（Icon 图标 + 动词 + 目标），默认折叠为计数条
 * （「本回合已执行 N 项操作」），点开展开明细；失败标红、进行中 Loader。
 * KIND_VERB/KIND_ICON 导出供 StatusScreen 操作时间线复用（两端口径一致，
 * 不直接渲染工具原名，ux-core-flows.md §3.1）。
 */
import { useState } from 'react'

import type { ToolCallEntry } from '@dionysus/client-core'
import type { ToolKind } from '@dionysus/protocol'

import { Icon, type IconName } from './Icon.js'

export const KIND_ICON: Record<ToolKind, IconName> = {
  read: 'tool-read',
  edit: 'tool-edit',
  bash: 'tool-bash',
  search: 'tool-search',
  other: 'tool-other',
}

export const KIND_VERB: Record<ToolKind, string> = {
  read: '读',
  edit: '改',
  bash: '跑',
  search: '搜',
  other: '用',
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs === undefined) return null
  return durationMs < 1000
    ? `${Math.round(durationMs)}ms`
    : `${(durationMs / 1000).toFixed(1)}s`
}

function ToolChip({ entry }: { entry: ToolCallEntry }) {
  const failed = entry.result && !entry.result.ok
  const running = !entry.result
  return (
    <div
      data-testid={`tool-chip-${entry.toolCallId}`}
      data-status={running ? 'running' : failed ? 'error' : 'ok'}
      className={`flex items-center gap-1.5 rounded-[var(--dn-radius-sm)] border px-2.5 py-1 text-xs ${
        failed
          ? 'border-[var(--dn-error)] text-[var(--dn-error)]'
          : 'border-[var(--dn-border)] bg-[var(--dn-panel-bg)] text-[var(--dn-fg)]'
      }`}
    >
      <Icon name={KIND_ICON[entry.kind] ?? KIND_ICON.other} size={13} />
      <span className="min-w-0 truncate">
        {KIND_VERB[entry.kind] ?? KIND_VERB.other}{' '}
        <span className="text-[var(--dn-accent)]">
          {entry.displayTarget || entry.name}
        </span>
      </span>
      {running && <span className="dn-loader" aria-label="执行中" />}
      {failed && <Icon name="close" size={12} title="失败" />}
      {entry.result?.durationMs !== undefined && (
        <span className="flex-none text-[var(--dn-muted)]">
          {formatDuration(entry.result.durationMs)}
        </span>
      )}
    </div>
  )
}

export interface ToolCallChipsProps {
  toolCalls: ToolCallEntry[]
  /** 当前回合 turnId（chip 计数条按「本回合」口径过滤） */
  currentTurnId?: string
}

export function ToolCallChips({ toolCalls, currentTurnId }: ToolCallChipsProps) {
  const [expanded, setExpanded] = useState(false)
  // 「本回合」口径：有 turnId 时只统计该回合；无 turnId 信息时全量
  const inTurn = currentTurnId
    ? toolCalls.filter((t) => t.turnId === currentTurnId || t.turnId === undefined)
    : toolCalls
  if (inTurn.length === 0) return null
  const runningCount = inTurn.reduce((n, t) => (t.result ? n : n + 1), 0)

  return (
    <div data-testid="tool-call-chips" className="px-4 py-1.5">
      <button
        type="button"
        data-testid="tool-chip-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[var(--dn-radius-md)] bg-[var(--dn-button-secondary-bg)] px-3 py-1.5 text-xs text-[var(--dn-button-secondary-fg)]"
      >
        <Icon name="settings" size={13} />
        <span className="min-w-0 flex-1 truncate text-left">
          本回合已执行 {inTurn.length} 项操作
          {runningCount > 0 ? `（${runningCount} 进行中）` : ''}
        </span>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} />
      </button>
      {expanded && (
        <div data-testid="tool-chip-detail" className="mt-1.5 flex flex-col gap-1">
          {inTurn.map((entry) => (
            <ToolChip key={entry.toolCallId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
