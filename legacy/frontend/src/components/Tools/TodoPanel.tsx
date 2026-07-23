import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useChatStore } from '@/stores/chatStore'

export default function TodoPanel() {
  const todos = useChatStore((state) => {
    const sessionId = state.currentSessionId
    return sessionId ? state.sessionTodos[sessionId] ?? [] : state.todos
  })
  const isStreaming = useChatStore((state) => state.isStreaming)

  if (todos.length === 0 && !isStreaming) {
    return null
  }

  const doneCount = todos.filter((t) => t.done).length
  const progress = todos.length === 0 ? 0 : Math.round((doneCount / todos.length) * 100)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-b-2 border-dionysus-glass-border bg-dionysus-glass-bg/60 p-3 dark:backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-dionysus-text-primary">
          <span className="rounded-md bg-dionysus-primary/15 px-1.5 py-0.5 text-dionysus-primary">
            TODO
          </span>
          <span>流程进度</span>
        </div>
        <div className="text-xs text-dionysus-text-secondary">
          {doneCount}/{todos.length}
        </div>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-dionysus-glass-border">
        <motion.div
          className="h-full rounded-full bg-dionysus-primary"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>

      {todos.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-dionysus-text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-dionysus-primary" />
          等待任务开始…
        </div>
      ) : (
        <ul className="flex-1 min-h-0 space-y-1.5 overflow-y-auto touch-pan-y scrollbar-thin">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`flex items-center gap-2 text-xs ${
                todo.done
                  ? 'text-dionysus-text-secondary line-through'
                  : 'text-dionysus-text-primary'
              }`}
            >
              {todo.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-dionysus-success" />
              ) : (
                <Circle className="h-3.5 w-3.5 flex-shrink-0 text-dionysus-primary" />
              )}
              <span className="truncate">{todo.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
