/**
 * sessionStore 关键行为：selector 派生无镜像（v2 chatStore 缺陷回归防线）。
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  selectCurrentMessages,
  useSessionStore,
  type ChatMessage,
} from './sessionStore.js'

function msg(id: string, text: string): ChatMessage {
  return { id, role: 'agent', text, ts: 1 }
}

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().reset()
  })

  it('messages 一律经 selector 从 sessions[currentSessionId] 派生（同引用，无镜像字段）', () => {
    const s = useSessionStore.getState()
    s.appendMessage('s1', msg('m1', 'hello'))
    s.appendMessage('s1', msg('m2', 'world'))
    s.appendMessage('s2', msg('m3', 'other'))
    s.setCurrentSession('s1')

    const state = useSessionStore.getState()
    // 派生结果与 sessions 内数组是同一引用（没有拷贝镜像）
    expect(selectCurrentMessages(state)).toBe(state.sessions.s1.messages)
    expect(selectCurrentMessages(state).map((m) => m.id)).toEqual(['m1', 'm2'])
    // store 顶层不存在 messages 镜像字段
    expect('messages' in state).toBe(false)
  })

  it('切换会话 selector 立即跟随；未选中返回稳定空数组', () => {
    const s = useSessionStore.getState()
    s.appendMessage('s1', msg('m1', 'a'))
    s.appendMessage('s2', msg('m2', 'b'))
    s.setCurrentSession('s2')
    expect(selectCurrentMessages(useSessionStore.getState()).map((m) => m.id)).toEqual(['m2'])

    s.setCurrentSession(null)
    const empty1 = selectCurrentMessages(useSessionStore.getState())
    const empty2 = selectCurrentMessages(useSessionStore.getState())
    expect(empty1).toEqual([])
    expect(empty1).toBe(empty2) // 共享空数组，引用稳定（React 订阅不抖动）
  })

  it('prependHistory 前插去重并记录 hasMore', () => {
    const s = useSessionStore.getState()
    s.appendMessage('s1', msg('m2', 'new'))
    s.prependHistory(
      's1',
      [
        { type: 'message', id: 'm1', role: 'user', text: 'old', ts: 0 },
        { type: 'message', id: 'm2', role: 'agent', text: 'dup', ts: 1 },
      ],
      true,
    )
    const session = useSessionStore.getState().sessions.s1
    expect(session.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(session.historyHasMore).toBe(true)
  })

  it('advanceSeq 单调推进，不回退', () => {
    const s = useSessionStore.getState()
    s.ensureSession('s1')
    s.advanceSeq('s1', 10)
    s.advanceSeq('s1', 5)
    expect(useSessionStore.getState().sessions.s1.lastSeq).toBe(10)
  })

  it('无 sessionId 的 notice 落 globalNotices', () => {
    useSessionStore.getState().addGlobalNotice('超限', 'warning', 1)
    expect(useSessionStore.getState().globalNotices).toEqual([
      { text: '超限', level: 'warning', ts: 1 },
    ])
  })
})

describe('expectNewSession（新建会话自动切入回归）', () => {
  it('expectNewSession 后，digest 带回的新会话自动设为当前会话', () => {
    useSessionStore.getState().reset()
    useSessionStore.getState().ensureSession('old', '旧会话')
    useSessionStore.getState().setCurrentSession('old')
    useSessionStore.getState().expectNewSession()
    useSessionStore.getState().ensureSession('new-id', '新会话')
    expect(useSessionStore.getState().currentSessionId).toBe('new-id')
    expect(useSessionStore.getState().expectingNewSession).toBe(false)
  })

  it('未 expect 时新会话不抢占当前会话', () => {
    useSessionStore.getState().reset()
    useSessionStore.getState().ensureSession('old', '旧会话')
    useSessionStore.getState().setCurrentSession('old')
    useSessionStore.getState().ensureSession('other', '别的会话')
    expect(useSessionStore.getState().currentSessionId).toBe('old')
  })
})
