import { Search, User } from 'lucide-react'

interface MobileSessionListHeaderProps {
  connected?: boolean
}

export default function MobileSessionListHeader({ connected = false }: MobileSessionListHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-dionysus-subtle-border bg-dionysus-panel-bg p-4 md:hidden">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dionysus-primary text-sm font-bold text-white">
            <User className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-dionysus-text-primary">Dionysus</div>
            <div className="flex items-center gap-1.5 text-xs text-dionysus-text-secondary">
              <span
                className={`h-2 w-2 rounded-full ${connected ? 'bg-dionysus-status-online' : 'bg-dionysus-system'}`}
              />
              {connected ? '在线' : '未连接'}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2">
        <Search className="h-4 w-4 text-dionysus-text-secondary" />
        <input
          type="text"
          placeholder="搜索会话..."
          className="flex-1 bg-transparent text-sm text-dionysus-text-primary placeholder:text-dionysus-text-secondary/60 outline-none"
        />
      </div>
    </div>
  )
}
