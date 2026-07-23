import { describe, expect, it } from 'vitest'

import {
  PROTOCOL_VERSION,
  ProtocolError,
  parseClientMessage,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './index.js'

const TS = 1752926400000

/** 构造一条完整信封（payload 字段写全，避免依赖 schema 默认值）。 */
function env<T extends string, P>(type: T, payload: P, extra: Record<string, unknown> = {}) {
  return { v: 1, type, traceId: 'trace-1', ts: TS, payload, ...extra }
}

/** JSON 序列化往返后经解析应深等于原消息。 */
function roundtrip<T>(parse: (raw: unknown) => T, msg: unknown): T {
  const wire = JSON.parse(JSON.stringify(msg))
  const parsed = parse(wire)
  expect(parsed).toEqual(msg)
  return parsed
}

function expectProtocolError(parse: (raw: unknown) => unknown, raw: unknown, pathPart?: string) {
  try {
    parse(raw)
    expect.unreachable('should have thrown ProtocolError')
  } catch (err) {
    expect(err).toBeInstanceOf(ProtocolError)
    const perr = err as ProtocolError
    expect(perr.issues.length).toBeGreaterThan(0)
    if (pathPart !== undefined) {
      expect(perr.message).toContain(pathPart)
    }
  }
}

describe('PROTOCOL_VERSION', () => {
  it('freezes protocol version at 1', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })
})

describe('C→S 消息合法往返', () => {
  it('hello', () => {
    roundtrip(
      parseClientMessage,
      env('hello', { minVersion: 1, maxVersion: 1 }),
    )
  })

  it('ping', () => {
    roundtrip(parseClientMessage, env('ping', {}))
  })

  it('new_session', () => {
    roundtrip(parseClientMessage, env('new_session', { personaId: 'kalt_sit' }))
    // personaId 可省略
    roundtrip(parseClientMessage, env('new_session', {}))
  })

  it('client_command', () => {
    roundtrip(
      parseClientMessage,
      env('client_command', { command: 'switch_persona', args: 'kalt_sit', text: 'kalt_sit' }, { sessionId: 's1' }),
    )
  })

  it('user_input（含 attachments 与 mode）', () => {
    const msg = env(
      'user_input',
      {
        text: '帮我重构 login 函数',
        attachments: [
          { id: 'a1', filename: 'auth.ts', mimeType: 'text/plain', size: 123, data: 'YmFzZTY0' },
        ],
        mode: 'plan_yolo',
      },
      { sessionId: 's1' },
    )
    const parsed = roundtrip(parseClientMessage, msg)
    expect(parsed.type).toBe('user_input')
  })

  it('user_input 缺省 attachments/mode 时填默认值', () => {
    const parsed = parseClientMessage(env('user_input', { text: 'hi' }, { sessionId: 's1' }))
    expect(parsed.type).toBe('user_input')
    if (parsed.type === 'user_input') {
      expect(parsed.payload.attachments).toEqual([])
      expect(parsed.payload.mode).toBe('normal')
    }
  })

  it('option_selected', () => {
    roundtrip(
      parseClientMessage,
      env('option_selected', { selectedId: 'opt_yes', selectedLabel: '确认删除' }, { sessionId: 's1' }),
    )
  })

  it('interrupt', () => {
    roundtrip(
      parseClientMessage,
      env('interrupt', { reason: 'user_request', insertMessage: '顺便改下标题' }, { sessionId: 's1' }),
    )
  })

  it('sync_request', () => {
    roundtrip(parseClientMessage, env('sync_request', { sessionId: 's1', afterSeq: 42 }))
  })

  it('session_list_request', () => {
    roundtrip(parseClientMessage, env('session_list_request', {}))
  })

  it('history_request', () => {
    roundtrip(
      parseClientMessage,
      env('history_request', { sessionId: 's1', beforeTs: TS - 1000, limit: 50 }),
    )
  })

  it('focus_session（sidebar 点击切换会话）', () => {
    roundtrip(parseClientMessage, env('focus_session', { sessionId: 's1' }))
  })

  it('focus_session 拒绝空 sessionId', () => {
    expectProtocolError(parseClientMessage, env('focus_session', { sessionId: '' }), 'sessionId')
  })
})

