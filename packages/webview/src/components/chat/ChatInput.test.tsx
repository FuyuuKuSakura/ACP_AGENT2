// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ChatInput } from './ChatInput.js'
import { FakeTransport } from './testUtils.js'

afterEach(cleanup)

function setup(sessionId: string | null = 's1') {
  const transport = new FakeTransport()
  render(<ChatInput sessionId={sessionId} transport={transport} />)
  return transport
}

function inputEl() {
  return screen.getByTestId('chat-input') as HTMLTextAreaElement
}

describe('ChatInput', () => {
  it('Enter 发送 user_input，输入框清空', () => {
    const transport = setup()
    fireEvent.change(inputEl(), { target: { value: '帮我改 bug' } })
    fireEvent.keyDown(inputEl(), { key: 'Enter' })
    const sent = transport.ofType('user_input')
    expect(sent).toHaveLength(1)
    expect(sent[0].sessionId).toBe('s1')
    expect(sent[0].payload.text).toBe('帮我改 bug')
    expect(inputEl().value).toBe('')
  })

  it('Shift+Enter 换行不发送', () => {
    const transport = setup()
    fireEvent.change(inputEl(), { target: { value: '第一行' } })
    fireEvent.keyDown(inputEl(), { key: 'Enter', shiftKey: true })
    expect(transport.ofType('user_input')).toHaveLength(0)
    expect(inputEl().value).toBe('第一行')
  })

  it('输入 / 弹出斜杠命令候选（附一句话说明），前缀过滤', () => {
    setup()
    expect(screen.queryByTestId('slash-candidates')).toBeNull()
    fireEvent.change(inputEl(), { target: { value: '/' } })
    const list = screen.getByTestId('slash-candidates')
    expect(list.textContent).toContain('/new')
    expect(list.textContent).toContain('创建新会话')
    expect(list.textContent).toContain('/sessions')
    expect(list.textContent).toContain('/resume')
    fireEvent.change(inputEl(), { target: { value: '/ne' } })
    const filtered = screen.getByTestId('slash-candidates')
    expect(filtered.textContent).toContain('/new')
    expect(filtered.textContent).not.toContain('/sessions')
  })

  it('斜杠命令发送 client_command 而非 user_input', () => {
    const transport = setup()
    fireEvent.change(inputEl(), { target: { value: '/resume abc-123' } })
    fireEvent.keyDown(inputEl(), { key: 'Enter' })
    const sent = transport.ofType('client_command')
    expect(sent).toHaveLength(1)
    expect(sent[0].payload.command).toBe('/resume')
    expect(sent[0].payload.args).toBe('abc-123')
    expect(transport.ofType('user_input')).toHaveLength(0)
  })

  it('无会话时输入框禁用', () => {
    const transport = setup(null)
    expect(inputEl().disabled).toBe(true)
    fireEvent.keyDown(inputEl(), { key: 'Enter' })
    expect(transport.sent).toHaveLength(0)
  })
})
