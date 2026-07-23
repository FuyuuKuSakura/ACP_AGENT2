/**
 * persona/todo-tracker.ts — 从结构化 tool_call/tool_result 事件提取 todo
 *（architecture.md §5.4；行为基线 extract/persona.md §5）。
 *
 * 相对 v2 的关键变化（extract/persona.md §7 缺陷 12）：输入是适配器层的
 * 结构化 AgentEvent，**不再用 emoji 正则扫流式文本**。推断规则沿用 v2：
 * - `status` 事件：4 个固定状态（thinking/reading_file/executing/outputting）
 *   各映射一个 todo 项；新状态出现时把固定顺序中排在它之前的项标记完成，
 *   再追加新项（按 id 去重）；
 * - `tool_call`：新增「调用 <tool>」项（id 取原生 toolCallId，天然配对）；
 * - `tool_result`：按 toolCallId 配对标记完成；无配对时按 FIFO 标记最近一个
 *   未闭合的工具项（对齐 protocol §4.1 的配对策略）；
 * - `complete`：全部标记完成。
 *
 * 仅当列表实际变化时 onEvent 返回全量快照（todo_update 是非增量消息），
 * 否则返回 null。digest.todoProgress 的数据源为 {@link TodoTracker.progress}。
 */
import type { TodoItem } from '@dionysus/protocol'

import type { AgentEvent } from '../adapters/types.js'

export interface TodoProgress {
  done: number
  total: number
}

/** 固定 4 状态 → todo 项（顺序即「排在它之前」的判定依据，沿用 v2） */
const STATUS_TODOS: ReadonlyArray<{ status: string; id: string; text: string }> = [
  { status: 'thinking', id: 'status:think', text: '思考方案' },
  { status: 'reading_file', id: 'status:read', text: '读取文件' },
  { status: 'executing', id: 'status:exec', text: '执行操作' },
  { status: 'outputting', id: 'status:output', text: '输出结果' },
]

const TOOL_ITEM_PREFIX = 'tool:'

export class TodoTracker {
  private items: TodoItem[] = []
  /** 上次已外发快照的序列化形式（变化检测） */
  private lastEmittedKey = ''

  /**
   * 消费一个结构化事件；列表实际变化时返回全量快照（新数组，可安全外发），
   * 无变化返回 null。
   */
  onEvent(ev: AgentEvent): TodoItem[] | null {
    switch (ev.type) {
      case 'status':
        this.onStatus(ev.status)
        break
      case 'tool_call':
        this.onToolCall(ev.toolCallId, ev.name)
        break
      case 'tool_result':
        this.onToolResult(ev.toolCallId)
        break
      case 'complete':
        this.onComplete()
        break
      default:
        return null
    }
    return this.snapshotIfChanged()
  }

  /** digest.todoProgress 的数据源（「7 步做到第 3 步」口径）。 */
  progress(): TodoProgress {
    return {
      done: this.items.filter((item) => item.done).length,
      total: this.items.length,
    }
  }

  /** 当前全量列表的拷贝（回合末终态快照落盘用，无论是否变化）。 */
  currentItems(): TodoItem[] {
    return this.items.map((item) => ({ ...item }))
  }

  private onStatus(status: string): void {
    const index = STATUS_TODOS.findIndex((s) => s.status === status)
    if (index === -1) return
    const entry = STATUS_TODOS[index]
    // 固定顺序中排在它之前的状态项标记完成
    const earlierIds = new Set(STATUS_TODOS.slice(0, index).map((s) => s.id))
    for (const item of this.items) {
      if (earlierIds.has(item.id)) item.done = true
    }
    // 追加新项（按 id 去重）
    if (!this.items.some((item) => item.id === entry.id)) {
      this.items.push({ id: entry.id, text: entry.text, done: false })
    }
  }

  private onToolCall(toolCallId: string, name: string): void {
    const id = TOOL_ITEM_PREFIX + toolCallId
    if (this.items.some((item) => item.id === id)) return
    this.items.push({ id, text: `调用 ${name}`, done: false })
  }

  private onToolResult(toolCallId: string): void {
    const direct = this.items.find(
      (item) => item.id === TOOL_ITEM_PREFIX + toolCallId && !item.done,
    )
    if (direct) {
      direct.done = true
      return
    }
    // 无原生 id 配对时按 FIFO 配对最近一个未闭合工具项（protocol §4.1 同策略）
    const fallback = this.items.find(
      (item) => item.id.startsWith(TOOL_ITEM_PREFIX) && !item.done,
    )
    if (fallback) fallback.done = true
  }

  private onComplete(): void {
    for (const item of this.items) item.done = true
  }

  private snapshotIfChanged(): TodoItem[] | null {
    const key = JSON.stringify(this.items)
    if (key === this.lastEmittedKey) return null
    this.lastEmittedKey = key
    return this.currentItems()
  }
}