describe('S→C 消息合法往返', () => {
  it('handshake（全量会话 digest 快照 + latestSeq）', () => {
    roundtrip(
      parseServerMessage,
      env('handshake', {
        v: 1,
        clientId: 'client-1',
        sessions: [
          { sessionId: 's1', title: '重构 auth', status: 'running', latestSeq: 87 },
          { sessionId: 's2', title: '写测试', status: 'waiting_option', latestSeq: 12 },
        ],
      }),
    )
  })

  it('pong', () => {
    roundtrip(parseServerMessage, env('pong', {}))
  })

  it('agent_stream（含 isThinking）', () => {
    roundtrip(
      parseServerMessage,
      env(
        'agent_stream',
        { chunk: '好的，我先看一下 ', isFinal: false, status: 'outputting', isThinking: false },
        { sessionId: 's1', seq: 5, turnId: 't1' },
      ),
    )
    // thinking 通道
    roundtrip(
      parseServerMessage,
      env(
        'agent_stream',
        { chunk: '用户想重构…', isFinal: false, status: 'thinking', isThinking: true },
        { sessionId: 's1', seq: 6, turnId: 't1' },
      ),
    )
  })

  it('agent_complete（success/error/interrupted + turnId）', () => {
    for (const status of ['success', 'error', 'interrupted'] as const) {
      roundtrip(
        parseServerMessage,
        env(
          'agent_complete',
          {
            status,
            durationMs: 8200,
            artifacts: [
              { type: 'mermaid', mimeType: 'text/plain', data: 'graph TD; A-->B', caption: '依赖图' },
            ],
            errorMessage: status === 'error' ? 'spawn ENOENT' : undefined,
          },
          { sessionId: 's1', seq: 9, turnId: 't1' },
        ),
      )
    }
  })

  it('status_update', () => {
    roundtrip(
      parseServerMessage,
      env('status_update', { status: 'reading_file', detail: '读取 src/auth.ts', progress: 0.5 }, { sessionId: 's1' }),
    )
  })

  it('tool_call（§4.1 字段级 schema）', () => {
    roundtrip(
      parseServerMessage,
      env(
        'tool_call',
        {
          toolCallId: 't1-3',
          name: 'read_file',
          kind: 'read',
          args: { path: 'src/auth.ts', offset: 0 },
          displayTarget: 'src/auth.ts',
        },
        { sessionId: 's1', seq: 7, turnId: 't1' },
      ),
    )
  })

  it('tool_result（§4.1 字段级 schema）', () => {
    roundtrip(
      parseServerMessage,
      env(
        'tool_result',
        { toolCallId: 't1-3', ok: true, summary: '读取 42 行', durationMs: 15 },
        { sessionId: 's1', seq: 8, turnId: 't1' },
      ),
    )
  })

  it('option_request', () => {
    roundtrip(
      parseServerMessage,
      env(
        'option_request',
        {
          question: '确定要删除该文件吗？',
          options: [
            { id: 'opt_yes', label: '确认删除', description: '不可恢复', icon: 'warn' },
            { id: 'opt_no', label: '取消' },
          ],
          uiType: 'button_group',
          timeoutSeconds: 60,
        },
        { sessionId: 's1', seq: 10, turnId: 't1' },
      ),
    )
  })

  it('session_digest_update（含 todoProgress 与 adapterId）', () => {
    roundtrip(
      parseServerMessage,
      env('session_digest_update', {
        sessionId: 's1',
        title: '重构 auth',
        status: 'running',
        currentAction: '正在读 auth.ts',
        todoProgress: { done: 3, total: 7 },
        pendingOptionRequest: false,
        lastActivityAt: TS,
        seq: 87,
        adapterId: 'kimi_cli',
        personaId: 'kalt_sit',
      }),
    )
  })

  it('session_list_response', () => {
    roundtrip(
      parseServerMessage,
      env('session_list_response', {
        sessions: [
          {
            id: 's1',
            title: '重构 auth',
            personaId: 'kalt_sit',
            status: 'running',
            lastMessagePreview: '好的，我先看一下',
            updatedAt: TS,
            unreadCount: 2,
          },
        ],
      }),
    )
  })

  it('history_response（message 行与 event 行）', () => {
    roundtrip(
      parseServerMessage,
      env('history_response', {
        sessionId: 's1',
        entries: [
          { type: 'message', id: 'm1', role: 'user', text: '帮我重构 login 函数', ts: TS - 2000 },
          {
            type: 'message',
            id: 'm2',
            role: 'agent',
            text: '好的',
            artifacts: [{ type: 'latex', data: 'e=mc^2' }],
            ts: TS - 1000,
          },
          {
            type: 'event',
            eventType: 'companion_message',
            payload: { text: '主人，会话一完工了', scope: 'global', sourceSessionId: 's1', sourceTitle: '重构 auth' },
            ts: TS - 500,
          },
          {
            type: 'event',
            eventType: 'todo_update',
            payload: { items: [{ id: 'todo-1', text: '读完 auth.ts', done: true }] },
            ts: TS - 400,
          },
        ],
        hasMore: true,
      }),
    )
  })

  it('sync_response（events 为递归 ServerMessage[]）', () => {
    roundtrip(
      parseServerMessage,
      env('sync_response', {
        sessionId: 's1',
        events: [
          env('agent_stream', { chunk: 'x', isFinal: false, status: 'outputting', isThinking: false }, { sessionId: 's1', seq: 6 }),
          env('tool_call', { toolCallId: 't1-1', name: 'Bash', kind: 'bash', args: { command: 'ls' }, displayTarget: 'ls' }, { sessionId: 's1', seq: 7 }),
        ],
        latestSeq: 87,
        truncated: false,
      }),
    )
  })

  it('sync_response 拒绝非法内嵌事件', () => {
    expectProtocolError(
      parseServerMessage,
      env('sync_response', {
        sessionId: 's1',
        events: [{ v: 2, type: 'pong', ts: TS, payload: {} }],
        latestSeq: 87,
        truncated: false,
      }),
      'payload.events',
    )
  })

  it('user_message_echo', () => {
    roundtrip(
      parseServerMessage,
      env('user_message_echo', { text: '继续', attachments: [], origin: 'mobile' }, { sessionId: 's1' }),
    )
  })

  it('option_resolved', () => {
    roundtrip(
      parseServerMessage,
      env('option_resolved', { requestTraceId: 'trace-9', selectedId: 'opt_yes', origin: 'mobile' }, { sessionId: 's1' }),
    )
  })

  it('emotion_update（expression/motion）', () => {
    roundtrip(
      parseServerMessage,
      env('emotion_update', { emotion: 'happy', confidence: 1, expression: 'smile', motion: 'wave' }, { sessionId: 's1' }),
    )
  })

  it('companion_message（scope: session/global + sourceSessionId/sourceTitle）', () => {
    roundtrip(
      parseServerMessage,
      env('companion_message', {
        text: '3 个会话在跑，1 个等你确认',
        scope: 'global',
        emotion: 'curious',
        sourceSessionId: 's2',
        sourceTitle: '写测试',
      }),
    )
    roundtrip(
      parseServerMessage,
      env('companion_message', { text: '这回合搞定', scope: 'session' }, { sessionId: 's1' }),
    )
  })

  it('todo_update', () => {
    roundtrip(
      parseServerMessage,
      env('todo_update', { items: [{ id: 't1', text: '读完 auth.ts', done: false }] }, { sessionId: 's1' }),
    )
  })

  it('session_switched（focus_session 确认后单播给 chat webview）', () => {
    roundtrip(parseServerMessage, env('session_switched', { sessionId: 's1' }))
  })

  it('system_notice（level: info/warning/error）', () => {
    for (const level of ['info', 'warning', 'error'] as const) {
      roundtrip(parseServerMessage, env('system_notice', { text: '未知命令 /foo', level }))
    }
  })
})

