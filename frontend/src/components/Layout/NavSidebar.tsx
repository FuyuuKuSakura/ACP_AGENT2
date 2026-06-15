import { MessageSquare, Palette, User, Settings } from 'lucide-react'
import { useLayoutStore, type NavItem } from '@/stores/layoutStore'

interface NavItemDef {
  id: NavItem
  label: string
  icon: React.ElementType
}

const NAV_ITEMS: NavItemDef[] = [
  { id: 'sessions', label: '会话', icon: MessageSquare },
  { id: 'themes', label: '调色盘', icon: Palette },
  { id: 'character', label: '角色', icon: User },
  { id: 'settings', label: '设置', icon: Settings },
]

export default function NavSidebar() {
  const { activeNav, setActiveNav } = useLayoutStore()

  return (
    <nav
      className="flex h-full w-16 flex-shrink-0 flex-col items-center border-r border-elaw-subtle-border bg-elaw-panel-bg py-4"
      aria-label="主导航"
    >
      <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-elaw-primary text-lg font-bold text-white shadow-md">
        E
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeNav === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`
                group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all
                ${
                  isActive
                    ? 'bg-elaw-primary/15 text-elaw-primary'
                    : 'text-elaw-text-secondary hover:bg-elaw-glass-highlight hover:text-elaw-text-primary'
                }
              `}
            >
              <Icon className="h-5 w-5" />
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-elaw-primary" />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
