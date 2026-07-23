// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CompanionLine } from '@dionysus/client-core'

import { CompanionBubbles } from './CompanionBubbles.js'

afterEach(cleanup)

let seq = 0
function line(text: string, extra: Partial<CompanionLine> = {}): CompanionLine {
  seq += 1
  return {
    id: `l${seq}`,
    text,
    scope: 'global',
    ts: 1_700_000_000_000 + seq,
    ...extra,
  }
}

/** jsdom 无布局：给滚动容器补 scrollHeight/clientHeight 以模拟可滚动状态 */
function mockScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

describe('CompanionBubbles（ux §4.1 旁白气泡滚动面板）', () => {
  it('滚动面板渲染全部历史行：最久在顶、最新在底（不截断、无折叠展开器）', () => {
    render(
      <CompanionBubbles
        lines={[line('一'), line('二'), line('三'), line('四'), line('五')]}
      />,
    )
    const bubbles = screen.getAllByTestId('companion-bubble')
    expect(bubbles).toHaveLength(5)
    // DOM 顺序即时间升序：最久在面板顶部，最新在底部贴角色头顶
    expect(bubbles.map((b) => b.textContent)).toEqual(['一', '二', '三', '四', '五'])
    expect(screen.queryByTestId('companion-history-toggle')).toBeNull()
    expect(screen.queryByTestId('companion-history')).toBeNull()
  })

  it('滚动面板 flex-1 铺满气泡区，滚动条走全局 dn-scroll token', () => {
    render(<CompanionBubbles lines={[line('一')]} />)
    const root = screen.getByTestId('companion-bubbles')
    expect(root.className).toContain('flex-1')
    expect(root.className).toContain('min-h-0')
    const scroll = screen.getByTestId('companion-scroll')
    expect(scroll.className).toContain('flex-1')
    expect(scroll.className).toContain('overflow-y-auto')
    expect(scroll.className).toContain('dn-scroll')
  })

  it('首屏定位到面板底部（最新句贴角色头顶）', () => {
    // jsdom scrollHeight 恒 0：首屏 useLayoutEffect 在挂载时执行，需提前 mock 原型
    const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      value: 120,
      configurable: true,
    })
    try {
      render(<CompanionBubbles lines={[line('一'), line('二')]} />)
      expect(screen.getByTestId('companion-scroll').scrollTop).toBe(120)
    } finally {
      if (proto) Object.defineProperty(Element.prototype, 'scrollHeight', proto)
    }
  })

  it('贴底时新句到达自动跟随滚到底，不显示浮钮', () => {
    const lines = [line('一'), line('二'), line('三')]
    const { rerender } = render(<CompanionBubbles lines={lines} />)
    const scroll = screen.getByTestId('companion-scroll')
    mockScrollMetrics(scroll, 120, 50)

    rerender(<CompanionBubbles lines={[...lines, line('四')]} />)
    expect(scroll.scrollTop).toBe(120)
    expect(screen.queryByTestId('companion-new-lines')).toBeNull()
  })

  it('翻阅历史时新句到达不强行跳转：显示「有新汇报 ↓」浮钮，回到底部浮钮消失', () => {
    const lines = [line('一'), line('二'), line('三')]
    const { rerender } = render(<CompanionBubbles lines={lines} />)
    const scroll = screen.getByTestId('companion-scroll')
    mockScrollMetrics(scroll, 120, 50)

    // 用户上翻阅历史（距底 70px > 阈值）
    scroll.scrollTop = 0
    fireEvent.scroll(scroll)

    rerender(<CompanionBubbles lines={[...lines, line('四')]} />)
    expect(scroll.scrollTop).toBe(0)
    const toast = screen.getByTestId('companion-new-lines')
    expect(toast.textContent).toContain('有新汇报')

    // 用户自己翻回底部 → 浮钮消失
    scroll.scrollTop = 70
    fireEvent.scroll(scroll)
    expect(screen.queryByTestId('companion-new-lines')).toBeNull()
  })

  it('点击浮钮滚到底部并隐藏浮钮', () => {
    const lines = [line('一'), line('二'), line('三')]
    const { rerender } = render(<CompanionBubbles lines={lines} />)
    const scroll = screen.getByTestId('companion-scroll')
    mockScrollMetrics(scroll, 120, 50)
    scroll.scrollTop = 0
    fireEvent.scroll(scroll)

    rerender(<CompanionBubbles lines={[...lines, line('四')]} />)
    fireEvent.click(screen.getByTestId('companion-new-lines'))
    expect(scroll.scrollTop).toBe(120)
    expect(screen.queryByTestId('companion-new-lines')).toBeNull()

    // 已回到底部：之后的新句恢复自动跟随
    rerender(<CompanionBubbles lines={[...lines, line('四'), line('五')]} />)
    expect(scroll.scrollTop).toBe(120)
    expect(screen.queryByTestId('companion-new-lines')).toBeNull()
  })

  it('来源标注：右下角小字「来自：sourceTitle」，点击回调 sourceSessionId', () => {
    const onJump = vi.fn()
    render(
      <CompanionBubbles
        lines={[
          line('auth 重构搞定啦', {
            sourceSessionId: 's1',
            sourceTitle: '重构 auth',
          }),
        ]}
        onJumpSource={onJump}
      />,
    )
    const source = screen.getByTestId('companion-bubble-source')
    expect(source.textContent).toBe('来自：重构 auth')
    fireEvent.click(source)
    expect(onJump).toHaveBeenCalledWith('s1')
  })

  it('无来源字段时不渲染标注', () => {
    render(<CompanionBubbles lines={[line('全部完成')]} />)
    expect(screen.queryByTestId('companion-bubble-source')).toBeNull()
  })

  it('气泡旁情绪徽记：已知 emotion 渲染对应图标，未知 emotion 不渲染', () => {
    render(
      <CompanionBubbles
        lines={[
          line('报错了', { emotion: 'worried' }),
          line('神秘情绪', { emotion: 'xyz' }),
        ]}
      />,
    )
    const icons = screen.getAllByTestId('companion-bubble-icon')
    expect(icons).toHaveLength(1)
    expect(icons[0].querySelector('[data-icon="emotion-worried"]')).toBeTruthy()
  })

  it('无台词时不渲染任何内容', () => {
    const { container } = render(<CompanionBubbles lines={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
