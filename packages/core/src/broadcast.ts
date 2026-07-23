/**
 * BroadcastHub：多客户端广播 + per-session seq + 环形事件缓冲
 *（architecture.md §5.3 / ADR-11；零 vscode / HTTP / WS 依赖）。
 *
 * - 广播为全局扇出：会话事件发向全部已连接客户端，客户端按
 *   envelope.sessionId 自行过滤（per-client 订阅过滤留到 Phase 5 实测后再评估）；
 * - 客户端断开只注销自己，绝不触碰适配器进程（hub 根本不持有适配器引用，
 *   适配器生命周期只跟随会话显式关闭或宿主 deactivate）；
 * - 扇出前为每条会话消息赋 per-session 单调递增 seq（断连补拉游标）；
 *   session_digest_update 的 payload.seq 与 envelope.seq 同值（快照自包含）；
 * - 每个活跃会话维护内存环形事件缓冲（默认 500 条）；sync_request 按
 *   afterSeq 回放，溢出时先发会话快照（digest）再从缓冲头部续播；
 * - 断连超阈值（落后超阈值或断连 >60s）向该客户端单播「归来摘要」，
 *   内置模板拼装、零 LLM 依赖（模板格式见 §5.3 示例）。
 */
import type {
  CompanionMessageMessage,
  ServerMessage,
  SessionDigestUpdateMessage,
  SyncRequestPayload,
  SyncResponseMessage,
} from '@dionysus/protocol'

/** 宿主传输层注入的发送函数（ws.send / webview.postMessage 的薄封装）。 */
export type ClientSendFn = (msg: ServerMessage) => void

export interface BroadcastHubOptions {
  /** 每会话环形事件缓冲容量，默认 500（覆盖一顿饭时长的离席） */
  bufferCapacity?: number
  /** 归来摘要触发阈值：落后 seq 数超过该值即单播摘要，默认 50 */
  returnSummaryLagThreshold?: number
  /** 断连时长阈值（毫秒），超过同样触发归来摘要，默认 60_000 */
  returnSummaryDisconnectMs?: number
  /**
   * 归来摘要的口吻改写挂钩（Phase 4 陪伴层接线）：内置模板拼装完成后、
   * 单播前过一遍 persona rewriter（architecture.md §5.4 改写范围含归来摘要）。
   * 公开接口不变的可选扩展；缺省原样下发。
   */
  returnSummaryRewriter?: (text: string) => string
}

/** 单个会话的补拉统计（归来摘要的数据来源）。 */
interface SessionSummaryStats {
  completedTurns: number
  failedTurns: number
  toolCalls: number
  waitingOption: boolean
  errored: boolean
}

const DEFAULT_BUFFER_CAPACITY = 500
const DEFAULT_LAG_THRESHOLD = 50
const DEFAULT_DISCONNECT_MS = 60_000

export class BroadcastHub {
  private readonly bufferCapacity: number
  private readonly lagThreshold: number
  private readonly disconnectMs: number
  private readonly returnSummaryRewriter?: (text: string) => string

  private readonly clients = new Map<string, ClientSendFn>()
  private readonly seqBySession = new Map<string, number>()
  private readonly buffers = new Map<string, ServerMessage[]>()
  private readonly latestDigest = new Map<string, SessionDigestUpdateMessage>()

  constructor(options: BroadcastHubOptions = {}) {
    this.bufferCapacity = options.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY
    this.lagThreshold = options.returnSummaryLagThreshold ?? DEFAULT_LAG_THRESHOLD
    this.disconnectMs = options.returnSummaryDisconnectMs ?? DEFAULT_DISCONNECT_MS
    this.returnSummaryRewriter = options.returnSummaryRewriter
  }

  /** 注册客户端；重复注册同 clientId 视为重连，替换发送函数。 */
  registerClient(clientId: string, send: ClientSendFn): void {
    this.clients.set(clientId, send)
  }

