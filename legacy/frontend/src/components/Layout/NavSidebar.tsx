import type { ElementType } from 'react'
import { MessageSquare, User, Wrench, Settings } from 'lucide-react'
import { useLayoutStore, type NavItem } from '@/stores/layoutStore'
import QRCodeButton from './QRCodeButton'
import PersonaAvatar from '../Character/PersonaAvatar'

interface NavItemDef {
  id: NavItem
  label: string
  subLabel: string
  icon: ElementType
}

const NAV_ITEMS: NavItemDef[] = [
  { id: 'sessions', label: '会话', subLabel: 'CHAT', icon: MessageSquare },
  { id: 'character', label: '角色', subLabel: 'CHAR', icon: User },
  { id: 'tools', label: '工具', subLabel: 'TOOL', icon: Wrench },
  { id: 'settings', label: '设置', subLabel: 'SET', icon: Settings },
]

interface NavSidebarProps {
  onOpenPersona?: () => void
  onOpenSystemSettings?: () => void
  onCloseGlobalPages?: () => void
  onToggleToolPanel?: () => void
}

export default function NavSidebar({
  onOpenPersona,
  onOpenSystemSettings,
  onCloseGlobalPages,
  onToggleToolPanel,
}: NavSidebarProps) {
  const { activeNav, setActiveNav } = useLayoutStore()

  const handleClick = (id: NavItem) => {
    setActiveNav(id)
    switch (id) {
      case 'sessions':
        onCloseGlobalPages?.()
        break
      case 'tools':
        onToggleToolPanel?.()
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
      className="flex h-full w-32 flex-shrink-0 flex-col justify-between py-4 px-2"
      aria-label="主导航"
    >
      <div>
        <div className="mb-6 flex flex-col items-center gap-1 px-1">
          <PersonaAvatar size="sm" />
          <span className="text-[9px] font-bold tracking-wider text-dionysus-text-secondary uppercase">
            Dionysus
          </span>
        </div>

        <div className="flex flex-col gap-1">
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
                aria-current={isActive ? 'page' : undefined}
                className={`cel-nav-item flex-col gap-0 py-2 ${isActive ? 'active' : ''}`}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className="text-[10px]">{item.label}</span>
                <span className="text-[8px] tracking-wider text-dionysus-text-secondary/70">{item.subLabel}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <QRCodeButton />
        <div className="flex flex-col items-center gap-1 px-1">
          <PersonaAvatar size="xs" />
          <span className="text-[8px] font-bold tracking-widest text-dionysus-text-secondary">
            KIMI CODE CLI
          </span>
          <span className="flex items-center gap-1 text-[8px] font-medium text-dionysus-text-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-dionysus-success" />
            online
          </span>
        </div>
      </div>
    </nav>
  )
}
