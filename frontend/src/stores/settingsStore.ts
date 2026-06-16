import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FontSize = 'small' | 'default' | 'large'

interface SettingsState {
  fontSize: FontSize
  live2dEnabled: boolean
  ttsEnabled: boolean
  compactMode: boolean
  wallpaperUrl: string
  wallpaperOpacity: number
  wallpaperBlur: number
  wallpaperBrightness: number
  historyLimit: number
  globalPersonaId: string

  setFontSize: (value: FontSize) => void
  setLive2dEnabled: (value: boolean) => void
  setTtsEnabled: (value: boolean) => void
  setCompactMode: (value: boolean) => void
  setWallpaperUrl: (value: string) => void
  setWallpaperOpacity: (value: number) => void
  setWallpaperBlur: (value: number) => void
  setWallpaperBrightness: (value: number) => void
  setHistoryLimit: (value: number) => void
  resetWallpaper: () => void
  setGlobalPersonaId: (value: string) => void
  initWallpaperFromServer: () => Promise<void>
}

const DEFAULT_WALLPAPER_OPACITY = 0.15
const DEFAULT_WALLPAPER_BLUR = 8
const DEFAULT_WALLPAPER_BRIGHTNESS = 0.7
const DEFAULT_HISTORY_LIMIT = 50

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      fontSize: 'default',
      live2dEnabled: true,
      ttsEnabled: false,
      compactMode: false,
      wallpaperUrl: '',
      wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
      wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
      wallpaperBrightness: DEFAULT_WALLPAPER_BRIGHTNESS,
      historyLimit: DEFAULT_HISTORY_LIMIT,
      globalPersonaId: 'exusiai',
      setFontSize: (value) => set({ fontSize: value }),
      setLive2dEnabled: (value) => set({ live2dEnabled: value }),
      setTtsEnabled: (value) => set({ ttsEnabled: value }),
      setCompactMode: (value) => set({ compactMode: value }),
      setWallpaperUrl: (value) => set({ wallpaperUrl: value }),
      setWallpaperOpacity: (value) => set({ wallpaperOpacity: value }),
      setWallpaperBlur: (value) => set({ wallpaperBlur: value }),
      setWallpaperBrightness: (value) => set({ wallpaperBrightness: value }),
      setHistoryLimit: (value) => set({ historyLimit: value }),
      resetWallpaper: () =>
        set({
          wallpaperUrl: '',
          wallpaperOpacity: DEFAULT_WALLPAPER_OPACITY,
          wallpaperBlur: DEFAULT_WALLPAPER_BLUR,
          wallpaperBrightness: DEFAULT_WALLPAPER_BRIGHTNESS,
        }),
      setGlobalPersonaId: (value) => set({ globalPersonaId: value }),
      initWallpaperFromServer: async () => {
        try {
          const res = await fetch('/api/wallpaper')
          if (!res.ok) return
          const data = (await res.json()) as {
            url?: string
            opacity?: number
            blur?: number
            brightness?: number
          }
          set({
            wallpaperUrl: data.url ?? '',
            wallpaperOpacity:
              typeof data.opacity === 'number' ? data.opacity : DEFAULT_WALLPAPER_OPACITY,
            wallpaperBlur:
              typeof data.blur === 'number' ? data.blur : DEFAULT_WALLPAPER_BLUR,
            wallpaperBrightness:
              typeof data.brightness === 'number'
                ? data.brightness
                : DEFAULT_WALLPAPER_BRIGHTNESS,
          })
        } catch {
          // Keep persisted local values on failure.
        }
      },
    }),
    {
      name: 'dionysus-settings',
    },
  ),
)
