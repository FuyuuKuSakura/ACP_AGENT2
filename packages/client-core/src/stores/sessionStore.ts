/**
 * sessionStore — 会话 + 消息（architecture.md §7 按域拆 store）。
 *
 * 单真源约束：当前会话消息一律经 selector 从 sessions[currentSessionId]
 * 派生，**不做镜像字段**（v2 chatStore 的 messages 镜像缺陷不复现）。
 */
import { create } from 'zustand'

import type {
  Artifact,
  Attachment,
  MessageLine,
  SessionMeta,
} from '@dionysus/protocol'

/** 聊天流中的一条消息（agent_stream 回合收尾时由 streamStore 提交为 agent 行）。 */
export interface ChatMessage {
  id: string
  role: MessageLine['role']
  text: string
  attachments?: Attachment[]
  artifacts?: Artifact[]
  /** 多端回显来源（user_message_echo.origin，UI 标注「来自手机」） */
  origin?: string
  /** Unix 毫秒 */
  ts: number
}

export interface SessionState {
  id: string
  title: string
  messages: ChatMessage[]
  /** 本地已见的最大 envelope.seq（sync_request 的 afterSeq 游标） */
  lastSeq: number
  /** history_response 分页游标 */
  historyHasMore: boolean
}

export interface SessionStoreState {
  sessions: Record<string, SessionState>
  /** 插入序即创建序；digestStore 的排序规则负责展示序 */
  sessionIds: string[]
  currentSessionId: string | null
  /** 本客户端已发出 new_session、等待 digest 带回新会话自动切入 */
  expectingNewSession: boolean
  /** 无 sessionId 的 system_notice 落点（如 maxConcurrentAgents 超限提示） */
  globalNotices: { text: string; level: 'info' | 'warning' | 'error'; ts: number }[]

  ensureSession(sessionId: string, title?: string): void
  upsertSessionMetas(metas: SessionMeta[]): void
  /** handshake 快照：{sessionId,title,status,latestSeq} → 会话条目 + lastSeq 游标 */
  applyHandshakeSessions(
    sessions: { sessionId: string; title: string; latestSeq: number }[],
  ): void
  setCurrentSession(sessionId: string | null): void
  /** 本客户端发出 new_session 后调用：下一个新出现的会话自动切入（见 ensureSession） */
  expectNewSession(): void
  appendMessage(sessionId: string, msg: ChatMessage): void
  prependHistory(sessionId: string, lines: MessageLine[], hasMore: boolean): void
  /** 推进本地已见 seq 游标（在线事件与 sync_response.latestSeq 共用） */
  advanceSeq(sessionId: string, seq: number): void
  addGlobalNotice(text: string, level: 'info' | 'warning' | 'error', ts: number): void
  setTitle(sessionId: string, title: string): void
  reset(): void
}

const EMPTY_MESSAGES: ChatMessage[] = []

let msgCounter = 0
/** 生成客户端本地消息 id（单调，避免同毫秒碰撞）。 */
export function nextMessageId(): string {
  msgCounter += 1
  return `c${Date.now().toString(36)}-${msgCounter}`
}

function newSession(id: string, title = ''): SessionState {
  return { id, title, messages: [], lastSeq: 0, historyHasMore: false }
}

const initialState = {
  sessions: {} as Record<string, SessionState>,
  sessionIds: [] as string[],
  currentSessionId: null as string | null,
  expectingNewSession: false,
  globalNotices: [] as { text: string; level: 'info' | 'warning' | 'error'; ts: number }[],
}

