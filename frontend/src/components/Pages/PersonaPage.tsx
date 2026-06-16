import { useEffect, useRef, useState } from 'react'
import { User, Save, Upload, Check, FolderOpen, Plus, Unlink, RefreshCcw } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'
import { useLive2DStore } from '@/stores/live2dStore'

interface PersonaInfo {
  id: string
  name?: string
  description?: string
}

interface PersonaPageProps {
  onCloseGuardChange?: (guard: () => boolean) => void
  sendMessage?: (message: unknown) => boolean
}

export default function PersonaPage({ onCloseGuardChange, sendMessage }: PersonaPageProps) {
  const [personas, setPersonas] = useState<PersonaInfo[]>([])
  const [selectedPersona, setSelectedPersona] = useState<string>('exusiai')
  const [corpusText, setCorpusText] = useState<string>('')
  const [loadedCorpus, setLoadedCorpus] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [corpusFile, setCorpusFile] = useState<File | null>(null)
  const [live2dFiles, setLive2dFiles] = useState<File[]>([])
  const [live2dPath, setLive2dPath] = useState<string | null>(null)
  const live2dInputRef = useRef<HTMLInputElement>(null)
  const yamlInputRef = useRef<HTMLInputElement>(null)

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
      if (selectId) {
        setSelectedPersona(selectId)
      } else {
        const first = list[0]?.id || 'exusiai'
        setSelectedPersona((prev) => (list.some((p) => p.id === prev) ? prev : first))
      }
    } catch {
      setPersonas([])
    }
  }

  useEffect(() => {
    refreshPersonas()
  }, [])

  useEffect(() => {
    if (!selectedPersona) return
    setCorpusText('')
    setLoadedCorpus('')
    setLive2dPath(null)
    fetch(`/api/personas/${selectedPersona}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const companion = data.persona?.companion || {}
          setLive2dPath(companion.live2d?.model_path || null)
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

  const isDirty = corpusText !== loadedCorpus

  useEffect(() => {
    const guard = () => {
      if (!isDirty) return true
      return window.confirm('当前角色的语料有未保存的修改，确定要放弃吗？')
    }
    onCloseGuardChange?.(guard)
    return () => onCloseGuardChange?.(() => true)
  }, [isDirty, onCloseGuardChange])

  const maybeSwitchPersona = (id: string) => {
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
    if (isDirty && !window.confirm('当前角色的语料有未保存的修改，确定要放弃吗？')) {
      return
    }
    setSelectedPersona(id)
    setMessage(null)
    setCorpusFile(null)
    setLive2dFiles([])
    maybeSwitchPersona(id)
  }

  const handleAddPersona = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const yaml = await file.text()
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml }),
      })
      const data = await res.json()
      if (res.ok && data.id) {
        await refreshPersonas(data.id)
        setMessage('角色添加成功')
        maybeSwitchPersona(data.id)
      } else {
        setMessage(`添加失败：${data.error || '未知错误'}`)
      }
    } catch {
      setMessage('添加失败')
    } finally {
      if (yamlInputRef.current) {
        yamlInputRef.current.value = ''
      }
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
    const form = new FormData()
    form.append('file', corpusFile)
    try {
      const res = await fetch(`/api/personas/${selectedPersona}/corpus`, {
        method: 'POST',
        body: form,
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

  const selectedDescription = personas.find((p) => p.id === selectedPersona)?.description

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-dionysus-text-primary">
          <User className="h-4 w-4 text-dionysus-primary" />
          当前角色
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedPersona}
            onChange={(e) => handlePersonaChange(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border-2 border-dionysus-subtle-border bg-dionysus-glass-highlight px-3 py-2 text-sm text-dionysus-text-primary outline-none focus:border-dionysus-primary"
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-black/20 bg-dionysus-primary px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:brightness-110">
            <Plus className="h-3.5 w-3.5" />
            添加角色
            <input
              ref={yamlInputRef}
              type="file"
              accept=".yaml,.yml"
              onChange={handleAddPersona}
              className="sr-only"
            />
          </label>
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
      </section>
    </div>
  )
}