describe('非法样例', () => {
  it('user_input 缺 text', () => {
    expectProtocolError(parseClientMessage, env('user_input', { mode: 'normal' }, { sessionId: 's1' }), 'payload.text')
  })

  it('user_input mode 为非法枚举值', () => {
    expectProtocolError(
      parseClientMessage,
      env('user_input', { text: 'hi', mode: 'turbo' }, { sessionId: 's1' }),
      'payload.mode',
    )
  })

  it('history_request limit 非正整数', () => {
    expectProtocolError(
      parseClientMessage,
      env('history_request', { sessionId: 's1', limit: 0 }),
    )
  })

  it('tool_call 缺 kind / args 类型错误', () => {
    expectProtocolError(
      parseServerMessage,
      env('tool_call', { toolCallId: 'x', name: 'Bash', args: {}, displayTarget: 'ls' }),
      'payload.kind',
    )
    expectProtocolError(
      parseServerMessage,
      env('tool_call', { toolCallId: 'x', name: 'Bash', kind: 'read', args: 'not-an-object', displayTarget: 'ls' }),
      'payload.args',
    )
  })

  it('tool_result 缺 summary', () => {
    expectProtocolError(
      parseServerMessage,
      env('tool_result', { toolCallId: 'x', ok: true }),
      'payload.summary',
    )
  })

  it('agent_complete status 为非法枚举值', () => {
    expectProtocolError(
      parseServerMessage,
      env('agent_complete', { status: 'timeout', artifacts: [] }),
      'payload.status',
    )
  })

  it('companion_message 缺 scope', () => {
    expectProtocolError(
      parseServerMessage,
      env('companion_message', { text: 'hi' }),
      'payload.scope',
    )
  })

  it('session_digest_update status 枚举非法', () => {
    expectProtocolError(
      parseServerMessage,
      env('session_digest_update', {
        sessionId: 's1',
        title: 't',
        status: 'processing',
        pendingOptionRequest: false,
        lastActivityAt: TS,
        seq: 1,
      }),
      'payload.status',
    )
  })

  it('attachment 缺 size / todo item done 类型错误', () => {
    expectProtocolError(
      parseClientMessage,
      env('user_input', { text: 'hi', attachments: [{ filename: 'a', mimeType: 'text/plain', data: 'x' }] }),
      'payload.attachments.0.size',
    )
    expectProtocolError(
      parseServerMessage,
      env('todo_update', { items: [{ id: 't1', text: 'x', done: 'yes' }] }),
      'payload.items.0.done',
    )
  })

  it('未知消息类型', () => {
    expectProtocolError(parseClientMessage, env('sticker_send', {}))
    expectProtocolError(parseServerMessage, env('live2d_action', {}))
  })

  it('方向不匹配：server 消息走 parseClientMessage 被拒', () => {
    expectProtocolError(parseClientMessage, env('pong', {}))
    expectProtocolError(parseServerMessage, env('ping', {}))
  })
})

