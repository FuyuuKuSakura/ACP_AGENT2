import { useThemeStore } from '@/stores/themeStore'

export default function ThemeSwitcher() {
  const { currentTheme, availableThemes, setThemeById } = useThemeStore()

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setThemeById(e.target.value)
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="theme-switcher" className="text-sm text-dionysus-text-secondary">
        主题
      </label>
      <select
        id="theme-switcher"
        value={currentTheme.id}
        onChange={handleChange}
        className="rounded-full border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-1 text-sm font-medium text-dionysus-text-primary outline-none focus:border-dionysus-primary focus:ring-2 focus:ring-dionysus-primary/30"
      >
        {availableThemes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
    </div>
  )
}
