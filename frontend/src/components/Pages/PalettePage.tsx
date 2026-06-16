import { useEffect, useRef, useState, useCallback } from 'react'
import { Palette, Type, Image, Upload, RotateCcw } from 'lucide-react'
import { useSettingsStore, type FontSize } from '@/stores/settingsStore'
import { useThemeStore } from '@/stores/themeStore'
import { useLive2DStore } from '@/stores/live2dStore'
import { loadAllThemes } from '@/lib/theme'

export default function PalettePage() {
  const {
    fontSize,
    live2dEnabled,
    compactMode,
    wallpaperUrl,
    wallpaperOpacity,
    wallpaperBlur,
    wallpaperBrightness,
    setFontSize,
    setLive2dEnabled,
    setCompactMode,
    setWallpaperUrl,
    setWallpaperOpacity,
    setWallpaperBlur,
    setWallpaperBrightness,
    resetWallpaper,
  } = useSettingsStore()

  const { currentTheme, availableThemes, setThemeById, setAvailableThemes } = useThemeStore()
  const { setTrackingEnabled } = useLive2DStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [wallpaperInput, setWallpaperInput] = useState(wallpaperUrl)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSaveConfig = useCallback(
    (patch: { opacity?: number; blur?: number; brightness?: number }) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        saveWallpaperConfig(patch)
      }, 300)
    },
    [wallpaperUrl, wallpaperOpacity, wallpaperBlur, wallpaperBrightness],
  )

  useEffect(() => {
    loadAllThemes().then(setAvailableThemes).catch(() => {
      // Keep default themes if fetch fails
    })
  }, [setAvailableThemes])

  useEffect(() => {
    setWallpaperInput(wallpaperUrl)
  }, [wallpaperUrl])

  const handleLive2dChange = (enabled: boolean) => {
    setLive2dEnabled(enabled)
    setTrackingEnabled(enabled)
  }

  const saveWallpaperConfig = async (patch: {
    url?: string
    opacity?: number
    blur?: number
    brightness?: number
  }) => {
    try {
      await fetch('/api/wallpaper/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: patch.url ?? wallpaperUrl,
          opacity: patch.opacity ?? wallpaperOpacity,
          blur: patch.blur ?? wallpaperBlur,
          brightness: patch.brightness ?? wallpaperBrightness,
        }),
      })
    } catch {
      // Best-effort persistence.
    }
  }

  const handleWallpaperFile = async (file: File | null) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/wallpaper', {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (res.ok && data.url) {
        setWallpaperUrl(data.url)
        await saveWallpaperConfig({ url: data.url })
      }
    } catch {
      // Fallback to base64 data URL if backend upload fails.
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string') {
          setWallpaperUrl(result)
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const applyWallpaperUrl = async () => {
    const url = wallpaperInput.trim()
    setWallpaperUrl(url)
    await saveWallpaperConfig({ url })
  }

  const handleReset = async () => {
    try {
      await fetch('/api/wallpaper', { method: 'DELETE' })
    } catch {
      // ignore
    }
    resetWallpaper()
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Palette className="h-4 w-4 text-dionysus-primary" />
          主题
        </div>
        <select
          value={currentTheme.id}
          onChange={(e) => setThemeById(e.target.value)}
          className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
        >
          {availableThemes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Type className="h-4 w-4 text-dionysus-primary" />
          字体大小
        </div>
        <div className="flex gap-2">
          {(
            [
              { id: 'small', label: '小' },
              { id: 'default', label: '默认' },
              { id: 'large', label: '大' },
            ] as { id: FontSize; label: string }[]
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFontSize(id)}
              className={`flex-1 rounded-xl border-2 px-2 py-2 text-xs font-bold transition-all ${
                fontSize === id
                  ? 'border-dionysus-primary bg-dionysus-primary/15 text-dionysus-primary'
                  : 'border-dionysus-subtle-border bg-dionysus-glass-highlight text-dionysus-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 text-sm font-medium text-dionysus-text-primary">界面选项</div>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5">
            <span className="text-sm font-medium text-dionysus-text-primary">启用 Live2D</span>
            <input
              type="checkbox"
              checked={live2dEnabled}
              onChange={(e) => handleLive2dChange(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-6 w-11 rounded-full border-2 border-dionysus-subtle-border bg-dionysus-chat-bg transition-colors peer-checked:border-dionysus-primary peer-checked:bg-dionysus-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5">
            <span className="text-sm font-medium text-dionysus-text-primary">紧凑模式</span>
            <input
              type="checkbox"
              checked={compactMode}
              onChange={(e) => setCompactMode(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-6 w-11 rounded-full border-2 border-dionysus-subtle-border bg-dionysus-chat-bg transition-colors peer-checked:border-dionysus-primary peer-checked:bg-dionysus-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Image className="h-4 w-4 text-dionysus-primary" />
          壁纸
        </div>
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={wallpaperInput}
            onChange={(e) => setWallpaperInput(e.target.value)}
            onBlur={applyWallpaperUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyWallpaperUrl()
              }
            }}
            className="min-w-0 flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
            placeholder="图片 URL"
          />
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-text-primary transition-all hover:border-dionysus-primary/50">
            <Upload className="h-3.5 w-3.5" />
            本地上传
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleWallpaperFile(e.target.files?.[0] || null)}
              className="sr-only"
            />
          </label>
        </div>

        <div className="space-y-4 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight p-3">
          <Slider
            label="透明度"
            value={wallpaperOpacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(value) => {
              setWallpaperOpacity(value)
              debouncedSaveConfig({ opacity: value })
            }}
          />
          <Slider
            label="模糊度"
            value={wallpaperBlur}
            min={0}
            max={32}
            step={1}
            onChange={(value) => {
              setWallpaperBlur(value)
              debouncedSaveConfig({ blur: value })
            }}
          />
          <Slider
            label="亮度"
            value={wallpaperBrightness}
            min={0.1}
            max={2}
            step={0.05}
            onChange={(value) => {
              setWallpaperBrightness(value)
              debouncedSaveConfig({ brightness: value })
            }}
          />
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-text-secondary transition-colors hover:border-dionysus-primary/50 hover:text-dionysus-primary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复默认
        </button>
      </section>
    </div>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-dionysus-text-secondary">
        <span>{label}</span>
        <span>{value.toFixed(step < 1 ? 2 : 0)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-dionysus-subtle-border accent-dionysus-primary"
      />
    </div>
  )
}
