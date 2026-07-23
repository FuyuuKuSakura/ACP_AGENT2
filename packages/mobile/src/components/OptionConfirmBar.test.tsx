/**
 * 选项确认条测试（P0 门禁）：waiting_option 常驻高对比条、选项按钮内联、
 * 点击发 option_selected、多端竞态 resolved 置灰。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  ClientTransport,
  OptionGroupState,
} from '@dionysus/client-core'
import type { ClientMessage } from '@dionysus/protocol'

import { OptionConfirmBar } from './OptionConfirmBar.js'

function group(over: Partial<OptionGroupState> = {}): OptionGroupState {
  return {
    requestTraceId: 'tr-1',
    question: '允许删除 dist/ 吗？',
    options: [
      { id: 'yes', label: '允许' },
      { id: 'no', label: '拒绝' },
    ],
    uiType: 'button_group',
    timeoutSeconds: 60,
    ...over,
  }
}

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

afterEach(cleanup)

describe('OptionConfirmBar', () => {
  it('未决态：高对比条 + 内联选项按钮，点击发 option_selected', () => {
    const t = collectTransport()
    render(<OptionConfirmBar sessionId="s1" group={group()} transport={t} />)
    const bar = screen.getByTestId('option-confirm-bar')
    expect(bar.getAttribute('data-resolved')).toBe('false')
    expect(bar.textContent).toContain('需要你确认：允许删除 dist/ 吗？')
    fireEvent.click(screen.getByTestId('option-button-yes'))
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({
      type: 'option_selected',
      sessionId: 's1',
      payload: { selectedId: 'yes', selectedLabel: '允许' },
    })
  })

  it('已决态：按钮置灰、标注来源，不再发送', () => {
    const t = collectTransport()
    render(
      <OptionConfirmBar
        sessionId="s1"
        group={group({ resolved: { selectedId: 'no', origin: 'desktop' } })}
        transport={t}
      />,
    )
    const bar = screen.getByTestId('option-confirm-bar')
    expect(bar.getAttribute('data-resolved')).toBe('true')
    expect(bar.textContent).toContain('已选择（来自 desktop）')
    fireEvent.click(screen.getByTestId('option-button-yes'))
    expect(t.sent).toHaveLength(0)
  })

  it('无未决选项组时不渲染', () => {
    const t = collectTransport()
    const { container } = render(
      <OptionConfirmBar sessionId="s1" group={null} transport={t} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
