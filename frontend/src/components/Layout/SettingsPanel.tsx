import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Palette, User, Bot, Save, Check, Upload } from 'lucide-react'
import { useSettingsStore, type StylePreset, type FontSize } from '@/stores/settingsStore'
import { useLive2DStore } from '@/stores/live2dStore'
import { panelWidthClasses } from '@/lib/layout'
import ThemeSwitcher from './ThemeSwitcher'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  onOpenThemeStudio?: () => void
  initialTab?: Tab
}

type Tab = 'appearance' | 'persona' | 'agent'

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

export default function SettingsPanel({ isOpen, onClose, onOpenThemeStudio, initialTab }: SettingsPanelProps) {
  const { live2dEnabled, stylePreset, fontSize, setLive2dEnabled, setStylePreset, setFontSize } =
    useSettingsStore()
  const { setTrackingEnabled } = useLive2DStore()

  const [activeTab, setActiveTab] = useState<Tab>('appearance')
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
            className={`fixed inset-y-0 right-0 z-50 ${panelWidthClasses()} border-l border-elaw-subtle-border bg-elaw-panel-bg shadow-xl backdrop-blur-xl`}
            role="dialog"
            aria-modal="true"
            aria-label="设置面板"
          >
            <div className="flex h-14 items-center justify-between border-b border-elaw-subtle-border px-4">
              <h2 className="text-base font-semibold text-elaw-text-primary">设置</h2>
              <button
                type="button"
                onClick={onClose}
                className="cel-button p-2 text-elaw-text-secondary"
                aria-label="关闭设置"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex border-b border-elaw-subtle-border">
              {[
                { id: 'appearance', label: '外观', icon: Palette },
                { id: 'persona', label: '角色', icon: User },
                { id: 'agent', label: 'Agent', icon: Bot },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id as Tab)}
                  className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-bold transition-all ${
                    activeTab === id
                      ? 'border-elaw-primary text-elaw-primary'
                      : 'border-transparent text-elaw-text-secondary hover:text-elaw-text-primary'
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
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-elaw-text-primary">
                      <Palette className="h-4 w-4 text-elaw-primary" />
                      主题
                    </div>
                    <ThemeSwitcher />
                    {onOpenThemeStudio && (
                      <button
                        type="button"
                        onClick={onOpenThemeStudio}
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2 text-xs font-bold text-elaw-text-secondary transition-colors hover:border-elaw-primary/50 hover:text-elaw-primary"
                      >
                        <Palette className="h-3.5 w-3.5" />
                        打开调色盘
                      </button>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-elaw-text-primary">风格预设</div>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { id: 'cel', label: '赛璐珞' },
                        { id: 'flat', label: '扁平' },
                        { id: 'contrast', label: '高对比' },
                      ] as { id: StylePreset; label: string }[]).map(({ id, label }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setStylePreset(id)}
                          className={`rounded-xl border-2 px-2 py-2 text-xs font-bold transition-all ${
                            stylePreset === id
                              ? 'border-elaw-primary bg-elaw-primary/15 text-elaw-primary'
                              : 'border-elaw-subtle-border bg-elaw-glass-highlight text-elaw-text-secondary'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-elaw-text-primary">字体大小</div>
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
                              ? 'border-elaw-primary bg-elaw-primary/15 text-elaw-primary'
                              : 'border-elaw-subtle-border bg-elaw-glass-highlight text-elaw-text-secondary'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-elaw-text-primary">角色展示</div>
                    <label className="flex cursor-pointer items-center justify-between rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2.5">
                      <span className="text-sm font-medium text-elaw-text-primary">启用 Live2D</span>
                      <input
                        type="checkbox"
                        checked={live2dEnabled}
                        onChange={(e) => handleLive2dChange(e.target.checked)}
                        className="peer sr-only"
                      />
                      <span className="relative h-6 w-11 rounded-full border-2 border-elaw-subtle-border bg-elaw-chat-bg transition-colors peer-checked:border-elaw-primary peer-checked:bg-elaw-primary after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
                    </label>
                  </section>
                </>
              )}

              {activeTab === 'persona' && (
                <>
                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-elaw-text-primary">
                      <User className="h-4 w-4 text-elaw-primary" />
                      当前角色
                    </div>
                    <select
                      value={selectedPersona}
                      onChange={(e) => setSelectedPersona(e.target.value)}
                      className="w-full rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2 text-sm text-elaw-text-primary outline-none focus:border-elaw-primary"
                    >
                      {personas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                    {personas.find((p) => p.id === selectedPersona)?.description && (
                      <p className="mt-2 text-xs text-elaw-text-secondary">
                        {personas.find((p) => p.id === selectedPersona)?.description}
                      </p>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-elaw-text-primary">提示词 / QA 数据集（YAML）</div>
                    <textarea
                      value={personaYaml}
                      onChange={(e) => setPersonaYaml(e.target.value)}
                      rows={16}
                      className="w-full rounded-xl border-2 border-elaw-subtle-border bg-elaw-code-bg px-3 py-2 font-mono text-xs text-elaw-text-primary outline-none focus:border-elaw-primary"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={savePersona}
                        disabled={personaSaving}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-elaw-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {personaSaving ? '保存中…' : '保存'}
                      </button>
                      {personaMessage && (
                        <span className="flex items-center gap-1 text-xs text-elaw-success">
                          <Check className="h-3.5 w-3.5" />
                          {personaMessage}
                        </span>
                      )}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-medium text-elaw-text-primary">语料文件</div>
                    <div className="flex items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-1.5 text-xs font-bold text-elaw-text-primary transition-all hover:border-elaw-primary/50">
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
                        <span className="max-w-[8rem] truncate text-xs text-elaw-text-secondary">
                          {corpusFile.name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={uploadCorpus}
                        disabled={!corpusFile}
                        className="rounded-xl border-2 border-black/20 bg-elaw-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
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
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-elaw-text-primary">
                      <Bot className="h-4 w-4 text-elaw-primary" />
                      Agent 连接
                    </div>
                    <select
                      value={selectedAdapter}
                      onChange={(e) => onAdapterChange(e.target.value)}
                      className="mb-3 w-full rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2 text-sm text-elaw-text-primary outline-none focus:border-elaw-primary"
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

                    <label className="mb-2 block text-xs text-elaw-text-secondary">命令路径</label>
                    <input
                      type="text"
                      value={adapterCommand}
                      onChange={(e) => setAdapterCommand(e.target.value)}
                      className="mb-3 w-full rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2 text-sm text-elaw-text-primary outline-none focus:border-elaw-primary"
                      placeholder="kimi"
                    />

                    <label className="mb-2 block text-xs text-elaw-text-secondary">工作目录</label>
                    <input
                      type="text"
                      value={adapterWorkingDir}
                      onChange={(e) => setAdapterWorkingDir(e.target.value)}
                      className="mb-3 w-full rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2 text-sm text-elaw-text-primary outline-none focus:border-elaw-primary"
                      placeholder="/Users/..."
                    />

                    {selectedSupportsModel && (
                      <>
                        <label className="mb-2 block text-xs text-elaw-text-secondary">
                          默认模型
                        </label>
                        <input
                          type="text"
                          value={adapterModel}
                          onChange={(e) => setAdapterModel(e.target.value)}
                          className="mb-3 w-full rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2 text-sm text-elaw-text-primary outline-none focus:border-elaw-primary"
                          placeholder="例如 claude-sonnet-4 / gpt-5.4"
                        />
                      </>
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={saveAgent}
                        disabled={agentSaving}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-elaw-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {agentSaving ? '保存中…' : '保存并重启'}
                      </button>
                      {agentMessage && (
                        <span className="text-xs text-elaw-text-secondary">{agentMessage}</span>
                      )}
                    </div>
                  </section>
                </>
              )}

              <section className="pt-4 border-t border-elaw-subtle-border">
                <div className="rounded-xl border-2 border-elaw-subtle-border bg-elaw-glass-highlight px-3 py-2.5 text-xs text-elaw-text-secondary">
                  ELAW v0.2.0 · Exusiai Live Agent WebUI
                </div>
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
