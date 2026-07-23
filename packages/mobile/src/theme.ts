/**
 * 三态主题（architecture.md §5.5）：浅色（endfield 米白）/ 深色（endfield 炭黑）/ 跟随系统。
 * mobile 包内实现，不经 core；设置持久化 localStorage。
 *
 * `system` 模式下监听 prefers-color-scheme 变化实时跟随；最终生效的
 * light/dark 落在 <html data-theme> 上，配色见 index.css。
 */
import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'dionysus.mobile.theme'

export function loadThemeMode(): ThemeMode {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage 不可用（隐私模式等）时保持默认
  }
  return 'system'
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 同上，静默降级
  }
}

/** system 的实际取值；matchMedia 不可用时按浅色。 */
export function resolveSystemTheme(): ResolvedTheme {
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }
  return 'light'
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? resolveSystemTheme() : mode
}

/** 把主题落到 DOM（index.css 按 [data-theme] 出 token）。 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode)
  document.documentElement.dataset.theme = resolved
  return resolved
}

export interface ThemeStoreState {
  mode: ThemeMode
  setMode(mode: ThemeMode): void
}

export const useThemeStore = create<ThemeStoreState>()((set) => ({
  mode: loadThemeMode(),
  setMode(mode) {
    saveThemeMode(mode)
    set({ mode })
    applyTheme(mode)
  },
}))

/**
 * 启动接线：应用当前主题；system 模式下订阅系统主题变化。
 * 返回清理函数（测试用）。
 */
export function initTheme(): () => void {
  applyTheme(useThemeStore.getState().mode)
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => {
    if (useThemeStore.getState().mode === 'system') applyTheme('system')
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