  /**
   * 注销客户端（断开/发送失败/75s 无帧）。只从广播表移除该 clientId，
   * 不影响其他任何客户端，更不触碰适配器进程（v2 多标签断连误杀共享
   * CLI 进程的缺陷不重现）。
   */
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId)
  }

  get clientCount(): number {
    return this.clients.size
  }

  hasClient(clientId: string): boolean {
    return this.clients.has(clientId)
  }

  /** 该会话当前已分配的最大 seq（handshake 的 latestSeq 数据源）。 */
  latestSeq(sessionId: string): number {
    return this.seqBySession.get(sessionId) ?? 0
  }

  /**
   * 全局扇出。会话消息（带 sessionId）先赋 seq、写入环形缓冲，再发往全部
   * 客户端；send 抛错即注销该 clientId 并记 warning，单点失败隔离。
   */
  broadcast(msg: ServerMessage): void {
    if (msg.sessionId) {
      const seq = this.latestSeq(msg.sessionId) + 1
      this.seqBySession.set(msg.sessionId, seq)
      msg.seq = seq
      if (msg.type === 'session_digest_update') {
        // payload.seq 与 envelope.seq 同值（digest 快照自包含，protocol §4.1）
        msg.payload.seq = seq
        this.latestDigest.set(msg.sessionId, msg)
      }
      this.pushToBuffer(msg.sessionId, msg)
    }
    for (const [clientId, send] of [...this.clients]) {
      try {
        send(msg)
      } catch (err) {
        console.warn(`[BroadcastHub] send to ${clientId} failed, unregister: ${(err as Error).message}`)
        this.clients.delete(clientId)
      }
    }
  }

  /** 只向单个客户端发送（sync_response / 归来摘要等单播）。 */
  unicast(clientId: string, msg: ServerMessage): void {
    const send = this.clients.get(clientId)
    if (!send) return
    try {
      send(msg)
    } catch (err) {
      console.warn(`[BroadcastHub] unicast to ${clientId} failed, unregister: ${(err as Error).message}`)
      this.clients.delete(clientId)
    }
  }

  private pushToBuffer(sessionId: string, msg: ServerMessage): void {
    let buf = this.buffers.get(sessionId)
    if (!buf) {
      buf = []
      this.buffers.set(sessionId, buf)
    }
    buf.push(msg)
    if (buf.length > this.bufferCapacity) {
      buf.splice(0, buf.length - this.bufferCapacity)
    }
  }

  /**
   * 处理 sync_request（ADR-11）：按 afterSeq 从环形缓冲回放；
   * afterSeq 已溢出缓冲时 truncated=true，events 以一条会话快照
   * （当前 session_digest_update）开头，其后从缓冲头部续播。
   */
  handleSyncRequest(clientId: string, req: SyncRequestPayload): void {
    const { sessionId, afterSeq } = req
    const buf = this.buffers.get(sessionId) ?? []
    const latestSeq = this.latestSeq(sessionId)
    const firstBufferedSeq = buf.length ? (buf[0].seq ?? 0) : latestSeq + 1
    const truncated = latestSeq > afterSeq && firstBufferedSeq > afterSeq + 1

    const events: ServerMessage[] = []
    if (truncated) {
      events.push(this.buildSnapshot(sessionId))
    }
    for (const msg of buf) {
      if ((msg.seq ?? 0) > afterSeq) events.push(msg)
    }

    const response: SyncResponseMessage = {
      v: 1,
      type: 'sync_response',
      sessionId,
      ts: Date.now(),
      payload: { sessionId, events, latestSeq, truncated },
    }
    this.unicast(clientId, response)
  }

  /** 缓冲溢出时的会话快照：以最近一次 digest 为底，seq 取当前 latestSeq。 */
  private buildSnapshot(sessionId: string): SessionDigestUpdateMessage {
    const latest = this.latestDigest.get(sessionId)
    if (latest) {
      return {
        ...latest,
        seq: this.latestSeq(sessionId),
        payload: { ...latest.payload, seq: this.latestSeq(sessionId) },
      }
    }
    // 无 digest（会话尚无状态跃迁）时合成最小快照
    const seq = this.latestSeq(sessionId)
    return {
      v: 1,
      type: 'session_digest_update',
      sessionId,
      seq,
      ts: Date.now(),
      payload: {
        sessionId,
        title: sessionId,
        status: 'idle',
        todoProgress: { done: 0, total: 0 },
        pendingOptionRequest: false,
        lastActivityAt: Date.now(),
        seq,
      },
    }
  }

  /**
   * 归来摘要（architecture.md §5.3）：重连客户端任一关注会话落后超阈值
   * （或断连 >60s）时，用内置模板向该客户端单播一条 companion_message，
   * 零 LLM 依赖。返回是否发送了摘要。
   *
   * 模板示例（§5.3）：「你离开期间：会话 A 完成 1 回合（成功）、调用工具
   * 14 次；会话 B 在等待你确认选项」。
   */
  maybeSendReturnSummary(
    clientId: string,
    cursors: { sessionId: string; afterSeq: number }[],
    opts: { disconnectedMs?: number } = {},
  ): boolean {
    const lagging = cursors.some((c) => this.latestSeq(c.sessionId) - c.afterSeq > this.lagThreshold)
    const longGone = (opts.disconnectedMs ?? 0) > this.disconnectMs
    if (!lagging && !longGone) return false

    const clauses: string[] = []
    for (const { sessionId, afterSeq } of cursors) {
      const stats = this.collectStats(sessionId, afterSeq)
      const title = this.latestDigest.get(sessionId)?.payload.title ?? sessionId
      const parts: string[] = []
      if (stats.completedTurns > 0) parts.push(`完成 ${stats.completedTurns} 回合（成功）`)
      if (stats.failedTurns > 0) parts.push(`${stats.failedTurns} 回合出错`)
      if (stats.toolCalls > 0) parts.push(`调用工具 ${stats.toolCalls} 次`)
      if (stats.waitingOption) parts.push('在等待你确认选项')
      if (stats.errored && stats.failedTurns === 0) parts.push('出现错误')
      if (parts.length > 0) clauses.push(`会话 ${title} ${parts.join('、')}`)
    }

    const assembled =
      clauses.length > 0 ? `你离开期间：${clauses.join('；')}` : '你离开期间：各会话没有新的进展。'
    // 陪伴层接线：归来摘要过 persona rewriter（缺省原样）
    const text = this.returnSummaryRewriter ? this.returnSummaryRewriter(assembled) : assembled
    const msg: CompanionMessageMessage = {
      v: 1,
      type: 'companion_message',
      ts: Date.now(),
      payload: { text, scope: 'global' },
    }
    this.unicast(clientId, msg)
    return true
  }

  /** 统计 afterSeq 之后缓冲内的回合/工具事件，并结合最新 digest 判定待决策态。 */
  private collectStats(sessionId: string, afterSeq: number): SessionSummaryStats {
    const stats: SessionSummaryStats = {
      completedTurns: 0,
      failedTurns: 0,
      toolCalls: 0,
      waitingOption: false,
      errored: false,
    }
    for (const msg of this.buffers.get(sessionId) ?? []) {
      if ((msg.seq ?? 0) <= afterSeq) continue
      if (msg.type === 'agent_complete') {
        if (msg.payload.status === 'success') stats.completedTurns += 1
        else if (msg.payload.status === 'error') stats.failedTurns += 1
      } else if (msg.type === 'tool_call') {
        stats.toolCalls += 1
      }
    }
    const digest = this.latestDigest.get(sessionId)
    if (digest) {
      stats.waitingOption = digest.payload.pendingOptionRequest
      stats.errored = digest.payload.status === 'error'
    }
    return stats
  }
}