describe('信封边界', () => {
  const base = () => env('ping', {})

  it('ts 非整数被拒', () => {
    expectProtocolError(parseClientMessage, { ...base(), ts: TS + 0.5 }, 'ts')
  })

  it('ts 缺失 / 非 number 被拒', () => {
    const { ts: _ts, ...noTs } = base()
    expectProtocolError(parseClientMessage, noTs, 'ts')
    expectProtocolError(parseClientMessage, { ...base(), ts: String(TS) }, 'ts')
  })

  it('v 不为 1 被拒', () => {
    expectProtocolError(parseClientMessage, { ...base(), v: 2 }, 'v')
    expectProtocolError(parseServerMessage, { ...env('pong', {}), v: '1' }, 'v')
  })

  it('v 缺失被拒', () => {
    const { v: _v, ...noV } = base()
    expectProtocolError(parseClientMessage, noV, 'v')
  })

  it('seq 非整数 / 负数被拒', () => {
    expectProtocolError(parseServerMessage, { ...env('pong', {}), seq: 1.5 }, 'seq')
    expectProtocolError(parseServerMessage, { ...env('pong', {}), seq: -1 }, 'seq')
  })

  it('payload 缺失 / 非对象被拒', () => {
    const { payload: _p, ...noPayload } = base()
    expectProtocolError(parseClientMessage, noPayload)
    expectProtocolError(parseClientMessage, { ...base(), payload: null })
  })

  it('raw 不是对象被拒', () => {
    expectProtocolError(parseClientMessage, 'not json object')
    expectProtocolError(parseClientMessage, null)
    expectProtocolError(parseServerMessage, 42)
  })

  it('ProtocolError 暴露 issues 数组', () => {
    try {
      parseClientMessage({ v: 2, type: 'ping', ts: 1.5, payload: {} })
      expect.unreachable()
    } catch (err) {
      const perr = err as ProtocolError
      expect(perr.name).toBe('ProtocolError')
      const paths = perr.issues.map((i) => i.path)
      expect(paths).toContain('v')
      expect(paths).toContain('ts')
    }
  })
})

