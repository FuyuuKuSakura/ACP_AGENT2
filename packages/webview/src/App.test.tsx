// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDigestStore } from '@dionysus/client-core'

import App, { readDionysusInit } from './App.js'
import { FakeTransport, resetAllStores } from './components/chat/testUtils.js'

afterEach(cleanup)
beforeEach(() => {
  resetAllStores()
  delete window.__DIONYSUS_INIT__
})

describe('App 角色分流', () => {
  it('readDionysusInit 读取注入数据，缺失时回退 chat 默认', () => {
    expect(readDionysusInit().role).toBe('chat')
    window.__DIONYSUS_INIT__ = { clientId: 'webview:sidebar', role: 'sidebar', needCliGuide: false }
    expect(readDionysusInit()).toEqual({
      clientId: 'webview:sidebar',
      role: 'sidebar',
      needCliGuide: false,
    })
  })

  it("role='sidebar' 渲染会话列表视图（SidebarApp）", () => {
    render(
      <App
        init={{ clientId: 'webview:sidebar', role: 'sidebar', needCliGuide: false }}
        transport={new FakeTransport()}
      />,
    )
    expect(screen.getByTestId('sidebar-app')).toBeTruthy()
  })

  it("role='chat' 且 needCliGuide=true 渲染安装引导页而非聊天界面", () => {
    render(
      <App
        init={{ clientId: 'webview:chat', role: 'chat', needCliGuide: true }}
        transport={new FakeTransport()}
      />,
    )
    expect(screen.getAllByTestId('cli-guide-card')).toHaveLength(5)
    expect(screen.queryByTestId('chat-input')).toBeNull()
  })

  it("role='chat' 渲染聊天视图", () => {
    render(
      <App
        init={{ clientId: 'webview:chat', role: 'chat', needCliGuide: false }}
        transport={new FakeTransport()}
      />,
    )
    // 无会话时为聊天视图的空状态（含「开始新会话」）
    expect(screen.getByTestId('new-session-button')).toBeTruthy()
  })

  it("role='sidebar' 点击会话项发送 focus_session（BUG-2 接线）", () => {
    useDigestStore.getState().upsertDigest({
      sessionId: 's1',
      title: '重构 auth',
      status: 'idle',
      pendingOptionRequest: false,
      lastActivityAt: 1_700_000_000_000,
      seq: 1,
    })
    const transport = new FakeTransport()
    render(
      <App
        init={{ clientId: 'webview:sidebar', role: 'sidebar', needCliGuide: false }}
        transport={transport}
      />,
    )
    fireEvent.click(screen.getByTestId('session-item-s1'))
    const focus = transport.ofType('focus_session')
    expect(focus).toHaveLength(1)
    expect(focus[0].payload).toEqual({ sessionId: 's1' })
  })
})
