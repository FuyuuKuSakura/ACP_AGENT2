/**
 * 短指令栏测试（P0 门禁）：IME composition 保护（组字中 Enter 不发送）、
 * 「离开模式」开关走 user_input.mode='yolo'、打断按钮。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ClientTransport } from '@dionysus/client-core'
import type { ClientMessage } from '@dionysus/protocol'

import { CommandBar } from './CommandBar.js'

function collectTransport(): ClientTransport & { sent: ClientMessage[] } {
  const sent: ClientMessage[] = []
  return {
    sent,
    send(msg) {
      sent.push(msg)
    },
    onMessage() {},
  }
}

function renderBar(over: Partial<Parameters<typeof CommandBar>[0]> = {}) {
  const t = collectTransport()
  const props: Parameters<typeof CommandBar>[0] = {
    sessionId: 's1',
    transport: t,
    running: true,
    waitingOption: false,
    awayMode: false,
    onAwayModeChange() {},
    ...over,
  }
  render(<CommandBar {...props} />)
  return { t, props }
}

afterEach(cleanup)

describe('CommandBar', () => {
  it('Enter 发送 user_input（mode=normal）', () => {
    const { t } = renderBar()
    const input = screen.getByTestId('command-input')
    fireEvent.change(input, { target: { value: '把测试修一下' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({
      type: 'user_input',
      sessionId: 's1',
      payload: { text: '把测试修一下', mode: 'normal' },
    })
  })

  it('IME 组字中 Enter 不发送（isComposing / composition 事件双保护）', () => {
    const { t } = renderBar()
    const input = screen.getByTestId('command-input')
    fireEvent.change(input, { target: { value: '继续' } })
    // nativeEvent.isComposing = true
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(t.sent).toHaveLength(0)
    // compositionstart/end 状态位保护（isComposing 不可靠的浏览器）
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
    expect(t.sent).toHaveLength(0)
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false })
    expect(t.sent).toHaveLength(1)
  })

  it('离开模式开启后发送 mode=yolo', () => {
    const { t } = renderBar({ awayMode: true })
    fireEvent.click(screen.getByTestId('continue-button'))
    expect(t.sent[0]).toMatchObject({
      type: 'user_input',
      payload: { text: '继续', mode: 'yolo' },
    })
  })

  it('打断按钮发 interrupt；非运行态禁用', () => {
    const { t } = renderBar({ running: true })
    fireEvent.click(screen.getByTestId('interrupt-button'))
    expect(t.sent[0]).toMatchObject({
      type: 'interrupt',
      sessionId: 's1',
      payload: { reason: 'user_request' },
    })
    cleanup()
    renderBar({ running: false })
    expect(
      (screen.getByTestId('interrupt-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('waiting_option 时显示「确认选项」键，点击定位并聚焦确认条选项', () => {
    // 模拟页面顶部常驻确认条（OptionConfirmBar 渲染的 DOM）
    const bar = document.createElement('div')
    bar.setAttribute('data-testid', 'option-confirm-bar')
    const opt = document.createElement('button')
    bar.appendChild(opt)
    document.body.appendChild(bar)
    let scrolled = false
    bar.scrollIntoView = () => {
      scrolled = true
    }

    renderBar({ waitingOption: true })
    fireEvent.click(screen.getByTestId('focus-option-button'))
    expect(scrolled).toBe(true)
    expect(document.activeElement).toBe(opt)
    bar.remove()
  })

  it('非 waiting_option 时不渲染「确认选项」键', () => {
    renderBar({ waitingOption: false })
    expect(screen.queryByTestId('focus-option-button')).toBeNull()
  })
})
