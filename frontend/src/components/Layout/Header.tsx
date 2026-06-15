import { useEffect } from 'react'
import { ArrowLeft, Settings, Sparkles, Bot, LayoutGrid } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useAdapterStore } from '@/stores/adapterStore'
import { useLayoutStore } from '@/stores/layoutStore'

interface HeaderProps {
  onSettingsClick: () => void
  showBack?: boolean
  connected?: boolean
  settingsActive?: boolean
}

export default function Header({ onSettingsClick, showBack = false, connected = false, settingsActive = false }: HeaderProps) {
  const currentSession = useChatStore((state) =>
    state.sessions.find((s) => s.id === state.currentSessionId),
  )
  const { currentAdapter, availableAdapters, fetchAdapters } = useAdapterStore()
  const { toggleCompanionDrawer, toggleResourcePanel, setMobileView } = useLayoutStore()

  useEffect(() => {
    fetchAdapters()
  }, [fetchAdapters])

  const currentAdapterLabel =
    availableAdapters.find((a) => a.adapter_id === currentAdapter)?.adapter_id ?? currentAdapter

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-dionysus-glass-border bg-dionysus-background/40 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2">
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

      <div className="flex items-center gap-1 sm:gap-2">
        {currentAdapter && (
          <div
            className="cel-button flex items-center gap-1.5 rounded-full border border-dionysus-subtle-border bg-dionysus-glass-highlight px-2.5 py-1 text-xs text-dionysus-text-secondary"
            title="当前 Agent"
          >
            <Bot className="h-3 w-3" />
            <span className="hidden sm:inline">{currentAdapterLabel}</span>
          </div>
        )}
        <div
          className="cel-button flex items-center gap-1.5 rounded-full border border-dionysus-subtle-border bg-dionysus-glass-highlight px-2.5 py-1 text-xs text-dionysus-text-secondary"
          title={connected ? '已连接' : '未连接'}
        >
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-dionysus-status-online' : 'bg-dionysus-system'}`}
          />
          <span className="hidden sm:inline">{connected ? '已连接' : '未连接'}</span>
        </div>
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
        <button
          type="button"
          onClick={onSettingsClick}
          className={`cel-button hidden p-2 md:flex ${settingsActive ? 'text-dionysus-primary' : 'text-dionysus-text-secondary'}`}
          aria-label="会话设置"
          title="会话设置"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </header>
  )
}
