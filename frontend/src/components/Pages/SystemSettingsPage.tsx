import { useEffect, useState } from 'react'
import { Bot, Save, History, Trash2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'

interface AgentConfig {
  default: string
  adapters: Record<string, { command?: string; working_dir?: string; enabled?: boolean; type?: string; model?: string; [k: string]: unknown }>
}

interface AdapterCapability {
  adapter_id: string
  enabled: boolean
  supports_model: boolean
}

interface AdapterEditState {
  command: string
  model: string
  enabled: boolean
}

export default function SystemSettingsPage() {
  const { historyLimit, setHistoryLimit } = useSettingsStore()

  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [adapterCapabilities, setAdapterCapabilities] = useState<Record<string, AdapterCapability>>({})
  const [defaultAdapter, setDefaultAdapter] = useState<string>('')
  const [edits, setEdits] = useState<Record<string, AdapterEditState>>({})
  const [serverHistoryLimit, setServerHistoryLimit] = useState<number>(historyLimit)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/adapters')
      .then((r) => r.json())
      .then((data: Record<string, AdapterCapability>) => setAdapterCapabilities(data))
      .catch(() => setAdapterCapabilities({}))

    fetch('/api/settings/agent')
      .then((r) => r.json())
      .then((data: AgentConfig) => {
        setAgentConfig(data)
        setDefaultAdapter(data.default)
        const initialEdits: Record<string, AdapterEditState> = {}
        Object.entries(data.adapters || {}).forEach(([id, cfg]) => {
          initialEdits[id] = {
            command: (cfg.command as string) || '',
            model: (cfg.model as string) || '',
            enabled: cfg.enabled !== false,
          }
        })
        setEdits(initialEdits)
      })
      .catch(() => setAgentConfig(null))

    fetch('/api/settings/server')
      .then((r) => r.json())
      .then((data: { history_limit: number }) => {
        setServerHistoryLimit(data.history_limit)
        setHistoryLimit(data.history_limit)
      })
      .catch(() => setServerHistoryLimit(historyLimit))
  }, [historyLimit, setHistoryLimit])

  const showMessage = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(null), 3000)
  }

  const updateEdit = (id: string, patch: Partial<AdapterEditState>) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const saveAgent = async () => {
    if (!agentConfig) return
    setSaving(true)
    setMessage(null)
    try {
      const adapters: Record<string, { command: string; model: string; enabled: boolean }> = {}
      Object.entries(edits).forEach(([id, cfg]) => {
        adapters[id] = {
          command: cfg.command.trim(),
          model: cfg.model.trim(),
          enabled: cfg.enabled,
        }
      })
      const res = await fetch('/api/settings/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default: defaultAdapter,
          adapters,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        showMessage('Agent 配置已保存，启用/禁用变更将在后端重启后生效')
      } else {
        showMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      showMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveHistoryLimit = async () => {
    const value = Math.max(1, Math.round(serverHistoryLimit))
    setSaving(true)
    try {
      const res = await fetch('/api/settings/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_limit: value }),
      })
      if (res.ok) {
        setHistoryLimit(value)
        showMessage('历史记录上限已保存')
      } else {
        showMessage('保存失败')
      }
    } catch {
      showMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const clearLocalCache = () => {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith('dionysus-cache-') || key === 'dionysus-settings')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key))
    window.location.reload()
  }

  const adapterIds = Object.keys(agentConfig?.adapters || {})

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <History className="h-4 w-4 text-dionysus-primary" />
          历史记录
        </div>
        <label className="mb-1.5 block text-xs text-dionysus-text-secondary">
          单会话保留消息数（1-500）
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            max={500}
            value={serverHistoryLimit}
            onChange={(e) => setServerHistoryLimit(Number(e.target.value))}
            className="min-w-0 flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
          />
          <button
            type="button"
            onClick={saveHistoryLimit}
            disabled={saving}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            保存
          </button>
        </div>
      </section>

      <section className="border-t border-dionysus-subtle-border pt-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Bot className="h-4 w-4 text-dionysus-primary" />
          Agent 连接
        </div>

        <div className="space-y-3">
          {adapterIds.map((id) => {
            const cfg = edits[id] || { command: '', model: '', enabled: false }
            const supportsModel = adapterCapabilities[id]?.supports_model ?? false
            return (
              <div
                key={id}
                className="rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="default_adapter"
                      checked={defaultAdapter === id}
                      onChange={() => setDefaultAdapter(id)}
                      className="h-4 w-4 accent-dionysus-primary"
                      title="设为默认"
                    />
                    <span className="text-sm font-medium text-dionysus-text-primary">{id}</span>
                    {defaultAdapter === id && (
                      <span className="rounded bg-dionysus-primary/15 px-1.5 py-0.5 text-[10px] text-dionysus-primary">
                        默认
                      </span>
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-dionysus-text-secondary">
                    启用
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) => updateEdit(id, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-dionysus-primary"
                    />
                  </label>
                </div>

                <label className="mb-1 block text-xs text-dionysus-text-secondary">命令路径</label>
                <input
                  type="text"
                  value={cfg.command}
                  onChange={(e) => updateEdit(id, { command: e.target.value })}
                  className="mb-2 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-bg px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                  placeholder={id === 'kimi_cli' ? 'kimi' : id.replace('_cli', '')}
                />

                {supportsModel && (
                  <>
                    <label className="mb-1 block text-xs text-dionysus-text-secondary">默认模型</label>
                    <input
                      type="text"
                      value={cfg.model}
                      onChange={(e) => updateEdit(id, { model: e.target.value })}
                      className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-bg px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                      placeholder="例如 claude-sonnet-4 / gpt-5.4"
                    />
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={saveAgent}
            disabled={saving}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中…' : '保存并重启'}
          </button>
          {message && (
            <span className="text-xs text-dionysus-text-secondary">{message}</span>
          )}
        </div>
      </section>

      <section className="border-t border-dionysus-subtle-border pt-4">
        <button
          type="button"
          onClick={clearLocalCache}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-text-secondary transition-colors hover:border-dionysus-danger/50 hover:text-dionysus-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
          清除本地缓存
        </button>
      </section>

      <section className="border-t border-dionysus-subtle-border pt-4">
        <button
          type="button"
          onClick={async () => {
            try {
              const res = await fetch('/api/open-cc-switch', { method: 'POST' })
              const data = await res.json()
              if (data.success) {
                showMessage('已打开 CC Switch')
              } else {
                showMessage(`打开失败：${data.error || '未知错误'}`)
              }
            } catch {
              showMessage('打开失败：无法调用后端')
            }
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-text-secondary transition-colors hover:border-dionysus-primary/50 hover:text-dionysus-primary"
        >
          <img src="/ccswitch_icon.png" alt="CC Switch" className="h-5 w-5 rounded-md object-cover" />
          打开 CC Switch
        </button>
      </section>

      <section>
        <div className="rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5 text-xs text-dionysus-text-secondary">
          Dionysus v0.1.0 · By FuyuuKu樱
        </div>
      </section>
    </div>
  )
}
