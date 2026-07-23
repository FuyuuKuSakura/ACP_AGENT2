/**
 * SessionStatusBar 单测：聚合口径 + codicon 文案（禁止 emoji）。
 * StatusBarItem 以结构类型注入（StatusBarItemLike），无需 vscode 运行时。
 */
import { describe, expect, it } from 'vitest'

import type {
  ServerMessage,
  SessionDigestUpdatePayload,
} from '@dionysus/protocol'

import {
  FOCUS_SESSION_LIST_COMMAND,
  SessionStatusBar,
  type StatusBarItemLike,
} from './status-bar.js'

function fakeItem(): StatusBarItemLike & { shown: boolean } {
  return {
    text: '',
    shown: false,
    show() {
      this.shown = true
    },
    hide() {
      this.shown = false
    },
    dispose() {},
  }
}

function digestMsg(
  partial: Partial<SessionDigestUpdatePayload> & { sessionId: string },
): ServerMessage {
  return {
    v: 1,
    type: 'session_digest_update',
    ts: 1_700_000_000_000,
    payload: {
      title: partial.sessionId,
      status: 'idle',
      pendingOptionRequest: false,
      lastActivityAt: 1_700_000_000_000,
      seq: 1,
      ...partial,
    },
  }
}

describe('SessionStatusBar', () => {
  it('无会话时显示产品名；注册聚焦命令并常驻展示', () => {
    const item = fakeItem()
    new SessionStatusBar(item)
    expect(item.text).toBe('Dionysus')
    expect(item.command).toBe(FOCUS_SESSION_LIST_COMMAND)
    expect(item.shown).toBe(true)
  })

  it('聚合文案用 codicon：$(sync~spin) 运行中 / $(warning) 待决策', () => {
    const item = fakeItem()
    const bar = new SessionStatusBar(item)
    bar.handleMessage(digestMsg({ sessionId: 'r1', status: 'running' }))
    bar.handleMessage(digestMsg({ sessionId: 'r2', status: 'running' }))
    bar.handleMessage(
      digestMsg({
        sessionId: 'w1',
        status: 'waiting_option',
        pendingOptionRequest: true,
      }),
    )
    bar.handleMessage(digestMsg({ sessionId: 'd1', status: 'done' }))
    expect(item.text).toBe('$(sync~spin) 2 运行中 $(warning) 1 待决策')
    // 不含 emoji（图标一律走 codicon 语法）
    expect(item.text).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23F0}-\u{23FF}]|\u{FE0F}/u,
    )
  })

  it('error 不计入待决策（与聚合条同口径）；pendingOptionRequest 计入；dropSession 后重渲染', () => {
    const item = fakeItem()
    const bar = new SessionStatusBar(item)
    bar.handleMessage(digestMsg({ sessionId: 'e1', status: 'error' }))
    bar.handleMessage(
      digestMsg({ sessionId: 'p1', pendingOptionRequest: true }),
    )
    expect(item.text).toBe('$(sync~spin) 0 运行中 $(warning) 1 待决策')
    bar.dropSession('e1')
    expect(item.text).toBe('$(sync~spin) 0 运行中 $(warning) 1 待决策')
    bar.dropSession('p1')
    expect(item.text).toBe('Dionysus') // 空会话时回退到产品名
  })
})
