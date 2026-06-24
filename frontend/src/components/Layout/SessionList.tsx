import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Pencil, MoreVertical } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { useSettingsStore } from '@/stores/settingsStore'
import MobileSessionListHeader from './MobileSessionListHeader'
import type { Session } from '@/types/protocol'

interface SessionListProps {
  sendMessage?: (message: unknown) => boolean
}

interface ContextMenuState {
  x: number
  y: number
  sessionId: string
}

function latestMessagePreview(session: Session): string {
  const last = session.messages[session.messages.length - 1]
  if (!last) return '暂无消息'
  const text = last.content.slice(0, 32)
  return text.length < last.content.length ? `${text}…` : text
}

export default function SessionList({ sendMessage }: SessionListProps) {
  const sessions = useChatStore((state) => state.sessions)
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const setCurrentSession = useChatStore((state) => state.setCurrentSession)
  const deleteSession = useChatStore((state) => state.deleteSession)
  const renameSession = useChatStore((state) => state.renameSession)

  const { isSessionListOpen, setMobileView } = useLayoutStore()

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const globalPersonaId = useSettingsStore((state) => state.globalPersonaId)

  const handleNewSession = () => {
    sendMessage?.({ type: 'new_session', payload: { persona_id: globalPersonaId } })
  }

  const handleSelect = (id: string) => {
    setCurrentSession(id)
    setMobileView('chat')
  }

  const handleContextMenu = (e: React.MouseEvent, session: Session) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
  }

  const handleMenuClick = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setContextMenu({ x: rect.left, y: rect.bottom + 4, sessionId: session.id })
  }

  const startRename = () => {
    const session = sessions.find((s) => s.id === contextMenu?.sessionId)
    if (session) {
      setEditingId(session.id)
      setEditingTitle(session.title)
    }
    setContextMenu(null)
  }

  const handleDelete = () => {
    if (contextMenu) {
      deleteSession(contextMenu.sessionId)
    }
    setContextMenu(null)
  }

  const commitRename = () => {
    const trimmed = editingTitle.trim()
    if (editingId && trimmed) {
      renameSession(editingId, trimmed)
    }
    setEditingId(null)
    setEditingTitle('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingTitle('')
  }

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handleClick, true)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick, true)
      window.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  return (
    <aside
      className={`
        flex h-full flex-shrink-0 flex-col border-r border-dionysus-subtle-border bg-dionysus-background/10 backdrop-blur-xl
        transition-all duration-300 ease-in-out
        ${isSessionListOpen ? 'w-full md:w-64' : 'w-0 overflow-hidden'}
      `}
      aria-label="会话列表"
    >
      <MobileSessionListHeader />

      <div className="hidden h-14 flex-shrink-0 items-center justify-between border-b border-dionysus-subtle-border px-4 md:flex">
        <span className="font-semibold text-dionysus-text-primary">会话</span>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={handleNewSession}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-dionysus-primary px-4 py-2 text-sm font-bold text-white shadow-md transition-all hover:brightness-110 active:translate-y-px"
          title="新建会话"
        >
          <Plus className="h-4 w-4" />
          新建会话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="py-8 text-center text-sm text-dionysus-text-secondary">
            暂无会话
          </div>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map((session) => {
              const isActive = currentSessionId === session.id
              return (
                <li key={session.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(session.id)}
                    onContextMenu={(e) => handleContextMenu(e, session)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelect(session.id)
                      }
                    }}
                    className={`
                      group relative flex w-full flex-col rounded-xl border px-3 py-2 text-left transition-all
                      ${
                        isActive
                          ? 'border-transparent bg-dionysus-primary/10'
                          : 'border-transparent bg-dionysus-glass-highlight/50 hover:border-dionysus-subtle-border hover:bg-dionysus-glass-highlight'
                      }
                    `}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-dionysus-primary" />
                    )}
                    {editingId === session.id ? (
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitRename()
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            cancelRename()
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="w-full rounded border border-dionysus-primary bg-dionysus-glass-highlight px-1.5 py-0.5 text-sm text-dionysus-text-primary outline-none"
                      />
                    ) : (
                      <>
                        <div className="truncate pr-6 text-sm font-medium text-dionysus-text-primary">
                          {session.title}
                        </div>
                        <div className="truncate pr-6 text-xs text-dionysus-text-secondary">
                          {latestMessagePreview(session)}
                        </div>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleMenuClick(e, session)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-dionysus-text-secondary opacity-0 transition-colors hover:bg-dionysus-glass-highlight hover:text-dionysus-text-primary group-hover:opacity-100 focus:opacity-100"
                      aria-label="会话操作"
                      title="会话操作"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[8rem] rounded-lg border border-dionysus-subtle-border bg-dionysus-glass-bg p-1 shadow-lg backdrop-blur-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={startRename}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-dionysus-text-primary hover:bg-dionysus-primary/10"
          >
            <Pencil className="h-3.5 w-3.5" />
            重命名
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-dionysus-danger hover:bg-dionysus-danger/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      )}
    </aside>
  )
}
