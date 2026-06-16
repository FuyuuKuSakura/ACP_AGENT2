import { useEffect, useRef, useState } from 'react'
import { User, Save, Upload, Check, FolderOpen, Plus, Unlink, RefreshCcw, Bot, X } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useLive2DStore } from '@/stores/live2dStore'
import { useSettingsStore } from '@/stores/settingsStore'
import DionysusSelect from '@/components/UI/DionysusSelect'

type SupervisorMode = 'disabled' | 'agent_session' | 'deepseek_api'

interface PersonaInfo {
  id: string
  name?: string
  description?: string
}

interface SupervisorSettings {
  mode: SupervisorMode
  interval_seconds: number
  adapter_id: string
  api_url: string
  api_model: string
  api_key: string
}

interface PersonaPageProps {
  onCloseGuardChange?: (guard: () => boolean) => void
  sendMessage?: (message: unknown) => boolean
}

const DEFAULT_SUPERVISOR: SupervisorSettings = {
  mode: 'deepseek_api',
  interval_seconds: 15,
  adapter_id: '',
  api_url: 'https://api.deepseek.com/v1/chat/completions',
  api_model: 'deepseek-reasoner',
  api_key: '',
}

export default function PersonaPage({ onCloseGuardChange, sendMessage }: PersonaPageProps) {
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const globalPersonaId = useSettingsStore((state) => state.globalPersonaId)
  const setGlobalPersonaId = useSettingsStore((state) => state.setGlobalPersonaId)
  const [selectedPersona, setSelectedPersona] = useState<string>(globalPersonaId)
  const [corpusText, setCorpusText] = useState<string>('')
  const [loadedCorpus, setLoadedCorpus] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [corpusFile, setCorpusFile] = useState<File | null>(null)
  const [live2dFiles, setLive2dFiles] = useState<File[]>([])
  const [live2dPath, setLive2dPath] = useState<string | null>(null)
  const [live2dScale, setLive2dScale] = useState<number>(1)
  const [loadedLive2dScale, setLoadedLive2dScale] = useState<number>(1)
  const live2dInputRef = useRef<HTMLInputElement>(null)

  const [supervisor, setSupervisor] = useState<SupervisorSettings>(DEFAULT_SUPERVISOR)
  const [loadedSupervisor, setLoadedSupervisor] = useState<SupervisorSettings>(DEFAULT_SUPERVISOR)
  const [adapters, setAdapters] = useState<Record<string, { enabled?: boolean }>>({})

  const [showAddModal, setShowAddModal] = useState(false)
  const [newPersona, setNewPersona] = useState({ id: '', name: '', description: '' })
  const [addError, setAddError] = useState<string | null>(null)

  const sessions = useChatStore((state) => state.sessions)
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const currentPersonaId = sessions.find((s) => s.id === currentSessionId)?.persona_id

  const isBuiltin = (id: string) => ['exusiai', "kal'tsit"].includes(id)

  const refreshPersonas = async (selectId?: string) => {
    try {
      const res = await fetch('/api/personas')
      const data = await res.json()
      const list = Array.isArray(data) ? data : []
      setPersonas(list)
      const nextId = selectId || globalPersonaId
      if (list.some((p) => p.id === nextId)) {
        setSelectedPersona(nextId)
      } else {
        const first = list[0]?.id || 'exusiai'
        setSelectedPersona(first)
      }
    } catch {
      setPersonas([])
    }
  }

  useEffect(() => {
    refreshPersonas()
    fetch('/api/settings/supervisor')
      .then((r) => r.json())
      .then((data) => {
        const cfg: SupervisorSettings = {
          mode: data.mode || 'deepseek_api',
          interval_seconds: data.interval_seconds ?? 15,
          adapter_id: data.adapter_id || '',
          api_url: data.api_url || DEFAULT_SUPERVISOR.api_url,
          api_model: data.api_model || DEFAULT_SUPERVISOR.api_model,
          api_key: data.api_key || '',
        }
        setSupervisor(cfg)
        setLoadedSupervisor(cfg)
      })
      .catch(() => {
        setSupervisor(DEFAULT_SUPERVISOR)
        setLoadedSupervisor(DEFAULT_SUPERVISOR)
      })

    fetch('/api/adapters')
      .then((r) => r.json())
      .then((data) => {
        setAdapters(data || {})
      })
      .catch(() => setAdapters({}))
  }, [])

  useEffect(() => {
    if (!selectedPersona) return
    setCorpusText('')
    setLoadedCorpus('')
    setLive2dPath(null)
    setLive2dScale(1)
    setLoadedLive2dScale(1)
    fetch(`/api/personas/${selectedPersona}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const companion = data.persona?.companion || {}
          setLive2dPath(companion.live2d?.model_path || null)
          const scale = typeof companion.live2d?.scale === 'number' ? companion.live2d.scale : 1
          setLive2dScale(scale)
          setLoadedLive2dScale(scale)
        }
      })
      .catch(() => setLive2dPath(null))
    fetch(`/api/personas/${selectedPersona}/corpus`)
      .then((r) => r.json())
      .then((data) => {
        const text = data.ok ? data.text || '' : ''
        setCorpusText(text)
        setLoadedCorpus(text)
      })
      .catch(() => {
        setCorpusText('')
        setLoadedCorpus('')
      })
  }, [selectedPersona])

  const isDirty = corpusText !== loadedCorpus || live2dScale !== loadedLive2dScale
  const supervisorDirty = JSON.stringify(supervisor) !== JSON.stringify(loadedSupervisor)

  useEffect(() => {
    const guard = () => {
      if (!isDirty && !supervisorDirty) return true
      return window.confirm('当前页面有未保存的修改，确定要放弃吗？')
    }
    onCloseGuardChange?.(guard)
    return () => onCloseGuardChange?.(() => true)
  }, [isDirty, supervisorDirty, onCloseGuardChange])

  const maybeSwitchPersona = (id: string) => {
    setGlobalPersonaId(id)
    if (sendMessage && id !== currentPersonaId) {
      sendMessage({
        type: 'client_command',
        payload: { command: 'switch_persona', args: id },
      })
      // Sync the local session so the Live2D viewer reloads immediately.
      if (currentSessionId) {
        useChatStore.getState().updateSession(currentSessionId, { persona_id: id })
      }
      useLive2DStore.getState().triggerModelReload()
    }
  }

  const handlePersonaChange = (id: string) => {
    if (isDirty && !window.confirm('当前角色有未保存的修改，确定要放弃吗？')) {
      return
    }
    setSelectedPersona(id)
    setMessage(null)
    setCorpusFile(null)
    setLive2dFiles([])
    maybeSwitchPersona(id)
  }

  const handleAddPersona = async () => {
    setAddError(null)
    const id = newPersona.id.trim()
    const name = newPersona.name.trim()
    if (!id || !name) {
      setAddError('ID 和名称不能为空')
      return
    }
    try {
      const res = await fetch('/api/personas/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          description: newPersona.description.trim(),
        }),
      })
      const data = await res.json()
      if (res.ok && data.id) {
        setNewPersona({ id: '', name: '', description: '' })
        setShowAddModal(false)
        setGlobalPersonaId(data.id)
        await refreshPersonas(data.id)
        setMessage('角色添加成功')
        maybeSwitchPersona(data.id)
      } else {
        setAddError(`添加失败：${data.error || '未知错误'}`)
      }
    } catch {
      setAddError('添加失败')
    }
  }

  useEffect(() => {
    const input = live2dInputRef.current
    if (input) {
      input.setAttribute('webkitdirectory', 'true')
      input.setAttribute('directory', 'true')
    }
  }, [])

  const saveCorpus = async () => {
    if (!selectedPersona) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/corpus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: corpusText }),
      })
      const data = await res.json()
      if (res.ok) {
        setLoadedCorpus(corpusText)
        setMessage('保存成功')
      } else {
        setMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reloadCorpus = async () => {
    if (!selectedPersona) return
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/corpus`)
      const data = await res.json()
      const text = data.ok ? data.text || '' : ''
      setCorpusText(text)
      setLoadedCorpus(text)
    } catch {
      setMessage('语料刷新失败')
    }
  }

  const uploadCorpus = async () => {
    if (!corpusFile || !selectedPersona) return
    try {
      const text = await corpusFile.text()
      const res = await fetch(`/api/personas/${selectedPersona}/corpus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (res.ok) {
        setCorpusFile(null)
        setMessage('语料上传成功')
        await reloadCorpus()
      } else {
        setMessage(`上传失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('上传失败')
    }
  }

  const handleLive2dFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setLive2dFiles(files)
  }

  const uploadLive2dModel = async () => {
    if (live2dFiles.length === 0 || !selectedPersona) return
    const form = new FormData()
    live2dFiles.forEach((file) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      form.append('files', file, relativePath)
    })
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/live2d`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (res.ok) {
        setLive2dFiles([])
        setLive2dPath(data.model_path || null)
        setMessage(`Live2D 模型已更新：${data.model_path}`)
        useLive2DStore.getState().triggerModelReload()
      } else {
        setMessage(`Live2D 上传失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('Live2D 上传失败')
    } finally {
      setSaving(false)
    }
  }

  const unbindLive2dModel = async () => {
    if (!selectedPersona) return
    if (!window.confirm('确定要解绑当前 Live2D 模型吗？')) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/live2d`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        setLive2dPath(null)
        setMessage('模型已解绑')
        useLive2DStore.getState().triggerModelReload()
      } else {
        setMessage(`解绑失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('解绑失败')
    } finally {
      setSaving(false)
    }
  }

  const saveLive2dScale = async () => {
    if (!selectedPersona) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/live2d/scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale: live2dScale }),
      })
      const data = await res.json()
      if (res.ok) {
        setLoadedLive2dScale(live2dScale)
        setMessage('缩放已保存')
        useLive2DStore.getState().triggerModelReload()
      } else {
        setMessage(`缩放保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('缩放保存失败')
    } finally {
      setSaving(false)
    }
  }

  const saveSupervisor = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/supervisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: supervisor.mode,
          interval_seconds: supervisor.interval_seconds,
          adapter_id: supervisor.adapter_id,
          api_url: supervisor.api_url,
          api_model: supervisor.api_model,
          api_key: supervisor.api_key,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        const cfg: SupervisorSettings = {
          mode: data.mode || supervisor.mode,
          interval_seconds: data.interval_seconds ?? supervisor.interval_seconds,
          adapter_id: data.adapter_id ?? supervisor.adapter_id,
          api_url: data.api_url ?? supervisor.api_url,
          api_model: data.api_model ?? supervisor.api_model,
          api_key: supervisor.api_key,
        }
        setSupervisor(cfg)
        setLoadedSupervisor(cfg)
        setMessage('Supervisor 设置已保存')
      } else {
        setMessage(`保存失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const selectedDescription = personas.find((p) => p.id === selectedPersona)?.description

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <User className="h-4 w-4 text-dionysus-primary" />
          当前角色
        </div>
        <div className="flex items-center gap-2">
          <DionysusSelect
            value={selectedPersona}
            options={personas.map((p) => ({ value: p.id, label: p.name || p.id }))}
            onChange={(value) => handlePersonaChange(value)}
            placeholder="选择角色"
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={() => {
              setAddError(null)
              setNewPersona({ id: '', name: '', description: '' })
              setShowAddModal(true)
            }}
            className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" />
            添加角色
          </button>
        </div>
        {selectedDescription && (
          <p className="mt-2 text-xs text-dionysus-text-secondary">{selectedDescription}</p>
        )}
      </section>

      <section>
        <div className="mb-3 text-sm font-medium text-dionysus-text-primary">
          语料文本
          {isDirty && <span className="ml-2 text-xs text-dionysus-danger">已修改</span>}
        </div>
        <textarea
          value={corpusText}
          onChange={(e) => setCorpusText(e.target.value)}
          rows={16}
          className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-code-bg px-3 py-2 font-mono text-xs text-dionysus-text-primary outline-none focus:border-dionysus-primary"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={saveCorpus}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中…' : '保存'}
          </button>
          {message && (
            <span className="flex items-center gap-1 text-xs text-dionysus-success">
              <Check className="h-3.5 w-3.5" />
              {message}
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

      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <FolderOpen className="h-4 w-4 text-dionysus-primary" />
          Live2D 模型
          {live2dPath ? (
            <span className="ml-2 rounded-full bg-dionysus-success/20 px-2 py-0.5 text-xs text-dionysus-success">已绑定</span>
          ) : (
            <span className="ml-2 rounded-full bg-dionysus-text-secondary/20 px-2 py-0.5 text-xs text-dionysus-text-secondary">未绑定</span>
          )}
        </div>
        {live2dPath ? (
          <div className="mb-2 rounded-lg border border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs text-dionysus-text-secondary">
            <span className="font-medium text-dionysus-text-primary">路径：</span>
            <span className="break-all">{live2dPath}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-1.5 text-xs font-bold text-dionysus-text-primary transition-all hover:border-dionysus-primary/50">
            <RefreshCcw className="h-3.5 w-3.5" />
            {live2dPath ? '更换模型' : '选择模型文件夹'}
            <input
              ref={live2dInputRef}
              type="file"
              onChange={handleLive2dFolderChange}
              className="sr-only"
            />
          </label>
          {live2dFiles.length > 0 && (
            <span className="max-w-[12rem] truncate text-xs text-dionysus-text-secondary">
              {live2dFiles.length} 个文件
            </span>
          )}
          <button
            type="button"
            onClick={uploadLive2dModel}
            disabled={live2dFiles.length === 0 || saving}
            className="rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
          >
            上传并应用
          </button>
          {live2dPath && (
            <button
              type="button"
              onClick={unbindLive2dModel}
              disabled={saving}
              className="flex items-center gap-1 rounded-xl border-2 border-dionysus-danger/50 bg-dionysus-danger/10 px-3 py-1.5 text-xs font-bold text-dionysus-danger transition-all hover:bg-dionysus-danger/20 disabled:opacity-50"
            >
              <Unlink className="h-3.5 w-3.5" />
              解绑模型
            </button>
          )}
        </div>
        {isBuiltin(selectedPersona) ? (
          <p className="mt-2 text-xs text-dionysus-text-secondary">
            当前为内置角色，上传新模型会复制到该角色的运行时配置中，不会修改内置文件。
          </p>
        ) : (
          <p className="mt-2 text-xs text-dionysus-text-secondary">
            请选择包含 .model3.json 入口文件的 Live2D 模型文件夹。
          </p>
        )}

        <div className="mt-4 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-dionysus-text-secondary">
            <span>模型缩放</span>
            <span>{live2dScale.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.05}
            value={live2dScale}
            onChange={(e) => setLive2dScale(parseFloat(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-dionysus-subtle-border accent-dionysus-primary"
          />
          <button
            type="button"
            onClick={saveLive2dScale}
            disabled={saving || live2dScale === loadedLive2dScale}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-1.5 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            保存缩放
          </button>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <Bot className="h-4 w-4 text-dionysus-primary" />
          后台角色播报（Companion Supervisor）
          {supervisorDirty && <span className="ml-2 text-xs text-dionysus-danger">已修改</span>}
        </div>
        <div className="space-y-3 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight p-3">
          <div>
            <label className="mb-1.5 block text-xs text-dionysus-text-secondary">工作模式</label>
            <div className="flex gap-2">
              {(
                [
                  { id: 'disabled', label: '不接入模型' },
                  { id: 'agent_session', label: '多开 agent session' },
                  { id: 'deepseek_api', label: 'DeepSeek API' },
                ] as { id: SupervisorMode; label: string }[]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSupervisor((s) => ({ ...s, mode: id }))}
                  className={`flex-1 rounded-xl border-2 px-2 py-2 text-xs font-bold transition-all ${
                    supervisor.mode === id
                      ? 'border-dionysus-primary bg-dionysus-primary/15 text-dionysus-primary'
                      : 'border-dionysus-subtle-border bg-dionysus-glass-highlight text-dionysus-text-secondary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {supervisor.mode === 'agent_session' && (
            <div>
              <label className="mb-1.5 block text-xs text-dionysus-text-secondary">Adapter ID</label>
              <DionysusSelect
                value={supervisor.adapter_id}
                options={Object.entries(adapters)
                  .filter(([, cfg]) => cfg.enabled !== false)
                  .map(([id]) => ({ value: id, label: id }))}
                onChange={(value) => setSupervisor((s) => ({ ...s, adapter_id: value }))}
                placeholder="选择 Agent Adapter"
              />
            </div>
          )}

          {supervisor.mode === 'deepseek_api' && (
            <>
              <div>
                <label className="mb-1.5 block text-xs text-dionysus-text-secondary">API URL</label>
                <input
                  type="text"
                  value={supervisor.api_url}
                  onChange={(e) => setSupervisor((s) => ({ ...s, api_url: e.target.value }))}
                  className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-dionysus-text-secondary">模型</label>
                <input
                  type="text"
                  value={supervisor.api_model}
                  onChange={(e) => setSupervisor((s) => ({ ...s, api_model: e.target.value }))}
                  className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-dionysus-text-secondary">API Key</label>
                <input
                  type="password"
                  value={supervisor.api_key}
                  onChange={(e) => setSupervisor((s) => ({ ...s, api_key: e.target.value }))}
                  className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                  placeholder="留空则读取环境变量 DEEPSEEK_API_KEY"
                />
              </div>
            </>
          )}

          <div>
            <label className="mb-1.5 block text-xs text-dionysus-text-secondary">
              扫描间隔（秒）
            </label>
            <input
              type="number"
              min={5}
              step={1}
              value={supervisor.interval_seconds}
              onChange={(e) =>
                setSupervisor((s) => ({ ...s, interval_seconds: Number(e.target.value) }))
              }
              className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
            />
          </div>

          <button
            type="button"
            onClick={saveSupervisor}
            disabled={!supervisorDirty || saving}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            保存 Supervisor 设置
          </button>
        </div>
      </section>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-dionysus-subtle-border bg-dionysus-panel-bg p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-dionysus-text-primary">添加角色</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1 text-dionysus-text-secondary hover:bg-dionysus-glass-highlight"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-dionysus-text-secondary">角色 ID（英文/数字/下划线）</label>
                <input
                  type="text"
                  value={newPersona.id}
                  onChange={(e) => setNewPersona((p) => ({ ...p, id: e.target.value }))}
                  className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                  placeholder="例如 my_character"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-dionysus-text-secondary">角色名称</label>
                <input
                  type="text"
                  value={newPersona.name}
                  onChange={(e) => setNewPersona((p) => ({ ...p, name: e.target.value }))}
                  className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                  placeholder="例如 我的角色"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-dionysus-text-secondary">简介</label>
                <input
                  type="text"
                  value={newPersona.description}
                  onChange={(e) => setNewPersona((p) => ({ ...p, description: e.target.value }))}
                  className="w-full rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
                  placeholder="一句话描述角色"
                />
              </div>
              {addError && (
                <p className="text-xs text-dionysus-danger">{addError}</p>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-xs font-bold text-dionysus-text-secondary transition-all hover:border-dionysus-primary/50 hover:text-dionysus-primary"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAddPersona}
                  disabled={!newPersona.id.trim() || !newPersona.name.trim()}
                  className="flex-1 rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
