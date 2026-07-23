// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { StaticPortrait } from './StaticPortrait.js'

const PORTRAITS = {
  default: '/assets/personas/default_avatars/kaltsit.png',
  happy: '/assets/portraits/happy.png',
}

afterEach(cleanup)

describe('StaticPortrait', () => {
  it('无 emotion 时渲染 default 立绘', () => {
    render(<StaticPortrait portraitUrls={PORTRAITS} characterName="凯尔希" />)
    const img = screen.getByTestId('static-portrait-img') as HTMLImageElement
    expect(img.src).toContain('/assets/personas/default_avatars/kaltsit.png')
    expect(img.alt).toContain('凯尔希')
  })

  it('emotion 命中时切换表情贴图，未命中回退 default', () => {
    const { rerender } = render(<StaticPortrait portraitUrls={PORTRAITS} emotion="happy" />)
    expect((screen.getByTestId('static-portrait-img') as HTMLImageElement).src).toContain('happy.png')

    rerender(<StaticPortrait portraitUrls={PORTRAITS} emotion="bored" />)
    const img = screen.getByTestId('static-portrait-img') as HTMLImageElement
    expect(img.src).toContain('kaltsit.png')
    expect(img.dataset.emotion).toBe('bored')
  })

  it('有台词时渲染气泡，台词为空时不渲染气泡', () => {
    const { rerender } = render(
      <StaticPortrait portraitUrls={PORTRAITS} line="博士，会话 A 已完成。" characterName="凯尔希" />,
    )
    expect(screen.getByTestId('static-portrait-bubble').textContent).toContain('博士，会话 A 已完成。')
    expect(screen.getByTestId('static-portrait-bubble').textContent).toContain('凯尔希')

    rerender(<StaticPortrait portraitUrls={PORTRAITS} line="" />)
    expect(screen.queryByTestId('static-portrait-bubble')).toBeNull()
  })

  it('无任何立绘素材时渲染占位提示而非裂图', () => {
    render(<StaticPortrait portraitUrls={{}} line="hi" />)
    expect(screen.getByTestId('static-portrait-empty').textContent).toContain('未安装角色立绘素材')
    expect(screen.queryByTestId('static-portrait-img')).toBeNull()
  })
})
