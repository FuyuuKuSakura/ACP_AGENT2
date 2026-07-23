/**
 * TodoPanel — 会话任务清单进度面板（ux-core-flows.md §2.2/§3 操作显示规范）。
 *
 * 数据源：streamStore.todoItems（core TodoTracker 从 tool_call/tool_result/status
 * 推断后由 todo_update 全量快照下发，dispatch 路由进 store；finalizeTurn 不清空，
 * 故回合结束后面板保留终态——全部打勾，或标注失败步）。
 * 折叠摘要与 digest.todoProgress 同源同口径（done/total 均来自同一 todoItems），
 * 格式对齐会话列表一行摘要「3/7 · 正在…」。
 *
 * 状态推导（协议 TodoItem 仅 {id, text, done}，UI 侧补全四态，不改协议）：
 * - 失败：工具项（id 为 `tool:<toolCallId>`）配对的 toolCall result.ok === false
 *   ——TodoTracker 收到 tool_result 一律标 done，失败态须由 toolCalls 结果反查；
 * - 已完成：done === true（且非失败）；
 * - 进行中：流式进行中第一个未完成项（呼吸高亮）；
 * - 待办：其余未完成项。
 *
 * 设计说明（对照 docs/v3/design-principles.md Williams 四原则）：
 * - 亲密性：面板紧贴会话标题栏下方（进度是标题的附属信息）；清单项内
 *   「序号 + 状态图标 + 标题」gap-1.5 成组，与相邻项 space-y-1 拉开，距离即分组；
 * - 对比：进行中项独享 dn-breathe 呼吸动效 + accent 色（颜色与动效双重对比，
 *   同 sidebar running 状态点手法）；失败项 error 红、完成项 success 绿、
 *   待办 muted 灰，四态色板与列表状态点/工具卡同源（--dn-* token）；
 * - 重复：状态图标复用全局 Icon 体系（done/error/running），呼吸动画复用
 *   index.css 的 .dn-breathe，折叠 chevron 旋转手法与 ToolCallCard 一致；
 * - 对齐：序号、图标、文本基线对齐成一行，与操作时间线（StatusScreen）同款版式。
 */
import { useState } from 'react'

import { selectStreamState, useStreamStore } from '@dionysus/client-core'
import type { TodoItem } from '@dionysus/protocol'

import { Icon, type IconName } from '../Icon.js'

/** 清单项四态（见文件头「状态推导」）。 */
type TodoStatus = 'pending' | 'active' | 'done' | 'failed'

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '待办',
  active: '进行中',
  done: '已完成',
  failed: '失败',
}

const STATUS_ICON: Record<TodoStatus, IconName> = {
  pending: 'checkbox',
  active: 'running',
  done: 'done',
  failed: 'error',
}

const STATUS_COLOR: Record<TodoStatus, string> = {
  pending: 'text-[var(--dn-muted)]',
  active: 'text-[var(--dn-accent)]',
  done: 'text-[var(--dn-success)]',
  failed: 'text-[var(--dn-error)]',
}

const TOOL_ITEM_PREFIX = 'tool:'

export interface TodoPanelProps {
  sessionId: string
}

export function TodoPanel({ sessionId }: TodoPanelProps) {
  const stream = useStreamStore((s) => selectStreamState(s, sessionId))
  const [expanded, setExpanded] = useState(false)

  const todos = stream?.todoItems ?? []
  // 空态：无 todo 数据（老会话/无工具回合）不渲染，不占空间
  if (todos.length === 0) return null

  const toolCalls = stream?.toolCalls ?? []
  const isStreaming = stream?.isStreaming ?? false

  /** 工具 todo 项配对失败结果反查（TodoTracker 不区分 ok=false）。 */
  const isFailedTool = (item: TodoItem): boolean =>
    item.id.startsWith(TOOL_ITEM_PREFIX) &&
    toolCalls.some(
      (t) => t.toolCallId === item.id.slice(TOOL_ITEM_PREFIX.length) && t.result?.ok === false,
    )

  // 进行中 = 流式进行中第一个未完成且未失败的项
  const activeId = isStreaming
    ? (todos.find((item) => !item.done && !isFailedTool(item))?.id ?? null)
    : null

  const statusOf = (item: TodoItem): TodoStatus => {
    if (isFailedTool(item)) return 'failed'
    if (item.done) return 'done'
    if (item.id === activeId) return 'active'
    return 'pending'
  }

  const doneCount = todos.filter((t) => t.done).length
  const failedCount = todos.filter(isFailedTool).length
  const activeItem = activeId ? todos.find((t) => t.id === activeId) : undefined

  // 折叠摘要：与 digest 一行摘要同源同口径（§2.2「3/7 · 正在改 auth.ts」）
  let summary = `${doneCount}/${todos.length} 步已完成`
  if (activeItem) summary += ` · 正在：${activeItem.text}`
  else if (failedCount > 0) summary += ` · ${failedCount} 步失败`

  return (
    <section
      data-testid="todo-panel"
      data-expanded={expanded}
      className="border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-1.5"
    >
      <button
        type="button"
        data-testid="todo-panel-toggle"
        aria-expanded={expanded}
        aria-label={expanded ? '折叠任务清单' : '展开任务清单'}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-[var(--dn-muted)] hover:text-[var(--dn-fg)]"
      >
        <span
          aria-hidden
          className="inline-flex shrink-0 transition-transform"
          style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
        >
          <Icon name="chevron-down" size={12} />
        </span>
        <span data-testid="todo-panel-summary" className="min-w-0 flex-1 truncate">
          {summary}
        </span>
      </button>

      {expanded && (
        <ol data-testid="todo-panel-list" className="mt-1.5 space-y-1 pb-0.5">
          {todos.map((item, i) => {
            const status = statusOf(item)
            return (
              <li
                key={item.id}
                data-testid={`todo-item-${i}`}
                data-status={status}
                className="flex items-center gap-1.5 text-sm"
              >
                <span className="w-5 flex-none text-right text-xs text-[var(--dn-muted)]">
                  {i + 1}.
                </span>
                <span
                  className={`inline-flex flex-none ${STATUS_COLOR[status]} ${
                    status === 'active' ? 'dn-breathe' : ''
                  }`}
                >
                  <Icon name={STATUS_ICON[status]} size={13} title={STATUS_LABEL[status]} />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    status === 'done'
                      ? 'text-[var(--dn-muted)] line-through'
                      : status === 'failed'
                        ? 'text-[var(--dn-error)]'
                        : status === 'active'
                          ? 'text-[var(--dn-fg)]'
                          : 'text-[var(--dn-muted)]'
                  }`}
                >
                  {item.text}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
