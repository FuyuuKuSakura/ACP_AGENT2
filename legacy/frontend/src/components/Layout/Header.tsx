import { useEffect } from 'react'
import {
  ArrowLeft,
  Sparkles,
  Bot,
  LayoutGrid,
  BarChart3,
  Bell,
  Search,
} from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useAdapterStore } from '@/stores/adapterStore'
import { useLayoutStore } from '@/stores/layoutStore'

interface HeaderProps {
  onSettingsClick: () => void
  showBack?: boolean
  connected?: boolean
  settingsActive?: boolean
  onOpenPalette?: () => void
  onToggleResourcePanel?: () => void
}

export default function Header({
  onSettingsClick,
  showBack = false,
  connected = false,
  settingsActive = false,
  onOpenPalette,
  onToggleResourcePanel,
}: HeaderProps) {
  const currentSession = useChatStore((state) =>
    state.sessions.find((s) => s.id === state.currentSessionId),
  )
  const { currentAdapter, fetchAdapters } = useAdapterStore()
  const { toggleCompanionDrawer, toggleResourcePanel, setMobileView } = useLayoutStore()

  useEffect(() => {
    fetchAdapters()
  }, [fetchAdapters])

  const sessionAdapterId = currentSession?.adapter_id ?? currentAdapter
  const displayLabel = (sessionAdapterId ?? '未配置')
    .replace(/_/g, '.')
    .toUpperCase()

  const handleResourceClick = () => {
    onToggleResourcePanel?.()
  }

  const iconButtonClass =
    'rounded-md p-1 text-dionysus-text-secondary transition-colors hover:bg-dionysus-glass-highlight hover:text-dionysus-text-primary'

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-dionysus-border bg-transparent px-4 md:h-8 md:border-b-0 md:bg-transparent md:px-0">
      {/* Mobile: back + session title */}
      <div className="flex items-center gap-2 md:hidden">
        {showBack && (
          <button
            type="button"
            onClick={() => setMobileView('session-list')}
            className="cel-button p-2 text-dionysus-text-secondary"
            aria-label="返回会话列表"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="truncate px-2 text-base font-semibold text-dionysus-text-primary sm:text-lg">
          {currentSession?.title ?? 'Dionysus'}
        </h1>
      </div>

      {/* Desktop: search/agent status pill */}
      <div className="hidden items-center gap-2 md:flex">
        <div className="cel-status-pill pl-1" title="当前 Agent">
          <Search className="h-3.5 w-3.5" />
          <span className="font-medium text-dionysus-text-primary">{displayLabel}</span>
          <span
            className={`ml-0.5 h-1.5 w-1.5 rounded-full ${connected ? 'bg-dionysus-success' : 'bg-dionysus-system'}`}
          />
          <span className="text-[10px] uppercase tracking-wide">{connected ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      </div>

      {/* Desktop: center tool icons matching design draft */}
      <div className="hidden items-center gap-1 md:flex">
        <button
          type="button"
          onClick={onOpenPalette}
          className={iconButtonClass}
          aria-label="调色盘"
          title="调色盘"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleResourceClick}
          className={iconButtonClass}
          aria-label="资源面板"
          title="资源面板"
        >
          <BarChart3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onSettingsClick}
          className={`${iconButtonClass} ${settingsActive ? 'text-dionysus-primary' : ''}`}
          aria-label="会话设置"
          title="会话设置"
        >
          <Bell className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={iconButtonClass}
          aria-label="搜索"
          title="搜索"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {currentAdapter && (
          <div className="cel-status-pill md:hidden" title="当前 Agent">
            <Bot className="h-3 w-3" />
            <span className="hidden sm:inline">{displayLabel}</span>
          </div>
        )}
        <div className="cel-status-pill md:hidden" title={connected ? '已连接' : '未连接'}>
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-dionysus-success' : 'bg-dionysus-system'}`}
          />
          <span className="hidden sm:inline">{connected ? '已连接' : '未连接'}</span>
        </div>

        {/* Mobile-only companion / resource toggles to preserve existing functionality */}
        <button
          type="button"
          onClick={toggleCompanionDrawer}
          className="cel-button p-2 text-dionysus-text-secondary md:hidden"
          aria-label="角色陪伴"
          title="角色陪伴"
        >
          <Sparkles className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={toggleResourcePanel}
          className="cel-button p-2 text-dionysus-text-secondary md:hidden"
          aria-label="资源面板"
          title="资源面板"
        >
          <LayoutGrid className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
