// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { OptionGroupState } from '@dionysus/client-core'

import { OptionGroup } from './OptionGroup.js'
import { FakeTransport } from './testUtils.js'

afterEach(cleanup)

function group(resolved?: OptionGroupState['resolved']): OptionGroupState {
  return {
    question: '要删除 dist 目录吗？',
    options: [
      { id: 'yes', label: '删除' },
      { id: 'no', label: '保留' },
    ],
    uiType: 'button_group',
    timeoutSeconds: 60,
    ...(resolved ? { resolved } : {}),
  }
}

describe('OptionGroup', () => {
  it('未决态展示问题与选项，点击发送 option_selected', () => {
    const transport = new FakeTransport()
    render(<OptionGroup sessionId="s1" group={group()} transport={transport} />)
    expect(
      screen.getByTestId('option-group').getAttribute('data-resolved'),
    ).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const sent = transport.ofType('option_selected')
    expect(sent).toHaveLength(1)
    expect(sent[0].sessionId).toBe('s1')
    expect(sent[0].payload).toEqual({
      selectedId: 'yes',
      selectedLabel: '删除',
    })
  })

  it('已决态置灰：按钮禁用、选中项标注', () => {
    const transport = new FakeTransport()
    render(
      <OptionGroup
        sessionId="s1"
        group={group({ selectedId: 'no', origin: 'webview:chat' })}
        transport={transport}
      />,
    )
    const el = screen.getByTestId('option-group')
    expect(el.getAttribute('data-resolved')).toBe('true')
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[]
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(el.textContent).toContain('保留')
    expect(buttons[1].querySelector('[data-icon="done"]')).toBeTruthy()
    // 已决态点击不再发送
    expect(transport.ofType('option_selected')).toHaveLength(0)
  })
})
