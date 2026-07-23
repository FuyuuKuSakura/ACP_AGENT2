/**
 * companionStore（最小版，Phase 4 补全情绪联动等）——角色旁白行列表。
 *
 * 硬约束（ux-core-flows.md §4.1）：companion_message 一律进本 store、
 * 不进会话消息流；scope='global' 的 fleet 级汇报同样落在这里，跨会话
 * 切换不消失。emotion_update 只更新当前情绪，不产生旁白行。
 */
import { create } from 'zustand'

export interface CompanionLine {
  id: string
  text: string
  scope: 'session' | 'global'
  emotion?: string
  /** 来源会话标注（气泡角标「来自：重构 auth」，点击跳转） */
  sourceSessionId?: string
  sourceTitle?: string
  ts: number
}

/** 旁白历史上限（超出进历史展开的语义 Phase 4 补，这里先截断防无限增长） */
export const COMPANION_LINE_CAP = 100

export interface EmotionState {
  emotion: string
  expression?: string
  motion?: string
}

export interface CompanionStoreState {
  lines: CompanionLine[]
  currentEmotion: EmotionState | null

  addLine(line: Omit<CompanionLine, 'id'>): void
  setEmotion(emotion: EmotionState): void
  reset(): void
}

let lineCounter = 0

export const useCompanionStore = create<CompanionStoreState>()((set) => ({
  lines: [],
  currentEmotion: null,

  addLine(line) {
    lineCounter += 1
    set((s) => ({
      lines: [...s.lines, { ...line, id: `cl-${line.ts}-${lineCounter}` }].slice(
        -COMPANION_LINE_CAP,
      ),
    }))
  },

  setEmotion(emotion) {
    set({ currentEmotion: emotion })
  },

  reset() {
    set({ lines: [], currentEmotion: null })
  },
}))
