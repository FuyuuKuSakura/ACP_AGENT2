/**
 * focus_session 转发链路单测（BUG-2 修复；纯 node + FakeWebview）：
 * - sidebar 的 focus_session → setFocusSessionHandler 回调（宿主聚焦聊天面板）
 *   + 向 chat webview（'webview:chat'）单播 session_switched；
 * - 单播语义：请求方 sidebar 自身收不到 session_switched；
 * - 会话不存在：回 error 级 system_notice，不回调、不转发。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FakeWebview, makeTestHost, until, type TestHostContext } from './test-utils.js'

describe('focus_session 转发（BUG-2）', () => {
  let ctx: TestHostContext | null = null
  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
  })

  it('sidebar 的 focus_session → 宿主回调 + 向 chat webview 单播 session_switched', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    const chat = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)
    ctx.host.attachWebview('webview:chat', chat)
    const focused: string[] = []
    ctx.host.setFocusSessionHandler((sessionId) => focused.push(sessionId))

    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    sidebar.emit({ v: 1, type: 'focus_session', ts: Date.now(), payload: { sessionId: meta.id } })
    await until(() => chat.ofType('session_switched').length > 0)

    expect(focused).toEqual([meta.id])
    const switched = chat.ofType('session_switched')
    expect(switched).toHaveLength(1)
    expect(switched[0].payload).toEqual({ sessionId: meta.id })
    // 单播：sidebar（与 echo 语义不同）收不到 session_switched
    expect(sidebar.ofType('session_switched')).toHaveLength(0)
  })

  it('会话不存在：回 error 级 system_notice，不回调、不转发', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    const chat = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)
    ctx.host.attachWebview('webview:chat', chat)
    const handler = vi.fn()
    ctx.host.setFocusSessionHandler(handler)

    sidebar.emit({ v: 1, type: 'focus_session', ts: Date.now(), payload: { sessionId: 'no-such' } })
    await until(() => sidebar.ofType('system_notice').length > 0)

    const notice = sidebar.ofType('system_notice')[0]
    expect(notice.payload.level).toBe('error')
    expect(notice.payload.text).toContain('no-such')
    expect(handler).not.toHaveBeenCalled()
    expect(chat.ofType('session_switched')).toHaveLength(0)
  })
})
