/**
 * dispatch — 把 messageRouter 的路由动作应用到各 store。
 *
 * messageRouter 保持纯函数；这里是唯一的副作用汇聚点，webview / mobile
 * 在 transport.onMessage 里 `dispatchRouteActions(routeServerMessage(msg))` 即可。
 */
import type { RouteAction } from './messageRouter.js'
import { useCompanionStore } from './stores/companionStore.js'
import { useDigestStore } from './stores/digestStore.js'
import { nextMessageId, useSessionStore } from './stores/sessionStore.js'
import { useStreamStore } from './stores/streamStore.js'

export function dispatchRouteAction(action: RouteAction): void {
  const sessions = useSessionStore.getState()
  const streams = useStreamStore.getState()
  const digests = useDigestStore.getState()
  const companion = useCompanionStore.getState()

  switch (action.kind) {
    case 'handshake':
      sessions.applyHandshakeSessions(action.sessions)
      // 桌面 sidebar 与移动端列表都是 digest 驱动：快照同样喂 digestStore，
      // 否则 webview 重载/手机刷新后会话列表清空（缺省字段容忍见 store 注释）。
      digests.applyHandshakeSnapshot(action.sessions)
      break

    case 'updateSession':
      sessions.upsertSessionMetas(action.sessions)
      break

    case 'appendStream':
      streams.appendStream(action.sessionId, action.chunk, {
        isThinking: action.isThinking,
        status: action.status,
      })
      if (action.seq !== undefined) sessions.advanceSeq(action.sessionId, action.seq)
      break

    case 'finalizeTurn': {
      const result = streams.finalizeTurn(action.sessionId, action.turnId)
      if (!result.applied) break // 同 turnId 的重复 agent_complete，幂等忽略
      sessions.ensureSession(action.sessionId)
      if (result.text) {
        sessions.appendMessage(action.sessionId, {
          id: nextMessageId(),
          role: 'agent',
          text: result.text,
          artifacts: action.artifacts.length > 0 ? action.artifacts : undefined,
          ts: Date.now(),
        })
      }
      if (action.status === 'error' && action.errorMessage) {
        sessions.appendMessage(action.sessionId, {
          id: nextMessageId(),
          role: 'system',
          text: action.errorMessage,
          ts: Date.now(),
        })
      }
      if (action.seq !== undefined) sessions.advanceSeq(action.sessionId, action.seq)
      break
    }

    case 'updateStreamStatus':
      streams.setStatus(action.sessionId, action.status, action.detail, action.progress)
      break

    case 'addToolCall':
      streams.addToolCall(action.sessionId, action.toolCall, action.turnId)
      if (action.seq !== undefined) sessions.advanceSeq(action.sessionId, action.seq)
      break

    case 'resolveToolCall':
      streams.resolveToolCall(action.sessionId, action.result)
      break

    case 'showOptions':
      streams.showOptions(action.sessionId, {
        requestTraceId: action.requestTraceId,
        question: action.question,
        options: action.options,
        uiType: action.uiType,
        timeoutSeconds: action.timeoutSeconds,
      })
      break

    case 'resolveOptions':
      if (action.sessionId) {
        streams.resolveOptions(
          action.sessionId,
          action.requestTraceId,
          action.selectedId,
          action.origin,
        )
      } else {
        // 信封缺 sessionId 时兜底：对所有存在未决选项组的会话尝试匹配。
        for (const sessionId of Object.keys(useStreamStore.getState().bySession)) {
          streams.resolveOptions(sessionId, action.requestTraceId, action.selectedId, action.origin)
        }
      }
      break

    case 'updateDigest':
      digests.upsertDigest(action.digest)
      sessions.ensureSession(action.digest.sessionId, action.digest.title)
      sessions.setTitle(action.digest.sessionId, action.digest.title)
      sessions.advanceSeq(action.digest.sessionId, action.digest.seq)
      break

    case 'companion':
      // 汇报一律进 companionStore（含 scope='global'），不进任何 sessionStore。
      companion.addLine({
        text: action.text,
        scope: action.scope,
        emotion: action.emotion,
        sourceSessionId: action.sourceSessionId,
        sourceTitle: action.sourceTitle,
        ts: action.ts,
      })
      break

    case 'emotion':
      companion.setEmotion({
        emotion: action.emotion,
        expression: action.expression,
        motion: action.motion,
      })
      break

    case 'echo':
      sessions.ensureSession(action.sessionId)
      sessions.appendMessage(action.sessionId, {
        id: nextMessageId(),
        role: 'user',
        text: action.text,
        attachments: action.attachments,
        origin: action.origin,
        ts: action.ts,
      })
      break

    case 'notice':
      if (action.sessionId) {
        sessions.ensureSession(action.sessionId)
        sessions.appendMessage(action.sessionId, {
          id: nextMessageId(),
          role: 'system',
          text: action.text,
          ts: action.ts,
        })
      } else {
        sessions.addGlobalNotice(action.text, action.level, action.ts)
      }
      break

    case 'todo':
      streams.setTodoItems(action.sessionId, action.items)
      break

    case 'history': {
      const messageLines = action.entries.filter(
        (e): e is Extract<typeof e, { type: 'message' }> => e.type === 'message',
      )
      sessions.ensureSession(action.sessionId)
      sessions.prependHistory(action.sessionId, messageLines, action.hasMore)
      // event 行（瞬态汇报/ todo 终态）按类型落各自 store。
      for (const entry of action.entries) {
        if (entry.type !== 'event') continue
        if (entry.eventType === 'companion_message') {
          companion.addLine({
            text: entry.payload.text,
            scope: entry.payload.scope,
            emotion: entry.payload.emotion,
            sourceSessionId: entry.payload.sourceSessionId,
            sourceTitle: entry.payload.sourceTitle,
            ts: entry.ts,
          })
        } else if (entry.eventType === 'todo_update') {
          streams.setTodoItems(action.sessionId, entry.payload.items)
        }
      }
      break
    }

    case 'sessionSwitched':
      // sidebar focus_session 经宿主确认后的切换：ensure 兜底（chat 可能尚未
      // 见过该会话）再切入；清未读/拉历史由 chat 视图的进入会话逻辑接管。
      sessions.ensureSession(action.sessionId)
      sessions.setCurrentSession(action.sessionId)
      break

    case 'syncReplay':
      // 断连补拉：按序回放内嵌动作（truncated 快照同样走此路径），再推进游标。
      dispatchRouteActions(action.actions)
      sessions.ensureSession(action.sessionId)
      sessions.advanceSeq(action.sessionId, action.latestSeq)
      break

    case 'ignore':
      break
  }
}

export function dispatchRouteActions(actions: RouteAction[]): void {
  for (const action of actions) {
    dispatchRouteAction(action)
  }
}
