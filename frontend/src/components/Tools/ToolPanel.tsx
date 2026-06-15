import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Terminal,
} from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import TodoPanel from './TodoPanel'

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function statusIcon(status: string) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-dionysus-primary" />
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-dionysus-success" />
    case 'error':
      return <XCircle className="h-4 w-4 text-dionysus-danger" />
    default:
      return <Wrench className="h-4 w-4 text-dionysus-text-secondary" />
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'success':
      return '完成'
    case 'error':
      return '失败'
    default:
      return '等待'
  }
}

export default function ToolPanel() {
  const toolCalls = useChatStore((state) => state.toolCalls)
  const streamingStatus = useChatStore((state) => state.streamingStatus)
  const isStreaming = useChatStore((state) => state.isStreaming)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const progress = streamingStatus?.progress
  const currentStatus = streamingStatus?.detail || streamingStatus?.status

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t-2 border-dionysus-glass-border bg-transparent p-4 backdrop-blur-md">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
        <Terminal className="h-4 w-4 text-dionysus-primary" />
        执行进度
      </div>

      {isStreaming && currentStatus && (
        <div className="mb-3 rounded-lg border border-dionysus-glass-border bg-dionysus-glass-highlight px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-dionysus-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-dionysus-primary" />
            <span className="capitalize">{currentStatus}</span>
          </div>
          {typeof progress === 'number' && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-dionysus-glass-border">
              <motion.div
                className="h-full rounded-full bg-dionysus-primary"
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                transition={{ duration: 0.4 }}
              />
            </div>
          )}
        </div>
      )}

      <TodoPanel />

      <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y scrollbar-thin">
        {toolCalls.length === 0 ? (
          <div className="py-4 text-center text-xs text-dionysus-text-secondary">
            暂无工具调用
          </div>
        ) : (
          <ul className="space-y-2">
            {[...toolCalls].reverse().map((tool) => {
              const isExpanded = expandedId === tool.id
              return (
                <li
                  key={tool.id}
                  className="rounded-xl border-2 border-dionysus-glass-border bg-dionysus-glass-highlight"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : tool.id)
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    {statusIcon(tool.status)}
                    <span className="min-w-0 flex-1 truncate text-sm text-dionysus-text-primary">
                      {tool.name}
                    </span>
                    <span className="text-xs text-dionysus-text-secondary">
                      {statusLabel(tool.status)}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 flex-shrink-0 text-dionysus-text-secondary transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 px-3 pb-3 pt-1">
                          {tool.args && (
                            <div>
                              <p className="mb-1 text-xs text-dionysus-text-secondary">
                                参数
                              </p>
                              <pre className="max-h-24 overflow-auto rounded-md bg-dionysus-code-bg px-2 py-1.5 text-xs text-dionysus-text-primary">
                                {tool.args}
                              </pre>
                            </div>
                          )}
                          {tool.result && (
                            <div>
                              <p className="mb-1 text-xs text-dionysus-text-secondary">
                                结果
                              </p>
                              <pre className="max-h-24 overflow-auto rounded-md bg-dionysus-code-bg px-2 py-1.5 text-xs text-dionysus-text-primary">
                                {tool.result}
                              </pre>
                            </div>
                          )}
                          <p className="text-xs text-dionysus-text-secondary/70">
                            {formatTime(tool.timestamp)}
                          </p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
