import { FileSearch, Zap, FolderOpen, List } from 'lucide-react'

export type AgentMode = 'normal' | 'plan' | 'yolo' | 'plan_yolo'

interface QuickActionBarProps {
  activeMode: AgentMode
  onSetMode: (mode: AgentMode) => void
  onCdClick: () => void
  onSessionsClick: () => void
}

const MODES: { mode: AgentMode; label: string; icon: typeof FileSearch }[] = [
  { mode: 'plan', label: 'Plan', icon: FileSearch },
  { mode: 'yolo', label: 'Yolo', icon: Zap },
]

export default function QuickActionBar({
  activeMode,
  onSetMode,
  onCdClick,
  onSessionsClick,
}: QuickActionBarProps) {
  const toggleMode = (mode: AgentMode) => {
    onSetMode(activeMode === mode ? 'normal' : mode)
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2 pt-1 scrollbar-thin">
      {MODES.map(({ mode, label, icon: Icon }) => {
        const active = activeMode === mode || activeMode === 'plan_yolo'
        return (
          <button
            key={mode}
            type="button"
            onClick={() => toggleMode(mode)}
            className={`
              flex flex-shrink-0 items-center gap-1.5 rounded-full border-2 px-3 py-1 text-xs font-bold transition-all
              ${
                active
                  ? 'border-dionysus-primary bg-dionysus-primary/20 text-dionysus-primary'
                  : 'border-dionysus-glass-border bg-dionysus-glass-highlight text-dionysus-text-secondary hover:border-dionysus-primary/50'
              }
            `}
            title={
              mode === 'plan'
                ? '下一条消息以 plan mode 发送（--plan）'
                : '下一条消息以 yolo 模式发送（自动确认）'
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        )
      })}

      <button
        type="button"
        onClick={onCdClick}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-full border-2 border-dionysus-glass-border bg-dionysus-glass-highlight px-3 py-1 text-xs font-bold text-dionysus-text-secondary transition-all hover:border-dionysus-primary/50"
        title="切换工作目录并打开文件夹"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        cd
      </button>

      <button
        type="button"
        onClick={onSessionsClick}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-full border-2 border-dionysus-glass-border bg-dionysus-glass-highlight px-3 py-1 text-xs font-bold text-dionysus-text-secondary transition-all hover:border-dionysus-primary/50"
        title="列出 Kimi CLI 会话"
      >
        <List className="h-3.5 w-3.5" />
        Sessions
      </button>
    </div>
  )
}
