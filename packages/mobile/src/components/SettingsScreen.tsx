/**
 * 设置页（architecture.md §5.5）：三态主题切换（浅色/深色/跟随系统）
 * + 解除配对（清 device token 回配对页，设备撤销后重新扫码的路径）。
 */
import { clearDeviceToken } from '../pairing.js'
import { navigate } from '../router.js'
import { useThemeStore, type ThemeMode } from '../theme.js'
import { Icon } from './Icon.js'

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: '浅色', hint: '柔和白' },
  { value: 'dark', label: '深色', hint: '柔和黑' },
  { value: 'system', label: '跟随系统', hint: 'prefers-color-scheme' },
]

export function SettingsScreen() {
  const { mode, setMode } = useThemeStore()

  return (
    <div data-testid="settings-screen" className="flex h-full flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-2.5">
        <button
          type="button"
          data-testid="settings-back"
          aria-label="返回列表"
          onClick={() => navigate({ name: 'list' })}
          className="flex-none px-1 text-lg text-[var(--dn-accent)]"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">设置</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold">主题</h2>
        <div role="radiogroup" aria-label="主题" className="overflow-hidden rounded-[var(--dn-radius-md)] border border-[var(--dn-border)]">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={mode === opt.value}
              data-testid={`theme-option-${opt.value}`}
              onClick={() => setMode(opt.value)}
              className={`flex w-full items-center gap-2 border-b border-[var(--dn-border)] px-3 py-3 text-left text-sm last:border-b-0 ${
                mode === opt.value
                  ? 'bg-[var(--dn-list-active-bg)]'
                  : 'bg-[var(--dn-panel-bg)]'
              }`}
            >
              <span className="min-w-0 flex-1">
                {opt.label}
                <span className="ml-1.5 text-xs text-[var(--dn-muted)]">{opt.hint}</span>
              </span>
              {mode === opt.value && (
                <span className="flex-none text-[var(--dn-accent)]">
                  <Icon name="done" size={15} title="当前主题" />
                </span>
              )}
            </button>
          ))}
        </div>
        <h2 className="mb-2 mt-6 text-sm font-semibold">配对</h2>
        <button
          type="button"
          data-testid="unpair-button"
          onClick={() => {
            clearDeviceToken()
            navigate({ name: 'pair' })
          }}
          className="w-full rounded-[var(--dn-radius-md)] border border-[var(--dn-error)] px-3 py-2.5 text-sm text-[var(--dn-error)]"
        >
          解除本机配对（重新扫码）
        </button>
      </div>
    </div>
  )
}
