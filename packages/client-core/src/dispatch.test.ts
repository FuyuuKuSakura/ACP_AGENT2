/**
 * dispatch 集成测试：routeServerMessage → dispatchRouteActions 全链路，
 * 含 global companion 路由去向、sync 回放、agent_complete 幂等提交。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import type { ServerMessage } from '@dionysus/protocol'

import { dispatchRouteActions } from './dispatch.js'
import { routeServerMessage } from './messageRouter.js'
import { useCompanionStore } from './stores/companionStore.js'
import { useDigestStore, selectUnreadCount } from './stores/digestStore.js'
import { useSessionStore } from './stores/sessionStore.js'
import { useStreamStore } from './stores/streamStore.js'

const TS = 1_700_000_000_000

function handle(msg: ServerMessage): void {
  dispatchRouteActions(routeServerMessage(msg))
}

function env(type: string, payload: unknown, extra: Record<string, unknown> = {}): ServerMessage {
  return { v: 1, type, ts: TS, payload, ...extra } as ServerMessage
}

function resetAll(): void {
  useSessionStore.getState().reset()
  useStreamStore.getState().reset()
  useDigestStore.getState().reset()
  useCompanionStore.getState().reset()
}

describe('dispatch 全链路', () => {
  beforeEach(resetAll)

  it('agent_stream → agent_complete：流式文本提交为 agent 消息，seq 游标推进', () => {
    handle(env('agent_stream', { chunk: '你好', isFinal: false, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 1, turnId: 't1' }))
    handle(env('agent_stream', { chunk: '世界', isFinal: true, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 2, turnId: 't1' }))
    handle(env('agent_complete', { status: 'success', artifacts: [] }, { sessionId: 's1', seq: 3, turnId: 't1' }))

    const session = useSessionStore.getState().sessions.s1
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0]).toMatchObject({ role: 'agent', text: '你好世界' })
    expect(session.lastSeq).toBe(3)
  })

  it('同 turnId 重复 agent_complete 不产生重复消息', () => {
    handle(env('agent_stream', { chunk: 'x', isFinal: false, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 1, turnId: 't1' }))
    const complete = env('agent_complete', { status: 'success', artifacts: [] }, { sessionId: 's1', seq: 2, turnId: 't1' })
    handle(complete)
    handle(complete)
    expect(useSessionStore.getState().sessions.s1.messages).toHaveLength(1)
  })

  it('error 完成：errorMessage 以 system 消息落会话', () => {
    handle(env('agent_complete', { status: 'error', errorMessage: 'adapter busy', artifacts: [] }, { sessionId: 's1', turnId: 't1' }))
    const msgs = useSessionStore.getState().sessions.s1.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'system', text: 'adapter busy' })
  })

  it('scope=global 的 companion_message 进 companionStore，不进任何 sessionStore', () => {
    handle(env('companion_message', { text: 'fleet 汇报', scope: 'global' }))
    expect(useCompanionStore.getState().lines).toHaveLength(1)
    expect(useCompanionStore.getState().lines[0]).toMatchObject({ text: 'fleet 汇报', scope: 'global' })
    expect(useSessionStore.getState().sessionIds).toEqual([])
  })

  it('scope=session 的 companion_message 同样只进 companionStore（不进会话消息流）', () => {
    handle(env('companion_message', { text: '搞定啦', scope: 'session', sourceSessionId: 's1', sourceTitle: '重构 auth' }, { sessionId: 's1' }))
    expect(useCompanionStore.getState().lines[0]).toMatchObject({ scope: 'session', sourceTitle: '重构 auth' })
    expect(useSessionStore.getState().sessions.s1).toBeUndefined()
  })

  it('emotion_update 只更新情绪，不产生旁白行', () => {
    handle(env('emotion_update', { emotion: 'happy', expression: 'smile', confidence: 1 }))
    expect(useCompanionStore.getState().currentEmotion).toEqual({ emotion: 'happy', expression: 'smile', motion: undefined })
    expect(useCompanionStore.getState().lines).toEqual([])
  })

  it('user_message_echo 落会话 user 消息并标注 origin', () => {
    handle(env('user_message_echo', { text: '来自手机', origin: 'mobile' }, { sessionId: 's1' }))
    expect(useSessionStore.getState().sessions.s1.messages[0]).toMatchObject({
      role: 'user',
      text: '来自手机',
      origin: 'mobile',
    })
  })

  it('sync_response 回放：事件按序应用，latestSeq 推进游标', () => {
    // 模拟断连前已见 seq=1（一条用户消息）
    handle(env('user_message_echo', { text: '任务开始', origin: 'desktop' }, { sessionId: 's1', seq: 1 }))
    handle(
      env('sync_response', {
        sessionId: 's1',
        latestSeq: 4,
        truncated: false,
        events: [
          env('agent_stream', { chunk: '结果', isFinal: false, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 2, turnId: 't1' }),
          env('tool_call', { toolCallId: 'tc1', name: 'Bash', kind: 'bash', args: {}, displayTarget: 'npm test' }, { sessionId: 's1', seq: 3, turnId: 't1' }),
          env('agent_complete', { status: 'success', artifacts: [] }, { sessionId: 's1', seq: 4, turnId: 't1' }),
        ],
      }),
    )

    const session = useSessionStore.getState().sessions.s1
    expect(session.messages.map((m) => m.text)).toEqual(['任务开始', '结果'])
    expect(session.lastSeq).toBe(4)
    expect(useStreamStore.getState().bySession.s1.toolCalls).toHaveLength(1)
  })

  it('truncated sync 快照（未闭合 tool_call + 流式前缀）同样可回放', () => {
    handle(
      env('sync_response', {
        sessionId: 's1',
        latestSeq: 500,
        truncated: true,
        events: [
          env('agent_stream', { chunk: '已流失的前缀…', isFinal: false, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 1, turnId: 't9' }),
          env('tool_call', { toolCallId: 'tc-open', name: 'read_file', kind: 'read', args: {}, displayTarget: 'a.ts' }, { sessionId: 's1', seq: 2, turnId: 't9' }),
          env('status_update', { status: 'reading_file', detail: '正在读 a.ts' }, { sessionId: 's1', seq: 3 }),
        ],
      }),
    )
    const st = useStreamStore.getState().bySession.s1
    expect(st.isStreaming).toBe(true)
    expect(st.streamText).toBe('已流失的前缀…')
    expect(st.toolCalls[0].result).toBeUndefined() // 未闭合
    expect(st.streamingStatus?.detail).toBe('正在读 a.ts')
    expect(useSessionStore.getState().sessions.s1.lastSeq).toBe(500)
  })

  it('session_digest_update 同时驱动 digestStore 与 sessionStore 标题/游标', () => {
    handle(
      env('session_digest_update', {
        sessionId: 's1',
        title: '重构 auth',
        status: 'waiting_option',
        pendingOptionRequest: true,
        lastActivityAt: TS,
        seq: 8,
      }),
    )
    expect(useDigestStore.getState().digests.s1).toMatchObject({ title: '重构 auth', status: 'waiting_option' })
    expect(selectUnreadCount(useDigestStore.getState().digests.s1)).toBe(8)
    expect(useSessionStore.getState().sessions.s1.title).toBe('重构 auth')
    expect(useSessionStore.getState().sessions.s1.lastSeq).toBe(8)
  })

  it('handshake 快照建立会话与 latestSeq 游标', () => {
    handle(
      env('handshake', {
        v: 1,
        clientId: 'c1',
        sessions: [
          { sessionId: 's1', title: 'A', status: 'running', latestSeq: 10 },
          { sessionId: 's2', title: 'B', status: 'idle', latestSeq: 3 },
        ],
      }),
    )
    const state = useSessionStore.getState()
    expect(state.sessionIds).toEqual(['s1', 's2'])
    expect(state.sessions.s1.lastSeq).toBe(10)
  })

  it('handshake 快照同步喂 digestStore（sidebar/移动端列表数据源）', () => {
    handle(
      env('handshake', {
        v: 1,
        clientId: 'c1',
        sessions: [
          { sessionId: 's1', title: 'A', status: 'running', latestSeq: 10 },
          { sessionId: 's2', title: 'B', status: 'idle', latestSeq: 3 },
        ],
      }),
    )
    const digests = useDigestStore.getState().digests
    // webview 重载/手机刷新后列表不为空
    expect(Object.keys(digests)).toEqual(['s1', 's2'])
    expect(digests.s1).toMatchObject({
      title: 'A',
      status: 'running',
      seq: 10,
      readSeq: 0,
      pendingOptionRequest: false,
      lastActivityAt: 0,
    })
    expect(selectUnreadCount(digests.s1)).toBe(10)
    expect(digests.s2).toMatchObject({ title: 'B', status: 'idle', seq: 3 })
  })

  it('handshake 快照不回退已有 digest 的 readSeq 与富字段', () => {
    // 在线 digest 先到（带富字段），已读游标推进到 8
    handle(
      env('session_digest_update', {
        sessionId: 's1',
        title: '重构 auth',
        status: 'running',
        currentAction: '正在读 auth.ts',
        pendingOptionRequest: false,
        lastActivityAt: TS,
        seq: 8,
        personaId: 'kalt_sit',
      }, { sessionId: 's1' }),
    )
    useDigestStore.getState().markSessionRead('s1', 8)

    // 重连握手：快照只带 {sessionId,title,status,latestSeq}
    handle(
      env('handshake', {
        v: 1,
        clientId: 'c1',
        sessions: [{ sessionId: 's1', title: '重构 auth', status: 'idle', latestSeq: 8 }],
      }),
    )
    const entry = useDigestStore.getState().digests.s1
    expect(entry.readSeq).toBe(8) // 已读游标不回退
    expect(entry.seq).toBe(8)
    expect(entry.currentAction).toBe('正在读 auth.ts') // 富字段保留
    expect(entry.personaId).toBe('kalt_sit')
    expect(entry.lastActivityAt).toBe(TS)
    expect(entry.status).toBe('idle') // 快照状态生效
  })

  it('session_switched 切换 currentSessionId；未知会话 ensure 兜底', () => {
    handle(
      env('handshake', {
        v: 1,
        clientId: 'c1',
        sessions: [{ sessionId: 's1', title: 'A', status: 'idle', latestSeq: 0 }],
      }),
    )
    handle(env('session_switched', { sessionId: 's1' }))
    expect(useSessionStore.getState().currentSessionId).toBe('s1')

    // chat webview 尚未见过该会话（如错过 digest）时补建条目再切入
    handle(env('session_switched', { sessionId: 's9' }))
    const state = useSessionStore.getState()
    expect(state.currentSessionId).toBe('s9')
    expect(state.sessions.s9).toBeDefined()
  })

  it('history_response：message 行前插、event 行落 companion/todo', () => {
    handle(env('user_message_echo', { text: '在线消息', origin: 'desktop' }, { sessionId: 's1' }))
    handle(
      env('history_response', {
        sessionId: 's1',
        hasMore: false,
        entries: [
          { type: 'message', id: 'h1', role: 'user', text: '历史消息', ts: TS - 1000 },
          { type: 'event', eventType: 'companion_message', payload: { text: '历史汇报', scope: 'session' }, ts: TS - 900 },
          { type: 'event', eventType: 'todo_update', payload: { items: [{ id: '1', text: 'todo', done: true }] }, ts: TS - 800 },
        ],
      }),
    )
    expect(useSessionStore.getState().sessions.s1.messages.map((m) => m.text)).toEqual(['历史消息', '在线消息'])
    expect(useCompanionStore.getState().lines[0]).toMatchObject({ text: '历史汇报' })
    expect(useStreamStore.getState().bySession.s1.todoItems).toHaveLength(1)
  })

  it('system_notice 无 sessionId 时落 globalNotices，有 sessionId 时落会话 system 消息', () => {
    handle(env('system_notice', { text: '并发超限', level: 'warning' }))
    expect(useSessionStore.getState().globalNotices[0]).toMatchObject({ text: '并发超限', level: 'warning' })

    handle(env('system_notice', { text: '选项超时', level: 'info' }, { sessionId: 's1' }))
    expect(useSessionStore.getState().sessions.s1.messages[0]).toMatchObject({ role: 'system', text: '选项超时' })
  })

  it('option 流程：showOptions → resolveOptions 置已决态', () => {
    handle(
      env('option_request', {
        question: '继续？',
        options: [{ id: 'y', label: '是' }],
        uiType: 'button_group',
        timeoutSeconds: 60,
      }, { sessionId: 's1', traceId: 'tr-1' }),
    )
    handle(env('option_resolved', { requestTraceId: 'tr-1', selectedId: 'y', origin: 'mobile' }, { sessionId: 's1' }))
    expect(useStreamStore.getState().bySession.s1.optionGroup?.resolved).toEqual({ selectedId: 'y', origin: 'mobile' })
  })
})
