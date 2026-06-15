import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme } from '@/types/protocol'
import { DEFAULT_THEME, loadTheme } from '@/lib/theme'

function isValidTheme(theme: unknown): theme is Theme {
  if (!theme || typeof theme !== 'object') return false
  const t = theme as Partial<Theme>
  return !!t.id && !!t.colors && !!t.fonts && !!t.assets
}

const LEGACY_THEME_IDS = new Set([
  'exusiai_default',
  'dark_glass',
  'dark_default',
  'paseo_dark',
])

interface ThemeState {
  currentTheme: Theme
  availableThemes: Theme[]
  isLoading: boolean
  setTheme: (theme: Theme) => void
  setThemeById: (themeId: string) => Promise<void>
  setAvailableThemes: (themes: Theme[]) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      currentTheme: DEFAULT_THEME,
      availableThemes: [DEFAULT_THEME],
      isLoading: false,
      setTheme: (theme) => set({ currentTheme: theme }),
      setThemeById: async (themeId) => {
        set({ isLoading: true })
        const theme = await loadTheme(themeId)
        set({ currentTheme: theme, isLoading: false })
      },
      setAvailableThemes: (themes) => set({ availableThemes: themes }),
    }),
    {
      name: 'dionysus-theme',
      partialize: (state) => ({ currentTheme: state.currentTheme }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Migrate legacy or stale theme variants to the current default.
        if (
          !isValidTheme(state.currentTheme) ||
          LEGACY_THEME_IDS.has(state.currentTheme.id)
        ) {
          state.currentTheme = DEFAULT_THEME
        }
      },
    },
  ),
)
