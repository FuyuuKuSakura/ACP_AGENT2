import type { Theme } from '@/types/protocol'

export const DEFAULT_THEME: Theme = {
  id: 'default_dark',
  name: '默认暗色',
  mode: 'dark',
  fonts: {
    body: '"Inter", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    code: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
  },
  colors: {
    primary: '#FFC940',
    primaryHover: '#FFD966',
    accent: '#E6B130',
    background: '#1A1B1F',
    chatBackground: 'transparent',
    userBubble: '#FFC940',
    agentBubbleLight: '#ffffff',
    agentBubbleDark: 'rgba(255, 255, 255, 0.06)',
    textPrimaryLight: '#1d1d1f',
    textPrimaryDark: '#f5f5f7',
    textSecondary: '#9ca3af',
    system: '#6b7280',
    danger: '#ef4444',
    success: '#22c55e',
    codeBackgroundLight: '#f4f4f5',
    codeBackgroundDark: '#0c0c0e',
    borderLight: '#e5e5e7',
    borderDark: 'rgba(255, 255, 255, 0.10)',
  },
  assets: {
    manifestThemeColor: '#1A1B1F',
    manifestBackgroundColor: '#1A1B1F',
  },
}

export function isDarkMode(theme: Partial<Theme>): boolean {
  if (theme.mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return theme.mode === 'dark'
}

export function applyTheme(theme: Partial<Theme> | Theme): void {
  const fullTheme = mergeTheme(DEFAULT_THEME, theme)
  const root = document.documentElement
  const dark = isDarkMode(fullTheme)

  const cssVars: Record<string, string> = {
    '--dionysus-primary': fullTheme.colors.primary,
    '--dionysus-primary-hover': fullTheme.colors.primaryHover,
    '--dionysus-accent': fullTheme.colors.accent,
    '--dionysus-background': fullTheme.colors.background,
    '--dionysus-chat-bg': fullTheme.colors.chatBackground,
    '--dionysus-user-bubble': fullTheme.colors.userBubble,
    '--dionysus-agent-bubble': dark
      ? fullTheme.colors.agentBubbleDark
      : fullTheme.colors.agentBubbleLight,
    '--dionysus-text-primary': dark
      ? fullTheme.colors.textPrimaryDark
      : fullTheme.colors.textPrimaryLight,
    '--dionysus-text-secondary': fullTheme.colors.textSecondary,
    '--dionysus-system': fullTheme.colors.system,
    '--dionysus-danger': fullTheme.colors.danger,
    '--dionysus-success': fullTheme.colors.success,
    '--dionysus-code-bg': dark
      ? fullTheme.colors.codeBackgroundDark
      : fullTheme.colors.codeBackgroundLight,
    '--dionysus-border': dark
      ? fullTheme.colors.borderDark
      : fullTheme.colors.borderLight,
    '--dionysus-panel-bg': dark
      ? 'rgba(22, 23, 27, 0.94)'
      : 'rgba(255, 255, 255, 0.92)',
    '--dionysus-subtle-border': dark
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(0, 0, 0, 0.06)',
    '--dionysus-glass-bg': dark
      ? 'rgba(30, 31, 38, 0.72)'
      : 'rgba(255, 255, 255, 0.72)',
    '--dionysus-glass-border': dark
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(0, 0, 0, 0.06)',
    '--dionysus-glass-highlight': dark
      ? 'rgba(255, 255, 255, 0.08)'
      : 'rgba(255, 255, 255, 0.9)',
    '--dionysus-floating-bg': dark
      ? 'rgba(28, 29, 35, 0.65)'
      : 'rgba(245, 245, 247, 0.88)',
    '--dionysus-session-card-bg': dark
      ? 'rgba(245, 245, 247, 0.72)'
      : 'rgba(255, 255, 255, 0.88)',
    '--dionysus-input-card-bg': dark
      ? 'rgba(255, 255, 255, 0.85)'
      : 'rgba(255, 255, 255, 0.95)',
    '--dionysus-fold-accent': fullTheme.colors.primary,
    '--dionysus-glow': dark
      ? `0 0 0 1px ${fullTheme.colors.primary}18, 0 8px 32px rgba(0, 0, 0, 0.35)`
      : '0 0 0 1px rgba(37, 99, 235, 0.08), 0 8px 32px rgba(0, 0, 0, 0.1)',
    '--dionysus-status-online': fullTheme.colors.success,
    '--dionysus-status-busy': '#f59e0b',
    '--dionysus-status-offline': fullTheme.colors.danger,
    '--dionysus-font-body': fullTheme.fonts.body,
    '--dionysus-font-code': fullTheme.fonts.code,
  }

  Object.entries(cssVars).forEach(([key, value]) => {
    root.style.setProperty(key, value)
  })

  root.setAttribute('data-theme-mode', dark ? 'dark' : 'light')
  root.setAttribute('data-theme-id', fullTheme.id)

  // Update manifest theme color
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', fullTheme.assets.manifestThemeColor)
  }
}

export function mergeTheme(base: Theme, override: Partial<Theme>): Theme {
  return {
    ...base,
    ...override,
    colors: {
      ...base.colors,
      ...override.colors,
    },
    fonts: {
      ...base.fonts,
      ...override.fonts,
    },
    assets: {
      ...base.assets,
      ...override.assets,
    },
  }
}

export async function loadTheme(themeId: string): Promise<Theme> {
  try {
    const res = await fetch(`/api/themes/${themeId}.json`)
    if (!res.ok) throw new Error(`Failed to load theme ${themeId}`)
    return (await res.json()) as Theme
  } catch {
    return DEFAULT_THEME
  }
}

export async function loadAllThemes(): Promise<Theme[]> {
  try {
    const res = await fetch('/api/themes')
    if (!res.ok) throw new Error('Failed to load themes')
    return (await res.json()) as Theme[]
  } catch {
    return [DEFAULT_THEME]
  }
}
