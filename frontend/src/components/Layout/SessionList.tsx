import { useState, useEffect, useRef, useMemo } from 'react'
import { Plus, Trash2, MessageSquare, Pencil } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useLayoutStore } from '@/stores/layoutStore'
import type { Session } from '@/types/protocol'

interface SessionListProps {
  sendMessage?: (message: unknown) => boolean
}

interface ContextMenuState {
  x: number
  y: number
  sessionId: string
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusColor(status: Session['status']): string {
  switch (status) {
    case 'processing':
    case 'streaming':
      return 'bg-elaw-status-busy'
    case 'interrupted':
      return 'bg-elaw-status-offline'
    default:
      return 'bg-elaw-status-online'
  }
}

function groupSessions(sessions: Session[]) {
  const now = Date.now()
  const oneDay = 24 * 60 * 60 * 1000
  const groups: { label: string; items: Session[] }[] = []
  const today: Session[] = []
  const earlier: Session[] = []

  sessions.forEach((s) => {
    if (now - s.updated_at < oneDay) today.push(s)
    else earlier.push(s)
  })

  if (today.length) groups.push({ label: '今天', items: today })
  if (earlier.length) groups.push({ label: '更早', items: earlier })
  return groups
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

  const groups = useMemo(() => groupSessions(sessions), [sessions])

  const handleNewSession = () => {
    sendMessage?.({ type: 'new_session', payload: { persona_id: 'exusiai' } })
  }

  const handleSelect = (id: string) => {
    setCurrentSession(id)
    setMobileView('chat')
  }

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteSession(id)
    setContextMenu(null)
  }

  const handleContextMenu = (e: React.MouseEvent, session: Session) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
  }

  const startRename = () => {
    const session = sessions.find((s) => s.id === contextMenu?.sessionId)
    if (session) {
      setEditingId(session.id)
      setEditingTitle(session.title)
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
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  return (
    <aside
      className={`
        flex h-full flex-shrink-0 flex-col border-r border-elaw-subtle-border bg-elaw-panel-bg
        transition-all duration-300 ease-in-out
        ${isSessionListOpen ? 'w-64' : 'w-0 overflow-hidden'}
      `}
      aria-label="会话列表"
    >
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-elaw-subtle-border px-4">
        <span className="font-semibold text-elaw-text-primary">会话</span>
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={handleNewSession}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-elaw-primary px-4 py-2 text-sm font-bold text-white shadow-md transition-all hover:brightness-110 active:translate-y-px"
          title="新建会话"
        >
          <Plus className="h-4 w-4" />
          新建会话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
        {sessions.length === 0 ? (
          <div className="py-8 text-center text-sm text-elaw-text-secondary">
            暂无会话
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="mb-2 px-2 text-xs font-bold text-elaw-text-secondary">
                  {group.label}
                </div>
                <ul className="space-y-1.5">
                  {group.items.map((session) => (
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
                          group flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all
                          ${
                            currentSessionId === session.id
                              ? 'border-elaw-primary/50 bg-elaw-primary/10'
                              : 'border-transparent bg-elaw-glass-highlight/50 hover:border-elaw-subtle-border hover:bg-elaw-glass-highlight'
                          }
                        `}
                      >
                        <span
                          className={`h-2 w-2 flex-shrink-0 rounded-full ${statusColor(session.status)}`}
                          title={session.status}
                        />
                        <MessageSquare
                          className={`h-4 w-4 flex-shrink-0 ${
                            currentSessionId === session.id
                              ? 'text-elaw-primary'
                              : 'text-elaw-text-secondary'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
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
                              className="w-full rounded border border-elaw-primary bg-elaw-glass-highlight px-1.5 py-0.5 text-sm text-elaw-text-primary outline-none"
                            />
                          ) : (
                            <>
                              <div className="truncate text-sm font-medium text-elaw-text-primary">
                                {session.title}
                              </div>
                              <div className="text-xs text-elaw-text-secondary">
                                {formatTime(session.updated_at)}
                              </div>
                            </>
                          )}
                        </div>
                        {editingId !== session.id && (
                          <button
                            type="button"
                            onClick={(e) => handleDelete(e, session.id)}
                            className="rounded p-1 text-elaw-text-secondary opacity-0 group-hover:opacity-100 hover:text-elaw-danger focus:opacity-100"
                            aria-label="删除会话"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] min-w-[8rem] rounded-lg border border-elaw-subtle-border bg-elaw-glass-bg p-1 shadow-lg backdrop-blur-md"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={startRename}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-elaw-text-primary hover:bg-elaw-primary/10"
          >
            <Pencil className="h-3.5 w-3.5" />
            重命名
          </button>
          <button
            type="button"
            onClick={() => deleteSession(contextMenu.sessionId)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-elaw-danger hover:bg-elaw-danger/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </button>
        </div>
      )}
    </aside>
  )
}
