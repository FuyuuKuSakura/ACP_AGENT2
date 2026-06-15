import { useEffect, useMemo, useState } from 'react'
import { Save, Layers, Check } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { panelWidthClasses } from '@/lib/layout'

interface SessionSettingsPanelProps {
  sendMessage?: (message: unknown) => boolean
  className?: string
}

interface AdapterCapability {
  adapter_id: string
  enabled: boolean
  supports_model: boolean
  working_dir?: string
}

export default function SessionSettingsPanel({ sendMessage, className = '' }: SessionSettingsPanelProps) {
  const { sessions, currentSessionId, renameSession, updateSession } = useChatStore()
  const session = sessions.find((s) => s.id === currentSessionId)

  const [adapterCapabilities, setAdapterCapabilities] = useState<Record<string, AdapterCapability>>({})

  const [title, setTitle] = useState(session?.title ?? '')
  const [workingDir, setWorkingDir] = useState(session?.working_dir ?? '')
  const [selectedAdapter, setSelectedAdapter] = useState(session?.adapter_id ?? '')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/adapters')
      .then((r) => r.json())
      .then((data: Record<string, AdapterCapability>) => {
        setAdapterCapabilities(data)
        const list = Object.values(data).filter((a) => a.enabled !== false)
        const defaultId = list[0]?.adapter_id ?? ''
        setSelectedAdapter((prev) => prev || defaultId)
      })
      .catch(() => setAdapterCapabilities({}))
  }, [])

  useEffect(() => {
    if (session) {
      setTitle(session.title)
      setSelectedAdapter((prev) => session.adapter_id ?? prev)
      const fallback = session.adapter_id
        ? adapterCapabilities[session.adapter_id]?.working_dir ?? ''
        : ''
      setWorkingDir(session.working_dir ?? fallback)
    }
  }, [session, adapterCapabilities])

  const showMessage = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(null), 2000)
  }

  const handleRename = () => {
    if (!session || !title.trim()) return
    renameSession(session.id, title.trim())
    showMessage('会话标题已更新')
  }

  const handleSwitchAdapter = () => {
    if (!session || !selectedAdapter) return
    updateSession(session.id, { adapter_id: selectedAdapter })
    sendMessage?.({
      type: 'client_command',
      payload: { command: 'switch_adapter', args: selectedAdapter },
    })
    showMessage(`已发送切换 adapter 请求：${selectedAdapter}`)
  }

  const handleChangeWorkingDir = () => {
    if (!session || !workingDir.trim()) return
    const confirmed = window.confirm('修改工作目录会影响当前会话，确定要继续吗？')
    if (!confirmed) return
    updateSession(session.id, { working_dir: workingDir.trim() })
    sendMessage?.({
      type: 'client_command',
      payload: { command: 'change_working_dir', args: workingDir.trim() },
    })
    showMessage('已发送切换工作目录请求')
  }

  const adapterOptions = useMemo(() => {
    return Object.values(adapterCapabilities)
      .filter((a) => a.enabled !== false)
      .map((a) => a.adapter_id)
  }, [adapterCapabilities])

  if (!session) {
    return (
      <aside
        className={`flex h-full flex-shrink-0 flex-col border-l border-dionysus-subtle-border bg-dionysus-glass-bg backdrop-blur-xl ${panelWidthClasses()} ${className}`}
      >
        <div className="flex h-14 flex-shrink-0 items-center border-b border-dionysus-subtle-border px-4">
          <h2 className="text-base font-semibold text-dionysus-text-primary">会话设置</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <section>
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
              <Layers className="h-4 w-4 text-dionysus-primary" />
              当前会话
            </div>
            <p className="rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs text-dionysus-text-secondary">
              暂无选中会话，请先创建一个会话。
            </p>
          </section>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`flex h-full flex-shrink-0 flex-col border-l border-dionysus-subtle-border bg-dionysus-glass-bg backdrop-blur-xl ${panelWidthClasses()} ${className}`}
    >
      <div className="flex h-14 flex-shrink-0 items-center border-b border-dionysus-subtle-border px-4">
        <h2 className="text-base font-semibold text-dionysus-text-primary">会话设置</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
            <Layers className="h-4 w-4 text-dionysus-primary" />
            当前会话
          </div>

          <label className="mb-1.5 block text-xs text-dionysus-text-secondary">会话标题</label>
          <div className="mb-3 flex gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
              placeholder="输入会话名称"
            />
            <button
              type="button"
              onClick={handleRename}
              disabled={!title.trim() || title.trim() === session.title}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              重命名
            </button>
          </div>

          <label className="mb-1.5 block text-xs text-dionysus-text-secondary">Adapter</label>
          <div className="mb-3 flex gap-2">
            <select
              value={selectedAdapter}
              onChange={(e) => setSelectedAdapter(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
            >
              {adapterOptions.length === 0 && (
                <option value="">未启用 adapter</option>
              )}
              {adapterOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSwitchAdapter}
              disabled={!selectedAdapter}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
            >
              切换
            </button>
          </div>

          <label className="mb-1.5 block text-xs text-dionysus-text-secondary">工作目录</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
              placeholder="/Users/..."
            />
            <button
              type="button"
              onClick={handleChangeWorkingDir}
              disabled={!workingDir.trim()}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
            >
              应用
            </button>
          </div>

          {message && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-dionysus-success">
              <Check className="h-3.5 w-3.5" />
              {message}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
