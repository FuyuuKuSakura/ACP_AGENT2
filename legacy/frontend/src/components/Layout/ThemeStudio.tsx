import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Palette, FileCode, Save, Trash2, Download, Upload, Copy } from 'lucide-react'
import { panelWidthClasses } from '@/lib/layout'
import { applyTheme, DEFAULT_THEME, loadAllThemes, mergeTheme } from '@/lib/theme'
import { useThemeStore } from '@/stores/themeStore'
import type { Theme } from '@/types/protocol'

interface ThemeStudioProps {
  isOpen: boolean
  onClose: () => void
}

const COLOR_KEYS: { key: keyof Theme['colors']; label: string }[] = [
  { key: 'primary', label: '主色' },
  { key: 'primaryHover', label: '主色悬停' },
  { key: 'accent', label: '强调色' },
  { key: 'background', label: '背景色' },
  { key: 'chatBackground', label: '聊天背景' },
  { key: 'userBubble', label: '用户气泡' },
  { key: 'agentBubbleLight', label: 'Agent 气泡（亮）' },
  { key: 'agentBubbleDark', label: 'Agent 气泡（暗）' },
  { key: 'textPrimaryLight', label: '主文字（亮）' },
  { key: 'textPrimaryDark', label: '主文字（暗）' },
  { key: 'textSecondary', label: '次要文字' },
  { key: 'system', label: '系统色' },
  { key: 'danger', label: '危险色' },
  { key: 'success', label: '成功色' },
  { key: 'codeBackgroundLight', label: '代码背景（亮）' },
  { key: 'codeBackgroundDark', label: '代码背景（暗）' },
  { key: 'borderLight', label: '边框（亮）' },
  { key: 'borderDark', label: '边框（暗）' },
]

const PRESETS: { label: string; theme: Partial<Theme> }[] = [
  {
    label: '默认暗色',
    theme: {
      id: 'default_dark',
      name: '默认暗色',
      mode: 'dark',
      colors: DEFAULT_THEME.colors,
    },
  },
  {
    label: '默认浅色',
    theme: {
      id: 'default_light',
      name: '默认浅色',
      mode: 'light',
      colors: {
        primary: '#2563eb',
        primaryHover: '#3b82f6',
        accent: '#38bdf8',
        background: '#f5f7fa',
        chatBackground: '#ffffff',
        userBubble: '#2563eb',
        agentBubbleLight: '#ffffff',
        agentBubbleDark: '#1f2937',
        textPrimaryLight: '#1d1d1f',
        textPrimaryDark: '#f5f5f7',
        textSecondary: '#6b7280',
        system: '#9ca3af',
        danger: '#ef4444',
        success: '#22c55e',
        codeBackgroundLight: '#f4f4f5',
        codeBackgroundDark: '#1f2937',
        borderLight: 'rgba(0, 0, 0, 0.06)',
        borderDark: 'rgba(255, 255, 255, 0.1)',
      },
    },
  },
]