describe('类型层面', () => {
  it('ClientMessage / ServerMessage 可窄化', () => {
    const c: ClientMessage = parseClientMessage(env('sync_request', { sessionId: 's1', afterSeq: 0 }))
    if (c.type === 'sync_request') {
      expect(c.payload.afterSeq).toBe(0)
    }
    const s: ServerMessage = parseServerMessage(
      env('sync_response', { sessionId: 's1', events: [], latestSeq: 0, truncated: true }),
    )
    if (s.type === 'sync_response') {
      expect(s.payload.truncated).toBe(true)
      expect(s.payload.events).toEqual([])
    }
  })
})

describe('素材库与 persona voice 客制化消息族（architecture.md §7 / ux-core-flows.md §5.5）', () => {
  const voice = {
    tone: '冷静克制、偶尔毒舌',
    catchphrases: ['……请注意分寸。'],
    taboos: ['卖萌'],
    examples: [{ plain: '任务完成。', styled: '任务完成，博士。' }],
    rewriterPrompt: '请以「{tone}」的语气改写：\n{examples}',
  }

  it('persona_list_request / persona_list_response 往返', () => {
    roundtrip(parseClientMessage, env('persona_list_request', {}))
    roundtrip(
      parseServerMessage,
      env('persona_list_response', {
        personas: [
          {
            id: "kal'tsit",
            name: '凯尔希',
            description: '罗德岛医疗部门负责人。',
            avatarPath: 'personas/default_avatars/kaltsit.png',
            avatarSource: 'builtin',
            voice,
            touchZones: { head: { expression: '惊讶', lines: ['博士，有事吗？'] } },
            // Phase 4 追加的可选字段：asWebviewUri 解析结果 + live2d 段透传
            modelUrl: "vscode-webview://x/assets/live2d/kal'tsit/凯尔希直播版1.model3.json",
            portraitUrls: { default: 'vscode-webview://x/assets/personas/default_avatars/kaltsit.png' },
            live2d: {
              expressions: { happy: '微笑', neutral: '原皮' },
              motions: { idle: 'M3待机', nod: '待机动耳朵' },
              defaultExpression: '原皮',
              scale: 0.5,
              expressionFiles: [],
              motionFiles: [
                { name: 'M3待机', file: 'M3待机.motion3.json' },
                { name: '待机动耳朵', file: '待机动耳朵.motion3.json' },
              ],
            },
          },
          {
            id: 'my_char',
            name: '自创角色',
            description: '',
            voice,
            touchZones: {},
          },
        ],
      }),
    )
  })

  it('persona_update_request / persona_update_response 往返', () => {
    roundtrip(
      parseClientMessage,
      env('persona_update_request', {
        personaId: "kal'tsit",
        name: '凯尔希',
        voice: { tone: '更冷静', catchphrases: [], taboos: [], examples: [], rewriterPrompt: '' },
      }),
    )
    // voice 五字段逐键可选（只写 diff 键）
    roundtrip(parseClientMessage, env('persona_update_request', { personaId: "kal'tsit", voice: { tone: 'x' } }))
    roundtrip(parseServerMessage, env('persona_update_response', { personaId: "kal'tsit", ok: true }))
    roundtrip(
      parseServerMessage,
      env('persona_update_response', { personaId: "kal'tsit", ok: false, error: 'invalid YAML' }),
    )
  })

  it('voice_preview_request / voice_preview_response 往返', () => {
    roundtrip(
      parseClientMessage,
      env('voice_preview_request', { personaId: "kal'tsit", text: '会话 A 完成了。' }),
    )
    roundtrip(
      parseClientMessage,
      env('voice_preview_request', {
        personaId: "kal'tsit",
        text: '会话 A 完成了。',
        voice: { catchphrases: ['……嗯。'] },
      }),
    )
    roundtrip(
      parseServerMessage,
      env('voice_preview_response', {
        personaId: "kal'tsit",
        original: '会话 A 完成了。',
        rewritten: '会话 A 完成了，博士。',
      }),
    )
  })

  it('character_list_request / character_list_response 往返', () => {
    roundtrip(parseClientMessage, env('character_list_request', {}))
    roundtrip(
      parseServerMessage,
      env('character_list_response', {
        characters: [
          {
            id: "kal'tsit:live2d",
            name: '凯尔希',
            personaId: "kal'tsit",
            kind: 'live2d',
            source: 'builtin',
            modelUrl: "vscode-webview://x/assets/live2d/kal'tsit/凯尔希直播版1.model3.json",
          },
          { id: 'my_char:static', name: '自创角色', personaId: 'my_char', kind: 'static', source: 'user' },
        ],
        display: { desktop: 'live2d', mobile: 'static' },
        defaultPersonaId: "kal'tsit",
      }),
    )
  })

  it('settings_update_request / settings_update_response 往返', () => {
    roundtrip(
      parseClientMessage,
      env('settings_update_request', { key: 'character.display.mobile', value: 'live2d' }),
    )
    roundtrip(parseClientMessage, env('settings_update_request', { key: 'persona.default', value: '' }))
    roundtrip(
      parseServerMessage,
      env('settings_update_response', { key: 'character.display.mobile', ok: true }),
    )
  })

  it('settings_update_request 拒绝白名单外的键', () => {
    expectProtocolError(
      parseClientMessage,
      env('settings_update_request', { key: 'lan.port', value: '8765' }),
      'key',
    )
  })

  it('persona_update_request 拒绝空 personaId / 非法 voice 形状', () => {
    expectProtocolError(parseClientMessage, env('persona_update_request', { personaId: '' }), 'personaId')
    expectProtocolError(
      parseClientMessage,
      env('persona_update_request', { personaId: 'a', voice: { catchphrases: 'not-a-list' } }),
      'catchphrases',
    )
  })

  it('character_list_response 拒绝非法 kind/source/display', () => {
    expectProtocolError(
      parseServerMessage,
      env('character_list_response', {
        characters: [{ id: 'x', name: 'x', personaId: 'x', kind: 'hologram', source: 'builtin' }],
        display: { desktop: 'live2d', mobile: 'static' },
        defaultPersonaId: '',
      }),
      'kind',
    )
    expectProtocolError(
      parseServerMessage,
      env('character_list_response', {
        characters: [],
        display: { desktop: '3d', mobile: 'static' },
        defaultPersonaId: '',
      }),
      'desktop',
    )
  })

  it('方向校验：新族请求/响应不得反向解析', () => {
    expectProtocolError(parseClientMessage, env('persona_list_response', { personas: [] }))
    expectProtocolError(parseServerMessage, env('persona_list_request', {}))
    expectProtocolError(parseClientMessage, env('settings_update_response', { key: 'persona.default', ok: true }))
  })
})
