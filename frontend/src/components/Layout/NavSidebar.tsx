import { MessageSquare, Palette, User, Settings } from 'lucide-react'
import { useLayoutStore, type NavItem } from '@/stores/layoutStore'
import QRCodeButton from './QRCodeButton'

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

interface NavSidebarProps {
  onOpenPalette?: () => void
  onOpenPersona?: () => void
  onOpenSystemSettings?: () => void
  onCloseGlobalPages?: () => void
}

export default function NavSidebar({
  onOpenPalette,
  onOpenPersona,
  onOpenSystemSettings,
  onCloseGlobalPages,
}: NavSidebarProps) {
  const { activeNav, setActiveNav } = useLayoutStore()

  const handleClick = (id: NavItem) => {
    setActiveNav(id)
    switch (id) {
      case 'sessions':
        onCloseGlobalPages?.()
        break
      case 'themes':
        onOpenPalette?.()
        break
      case 'character':
        onOpenPersona?.()
        break
      case 'settings':
        onOpenSystemSettings?.()
        break
    }
  }

  return (
    <nav
      className="flex h-full w-16 flex-shrink-0 flex-col items-center border-r border-dionysus-subtle-border bg-dionysus-background py-4 backdrop-blur-xl"
      aria-label="主导航"
    >
      <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-dionysus-primary text-lg font-bold text-white shadow-md">
        D
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeNav === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleClick(item.id)}
              title={item.label}
              aria-label={item.label}
              className={`
                group relative flex h-11 w-11 items-center justify-center rounded-xl transition-all
                ${
                  isActive
                    ? 'bg-dionysus-primary/15 text-dionysus-primary'
                    : 'text-dionysus-text-secondary hover:bg-dionysus-glass-highlight hover:text-dionysus-text-primary'
                }
              `}
            >
              <Icon className="h-5 w-5" />
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-dionysus-primary" />
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-auto">
        <QRCodeButton />
      </div>
    </nav>
  )
}
