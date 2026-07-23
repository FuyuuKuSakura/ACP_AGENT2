// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { selectUnreadCount, useDigestStore } from '@dionysus/client-core'

import { ChatApp } from './ChatApp.js'
import { FakeTransport, envelope, resetAllStores, serverMsg } from './testUtils.js'

const SID = 's1'

afterEach(cleanup)
beforeEach(resetAllStores)

function digestUpdate(status: 'idle' | 'running' | 'waiting_option' | 'done' | 'error' = 'idle') {
  serverMsg(
    envelope('session_digest_update', {
      sessionId: SID,
      title: '重构 auth',
      status,
      pendingOptionRequest: status === 'waiting_option',
      lastActivityAt: 1_700_000_000_000,
      seq: 1,
    }),
  )
}

describe('ChatApp 集成', () => {
  it('无会话时显示空状态，点击「开始新会话」发送 new_session', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    screen.getByTestId('new-session-button').click()
    expect(transport.ofType('new_session')).toHaveLength(1)
  })

  it('digest 到达后自动选定会话：标题栏显示会话名并拉取历史', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => digestUpdate())
    expect(screen.getByText('重构 auth')).toBeTruthy()
    const historyReq = transport.ofType('history_request')
    expect(historyReq).toHaveLength(1)
    expect(historyReq[0].payload.sessionId).toBe(SID)
  })

  it('session_switched 切换当前会话：标题更新 + 清未读 + 拉目标会话历史（BUG-2 链路）', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => {
      // s1 时间较新，自动选定落在 s1
      digestUpdate()
      serverMsg(
        envelope('session_digest_update', {
          sessionId: 's2',
          title: '修 bug',
          status: 'idle',
          pendingOptionRequest: false,
          lastActivityAt: 1_600_000_000_000,
          seq: 3,
        }),
      )
    })
    expect(screen.getByText('重构 auth')).toBeTruthy()

    act(() => {
      serverMsg(envelope('session_switched', { sessionId: 's2' }))
    })
    // 切换到 s2：标题栏更新、拉取 s2 历史、s2 未读清零
    expect(screen.getByText('修 bug')).toBeTruthy()
    const historyReq = transport.ofType('history_request')
    expect(historyReq.map((m) => m.payload.sessionId)).toEqual([SID, 's2'])
    expect(selectUnreadCount(useDigestStore.getState().digests.s2)).toBe(0)
  })

  it('全链路：echo 出用户气泡 → 流式追加 → complete 提交 agent 气泡', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => digestUpdate('running'))
    act(() => {
      serverMsg(
        envelope('user_message_echo', { text: '帮我重构', origin: 'webview:chat' }, { sessionId: SID }),
      )
    })
    expect(screen.getByTestId('msg-user').textContent).toContain('帮我重构')
    act(() => {
      serverMsg(
        envelope(
          'agent_stream',
          { chunk: '流式回答', isFinal: false, status: 'outputting', isThinking: false },
          { sessionId: SID, turnId: 't1' },
        ),
      )
    })
    expect(screen.getByTestId('streaming-text').textContent).toContain('流式回答')
    // 流式中标题栏出现打断按钮
    screen.getByTestId('interrupt-button').click()
    expect(transport.ofType('interrupt')).toHaveLength(1)
    act(() => {
      serverMsg(
        envelope(
          'agent_complete',
          { status: 'success', artifacts: [] },
          { sessionId: SID, turnId: 't1' },
        ),
      )
    })
    expect(screen.queryByTestId('streaming-text')).toBeNull()
    expect(screen.getByTestId('msg-agent').textContent).toContain('流式回答')
  })

  it('waiting_option 时选项组醒目展示，option_resolved 后置灰', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => digestUpdate('waiting_option'))
    act(() => {
      serverMsg(
        envelope(
          'option_request',
          {
            question: '要继续吗？',
            options: [{ id: 'ok', label: '继续' }],
            uiType: 'button_group',
            timeoutSeconds: 60,
          },
          { sessionId: SID, traceId: 'tr-1' },
        ),
      )
    })
    const groupEl = screen.getByTestId('option-group')
    expect(groupEl.getAttribute('data-resolved')).toBe('false')
    expect(groupEl.textContent).toContain('需要你确认')
    act(() => {
      serverMsg(
        envelope(
          'option_resolved',
          { requestTraceId: 'tr-1', selectedId: 'ok', origin: 'webview:chat' },
          { sessionId: SID },
        ),
      )
    })
    expect(screen.getByTestId('option-group').getAttribute('data-resolved')).toBe('true')
  })

  it('全局 system_notice 渲染为通知条', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => {
      serverMsg(envelope('system_notice', { text: '并发会话数超限', level: 'warning' }))
    })
    const bar = screen.getByTestId('system-notice-bar')
    expect(bar.textContent).toContain('并发会话数超限')
  })

  it('标题栏徽标显示当前会话实际绑定的助手与角色（非全局默认，不可点击）', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => {
      serverMsg(
        envelope('session_digest_update', {
          sessionId: SID,
          title: '重构 auth',
          status: 'idle',
          pendingOptionRequest: false,
          lastActivityAt: 1_700_000_000_000,
          seq: 1,
          adapterId: 'claude_cli',
        }),
      )
    })
    // 会话出现 → 自动拉 session_list 取绑定 personaId
    expect(transport.ofType('session_list_request').length).toBeGreaterThan(0)
    act(() => {
      transport.emit(
        envelope(
          'persona_list_response',
          {
            personas: [
              {
                id: "kal'tsit",
                name: '凯尔希',
                description: '',
                voice: { tone: '', catchphrases: [], taboos: [], examples: [], rewriterPrompt: '' },
                touchZones: {},
              },
            ],
          },
          { traceId: 'chat:persona-list' },
        ),
      )
      transport.emit(
        envelope(
          'session_list_response',
          {
            sessions: [
              { id: SID, title: '重构 auth', personaId: "kal'tsit", status: 'idle', updatedAt: 1_700_000_000_000, unreadCount: 0 },
            ],
          },
          { traceId: 'chat:session-list' },
        ),
      )
    })
    // 徽标为实际绑定（角色显示名经 persona_list 解析），非交互元素
    expect(screen.getByTestId('persona-badge').textContent).toBe('凯尔希')
    expect(screen.getByTestId('adapter-badge').textContent).toBe('claude_cli')
    const badges = screen.getByTestId('adapter-persona-badges')
    expect(badges.tagName).toBe('SPAN')
    expect(badges.getAttribute('title')).toContain('不可在此切换')
  })
})
