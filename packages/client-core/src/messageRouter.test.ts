/**
 * messageRouter 全分支测试（architecture.md §12：含 scope:"global" 路由、
 * sync 回放、未知类型容错）。18 种 S→C 消息逐一断言路由动作。
 */
import { describe, expect, it } from 'vitest'

import type { ServerMessage } from '@dionysus/protocol'

import { routeServerMessage, type RouteAction } from './messageRouter.js'

const TS = 1_700_000_000_000

function env<T extends ServerMessage['type']>(
  type: T,
  payload: unknown,
  extra: Partial<{ sessionId: string; seq: number; turnId: string; traceId: string }> = {},
): ServerMessage {
  return { v: 1, type, ts: TS, payload, ...extra } as ServerMessage
}

function one(actions: RouteAction[]): RouteAction {
  expect(actions).toHaveLength(1)
  return actions[0]
}

describe('routeServerMessage 全分支', () => {
  it('handshake → handshake 动作（clientId + 会话快照）', () => {
    const a = one(
      routeServerMessage(
        env('handshake', {
          v: 1,
          clientId: 'c1',
          sessions: [{ sessionId: 's1', title: 't', status: 'running', latestSeq: 7 }],
        }),
      ),
    )
    expect(a).toEqual({
      kind: 'handshake',
      clientId: 'c1',
      sessions: [{ sessionId: 's1', title: 't', status: 'running', latestSeq: 7 }],
    })
  })

  it('pong → 显式 ignore', () => {
    const a = one(routeServerMessage(env('pong', {})))
    expect(a.kind).toBe('ignore')
    expect((a as { reason: string }).reason).toMatch(/pong/)
  })

  it('agent_stream → appendStream（携带 turnId/seq/isThinking）', () => {
    const a = one(
      routeServerMessage(
        env(
          'agent_stream',
          { chunk: 'hi', isFinal: false, status: 'outputting', isThinking: true },
          { sessionId: 's1', seq: 3, turnId: 't1' },
        ),
      ),
    )
    expect(a).toEqual({
      kind: 'appendStream',
      sessionId: 's1',
      chunk: 'hi',
      isThinking: true,
      isFinal: false,
      status: 'outputting',
      turnId: 't1',
      seq: 3,
    })
  })

  it('agent_complete → finalizeTurn', () => {
    const a = one(
      routeServerMessage(
        env('agent_complete', { status: 'error', errorMessage: 'boom', artifacts: [] }, {
          sessionId: 's1',
          turnId: 't1',
          seq: 9,
        }),
      ),
    )
    expect(a).toMatchObject({
      kind: 'finalizeTurn',
      sessionId: 's1',
      status: 'error',
      errorMessage: 'boom',
      turnId: 't1',
      seq: 9,
    })
  })

  it('status_update → updateStreamStatus', () => {
    const a = one(
      routeServerMessage(
        env('status_update', { status: 'reading_file', detail: '正在读 auth.ts' }, { sessionId: 's1' }),
      ),
    )
    expect(a).toEqual({
      kind: 'updateStreamStatus',
      sessionId: 's1',
      status: 'reading_file',
      detail: '正在读 auth.ts',
      progress: undefined,
    })
  })

  it('tool_call → addToolCall', () => {
    const payload = {
      toolCallId: 'tc1',
      name: 'read_file',
      kind: 'read',
      args: { path: 'a.ts' },
      displayTarget: 'a.ts',
    }
    const a = one(routeServerMessage(env('tool_call', payload, { sessionId: 's1', turnId: 't1', seq: 4 })))
    expect(a).toEqual({ kind: 'addToolCall', sessionId: 's1', toolCall: payload, turnId: 't1', seq: 4 })
  })

  it('tool_result → resolveToolCall', () => {
    const payload = { toolCallId: 'tc1', ok: true, summary: 'done', durationMs: 12 }
    const a = one(routeServerMessage(env('tool_result', payload, { sessionId: 's1' })))
    expect(a).toEqual({ kind: 'resolveToolCall', sessionId: 's1', result: payload })
  })

  it('option_request → showOptions（requestTraceId 取自信封 traceId）', () => {
    const a = one(
      routeServerMessage(
        env(
          'option_request',
          {
            question: '继续？',
            options: [{ id: 'y', label: '是' }],
            uiType: 'button_group',
            timeoutSeconds: 60,
          },
          { sessionId: 's1', traceId: 'tr-1' },
        ),
      ),
    )
    expect(a).toMatchObject({
      kind: 'showOptions',
      sessionId: 's1',
      requestTraceId: 'tr-1',
      question: '继续？',
    })
  })

  it('option_resolved → resolveOptions', () => {
    const a = one(
      routeServerMessage(
        env('option_resolved', { requestTraceId: 'tr-1', selectedId: 'y', origin: 'mobile' }, { sessionId: 's1' }),
      ),
    )
    expect(a).toEqual({
      kind: 'resolveOptions',
      sessionId: 's1',
      requestTraceId: 'tr-1',
      selectedId: 'y',
      origin: 'mobile',
    })
  })

  it('session_digest_update → updateDigest', () => {
    const digest = {
      sessionId: 's1',
      title: 't',
      status: 'waiting_option',
      pendingOptionRequest: true,
      lastActivityAt: TS,
      seq: 11,
      todoProgress: { done: 3, total: 7 },
      currentAction: '正在改 auth.ts',
    }
    const a = one(routeServerMessage(env('session_digest_update', digest, { sessionId: 's1', seq: 11 })))
    expect(a).toEqual({ kind: 'updateDigest', digest })
  })

  it('session_list_response → updateSession', () => {
    const sessions = [
      { id: 's1', title: 't', personaId: 'p', status: 'idle', updatedAt: TS, unreadCount: 0 },
    ]
    const a = one(routeServerMessage(env('session_list_response', { sessions })))
    expect(a).toEqual({ kind: 'updateSession', sessions })
  })

  it('history_response → history（message 行 + event 行）', () => {
    const entries = [
      { type: 'message', id: 'm1', role: 'user', text: 'hi', ts: TS },
      {
        type: 'event',
        eventType: 'companion_message',
        payload: { text: '汇报', scope: 'session' },
        ts: TS,
      },
    ]
    const a = one(routeServerMessage(env('history_response', { sessionId: 's1', entries, hasMore: true })))
    expect(a).toEqual({ kind: 'history', sessionId: 's1', entries, hasMore: true })
  })

  it('user_message_echo → echo（含 origin）', () => {
    const a = one(
      routeServerMessage(
        env('user_message_echo', { text: '来自手机', origin: 'mobile' }, { sessionId: 's1' }),
      ),
    )
    expect(a).toEqual({
      kind: 'echo',
      sessionId: 's1',
      text: '来自手机',
      attachments: undefined,
      origin: 'mobile',
      ts: TS,
    })
  })

  it('emotion_update → emotion', () => {
    const a = one(
      routeServerMessage(
        env('emotion_update', { emotion: 'happy', expression: 'smile', motion: 'wave', confidence: 1 }),
      ),
    )
    expect(a).toEqual({ kind: 'emotion', emotion: 'happy', expression: 'smile', motion: 'wave', sessionId: undefined })
  })

  it('companion_message scope=global（无 sessionId）→ companion 动作', () => {
    // 显式路由分支：全局消息 envelope.sessionId 省略，不得按会话过滤丢弃（ADR-17）。
    const a = one(
      routeServerMessage(env('companion_message', { text: 'fleet 汇报', scope: 'global' })),
    )
    expect(a).toMatchObject({ kind: 'companion', scope: 'global', text: 'fleet 汇报', sessionId: undefined })
  })

  it('companion_message scope=global 异常携带 sessionId 时仍路由 companion，不进 sessionStore', () => {
    const a = one(
      routeServerMessage(
        env('companion_message', { text: 'g', scope: 'global' }, { sessionId: 's1' }),
      ),
    )
    expect(a.kind).toBe('companion')
    expect((a as { scope: string }).scope).toBe('global')
  })

  it('companion_message scope=session → companion 动作（带来源标注）', () => {
    const a = one(
      routeServerMessage(
        env(
          'companion_message',
          { text: '搞定啦', scope: 'session', sourceSessionId: 's1', sourceTitle: '重构 auth' },
          { sessionId: 's1' },
        ),
      ),
    )
    expect(a).toMatchObject({
      kind: 'companion',
      scope: 'session',
      sourceSessionId: 's1',
      sourceTitle: '重构 auth',
    })
  })

  it('todo_update → todo（全量快照）', () => {
    const items = [{ id: '1', text: '改代码', done: false }]
    const a = one(routeServerMessage(env('todo_update', { items }, { sessionId: 's1' })))
    expect(a).toEqual({ kind: 'todo', sessionId: 's1', items })
  })

  it('session_switched → sessionSwitched（sidebar 切换会话的单播确认）', () => {
    const a = one(routeServerMessage(env('session_switched', { sessionId: 's2' })))
    expect(a).toEqual({ kind: 'sessionSwitched', sessionId: 's2' })
  })

  it('system_notice → notice（有/无 sessionId 两种形态）', () => {
    const scoped = one(
      routeServerMessage(env('system_notice', { text: 'n', level: 'warning' }, { sessionId: 's1' })),
    )
    expect(scoped).toEqual({ kind: 'notice', text: 'n', level: 'warning', sessionId: 's1', ts: TS })
    const global = one(routeServerMessage(env('system_notice', { text: 'g', level: 'info' })))
    expect(global).toMatchObject({ kind: 'notice', sessionId: undefined })
  })

  it('sync_response → syncReplay：事件序列递归路由、按序排列', () => {
    const events = [
      env('agent_stream', { chunk: 'a', isFinal: false, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 2, turnId: 't1' }),
      env('tool_call', { toolCallId: 'tc1', name: 'Bash', kind: 'bash', args: {}, displayTarget: 'npm test' }, { sessionId: 's1', seq: 3, turnId: 't1' }),
      env('agent_complete', { status: 'success', artifacts: [] }, { sessionId: 's1', seq: 4, turnId: 't1' }),
    ]
    const a = one(
      routeServerMessage(
        env('sync_response', { sessionId: 's1', events, latestSeq: 4, truncated: true }),
      ),
    )
    expect(a.kind).toBe('syncReplay')
    const replay = a as Extract<RouteAction, { kind: 'syncReplay' }>
    expect(replay.latestSeq).toBe(4)
    expect(replay.truncated).toBe(true)
    expect(replay.actions.map((x) => x.kind)).toEqual(['appendStream', 'addToolCall', 'finalizeTurn'])
  })

  it('未知消息类型容错为 ignore，不抛异常', () => {
    const unknown = { v: 1, type: 'future_message', ts: TS, payload: {} } as unknown as ServerMessage
    const a = one(routeServerMessage(unknown))
    expect(a.kind).toBe('ignore')
    expect((a as { reason: string }).reason).toMatch(/future_message/)
  })

  it('会话消息缺 envelope.sessionId 时抛错（协议契约）', () => {
    expect(() =>
      routeServerMessage(env('agent_stream', { chunk: 'x', isFinal: false, status: 'outputting', isThinking: false })),
    ).toThrow(/sessionId/)
  })
})
