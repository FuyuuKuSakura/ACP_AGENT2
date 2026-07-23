/**
 * streamStore — 流式状态 / 工具调用 / 选项组，全部按 sessionId 隔离
 * （architecture.md §7 按域拆 store；多会话并行互不干扰）。
 *
 * tool_call / tool_result 配对折叠：tool_result 按 toolCallId 配对既有条目、
 * 结果直接挂到该条目上（「调用 → 结果」单卡，ux-core-flows.md §3）；
 * toolCallId 无匹配时按协议语义 FIFO 配对最近一个未闭合 tool_call。
 */
import { create } from 'zustand'

import type {
  AgentStatus,
  OptionItem,
  OptionRequestPayload,
  TodoItem,
  ToolCallPayload,
  ToolResultPayload,
} from '@dionysus/protocol'

/** 一张工具卡片（result 到达后即折叠为「调用 → 结果」单卡）。 */
export interface ToolCallEntry {
  toolCallId: string
  name: string
  kind: ToolCallPayload['kind']
  args: Record<string, unknown>
  displayTarget: string
  turnId?: string
  result?: {
    ok: boolean
    summary: string
    durationMs?: number
  }
}

/** 选项组状态；resolved 存在即已决态（option_resolved 竞态解决）。 */
export interface OptionGroupState {
  requestTraceId?: string
  question: string
  options: OptionItem[]
  uiType: OptionRequestPayload['uiType']
  timeoutSeconds: number
  resolved?: { selectedId: string; origin: string }
}

export interface SessionStreamState {
  isStreaming: boolean
  streamingStatus: { status: AgentStatus; detail: string; progress?: number } | null
  /** 当前回合已累积的正文（finalizeTurn 时提交进 sessionStore） */
  streamText: string
  /** 当前回合已累积的 thinking 文本 */
  thinkingText: string
  toolCalls: ToolCallEntry[]
  optionGroup: OptionGroupState | null
  todoItems: TodoItem[]
  /** 最近一个已完成回合的 turnId（agent_complete 幂等去重，v2 双 complete 回归防线） */
  lastFinalizedTurnId?: string
}

export interface FinalizeResult {
  /** false 表示该 turnId 已收尾过，本次为重复的 agent_complete（忽略） */
  applied: boolean
  text: string
  thinking: string
}

export interface StreamStoreState {
  bySession: Record<string, SessionStreamState>

  appendStream(
    sessionId: string,
    chunk: string,
    opts: { isThinking: boolean; status: AgentStatus },
  ): void
  setStatus(
    sessionId: string,
    status: AgentStatus,
    detail: string,
    progress?: number,
  ): void
  addToolCall(sessionId: string, payload: ToolCallPayload, turnId?: string): void
  resolveToolCall(sessionId: string, result: ToolResultPayload): void
  showOptions(sessionId: string, group: OptionGroupState): void
  resolveOptions(sessionId: string, requestTraceId: string, selectedId: string, origin: string): void
  setTodoItems(sessionId: string, items: TodoItem[]): void
  /** 回合收尾：重置流式态并返回待提交文本；同 turnId 重复调用幂等忽略。 */
  finalizeTurn(sessionId: string, turnId?: string): FinalizeResult
  reset(): void
}

function newStreamState(): SessionStreamState {
  return {
    isStreaming: false,
    streamingStatus: null,
    streamText: '',
    thinkingText: '',
    toolCalls: [],
    optionGroup: null,
    todoItems: [],
  }
}

export const useStreamStore = create<StreamStoreState>()((set, get) => {
  /** 读取/初始化指定会话的流式状态。 */
  function patch(sessionId: string, fn: (st: SessionStreamState) => Partial<SessionStreamState>) {
    set((s) => {
      const st = s.bySession[sessionId] ?? newStreamState()
      return { bySession: { ...s.bySession, [sessionId]: { ...st, ...fn(st) } } }
    })
  }

  return {
    bySession: {},

    appendStream(sessionId, chunk, opts) {
      patch(sessionId, (st) => ({
        isStreaming: true,
        streamText: opts.isThinking ? st.streamText : st.streamText + chunk,
        thinkingText: opts.isThinking ? st.thinkingText + chunk : st.thinkingText,
      }))
    },

    setStatus(sessionId, status, detail, progress) {
      patch(sessionId, () => ({ streamingStatus: { status, detail, progress } }))
    },

    addToolCall(sessionId, payload, turnId) {
      patch(sessionId, (st) => ({
        toolCalls: [
          ...st.toolCalls,
          {
            toolCallId: payload.toolCallId,
            name: payload.name,
            kind: payload.kind,
            args: payload.args,
            displayTarget: payload.displayTarget,
            turnId,
          },
        ],
      }))
    },

    resolveToolCall(sessionId, result) {
      patch(sessionId, (st) => {
        // 优先按 toolCallId 精确配对；无匹配按协议语义 FIFO 配对最近一个未闭合条目。
        let idx = st.toolCalls.findIndex((t) => t.toolCallId === result.toolCallId && !t.result)
        if (idx < 0) {
          for (let i = st.toolCalls.length - 1; i >= 0; i--) {
            if (!st.toolCalls[i].result) {
              idx = i
              break
            }
          }
        }
        if (idx < 0) return st // 无未闭合条目（如 sync 快照外的迟到结果），忽略
        const toolCalls = st.toolCalls.slice()
        toolCalls[idx] = {
          ...toolCalls[idx],
          result: { ok: result.ok, summary: result.summary, durationMs: result.durationMs },
        }
        return { toolCalls }
      })
    },

    showOptions(sessionId, group) {
      patch(sessionId, () => ({ optionGroup: group }))
    },

    resolveOptions(sessionId, requestTraceId, selectedId, origin) {
      patch(sessionId, (st) => {
        const g = st.optionGroup
        if (!g || g.resolved) return st // 重复 option_selected 幂等忽略（§5.3）
        // requestTraceId 双方都有时须匹配；任一缺失则按「当前唯一未决组」处理。
        if (g.requestTraceId && requestTraceId && g.requestTraceId !== requestTraceId) return st
        return { optionGroup: { ...g, resolved: { selectedId, origin } } }
      })
    },

    setTodoItems(sessionId, items) {
      patch(sessionId, () => ({ todoItems: items }))
    },

    finalizeTurn(sessionId, turnId) {
      const st = get().bySession[sessionId] ?? newStreamState()
      if (turnId && st.lastFinalizedTurnId === turnId) {
        return { applied: false, text: '', thinking: '' }
      }
      const result: FinalizeResult = {
        applied: true,
        text: st.streamText,
        thinking: st.thinkingText,
      }
      patch(sessionId, () => ({
        isStreaming: false,
        streamingStatus: null,
        streamText: '',
        thinkingText: '',
        // 回合结束清除待决选项（§5.3：收到 option_selected 或回合结束清除）
        optionGroup: null,
        lastFinalizedTurnId: turnId ?? st.lastFinalizedTurnId,
      }))
      return result
    },

    reset() {
      set({ bySession: {} })
    },
  }
})

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectStreamState(
  s: Pick<StreamStoreState, 'bySession'>,
  sessionId: string,
): SessionStreamState | undefined {
  return s.bySession[sessionId]
}

/** 未闭合（进行中）的工具调用数。 */
export function selectOpenToolCallCount(
  s: Pick<StreamStoreState, 'bySession'>,
  sessionId: string,
): number {
  const st = s.bySession[sessionId]
  if (!st) return 0
  return st.toolCalls.reduce((n, t) => (t.result ? n : n + 1), 0)
}
