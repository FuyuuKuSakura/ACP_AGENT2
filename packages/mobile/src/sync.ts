/**
 * sync 补拉（architecture.md §8 / §9.3 断连追赶时序）。
 *
 * 重连握手后：每个本地已关注的会话发 sync_request { sessionId, afterSeq }，
 * afterSeq = 本地已见 seq 游标。游标取 sessionStore.lastSeq 与
 * digestStore 该会话 seq 的较大者（两者都只在收到服务端事件时推进，
 * digest 游标覆盖「仅状态跃迁、无消息事件」的会话）。
 *
 * 时序关键：handshake 会把 sessionStore.lastSeq 推进到服务端 latestSeq，
 * 因此游标必须在 dispatch handshake **之前**捕获——makeMessagePipeline
 * 在 handshake 分支先 capture 再 dispatch 再发 sync_request。
 */
import {
  useDigestStore,
  useSessionStore,
  type ClientTransport,
} from '@dionysus/client-core'

export interface SyncCursor {
  sessionId: string
  afterSeq: number
}

/** 捕获本地已见游标（handshake dispatch 之前调用）。 */
export function captureSyncCursors(): SyncCursor[] {
  const sessions = useSessionStore.getState().sessions
  const digests = useDigestStore.getState().digests
  const cursors: SyncCursor[] = []
  for (const sessionId of Object.keys(sessions)) {
    const afterSeq = Math.max(
      sessions[sessionId].lastSeq,
      digests[sessionId]?.seq ?? 0,
    )
    if (afterSeq > 0) cursors.push({ sessionId, afterSeq })
  }
  return cursors
}

/**
 * 发 sync_request。只补握手快照里仍存在、且本地游标落后于服务端
 * latestSeq 的会话（afterSeq 已最新则跳过，省一轮空回放）。
 */
export function sendSyncRequests(
  transport: ClientTransport,
  cursors: SyncCursor[],
  latestSeqs: Record<string, number>,
): void {
  for (const { sessionId, afterSeq } of cursors) {
    const latest = latestSeqs[sessionId]
    if (latest === undefined || afterSeq >= latest) continue
    transport.send({
      v: 1,
      type: 'sync_request',
      ts: Date.now(),
      payload: { sessionId, afterSeq },
    })
  }
}
