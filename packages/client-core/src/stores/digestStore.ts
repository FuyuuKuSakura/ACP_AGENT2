/**
 * digestStore — QQ 式会话列表数据源（architecture.md §6.6 / ux-core-flows.md §2）。
 *
 * 状态数据一律来自 core 广播的 session_digest_update，客户端不自行从原始
 * 事件流推断状态；未读角标 = digest.seq 与本地已读游标的差值。
 *
 * 排序规则（ux-core-flows.md §2.4）：waiting_option 置顶 → error → running →
 * idle（含 done）→ 组内按 lastActivityAt 倒序。
 */
import { create } from 'zustand'

import type {
  SessionDigestUpdatePayload,
  SessionStatus,
} from '@dionysus/protocol'

export interface DigestEntry {
  sessionId: string
  title: string
  status: SessionStatus
  currentAction?: string
  todoProgress?: { done: number; total: number }
  /** 会话绑定的适配器（列表项 adapter 徽标数据源，protocol 可选字段） */
  adapterId?: string
  /** 会话工作目录（列表项 title 属性数据源，protocol 可选字段） */
  workingDir?: string
  /** 会话绑定的 persona id（列表项头像数据源，protocol 可选字段） */
  personaId?: string
  pendingOptionRequest: boolean
  lastActivityAt: number
  /** 服务端 per-session 单调序号（未读计算基准） */
  seq: number
  /** 客户端已读游标（markSessionRead 推进） */
  readSeq: number
}

export interface DigestStoreState {
  digests: Record<string, DigestEntry>

  upsertDigest(payload: SessionDigestUpdatePayload): void
  /**
   * handshake 全量会话快照 upsert（sidebar/移动端列表都是 digest 驱动，
   * 快照不进来则 webview 重载/手机刷新后列表清空）。快照缺 digest 富字段，
   * 缺省容忍：lastActivityAt=0（组内排尾）、pendingOptionRequest=false；
   * 已有条目保留富字段，seq 单调、readSeq 不回退，等 session_digest_update 补全。
   */
  applyHandshakeSnapshot(
    sessions: readonly { sessionId: string; title: string; status: SessionStatus; latestSeq: number }[],
  ): void
  /** 已读游标推进（进入会话时调用）；缺省读到该会话最新 seq。 */
  markSessionRead(sessionId: string, seq?: number): void
  removeDigest(sessionId: string): void
  reset(): void
}

export const useDigestStore = create<DigestStoreState>()((set) => ({
  digests: {},

  upsertDigest(payload) {
    set((s) => {
      const existing = s.digests[payload.sessionId]
      const entry: DigestEntry = {
        sessionId: payload.sessionId,
        title: payload.title,
        status: payload.status,
        currentAction: payload.currentAction,
        todoProgress: payload.todoProgress,
        adapterId: payload.adapterId,
        workingDir: payload.workingDir,
        // personaId 透传；缺省（旧版 core）时保留既有值不清空
        personaId: payload.personaId ?? existing?.personaId,
        pendingOptionRequest: payload.pendingOptionRequest,
        lastActivityAt: payload.lastActivityAt,
        seq: payload.seq,
        // 已读游标单调：digest 快照回放的旧 seq 不回退游标
        readSeq: Math.min(existing?.readSeq ?? 0, payload.seq),
      }
      return { digests: { ...s.digests, [payload.sessionId]: entry } }
    })
  },

  applyHandshakeSnapshot(sessions) {
    set((s) => {
      const digests = { ...s.digests }
      for (const h of sessions) {
        const existing = digests[h.sessionId]
        if (existing) {
          // 在线 digest 已先到：保留富字段（currentAction/todoProgress/personaId 等），
          // 只补标题与状态；seq 单调、readSeq 不回退
          digests[h.sessionId] = {
            ...existing,
            title: h.title || existing.title,
            status: h.status,
            seq: Math.max(existing.seq, h.latestSeq),
          }
        } else {
          digests[h.sessionId] = {
            sessionId: h.sessionId,
            title: h.title,
            status: h.status,
            pendingOptionRequest: false,
            lastActivityAt: 0,
            seq: h.latestSeq,
            readSeq: 0,
          }
        }
      }
      return { digests }
    })
  },

  markSessionRead(sessionId, seq) {
    set((s) => {
      const entry = s.digests[sessionId]
      if (!entry) return s
      const target = Math.min(seq ?? entry.seq, entry.seq)
      if (target <= entry.readSeq) return s
      return {
        digests: { ...s.digests, [sessionId]: { ...entry, readSeq: target } },
      }
    })
  },

  removeDigest(sessionId) {
    set((s) => {
      if (!s.digests[sessionId]) return s
      const digests = { ...s.digests }
      delete digests[sessionId]
      return { digests }
    })
  },

  reset() {
    set({ digests: {} })
  },
}))

// ---------------------------------------------------------------------------
// Selectors（纯函数）
// ---------------------------------------------------------------------------

/** 状态分组优先级：waiting_option → error → running → idle（含 done，§2.4）。 */
export function statusRank(status: SessionStatus): number {
  switch (status) {
    case 'waiting_option':
      return 0
    case 'error':
      return 1
    case 'running':
      return 2
    case 'idle':
    case 'done':
      return 3
  }
}

/** 未读数 = digest.seq 与已读游标差值（进入会话 markSessionRead 后清零）。 */
export function selectUnreadCount(
  entry: Pick<DigestEntry, 'seq' | 'readSeq'>,
): number {
  return Math.max(0, entry.seq - entry.readSeq)
}

/**
 * 列表排序：状态组优先级升序，组内 lastActivityAt 倒序
 * （新建会话 lastActivityAt 最新，自然置顶 idle 组首位）。
 */
export function selectSortedDigests(
  s: Pick<DigestStoreState, 'digests'>,
): DigestEntry[] {
  return Object.values(s.digests).sort((a, b) => {
    const r = statusRank(a.status) - statusRank(b.status)
    if (r !== 0) return r
    return b.lastActivityAt - a.lastActivityAt
  })
}

/** 活动栏 badge 口径（ux-core-flows.md §2.1）：待决策 + 出错 + 有未读的会话数。 */
export function selectPendingBadgeCount(
  s: Pick<DigestStoreState, 'digests'>,
): number {
  let n = 0
  for (const d of Object.values(s.digests)) {
    if (
      d.pendingOptionRequest ||
      d.status === 'error' ||
      selectUnreadCount(d) > 0
    )
      n += 1
  }
  return n
}

/** StatusBar 聚合口径（§6.6）：「N 运行中 / M 待决策」（图标由展示层负责）。 */
export function selectStatusBarAggregate(
  s: Pick<DigestStoreState, 'digests'>,
): {
  running: number
  waitingOption: number
} {
  let running = 0
  let waitingOption = 0
  for (const d of Object.values(s.digests)) {
    if (d.status === 'running') running += 1
    if (d.status === 'waiting_option' || d.pendingOptionRequest)
      waitingOption += 1
  }
  return { running, waitingOption }
}
