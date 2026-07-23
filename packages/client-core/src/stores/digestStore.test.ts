/**
 * digestStore 关键行为：未读计算与 markSessionRead、排序规则（ux-core-flows.md §2.4）。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { SessionDigestUpdatePayload } from '@dionysus/protocol'

import {
  selectPendingBadgeCount,
  selectSortedDigests,
  selectStatusBarAggregate,
  selectUnreadCount,
  useDigestStore,
} from './digestStore.js'

function digest(partial: Partial<SessionDigestUpdatePayload> & { sessionId: string }): SessionDigestUpdatePayload {
  return {
    title: partial.sessionId,
    status: 'idle',
    pendingOptionRequest: false,
    lastActivityAt: 100,
    seq: 1,
    ...partial,
  }
}

describe('digestStore 未读与已读游标', () => {
  beforeEach(() => {
    useDigestStore.getState().reset()
  })

  it('未读数 = seq - readSeq；markSessionRead(sessionId, seq) 推进游标', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 's1', seq: 5 }))
    expect(selectUnreadCount(useDigestStore.getState().digests.s1)).toBe(5)

    s.markSessionRead('s1', 3)
    expect(selectUnreadCount(useDigestStore.getState().digests.s1)).toBe(2)

    s.markSessionRead('s1') // 缺省读到最新
    expect(selectUnreadCount(useDigestStore.getState().digests.s1)).toBe(0)
  })

  it('已读游标单调：更小的 seq 不回退；新 digest 到达后继续累计', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 's1', seq: 10 }))
    s.markSessionRead('s1', 10)
    s.markSessionRead('s1', 4) // 回退请求被忽略
    expect(useDigestStore.getState().digests.s1.readSeq).toBe(10)

    s.upsertDigest(digest({ sessionId: 's1', seq: 12 }))
    expect(selectUnreadCount(useDigestStore.getState().digests.s1)).toBe(2)
  })

  it('markSessionRead 的 seq 不得超过 digest.seq', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 's1', seq: 3 }))
    s.markSessionRead('s1', 99)
    expect(useDigestStore.getState().digests.s1.readSeq).toBe(3)
  })

  it('personaId 透传；后续 digest 缺省时保留既有值', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 's1', personaId: 'kalt_sit' }))
    expect(useDigestStore.getState().digests.s1.personaId).toBe('kalt_sit')

    s.upsertDigest(digest({ sessionId: 's1', seq: 2 }))
    expect(useDigestStore.getState().digests.s1.personaId).toBe('kalt_sit')
  })

  it('applyHandshakeSnapshot：新条目缺省容忍，已有条目保留富字段且 readSeq 不回退', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 's1', seq: 10, currentAction: '正在读 a.ts', personaId: 'p1' }))
    s.markSessionRead('s1', 10)

    s.applyHandshakeSnapshot([
      { sessionId: 's1', title: 'A', status: 'idle', latestSeq: 8 },
      { sessionId: 's2', title: 'B', status: 'running', latestSeq: 4 },
    ])

    const d1 = useDigestStore.getState().digests.s1
    expect(d1.readSeq).toBe(10) // 不回退
    expect(d1.seq).toBe(10) // seq 单调
    expect(d1.currentAction).toBe('正在读 a.ts') // 富字段保留
    expect(d1.personaId).toBe('p1')
    expect(d1.status).toBe('idle') // 快照状态生效

    const d2 = useDigestStore.getState().digests.s2
    expect(d2).toMatchObject({
      title: 'B',
      status: 'running',
      seq: 4,
      readSeq: 0,
      pendingOptionRequest: false,
      lastActivityAt: 0,
    })
  })
})

describe('digestStore 排序规则', () => {
  beforeEach(() => {
    useDigestStore.getState().reset()
  })

  it('waiting_option 置顶 → error → running → idle（含 done），组内 lastActivityAt 倒序', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 'idle-old', status: 'idle', lastActivityAt: 10 }))
    s.upsertDigest(digest({ sessionId: 'running-b', status: 'running', lastActivityAt: 50 }))
    s.upsertDigest(digest({ sessionId: 'done-new', status: 'done', lastActivityAt: 90 }))
    s.upsertDigest(digest({ sessionId: 'error-1', status: 'error', lastActivityAt: 5 }))
    s.upsertDigest(digest({ sessionId: 'waiting-1', status: 'waiting_option', pendingOptionRequest: true, lastActivityAt: 1 }))
    s.upsertDigest(digest({ sessionId: 'running-a', status: 'running', lastActivityAt: 60 }))
    s.upsertDigest(digest({ sessionId: 'idle-new', status: 'idle', lastActivityAt: 80 }))

    const sorted = selectSortedDigests(useDigestStore.getState())
    expect(sorted.map((d) => d.sessionId)).toEqual([
      'waiting-1', // 组 0
      'error-1', // 组 1
      'running-a', // 组 2，lastActivityAt 60 > 50
      'running-b',
      'done-new', // 组 3：done 与 idle 同组，90 > 80 > 10
      'idle-new',
      'idle-old',
    ])
  })

  it('新建会话（idle 且 lastActivityAt 最新）置顶 idle 组首位', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 'old', status: 'idle', lastActivityAt: 10 }))
    s.upsertDigest(digest({ sessionId: 'fresh', status: 'idle', lastActivityAt: 999 }))
    expect(selectSortedDigests(useDigestStore.getState())[0].sessionId).toBe('fresh')
  })

  it('badge 与 StatusBar 聚合计数', () => {
    const s = useDigestStore.getState()
    s.upsertDigest(digest({ sessionId: 'w', status: 'waiting_option', pendingOptionRequest: true }))
    s.upsertDigest(digest({ sessionId: 'e', status: 'error' }))
    s.upsertDigest(digest({ sessionId: 'u', status: 'idle', seq: 3 })) // 3 条未读
    s.upsertDigest(digest({ sessionId: 'r1', status: 'running' }))
    s.upsertDigest(digest({ sessionId: 'r2', status: 'running' }))
    s.markSessionRead('u')
    s.markSessionRead('r1') // 正在观看的 running 会话无未读
    s.markSessionRead('r2')

    const state = useDigestStore.getState()
    expect(selectPendingBadgeCount(state)).toBe(2) // waiting + error；u 已读后不计
    expect(selectStatusBarAggregate(state)).toEqual({ running: 2, waitingOption: 1 })
  })
})
