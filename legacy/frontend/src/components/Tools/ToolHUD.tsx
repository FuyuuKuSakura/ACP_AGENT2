import { motion, AnimatePresence } from 'framer-motion'
import { Wrench, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'

export default function ToolHUD() {
  const activeToolCallId = useChatStore((state) => state.activeToolCallId)
  const toolCalls = useChatStore((state) => state.toolCalls)

  const activeTool = toolCalls.find((t) => t.id === activeToolCallId)

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-dionysus-primary" />
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-dionysus-success" />
      case 'error':
        return <XCircle className="h-4 w-4 text-dionysus-danger" />
      default:
        return <Wrench className="h-4 w-4 text-dionysus-primary" />
    }
  }

  return (
    <AnimatePresence>
      {activeTool && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
          className="pointer-events-none absolute bottom-24 left-4 z-30 flex max-w-xs items-center gap-3 rounded-xl border border-dionysus-glass-border bg-dionysus-glass-bg/90 px-4 py-3 shadow-lg backdrop-blur-md sm:bottom-28 sm:left-6 sm:max-w-sm"
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-dionysus-primary/10">
            {statusIcon(activeTool.status)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-dionysus-text-secondary">
              正在调用工具
            </p>
            <p className="truncate text-sm font-semibold text-dionysus-text-primary">
              {activeTool.name}
            </p>
            {activeTool.args && (
              <p className="truncate text-xs text-dionysus-text-secondary/80">
                {activeTool.args}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
