// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ChatMessage } from '@dionysus/client-core'

import { MessageList } from './MessageList.js'

afterEach(cleanup)

function msg(role: ChatMessage['role'], text: string, id = text): ChatMessage {
  return { id, role, text, ts: 1_700_000_000_000 }
}

describe('MessageList', () => {
  it('渲染 user / agent / system 三种气泡', () => {
    render(
      <MessageList
        messages={[msg('user', '帮我改个 bug'), msg('agent', '好的'), msg('system', '已创建新会话')]}
      />,
    )
    expect(screen.getByTestId('msg-user').textContent).toContain('帮我改个 bug')
    expect(screen.getByTestId('msg-agent').textContent).toContain('好的')
    expect(screen.getByTestId('msg-system').textContent).toContain('已创建新会话')
  })

  it('agent 消息走 markdown 渲染（加粗 / 行内代码）', () => {
    render(<MessageList messages={[msg('agent', '已修改 **auth.ts**，运行 `npm test` 通过')]} />)
    const bubble = screen.getByTestId('msg-agent')
    expect(bubble.querySelector('strong')?.textContent).toBe('auth.ts')
    expect(bubble.querySelector('code')?.textContent).toBe('npm test')
  })

  it('agent 消息渲染 GFM 代码块', () => {
    render(<MessageList messages={[msg('agent', '```ts\nconst a = 1\n```')]} />)
    expect(screen.getByTestId('msg-agent').querySelector('pre code')?.textContent).toContain(
      'const a = 1',
    )
  })

  it('多端回显的 user 消息标注来源', () => {
    render(
      <MessageList messages={[{ ...msg('user', '手机发的'), origin: 'mobile:abc' }]} />,
    )
    expect(screen.getByTestId('msg-user').textContent).toContain('来自 mobile:abc')
  })
})
