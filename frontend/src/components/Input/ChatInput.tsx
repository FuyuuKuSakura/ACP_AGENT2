import { useState, useRef, useCallback, useEffect } from 'react'
import { Paperclip, Send, Zap, Bot, ChevronDown } from 'lucide-react'
import { useAdapterStore } from '@/stores/adapterStore'
import QuickActionBar, { type AgentMode } from './QuickActionBar'

interface ChatInputProps {
  sendMessage: (message: unknown) => boolean
}

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
  const [showAdapterMenu, setShowAdapterMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const adapterMenuRef = useRef<HTMLDivElement>(null)

  const { currentAdapter, availableAdapters, fetchAdapters, switchAdapter } = useAdapterStore()

  useEffect(() => {
    fetchAdapters()
  }, [fetchAdapters])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        adapterMenuRef.current &&
        !adapterMenuRef.current.contains(e.target as Node)
      ) {
        setShowAdapterMenu(false)
      }
    }
    if (showAdapterMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showAdapterMenu])

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
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

  const handleInterrupt = useCallback(() => {
    sendMessage({ type: 'interrupt' })
  }, [sendMessage])

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

  const handleAdapterChange = (id: string) => {
    switchAdapter(id)
    sendMessage({
      type: 'client_command',
      payload: { command: 'switch_adapter', args: id },
    })
    setShowAdapterMenu(false)
  }

  const enabledAdapters = availableAdapters.filter((a) => a.enabled)

  return (
    <div className="flex flex-col border-t border-dionysus-subtle-border bg-dionysus-glass-bg px-4 py-3 backdrop-blur-xl">
      <QuickActionBar
        activeMode={activeMode}
        onSetMode={setActiveMode}
        onCdClick={handleCdClick}
        onSessionsClick={handleSessionsClick}
      />
      <div className="flex items-end gap-1.5 rounded-2xl border border-dionysus-subtle-border bg-dionysus-glass-bg px-2 py-1.5 backdrop-blur-md sm:gap-2 sm:px-3 sm:py-2">
        <div className="relative" ref={adapterMenuRef}>
          <button
            type="button"
            onClick={() => setShowAdapterMenu((v) => !v)}
            className="flex items-center gap-1 rounded-full border border-dionysus-subtle-border bg-dionysus-glass-highlight px-2 py-1.5 text-xs font-bold text-dionysus-text-secondary transition-all hover:border-dionysus-primary/50 sm:gap-1.5 sm:px-3 sm:py-2"
            aria-label="选择 Agent"
            title="选择 Agent"
          >
            <Bot className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{currentAdapter || 'Agent'}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
          {showAdapterMenu && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-48 rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-bg p-1 shadow-xl backdrop-blur-xl">
              {enabledAdapters.map((a) => (
                <button
                  key={a.adapter_id}
                  type="button"
                  onClick={() => handleAdapterChange(a.adapter_id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                    a.adapter_id === currentAdapter
                      ? 'bg-dionysus-primary/15 text-dionysus-primary'
                      : 'text-dionysus-text-secondary hover:bg-dionysus-glass-highlight'
                  }`}
                >
                  <span>{a.adapter_id}</span>
                  {a.supports_model && (
                    <span className="rounded bg-dionysus-glass-highlight px-1 text-[10px] text-dionysus-text-secondary">
                      model
                    </span>
                  )}
                </button>
              ))}
              {enabledAdapters.length === 0 && (
                <div className="px-3 py-2 text-xs text-dionysus-text-secondary">无可用 Agent</div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="rounded-full p-1.5 text-dionysus-text-secondary transition-colors hover:bg-dionysus-glass-highlight sm:p-2"
          aria-label="添加附件"
          title="添加附件"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <span className="select-none pb-2 text-sm text-dionysus-text-secondary sm:pb-2.5">&gt;</span>

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
          className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-dionysus-text-primary outline-none placeholder:text-dionysus-text-secondary/70"
        />

        <button
          type="button"
          onClick={handleInterrupt}
          className="rounded-full p-1.5 text-dionysus-danger transition-colors hover:bg-dionysus-danger/10 sm:p-2"
          aria-label="中断"
          title="中断"
        >
          <Zap className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim()}
          className="rounded-full bg-dionysus-primary p-2 text-white shadow-md transition-all hover:brightness-110 active:translate-y-px disabled:opacity-50 sm:p-2.5"
          aria-label="发送"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
