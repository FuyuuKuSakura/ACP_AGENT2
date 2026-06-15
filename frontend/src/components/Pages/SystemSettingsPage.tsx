import { useEffect, useState } from 'react'
import { Bot, Save } from 'lucide-react'

interface AgentConfig {
  default: string
  adapters: Record<string, { command?: string; working_dir?: string; enabled?: boolean; type?: string; model?: string; [k: string]: unknown }>
}

interface AdapterCapability {
  adapter_id: string
  enabled: boolean
  supports_model: boolean
}

export default function SystemSettingsPage() {
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [adapterCapabilities, setAdapterCapabilities] = useState<Record<string, AdapterCapability>>({})
  const [selectedAdapter, setSelectedAdapter] = useState<string>('')
  const [adapterCommand, setAdapterCommand] = useState<string>('')
  const [adapterWorkingDir, setAdapterWorkingDir] = useState<string>('')
  const [adapterModel, setAdapterModel] = useState<string>('')
  const [originalWorkingDir, setOriginalWorkingDir] = useState<string>('')
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
        const adapterId = data.default
        setSelectedAdapter(adapterId)
        const cfg = data.adapters[adapterId] || {}
        const workingDir = (cfg.working_dir as string) || ''
        setAdapterCommand((cfg.command as string) || '')
        setAdapterWorkingDir(workingDir)
        setOriginalWorkingDir(workingDir)
        setAdapterModel((cfg.model as string) || '')
      })
      .catch(() => setAgentConfig(null))
  }, [])

  const selectedSupportsModel = adapterCapabilities[selectedAdapter]?.supports_model ?? false

  const onAdapterChange = (id: string) => {
    setSelectedAdapter(id)
    const cfg = agentConfig?.adapters[id] || {}
    const workingDir = (cfg.working_dir as string) || ''
    setAdapterCommand((cfg.command as string) || '')
    setAdapterWorkingDir(workingDir)
    setOriginalWorkingDir(workingDir)
    setAdapterModel((cfg.model as string) || '')
  }

  const saveAgent = async () => {
    if (!agentConfig) return
    if (adapterWorkingDir !== originalWorkingDir) {
      const confirmed = window.confirm('修改全局 working_dir 会影响所有会话，确定要继续吗？')
      if (!confirmed) return
    }
    setSaving(true)
    setMessage(null)
    try {
      const updates: Record<string, string> = {
        command: adapterCommand,
        working_dir: adapterWorkingDir,
      }
      if (selectedSupportsModel) {
        updates.model = adapterModel
      }
      const res = await fetch('/api/settings/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default: selectedAdapter,
          adapter_id: selectedAdapter,
          updates,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setOriginalWorkingDir(adapterWorkingDir)
        setMessage('已保存并将在下次发送时重启 adapter')
      } else {
        setMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const adapterOptions = Object.entries(agentConfig?.adapters || {})
    .filter(([, cfg]) => cfg.enabled !== false)
    .map(([id]) => id)

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Bot className="h-4 w-4 text-dionysus-primary" />
          Agent 连接
        </div>
        <select
          value={selectedAdapter}
          onChange={(e) => onAdapterChange(e.target.value)}
          className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
        >
          {adapterOptions.length === 0 && selectedAdapter && (
            <option value={selectedAdapter}>{selectedAdapter}</option>
          )}
          {adapterOptions.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>

        <label className="mb-1.5 block text-xs text-dionysus-text-secondary">命令路径</label>
        <input
          type="text"
          value={adapterCommand}
          onChange={(e) => setAdapterCommand(e.target.value)}
          className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
          placeholder="kimi"
        />

        <label className="mb-1.5 block text-xs text-dionysus-text-secondary">全局工作目录</label>
        <input
          type="text"
          value={adapterWorkingDir}
          onChange={(e) => setAdapterWorkingDir(e.target.value)}
          className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
          placeholder="/Users/..."
        />

        {selectedSupportsModel && (
          <>
            <label className="mb-1.5 block text-xs text-dionysus-text-secondary">默认模型</label>
            <input
              type="text"
              value={adapterModel}
              onChange={(e) => setAdapterModel(e.target.value)}
              className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
              placeholder="例如 claude-sonnet-4 / gpt-5.4"
            />
          </>
        )}

        <div className="flex items-center gap-2">
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

      <section className="pt-4 border-t border-dionysus-subtle-border">
        <div className="rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5 text-xs text-dionysus-text-secondary">
          Dionysus v0.2.0 · Dionysus Agent Companion
        </div>
      </section>
    </div>
  )
}
