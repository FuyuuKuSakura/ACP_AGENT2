// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CliGuidePage } from './CliGuidePage.js'

afterEach(cleanup)

describe('CliGuidePage', () => {
  it('展示五个 CLI，各带简介 / 安装命令 / 官方文档链接', () => {
    render(<CliGuidePage />)
    const cards = screen.getAllByTestId('cli-guide-card')
    expect(cards).toHaveLength(5)
    const names = cards.map((c) => c.querySelector('h2')?.textContent)
    expect(names).toEqual(['Kimi Code', 'Claude Code', 'opencode', 'Codex CLI', 'CodeBuddy Code'])
    for (const card of cards) {
      expect(card.querySelector('code')?.textContent).toContain('npm install -g')
      const link = card.querySelector('a') as HTMLAnchorElement
      expect(link.href).toMatch(/^https:\/\//)
      expect(link.textContent).toContain('官方文档')
    }
  })

  it('「复制」按钮把安装命令写入剪贴板并给出反馈', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    render(<CliGuidePage />)
    const firstCard = screen.getAllByTestId('cli-guide-card')[0]
    const button = firstCard.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('npm install -g')
    await vi.waitFor(() => expect(button.textContent).toContain('已复制'))
  })
})
