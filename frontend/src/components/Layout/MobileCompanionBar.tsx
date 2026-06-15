import { ChevronDown, Loader2, CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useLayoutStore } from '@/stores/layoutStore'

export default function MobileCompanionBar() {
  const { setCompanionDrawerOpen } = useLayoutStore()
  const { streamingStatus, todos, companionLine } = useChatStore()

  const latestTodo = todos[todos.length - 1]
  const status = streamingStatus?.status ?? 'idle'
  const detail = streamingStatus?.detail ?? latestTodo?.text ?? companionLine ?? '点击展开角色陪伴'

  const statusIcon = () => {
    switch (status) {
      case 'thinking':
      case 'reading_file':
      case 'executing':
      case 'outputting':
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-elaw-primary" />
      case 'error':
        return <XCircle className="h-3.5 w-3.5 text-elaw-danger" />
      case 'idle':
      default:
        return <Sparkles className="h-3.5 w-3.5 text-elaw-text-secondary" />
    }
  }

  return (
    <button
      type="button"
      onClick={() => setCompanionDrawerOpen(true)}
      className="flex w-full items-center justify-between gap-3 border-b border-elaw-subtle-border bg-elaw-panel-bg px-4 py-2.5 text-left md:hidden"
      aria-label="展开角色陪伴"
    >
      <div className="flex min-w-0 items-center gap-2">
        {statusIcon()}
        <span className="truncate text-xs text-elaw-text-secondary">
          {detail}
        </span>
      </div>
      <ChevronDown className="h-4 w-4 flex-shrink-0 text-elaw-text-secondary" />
    </button>
  )
}
