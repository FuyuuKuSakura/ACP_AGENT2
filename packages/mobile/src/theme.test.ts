/**
 * 三态主题测试：浅色/深色/跟随系统，data-theme 落 DOM，
 * system 跟随 prefers-color-scheme 变化，localStorage 持久化。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyTheme,
  initTheme,
  loadThemeMode,
  useThemeStore,
} from './theme.js'

type Listener = () => void

function mockMatchMedia(matchesDark: boolean) {
  const listeners: Listener[] = []
  const mql = {
    matches: matchesDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: Listener) => listeners.push(cb),
    removeEventListener: (_: string, cb: Listener) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    },
    fire(next: boolean) {
      mql.matches = next
      for (const cb of [...listeners]) cb()
    },
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return mql
}

beforeEach(() => {
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('三态主题', () => {
  it('light/dark 直接落 data-theme', () => {
    mockMatchMedia(true)
    expect(applyTheme('light')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(applyTheme('dark')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('system 跟随 prefers-color-scheme', () => {
    mockMatchMedia(true)
    expect(applyTheme('system')).toBe('dark')
    mockMatchMedia(false)
    expect(applyTheme('system')).toBe('light')
  })

  it('setMode 持久化 localStorage 并落 DOM', () => {
    mockMatchMedia(false)
    useThemeStore.getState().setMode('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('dionysus.mobile.theme')).toBe('dark')
    expect(loadThemeMode()).toBe('dark')
  })

  it('system 模式下系统主题变化实时跟随；固定模式不跟随', () => {
    const mql = mockMatchMedia(false)
    useThemeStore.getState().setMode('system')
    const dispose = initTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
    mql.fire(true)
    expect(document.documentElement.dataset.theme).toBe('dark')

    useThemeStore.getState().setMode('light')
    mql.fire(false)
    expect(document.documentElement.dataset.theme).toBe('light')
    dispose()
    useThemeStore.getState().setMode('system')
  })
})
