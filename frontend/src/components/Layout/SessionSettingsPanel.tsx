import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Palette, User, Bot, Save, Check, Upload, Layers } from 'lucide-react'
import { useSettingsStore, type FontSize } from '@/stores/settingsStore'
import { useLive2DStore } from '@/stores/live2dStore'
import { useChatStore } from '@/stores/chatStore'
import { panelWidthClasses } from '@/lib/layout'
import ThemeSwitcher from './ThemeSwitcher'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  onOpenThemeStudio?: () => void
  initialTab?: Tab
  sendMessage?: (message: unknown) => boolean
}

type Tab = 'appearance' | 'persona' | 'agent' | 'session'

interface PersonaInfo {
  id: string
  name?: string
  description?: string
}

interface AgentConfig {
  default: string
  adapters: Record<string, { command?: string; working_dir?: string; enabled?: boolean; type?: string; model?: string; [k: string]: unknown }>
}

interface AdapterCapability {
  adapter_id: string
  enabled: boolean
  supports_model: boolean
}

export default function SettingsPanel({ isOpen, onClose, onOpenThemeStudio, initialTab, sendMessage }: SettingsPanelProps) {
  const {
    live2dEnabled,
    fontSize,
    compactMode,
    setLive2dEnabled,
    setFontSize,
    setCompactMode,
  } = useSettingsStore()
  const { setTrackingEnabled } = useLive2DStore()

  const [activeTab, setActiveTab] = useState<Tab>('appearance')

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab)
    }
  }, [isOpen, initialTab])

  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [selectedPersona, setSelectedPersona] = useState<string>('exusiai')
  const [personaYaml, setPersonaYaml] = useState<string>('')
  const [personaSaving, setPersonaSaving] = useState(false)
  const [personaMessage, setPersonaMessage] = useState<string | null>(null)
  const [corpusFile, setCorpusFile] = useState<File | null>(null)

  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [adapterCapabilities, setAdapterCapabilities] = useState<Record<string, AdapterCapability>>({})
  const [selectedAdapter, setSelectedAdapter] = useState<string>('')
  const [adapterCommand, setAdapterCommand] = useState<string>('')
  const [adapterWorkingDir, setAdapterWorkingDir] = useState<string>('')
  const [adapterModel, setAdapterModel] = useState<string>('')
  const [agentSaving, setAgentSaving] = useState(false)
  const [agentMessage, setAgentMessage] = useState<string | null>(null)

  const selectedSupportsModel = adapterCapabilities[selectedAdapter]?.supports_model ?? false

  const handleLive2dChange = (enabled: boolean) => {
    setLive2dEnabled(enabled)
    setTrackingEnabled(enabled)
  }

  useEffect(() => {
    if (!isOpen) return
    fetch('/api/personas')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : []
        setPersonas(list)
        const first = list[0]?.id || 'exusiai'
        setSelectedPersona((prev) => prev || first)
      })
      .catch(() => setPersonas([]))

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
        setAdapterCommand((cfg.command as string) || '')
        setAdapterWorkingDir((cfg.working_dir as string) || '')
        setAdapterModel((cfg.model as string) || '')
      })
      .catch(() => setAgentConfig(null))
  }, [isOpen])

  useEffect(() => {
    if (!selectedPersona) return
    fetch(`/api/personas/${selectedPersona}`)
      .then((r) => r.json())
      .then((data) => setPersonaYaml(data.yaml || ''))
      .catch(() => setPersonaYaml(''))
  }, [selectedPersona])

  const savePersona = async () => {
    setPersonaSaving(true)
    setPersonaMessage(null)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: personaYaml }),
      })
      const data = await res.json()
      if (res.ok) {
        setPersonaMessage('保存成功')
      } else {
        setPersonaMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch (e) {
      setPersonaMessage('保存失败')
    } finally {
      setPersonaSaving(false)
    }
  }

  const uploadCorpus = async () => {
    if (!corpusFile || !selectedPersona) return
    const form = new FormData()
    form.append('file', corpusFile)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/corpus`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      setCorpusFile(null)
      setPersonaMessage(res.ok ? '语料上传成功' : `上传失败：${data.error || '未知错误'}`)
    } catch {
      setPersonaMessage('上传失败')
    }
  }

  const saveAgent = async () => {
    if (!agentConfig) return
    setAgentSaving(true)
    setAgentMessage(null)
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
        setAgentMessage('已保存并将在下次发送时重启 adapter')
      } else {
        setAgentMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      setAgentMessage('保存失败')
    } finally {
      setAgentSaving(false)
    }
  }

  const onAdapterChange = (id: string) => {
    setSelectedAdapter(id)
    const cfg = agentConfig?.adapters[id] || {}
    setAdapterCommand((cfg.command as string) || '')
    setAdapterWorkingDir((cfg.working_dir as string) || '')
    setAdapterModel((cfg.model as string) || '')
  }

  const adapterOptions = useMemo(() => {
    if (!agentConfig) return []
    return Object.entries(agentConfig.adapters)
      .filter(([, cfg]) => cfg.enabled !== false)
      .map(([id]) => id)
  }, [agentConfig])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/40"
            aria-hidden="true"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed inset-y-0 right-0 z-50 ${panelWidthClasses()} border-l border-dionysus-subtle-border bg-dionysus-panel-bg shadow-xl backdrop-blur-xl`}
            role="dialog"
            aria-modal="true"
            aria-label="设置面板"
          >
            <div className="flex h-14 items-center justify-between border-b border-dionysus-subtle-border px-4">
              <h2 className="text-base font-semibold text-dionysus-text-primary">设置</h2>
              <button
                type="button"
                onClick={onClose}
                className="cel-button p-2 text-dionysus-text-secondary"
                aria-label="关闭设置"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex border-b border-dionysus-subtle-border">
              {[
                { id: 'appearance', label: '外观', icon: Palette },
                { id: 'session', label: '会话', icon: Layers },
                { id: 'persona', label: '角色', icon: User },
                { id: 'agent', label: 'Agent', icon: Bot },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id as Tab)}
                  className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-bold transition-all ${
                    activeTab === id
                      ? 'border-dionysus-primary text-dionysus-primary'
                      : 'border-transparent text-dionysus-text-secondary hover:text-dionysus-text-primary'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-6 overflow-y-auto p-4">
              {activeTab === 'appearance' && (
                <>
                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
                      <Palette className="h-4 w-4 text-dionysus-primary" />
                      主题
                    </div>
                    <ThemeSwitcher />
                    {onOpenThemeStudio && (
                      <button
                        type="button"
                        onClick={onOpenThemeStudio}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-text-secondary transition-colors hover:border-dionysus-primary/50 hover:text-dionysus-primary"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        打开调色盘
                      </button>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-dionysus-text-primary">字体大小</div>
                    <div className="flex gap-2">
                      {([
                        { id: 'small', label: '小' },
                        { id: 'default', label: '默认' },
                        { id: 'large', label: '大' },
                      ] as { id: FontSize; label: string }[]).map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setFontSize(id)}
                          className={`flex-1 rounded-xl border-2 px-2 py-2 text-xs font-bold transition-all ${
                            fontSize === id
                              ? 'border-dionysus-primary bg-dionysus-primary/15 text-dionysus-primary'
                              : 'border-dionysus-subtle-border bg-dionysus-glass-highlight text-dionysus-text-secondary'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-dionysus-text-primary">角色展示</div>
                    <label className="flex cursor-pointer items-center justify-between rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5">
                      <span className="text-sm font-medium text-dionysus-text-primary">启用 Live2D</span>
                      <input
                        type="checkbox"
                        checked={live2dEnabled}
                        onChange={(e) => handleLive2dChange(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="relative h-6 w-11 rounded-full border-2 border-dionysus-subtle-border bg-dionysus-chat-bg transition-colors peer-checked:border-dionysus-primary peer-checked:bg-dionysus-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
                    </label>
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-dionysus-text-primary">界面密度</div>
                    <label className="flex cursor-pointer items-center justify-between rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5">
                      <span className="text-sm font-medium text-dionysus-text-primary">紧凑模式</span>
                      <input
                        type="checkbox"
                        checked={compactMode}
                        onChange={(e) => setCompactMode(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="relative h-6 w-11 rounded-full border-2 border-dionysus-subtle-border bg-dionysus-chat-bg transition-colors peer-checked:border-dionysus-primary peer-checked:bg-dionysus-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
                    </label>
                  </section>
                </>
              )}

              {activeTab === 'persona' && (
                <>
                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
                      <User className="h-4 w-4 text-dionysus-primary" />
                      当前角色
                    </div>
                    <select
                      value={selectedPersona}
                      onChange={(e) => setSelectedPersona(e.target.value)}
                      className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                    >
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                    {personas.find((p) => p.id === selectedPersona)?.description && (
                      <p className="mt-2 text-xs text-dionysus-text-secondary">
                        {personas.find((p) => p.id === selectedPersona)?.description}
                      </p>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-dionysus-text-primary">提示词 / QA 数据集（YAML）</div>
                    <textarea
                      value={personaYaml}
                      onChange={(e) => setPersonaYaml(e.target.value)}
                      rows={16}
                      className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-code-bg px-3 py-2 font-mono text-xs text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={savePersona}
                        disabled={personaSaving}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {personaSaving ? '保存中…' : '保存'}
                      </button>
                      {personaMessage && (
                        <span className="flex items-center gap-1 text-xs text-dionysus-success">
                          <Check className="h-3.5 w-3.5" />
                          {personaMessage}
                        </span>
                      )}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-dionysus-text-primary">语料文件</div>
                    <div className="flex items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-1.5 text-xs font-bold text-dionysus-text-primary transition-all hover:border-dionysus-primary/50">
                        <Upload className="h-3.5 w-3.5" />
                        选择 .txt 语料
                        <input
                          type="file"
                          accept=".txt"
                          onChange={(e) => setCorpusFile(e.target.files?.[0] || null)}
                          className="sr-only"
                        />
                      </label>
                      {corpusFile && (
                        <span className="max-w-[8rem] truncate text-xs text-dionysus-text-secondary">
                          {corpusFile.name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={uploadCorpus}
                        disabled={!corpusFile}
                        className="rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                      >
                        上传
                      </button>
                    </div>
                  </section>
                </>
              )}

              {activeTab === 'agent' && (
                <>
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

                    <label className="mb-2 block text-xs text-dionysus-text-secondary">命令路径</label>
                    <input
                      type="text"
                      value={adapterCommand}
                      onChange={(e) => setAdapterCommand(e.target.value)}
                      className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                      placeholder="kimi"
                    />

                    <label className="mb-2 block text-xs text-dionysus-text-secondary">工作目录</label>
                    <input
                      type="text"
                      value={adapterWorkingDir}
                      onChange={(e) => setAdapterWorkingDir(e.target.value)}
                      className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                      placeholder="/Users/..."
                    />

                    {selectedSupportsModel && (
                      <>
                        <label className="mb-2 block text-xs text-dionysus-text-secondary">
                          默认模型
                        </label>
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
                        disabled={agentSaving}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {agentSaving ? '保存中…' : '保存并重启'}
                      </button>
                      {agentMessage && (
                        <span className="text-xs text-dionysus-text-secondary">{agentMessage}</span>
                      )}
                    </div>
                  </section>
                </>
              )}

              {activeTab === 'session' && (
                <SessionSettingsTab
                  personas={personas}
                  adapterOptions={adapterOptions}
                  sendMessage={sendMessage}
                />
              )}

              <section className="pt-4 border-t border-dionysus-subtle-border">
                <div className="rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2.5 text-xs text-dionysus-text-secondary">
                  Dionysus v0.2.0 · Dionysus Agent Companion
                </div>
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

interface SessionSettingsTabProps {
  personas: PersonaInfo[]
  adapterOptions: string[]
  sendMessage?: (message: unknown) => boolean
}

function SessionSettingsTab({ personas, adapterOptions, sendMessage }: SessionSettingsTabProps) {
  const { sessions, currentSessionId, renameSession, updateSession } = useChatStore()
  const session = sessions.find((s) => s.id === currentSessionId)

  const [title, setTitle] = useState(session?.title ?? '')
  const [workingDir, setWorkingDir] = useState('')
  const [selectedPersona, setSelectedPersona] = useState(session?.persona_id ?? 'exusiai')
  const [selectedAdapter, setSelectedAdapter] = useState(adapterOptions[0] ?? '')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (session) {
      setTitle(session.title)
      setSelectedPersona(session.persona_id)
    }
  }, [session])

  useEffect(() => {
    setSelectedAdapter(adapterOptions[0] ?? '')
  }, [adapterOptions])

  const showMessage = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(null), 2000)
  }

  const handleRename = () => {
    if (!session || !title.trim()) return
    renameSession(session.id, title.trim())
    showMessage('会话标题已更新')
  }

  const handlePersonaChange = (id: string) => {
    if (!session) return
    setSelectedPersona(id)
    updateSession(session.id, { persona_id: id })
    sendMessage?.({
      type: 'client_command',
      payload: { command: 'switch_persona', args: id },
    })
    showMessage('角色已切换')
  }

  const handleSwitchAdapter = () => {
    if (!selectedAdapter) return
    sendMessage?.({
      type: 'client_command',
      payload: { command: 'switch_adapter', args: selectedAdapter },
    })
    showMessage(`已发送切换 adapter 请求：${selectedAdapter}`)
  }

  const handleChangeWorkingDir = () => {
    if (!workingDir.trim()) return
    sendMessage?.({
      type: 'client_command',
      payload: { command: 'change_working_dir', args: workingDir.trim() },
    })
    showMessage(`已发送切换工作目录请求`)
  }

  if (!session) {
    return (
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Layers className="h-4 w-4 text-dionysus-primary" />
          当前会话
        </div>
        <p className="rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs text-dionysus-text-secondary">
          暂无选中会话，请先创建一个会话。
        </p>
      </section>
    )
  }

  return (
    <>
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

        <label className="mb-1.5 block text-xs text-dionysus-text-secondary">角色</label>
        <select
          value={selectedPersona}
          onChange={(e) => handlePersonaChange(e.target.value)}
          className="mb-3 w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>

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
    </>
  )
}
