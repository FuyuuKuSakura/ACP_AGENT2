/**
 * ToolCallList / ToolCallCard — agent 操作卡片（ux-core-flows.md §3）。
 *
 * 三级信息层级：
 * - L1 自然语言动作（kind + displayTarget 模板，不渲染工具原名）；
 * - L2 行内状态（进行中旋转 Loader / 成功 done 图标 / 失败 error 图标标红）+ 耗时；
 * - L3 默认折叠详情（原始 args JSON + 结果摘要）。
 * tool_call / tool_result 的配对折叠由 client-core streamStore 完成
 * （result 直接挂到条目上），此处一张条目渲染为单卡。
 * kind 四类视觉区分（§3.2）：edit 主色描边最显著，bash 等宽命令行，
 * read/search/other 中性弱化。
 */
import { useState } from 'react'

import type { ToolCallEntry } from '@dionysus/client-core'
import type { ToolKind } from '@dionysus/protocol'

import { Icon, type IconName } from '../Icon.js'

const KIND_ICON: Record<ToolKind, IconName> = {
  read: 'tool-read',
  edit: 'tool-edit',
  bash: 'tool-bash',
  search: 'tool-search',
  other: 'tool-other',
}

/** kind → L1 自然语言模板（进行时 / 完成时）。 */
const KIND_PHRASE: Record<ToolKind, { doing: string; done: string }> = {
  read: { doing: '正在读取文件', done: '已读取文件' },
  edit: { doing: '正在修改', done: '已修改' },
  bash: { doing: '正在运行', done: '已运行' },
  search: { doing: '正在搜索', done: '已搜索' },
  other: { doing: '正在使用工具', done: '已使用工具' },
}

/** kind → 卡片描边 token（edit 最显著，read/search/other 中性弱化）。 */
const KIND_BORDER: Record<ToolKind, string> = {
  read: 'border-[var(--dn-border)]',
  edit: 'border-[var(--dn-accent)]',
  bash: 'border-[var(--dn-attention)]',
  search: 'border-[var(--dn-border)]',
  other: 'border-[var(--dn-border)]',
}

/**
 * kind → 左侧 2px 引导线（endfield 几何点缀，minimal 深度；仅几何元素，
 * 色彩仍走 --dn-* token 即 var(--vscode-*)，ADR-20 不破）。与描边同色，
 * inset shadow 实现以贴合卡片圆角。
 */
const KIND_GUIDE: Record<ToolKind, string> = {
  read: 'shadow-[inset_2px_0_0_var(--dn-border)]',
  edit: 'shadow-[inset_2px_0_0_var(--dn-accent)]',
  bash: 'shadow-[inset_2px_0_0_var(--dn-attention)]',
  search: 'shadow-[inset_2px_0_0_var(--dn-border)]',
  other: 'shadow-[inset_2px_0_0_var(--dn-border)]',
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs === undefined) return null
  return durationMs < 1000
    ? `${Math.round(durationMs)}ms`
    : `${(durationMs / 1000).toFixed(1)}s`
}

export function ToolCallCard({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const status = entry.result ? (entry.result.ok ? 'ok' : 'error') : 'running'
  const phrase = KIND_PHRASE[entry.kind] ?? KIND_PHRASE.other
  const target = entry.displayTarget || entry.name
  const duration = formatDuration(entry.result?.durationMs)

  return (
    <div
      data-testid="tool-call-card"
      data-kind={entry.kind}
      data-status={status}
      className={`rounded-[var(--dn-radius-md)] border bg-[var(--dn-panel-bg)] px-3 py-2 text-sm ${
        KIND_BORDER[entry.kind] ?? KIND_BORDER.other
      } ${
        status === 'error'
          ? 'border-[var(--dn-error)] shadow-[inset_2px_0_0_var(--dn-error)]'
          : (KIND_GUIDE[entry.kind] ?? KIND_GUIDE.other)
      }`}
    >
      {/* L1 + L2：动作描述 + 状态/耗时 */}
      <div className="flex items-center gap-2">
        <span aria-hidden className="shrink-0 text-[var(--dn-muted)]">
          <Icon name={KIND_ICON[entry.kind] ?? KIND_ICON.other} size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[var(--dn-fg)]">
          {status === 'running' ? phrase.doing : phrase.done}{' '}
          <code
            className={
              entry.kind === 'bash'
                ? 'font-mono text-[var(--dn-accent)]'
                : 'text-[var(--dn-accent)]'
            }
          >
            {target}
          </code>
        </span>
        {status === 'running' && (
          <span className="dn-loader" aria-label="执行中" />
        )}
        {status === 'ok' && (
          <span
            className="inline-flex text-[var(--dn-success)]"
            aria-label="成功"
          >
            <Icon name="done" size={14} />
          </span>
        )}
        {status === 'error' && (
          <span
            className="inline-flex text-[var(--dn-error)]"
            aria-label="失败"
          >
            <Icon name="error" size={14} />
          </span>
        )}
        {duration && (
          <span className="shrink-0 text-xs text-[var(--dn-muted)]">
            {duration}
          </span>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? '折叠详情' : '展开详情'}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 text-[var(--dn-muted)] transition-transform hover:text-[var(--dn-fg)]"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
        >
          <Icon name="chevron-down" size={12} />
        </button>
      </div>

      {/* L3：默认折叠的原始参数与结果摘要 */}
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-[var(--dn-border)] pt-2">
          <div>
            <p className="mb-1 text-xs text-[var(--dn-muted)]">参数</p>
            <pre className="max-h-40 overflow-auto rounded-[var(--dn-radius-sm)] bg-[var(--dn-code-bg)] p-2 text-xs">
              {JSON.stringify(entry.args, null, 2)}
            </pre>
          </div>
          {entry.result && (
            <div>
              <p className="mb-1 text-xs text-[var(--dn-muted)]">结果</p>
              <pre
                className={`max-h-40 overflow-auto whitespace-pre-wrap rounded-[var(--dn-radius-sm)] bg-[var(--dn-code-bg)] p-2 text-xs ${
                  status === 'error' ? 'text-[var(--dn-error)]' : ''
                }`}
              >
                {entry.result.summary || '（无输出）'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 操作条带：渲染在相邻气泡之间（左对齐、宽度窄于气泡、无头像，§3.3）。
 * 回合内聚合（计数条）留待后续；当前形态为按时序排列的卡片列，
 * 进行中的卡片 Loader 常显。
 */
export function ToolCallList({ toolCalls }: { toolCalls: ToolCallEntry[] }) {
  if (toolCalls.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5" data-testid="tool-call-list">
      {toolCalls.map((entry) => (
        <ToolCallCard key={entry.toolCallId} entry={entry} />
      ))}
    </div>
  )
}