export const useSessionStore = create<SessionStoreState>()((set) => ({
  ...initialState,

  ensureSession(sessionId, title) {
    set((s) => {
      if (s.sessions[sessionId]) return s
      // 本客户端刚发过 new_session：digest 广播带回的新会话直接切入（修复「新建会话后聊天面板停在旧会话」）。
      const switchToNew = s.expectingNewSession
      return {
        sessions: { ...s.sessions, [sessionId]: newSession(sessionId, title) },
        sessionIds: [...s.sessionIds, sessionId],
        expectingNewSession: false,
        ...(switchToNew ? { currentSessionId: sessionId } : {}),
      }
    })
  },

  upsertSessionMetas(metas) {
    set((s) => {
      const sessions = { ...s.sessions }
      const sessionIds = [...s.sessionIds]
      for (const m of metas) {
        const existing = sessions[m.id]
        if (existing) {
          sessions[m.id] = { ...existing, title: m.title }
        } else {
          sessions[m.id] = newSession(m.id, m.title)
          sessionIds.push(m.id)
        }
      }
      return { sessions, sessionIds }
    })
  },

  applyHandshakeSessions(sessions) {
    set((s) => {
      const next = { ...s.sessions }
      const sessionIds = [...s.sessionIds]
      for (const h of sessions) {
        const existing = next[h.sessionId]
        if (existing) {
          next[h.sessionId] = {
            ...existing,
            title: h.title || existing.title,
            lastSeq: Math.max(existing.lastSeq, h.latestSeq),
          }
        } else {
          next[h.sessionId] = { ...newSession(h.sessionId, h.title), lastSeq: h.latestSeq }
          sessionIds.push(h.sessionId)
        }
      }
      return { sessions: next, sessionIds }
    })
  },

  setCurrentSession(sessionId) {
    set({ currentSessionId: sessionId })
  },

  expectNewSession() {
    set({ expectingNewSession: true })
  },

  appendMessage(sessionId, msg) {
    set((s) => {
      const session = s.sessions[sessionId] ?? newSession(sessionId)
      const sessionIds = s.sessions[sessionId] ? s.sessionIds : [...s.sessionIds, sessionId]
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...session, messages: [...session.messages, msg] },
        },
        sessionIds,
      }
    })
  },

  prependHistory(sessionId, lines, hasMore) {
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      const known = new Set(session.messages.map((m) => m.id))
      const older: ChatMessage[] = []
      for (const line of lines) {
        if (known.has(line.id)) continue
        older.push({
          id: line.id,
          role: line.role,
          text: line.text,
          attachments: line.attachments,
          artifacts: line.artifacts,
          ts: line.ts,
        })
      }
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...session,
            messages: [...older, ...session.messages],
            historyHasMore: hasMore,
          },
        },
      }
    })
  },

  advanceSeq(sessionId, seq) {
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session || seq <= session.lastSeq) return s
      return {
        sessions: { ...s.sessions, [sessionId]: { ...session, lastSeq: seq } },
      }
    })
  },

  addGlobalNotice(text, level, ts) {
    set((s) => ({ globalNotices: [...s.globalNotices, { text, level, ts }] }))
  },

  setTitle(sessionId, title) {
    set((s) => {
      const session = s.sessions[sessionId]
      if (!session) return s
      return { sessions: { ...s.sessions, [sessionId]: { ...session, title } } }
    })
  },

  reset() {
    set({ ...initialState, sessions: {}, sessionIds: [], globalNotices: [] })
  },
}))

// ---------------------------------------------------------------------------
// Selectors（纯函数；React 侧列表类 selector 配合 useShallow 使用）
// ---------------------------------------------------------------------------

/**
 * 当前会话消息——从 sessions[currentSessionId] 派生的唯一入口。
 * 无镜像字段；未选中/会话不存在时返回共享空数组（引用稳定）。
 */
export function selectCurrentMessages(s: Pick<SessionStoreState, 'sessions' | 'currentSessionId'>): ChatMessage[] {
  if (!s.currentSessionId) return EMPTY_MESSAGES
  return s.sessions[s.currentSessionId]?.messages ?? EMPTY_MESSAGES
}

export function selectSession(
  s: Pick<SessionStoreState, 'sessions'>,
  sessionId: string,
): SessionState | undefined {
  return s.sessions[sessionId]
}
