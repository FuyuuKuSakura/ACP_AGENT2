import { useState, useRef, useCallback } from 'react'
import { FileSearch, Zap, FolderOpen, List, History, Send } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'

interface ChatInputProps {
  sendMessage: (message: unknown) => boolean
}

export type AgentMode = 'normal' | 'plan' | 'yolo' | 'plan_yolo'

function computeRows(text: string): number {
  const lines = text.split('\n').length
  return Math.min(5, Math.max(1, lines))
}

type ParsedCommand =
  | { type: 'user_input'; text: string; mode?: AgentMode }
  | {
      type: 'client_command'
      command:
        | 'change_working_dir'
        | 'list_kimi_sessions'
        | 'switch_kimi_session'
        | 'switch_adapter'
      args: string
    }

function parseSlashCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  const planMatch = trimmed.match(/^\/(plan|planmode)\s+(.*)$/i)
  if (planMatch) {
    return { type: 'user_input', text: planMatch[2].trim(), mode: 'plan' }
  }
  const yoloMatch = trimmed.match(/^\/yolo\s+(.*)$/i)
  if (yoloMatch) {
    return { type: 'user_input', text: yoloMatch[1].trim(), mode: 'yolo' }
  }
  const pyMatch = trimmed.match(/^\/(py|planyolo)\s+(.*)$/i)
  if (pyMatch) {
    return { type: 'user_input', text: pyMatch[2].trim(), mode: 'plan_yolo' }
  }
  const cdMatch = trimmed.match(/^\/cd\s+(\S.*)$/)
  if (cdMatch) {
    return { type: 'client_command', command: 'change_working_dir', args: cdMatch[1].trim() }
  }
  if (/^\/sessions?$/i.test(trimmed)) {
    return { type: 'client_command', command: 'list_kimi_sessions', args: '' }
  }
  const switchMatch = trimmed.match(/^\/switch\s+(\S+)$/i)
  if (switchMatch) {
    return { type: 'client_command', command: 'switch_kimi_session', args: switchMatch[1] }
  }
  const adapterMatch = trimmed.match(/^\/adapter\s+(\S+)$/i)
  if (adapterMatch) {
    return { type: 'client_command', command: 'switch_adapter', args: adapterMatch[1] }
  }
  return null
}

export default function ChatInput({ sendMessage }: ChatInputProps) {
  const [text, setText] = useState('')
  const [activeMode, setActiveMode] = useState<AgentMode>('normal')
  const [historyOpen, setHistoryOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const messages = useChatStore((state) => state.messages)
  const historyLimit = useSettingsStore((state) => state.historyLimit)

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const toggleMode = (mode: AgentMode) => {
    setActiveMode((prev) => (prev === mode ? 'normal' : mode))
  }

  const doSend = useCallback(
    (command: ParsedCommand | { type: 'user_input'; text: string; mode?: AgentMode }) => {
      if (command.type === 'user_input') {
        sendMessage({
          type: 'user_input',
          payload: {
            text: command.text,
            attachments: [],
            interrupt_before_send: false,
            mode: command.mode ?? activeMode,
          },
        })
      } else {
        sendMessage({
          type: 'client_command',
          payload: {
            command: command.command,
            args: command.args,
          },
        })
      }
      setText('')
      setActiveMode('normal')
      resetHeight()
    },
    [sendMessage, activeMode]
  )

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    const slash = parseSlashCommand(trimmed)
    if (slash) {
      doSend(slash)
      return
    }
    doSend({ type: 'user_input', text: trimmed })
  }, [text, doSend])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const target = e.target
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 5 * 24)}px`
  }

  const handleCdClick = () => {
    const path = window.prompt('输入要切换的工作目录路径：')
    if (path?.trim()) {
      sendMessage({
        type: 'client_command',
        payload: { command: 'change_working_dir', args: path.trim() },
      })
    }
  }

  const handleSessionsClick = () => {
    sendMessage({
      type: 'client_command',
      payload: { command: 'list_kimi_sessions' },
    })
  }

  const iconButtonClass =
    'rounded-lg p-1.5 text-dionysus-text-secondary transition-colors hover:bg-dionysus-glass-highlight hover:text-dionysus-text-primary'

  const activeIconClass =
    'rounded-lg p-1.5 text-dionysus-primary transition-colors hover:bg-dionysus-glass-highlight'

  const historyMessages = messages.slice(-historyLimit)

  return (
    <div className="relative flex flex-col border border-dionysus-glass-border/50 bg-dionysus-background/40 px-3 py-2 backdrop-blur-xl dark:border-dionysus-glass-border/40">
        {/* Top toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => toggleMode('plan')}
              className={activeMode === 'plan' || activeMode === 'plan_yolo' ? activeIconClass : iconButtonClass}
              title="Plan"
            >
              <FileSearch className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => toggleMode('yolo')}
              className={activeMode === 'yolo' || activeMode === 'plan_yolo' ? activeIconClass : iconButtonClass}
              title="Yolo"
            >
              <Zap className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleCdClick}
              className={iconButtonClass}
              title="cd"
            >
              <FolderOpen className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={handleSessionsClick}
              className={iconButtonClass}
              title="Sessions"
            >
              <List className="h-5 w-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className={historyOpen ? activeIconClass : iconButtonClass}
            title="历史记录"
          >
            <History className="h-5 w-5" />
          </button>
        </div>

        {/* History popover */}
        {historyOpen && (
          <div className="absolute inset-x-3 bottom-full mb-2 max-h-60 overflow-y-auto rounded-xl border border-dionysus-glass-border bg-dionysus-glass-bg p-2 shadow-lg backdrop-blur-xl">
            {historyMessages.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-dionysus-text-secondary">
                暂无历史消息
              </div>
            ) : (
              <ul className="space-y-1">
                {historyMessages.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-lg bg-dionysus-glass-highlight/50 px-2 py-1 text-xs text-dionysus-text-secondary"
                  >
                    <span className="mr-1 font-medium text-dionysus-text-primary">
                      {m.role === 'user' ? '我' : m.role === 'agent' ? 'Agent' : '系统'}
                    </span>
                    {m.content.slice(0, 80)}
                    {m.content.length > 80 && '…'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            rows={computeRows(text)}
            placeholder="给 Agent 发送消息…"
            className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-dionysus-text-primary outline-none placeholder:text-dionysus-text-secondary/70"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim()}
            className="mb-0.5 rounded-lg p-2 text-dionysus-primary transition-colors hover:bg-dionysus-glass-highlight disabled:opacity-40"
            aria-label="发送"
            title="发送"
          >
            <Send className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  )
}