export default function ThemeStudio({ isOpen, onClose }: ThemeStudioProps) {
  const { setAvailableThemes, setThemeById } = useThemeStore()
  const [themeId, setThemeId] = useState('custom_theme')
  const [themeName, setThemeName] = useState('自定义主题')
  const [mode, setMode] = useState<Theme['mode']>('dark')
  const [colors, setColors] = useState<Theme['colors']>(DEFAULT_THEME.colors)
  const [bodyFont, setBodyFont] = useState(DEFAULT_THEME.fonts.body)
  const [codeFont, setCodeFont] = useState(DEFAULT_THEME.fonts.code)
  const [yamlText, setYamlText] = useState('')
  const [showYaml, setShowYaml] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [allThemes, setAllThemes] = useState<Theme[]>([])

  useEffect(() => {
    if (!isOpen) return
    loadAllThemes().then((themes) => {
      setAllThemes(themes)
      setAvailableThemes(themes)
    })
  }, [isOpen, setAvailableThemes])

  const draftTheme = useMemo<Theme>(
    () => ({
      id: themeId,
      name: themeName,
      mode,
      colors,
      fonts: { body: bodyFont, code: codeFont },
      assets: {
        manifestThemeColor: colors.background,
        manifestBackgroundColor: colors.background,
      },
    }),
    [themeId, themeName, mode, colors, bodyFont, codeFont]
  )

  useEffect(() => {
    applyTheme(draftTheme)
  }, [draftTheme])

  useEffect(() => {
    setYamlText(themeToYaml(draftTheme))
  }, [draftTheme])

  const handleColorChange = (key: keyof Theme['colors'], value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }))
  }

  const handlePreset = (partial: Partial<Theme>) => {
    const merged = mergeTheme(DEFAULT_THEME, partial)
    setThemeId((prev) => partial.id || prev)
    setThemeName(merged.name)
    setMode(merged.mode)
    setColors(merged.colors)
    setBodyFont(merged.fonts.body)
    setCodeFont(merged.fonts.code)
  }

  const handleYamlChange = (text: string) => {
    setYamlText(text)
    try {
      const parsed = yamlToTheme(text)
      if (parsed) {
        setThemeId(parsed.id)
        setThemeName(parsed.name)
        setMode(parsed.mode)
        setColors(parsed.colors)
        setBodyFont(parsed.fonts.body)
        setCodeFont(parsed.fonts.code)
      }
    } catch {
      // ignore while typing
    }
  }

  const saveTheme = async () => {
    setMessage(null)
    try {
      const res = await fetch(`/api/themes/${themeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftTheme),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage('保存成功')
        const themes = await loadAllThemes()
        setAvailableThemes(themes)
        setAllThemes(themes)
        await setThemeById(themeId)
      } else {
        setMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('保存失败')
    }
  }

  const deleteTheme = async () => {
    if (!themeId) return
    const builtin = allThemes.find((t) => t.id === themeId)?.id
    if (builtin === 'default_dark' || builtin === 'default_light') {
      setMessage('不能删除内置主题')
      return
    }
    setMessage(null)
    try {
      const res = await fetch(`/api/themes/${themeId}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        setMessage('已删除')
        const themes = await loadAllThemes()
        setAvailableThemes(themes)
        setAllThemes(themes)
      } else {
        setMessage(`删除失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('删除失败')
    }
  }

  const exportYaml = () => {
    const blob = new Blob([yamlText], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${themeId}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importYaml = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result)
      handleYamlChange(text)
    }
    reader.readAsText(file)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed inset-y-0 right-0 z-50 ${panelWidthClasses()} border-l border-dionysus-subtle-border bg-dionysus-panel-bg shadow-xl backdrop-blur-xl`}
            role="dialog"
            aria-modal="true"
            aria-label="调色盘"
          >
            <div className="flex h-14 items-center justify-between border-b border-dionysus-subtle-border px-4">
              <h2 className="flex items-center gap-2 text-base font-semibold text-dionysus-text-primary">
                <Palette className="h-4 w-4 text-dionysus-primary" />
                调色盘
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 text-dionysus-text-secondary transition-colors hover:bg-dionysus-glass-highlight"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex h-[calc(100%-3.5rem)] flex-col">
              {/* Preview */}
              <div className="flex-shrink-0 border-b border-dionysus-subtle-border p-4">
                <div className="mb-2 text-xs font-bold text-dionysus-text-secondary">实时预览</div>
                <div
                  className="rounded-xl border border-dionysus-subtle-border p-3"
                  style={{ background: colors.chatBackground }}
                >
                  <div className="mb-2 max-w-[80%] rounded-2xl rounded-tl-sm px-3 py-2 text-sm" style={{ background: colors.userBubble, color: '#fff' }}>
                    你好，能帮我写一段代码吗？
                  </div>
                  <div
                    className="ml-auto max-w-[80%] rounded-2xl rounded-tr-sm px-3 py-2 text-sm"
                    style={{ background: mode === 'dark' ? colors.agentBubbleDark : colors.agentBubbleLight, color: mode === 'dark' ? colors.textPrimaryDark : colors.textPrimaryLight }}
                  >
                    当然可以！让我先看看项目结构～
                  </div>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-full px-2 py-1 text-xs" style={{ background: colors.primary, color: '#fff' }}>发送</span>
                    <span className="rounded-full px-2 py-1 text-xs" style={{ background: colors.success, color: '#fff' }}>成功</span>
                    <span className="rounded-full px-2 py-1 text-xs" style={{ background: colors.danger, color: '#fff' }}>错误</span>
                  </div>
                </div>
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-4 flex items-center gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handlePreset(p.theme)}
                      className="rounded-full border border-dionysus-subtle-border bg-dionysus-glass-highlight px-2.5 py-1 text-xs font-bold text-dionysus-text-secondary transition-colors hover:border-dionysus-primary/50"
                    >
                      <Copy className="mr-1 inline h-3 w-3" />
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowYaml((v) => !v)}
                    className={`ml-auto flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold transition-colors ${
                      showYaml
                        ? 'border-dionysus-primary bg-dionysus-primary/15 text-dionysus-primary'
                        : 'border-dionysus-subtle-border bg-dionysus-glass-highlight text-dionysus-text-secondary'
                    }`}
                  >
                    <FileCode className="h-3 w-3" />
                    YAML
                  </button>
                </div>

                {showYaml ? (
                  <div className="space-y-3">
                    <textarea
                      value={yamlText}
                      onChange={(e) => handleYamlChange(e.target.value)}
                      rows={24}
                      className="w-full rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight p-3 font-mono text-xs text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={exportYaml}
                        className="flex items-center gap-1 rounded-full bg-dionysus-glass-highlight px-3 py-1.5 text-xs font-bold text-dionysus-text-secondary transition-colors hover:bg-dionysus-primary/10"
                      >
                        <Download className="h-3.5 w-3.5" />
                        导出
                      </button>
                      <label className="flex cursor-pointer items-center gap-1 rounded-full bg-dionysus-glass-highlight px-3 py-1.5 text-xs font-bold text-dionysus-text-secondary transition-colors hover:bg-dionysus-primary/10">
                        <Upload className="h-3.5 w-3.5" />
                        导入
                        <input
                          type="file"
                          accept=".yaml,.yml"
                          onChange={(e) => e.target.files?.[0] && importYaml(e.target.files[0])}
                          className="sr-only"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-dionysus-text-secondary">主题 ID</label>
                        <input
                          type="text"
                          value={themeId}
                          onChange={(e) => setThemeId(e.target.value)}
                          className="w-full rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-dionysus-text-secondary">主题名称</label>
                        <input
                          type="text"
                          value={themeName}
                          onChange={(e) => setThemeName(e.target.value)}
                          className="w-full rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs text-dionysus-text-secondary">模式</label>
                      <div className="flex gap-2">
                        {(['light', 'dark', 'auto'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setMode(m)}
                            className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${
                              mode === m
                                ? 'border-dionysus-primary bg-dionysus-primary/15 text-dionysus-primary'
                                : 'border-dionysus-subtle-border bg-dionysus-glass-highlight text-dionysus-text-secondary'
                            }`}
                          >
                            {m === 'light' ? '浅色' : m === 'dark' ? '深色' : '自动'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-dionysus-text-secondary">正文字体</label>
                        <input
                          type="text"
                          value={bodyFont}
                          onChange={(e) => setBodyFont(e.target.value)}
                          className="w-full rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-dionysus-text-secondary">代码字体</label>
                        <input
                          type="text"
                          value={codeFont}
                          onChange={(e) => setCodeFont(e.target.value)}
                          className="w-full rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                      {COLOR_KEYS.map(({ key, label }) => (
                        <div key={key} className="flex items-center gap-2">
                          <input
                            type="color"
                            value={colors[key]}
                            onChange={(e) => handleColorChange(key, e.target.value)}
                            className="h-9 w-9 flex-shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                          />
                          <div className="min-w-0 flex-1">
                            <label className="block text-xs text-dionysus-text-secondary">{label}</label>
                            <input
                              type="text"
                              value={colors[key]}
                              onChange={(e) => handleColorChange(key, e.target.value)}
                              className="w-full rounded-lg border border-dionysus-subtle-border bg-dionysus-glass-highlight px-2 py-1 text-xs text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 border-t border-dionysus-subtle-border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveTheme}
                    className="flex items-center gap-1.5 rounded-xl bg-dionysus-primary px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:brightness-110"
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存为主题
                  </button>
                  <button
                    type="button"
                    onClick={deleteTheme}
                    className="flex items-center gap-1.5 rounded-xl bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-danger transition-colors hover:bg-dionysus-danger/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                  {message && (
                    <span className="text-xs text-dionysus-text-secondary">{message}</span>
                  )}
                </div>
                <div className="rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs text-dionysus-text-secondary">
                  提示：保存后会立即应用并写入后端主题目录。
                </div>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function themeToYaml(theme: Theme): string {
  const lines: string[] = []
  lines.push(`id: ${theme.id}`)
  lines.push(`name: "${theme.name}"`)
  lines.push(`mode: ${theme.mode}`)
  lines.push('fonts:')
  lines.push(`  body: '${theme.fonts.body}'`)
  lines.push(`  code: '${theme.fonts.code}'`)
  lines.push('colors:')
  Object.entries(theme.colors).forEach(([k, v]) => {
    lines.push(`  ${k}: "${v}"`)
  })
  lines.push('assets:')
  lines.push(`  manifestThemeColor: "${theme.assets.manifestThemeColor}"`)
  lines.push(`  manifestBackgroundColor: "${theme.assets.manifestBackgroundColor}"`)
  return lines.join('\n')
}

function yamlToTheme(text: string): Theme | null {
  // Very small parser for the subset we emit.
  const get = (key: string) => {
    const m = text.match(new RegExp(`^${key}:\s*["']?(.*?)["']?$`, 'm'))
    return m?.[1]?.trim()
  }
  const id = get('id')
  const name = get('name')
  const mode = get('mode') as Theme['mode']
  if (!id || !name || !mode) return null
  const colors: Theme['colors'] = { ...DEFAULT_THEME.colors }
  COLOR_KEYS.forEach(({ key }) => {
    const v = get(`colors\\.${String(key)}`) ?? get(`  ${String(key)}`)
    if (v) colors[key] = v
  })
  const bodyFont = get('fonts\\.body') ?? get('  body') ?? DEFAULT_THEME.fonts.body
  const codeFont = get('fonts\\.code') ?? get('  code') ?? DEFAULT_THEME.fonts.code
  return {
    id,
    name,
    mode,
    colors,
    fonts: { body: bodyFont, code: codeFont },
    assets: {
      manifestThemeColor: colors.background,
      manifestBackgroundColor: colors.background,
    },
  }
}
