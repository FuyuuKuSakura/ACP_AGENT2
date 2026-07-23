/**
 * sync 补拉测试（P0 门禁）：游标捕获（sessionStore.lastSeq 与 digestStore
 * seq 取大）、落后才发 sync_request、pipeline 在 handshake dispatch 之前
 * 捕获游标（否则 handshake 把 lastSeq 推到最新，补拉变空）。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  useDigestStore,
  useSessionStore,
  type ClientTransport,
} from '@dionysus/client-core'
import type {
  ClientMessage,
  HandshakeMessage,
  ServerMessage,
} from '@dionysus/protocol'

import { makeMessagePipeline } from './pipeline.js'
import { captureSyncCursors, sendSyncRequests } from './sync.js'

function collectTransport(): ClientTransport & { sent: ClientMessage[] } {
  const sent: ClientMessage[] = []
  return {
    sent,
    send(msg) {
      sent.push(msg)
    },
    onMessage() {},
  }
}

function digestPayload(sessionId: string, seq: number) {
  return {
    sessionId,
    title: sessionId,
    status: 'running' as const,
    pendingOptionRequest: false,
    lastActivityAt: 1,
    seq,
  }
}

beforeEach(() => {
  useSessionStore.getState().reset()
  useDigestStore.getState().reset()
})

describe('captureSyncCursors', () => {
  it('游标 = sessionStore.lastSeq 与 digestStore seq 的较大者；0 游标跳过', () => {
    useSessionStore.getState().ensureSession('s1')
    useSessionStore.getState().advanceSeq('s1', 5)
    useDigestStore.getState().upsertDigest(digestPayload('s1', 7))
    useSessionStore.getState().ensureSession('s2') // 无事件，游标 0
    expect(captureSyncCursors()).toEqual([{ sessionId: 's1', afterSeq: 7 }])
  })
})

describe('sendSyncRequests', () => {
  it('只补握手快照里仍存在且落后的会话', () => {
    const t = collectTransport()
    sendSyncRequests(
      t,
      [
        { sessionId: 's1', afterSeq: 5 },
        { sessionId: 's2', afterSeq: 9 },
        { sessionId: 'gone', afterSeq: 3 },
      ],
      { s1: 9, s2: 9 },
    )
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({
      type: 'sync_request',
      payload: { sessionId: 's1', afterSeq: 5 },
    })
  })
})

describe('pipeline：handshake 前捕获游标', () => {
  it('重连 handshake 后按旧游标发 sync_request（dispatch 推进 lastSeq 不影响）', () => {
    // 断连前已见 seq 5
    useSessionStore.getState().ensureSession('s1')
    useSessionStore.getState().advanceSeq('s1', 5)

    const t = collectTransport()
    const pipeline = makeMessagePipeline(t, 'DEV-T')
    const handshake: HandshakeMessage = {
      v: 1,
      type: 'handshake',
      ts: Date.now(),
      payload: {
        v: 1,
        clientId: 'c1',
        sessions: [{ sessionId: 's1', title: 'S1', status: 'running', latestSeq: 9 }],
      },
    }
    pipeline(handshake as ServerMessage)

    // handshake dispatch 后 lastSeq 被推进到 9，但 sync_request 用的是旧游标 5
    expect(useSessionStore.getState().sessions.s1.lastSeq).toBe(9)
    const sync = t.sent.filter((m) => m.type === 'sync_request')
    expect(sync).toHaveLength(1)
    expect(sync[0]).toMatchObject({ payload: { sessionId: 's1', afterSeq: 5 } })
  })

  it('首连（本地无游标）不发 sync_request', () => {
    const t = collectTransport()
    const pipeline = makeMessagePipeline(t, 'DEV-T')
    pipeline({
      v: 1,
      type: 'handshake',
      ts: Date.now(),
      payload: {
        v: 1,
        clientId: 'c1',
        sessions: [{ sessionId: 's1', title: 'S1', status: 'idle', latestSeq: 3 }],
      },
    } as ServerMessage)
    expect(t.sent.filter((m) => m.type === 'sync_request')).toHaveLength(0)
  })
})
