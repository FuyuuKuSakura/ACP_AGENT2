/**
 * 设置页容器（role='settings' 独立入口，ux-core-flows.md §5.5 布局）：
 * 左栏角色列表（头像+名称，persona_list）+ 右侧 voice 客制化表单
 * + 「AI 助手与模型」区（adapter_list，模型写回 dionysus.adapters.<id>.model）
 * + 底部素材库区。
 *
 * 数据流：挂载时发 persona_list_request / character_list_request /
 * adapter_list_request（traceId 关联），响应进本地 state——设置页是独立视图，
 * 不复用 client-core 的会话域 stores。
 * 展示模式与默认角色经 settings_update_request 写回 settings.json；
 * 助手模型经 adapter_model_update_request 写回 dionysus.adapters；
 * voice 表单经 persona_update_request 落 runtime YAML（只写 diff 键）；
 * 「试听」走 voice_preview_request（携带未保存的表单编辑）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ClientTransport } from '@dionysus/client-core'
import type {
  AdapterListEntry,
  CharacterAssetEntry,
  ClientMessage,
  DisplayModeSetting,
  PersonaSummary,
  PersonaVoiceUpdate,
  SettingsKey,
} from '@dionysus/protocol'

import { AdapterModelPanel } from './AdapterModelPanel.js'
import { AssetLibraryPanel } from './AssetLibraryPanel.js'
import { VoiceForm, type VoiceFormValues } from './VoiceForm.js'
import { readSettingsInit, type SettingsInit } from './settingsInit.js'

export interface SettingsAppProps {
  transport: ClientTransport
}

const TRACE = {
  personaList: 'settings:persona-list',
  characterList: 'settings:character-list',
  adapterList: 'settings:adapter-list',
  preview: 'settings:voice-preview',
  personaUpdate: 'settings:persona-update',
  settingsUpdate: 'settings:settings-update',
  adapterModelUpdate: 'settings:adapter-model-update',
} as const

interface PreviewResult {
  rewritten: string
  error?: string
}

/** persona 头像 URL：avatarPath 是相对其素材根的 POSIX 路径，拼上 init 注入的 asWebviewUri 根。 */
export function resolveAvatarUrl(
  persona: PersonaSummary,
  init: SettingsInit,
): string | undefined {
  if (!persona.avatarPath) return undefined
  const base =
    persona.avatarSource === 'user'
      ? init.userLibraryUri
      : init.builtinAssetsUri
  return base ? `${base}/${persona.avatarPath}` : undefined
}

export function SettingsApp({ transport }: SettingsAppProps) {
  const [init] = useState<SettingsInit>(() => readSettingsInit())
  const [personas, setPersonas] = useState<PersonaSummary[] | null>(null)
  const [characters, setCharacters] = useState<CharacterAssetEntry[]>([])
  const [display, setDisplay] = useState<{
    desktop: DisplayModeSetting
    mobile: DisplayModeSetting
  }>({
    desktop: 'live2d',
    mobile: 'live2d',
  })
  const [defaultPersonaId, setDefaultPersonaId] = useState('')
  const [adapters, setAdapters] = useState<AdapterListEntry[] | null>(null)
  const [defaultAdapterId, setDefaultAdapterId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    text: string
    level: 'info' | 'error'
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const previewResolver = useRef<((result: PreviewResult) => void) | null>(null)

  const send = useCallback(
    (msg: ClientMessage) => transport.send(msg),
    [transport],
  )

  useEffect(() => {
    transport.onMessage((msg) => {
      switch (msg.type) {
        case 'persona_list_response':
          setPersonas(msg.payload.personas)
          setSelectedId((prev) => prev ?? msg.payload.personas[0]?.id ?? null)
          break
        case 'character_list_response':
          setCharacters(msg.payload.characters)
          setDisplay(msg.payload.display)
          setDefaultPersonaId(msg.payload.defaultPersonaId)
          break
        case 'adapter_list_response':
          setAdapters(msg.payload.adapters)
          setDefaultAdapterId(msg.payload.defaultAdapterId)
          break
        case 'adapter_model_update_response':
          if (msg.payload.ok) {
            setNotice({ text: '已保存。', level: 'info' })
            // 重新拉取，保证输入框显示的是 settings.json 里的真实值
            send({
              v: 1,
              type: 'adapter_list_request',
              traceId: TRACE.adapterList,
              ts: Date.now(),
              payload: {},
            })
          } else {
            setNotice({
              text: `模型保存失败：${msg.payload.error ?? '未知错误'}`,
              level: 'error',
            })
          }
          break
        case 'voice_preview_response':
          previewResolver.current?.({
            rewritten: msg.payload.rewritten,
            ...(msg.payload.error !== undefined
              ? { error: msg.payload.error }
              : {}),
          })
          previewResolver.current = null
          break
        case 'persona_update_response':
          setSaving(false)
          if (msg.payload.ok) {
            setNotice({ text: '已保存。', level: 'info' })
            // 重新拉取，保证表单显示的是 builtin+runtime 深合并后的真实值
            send({
              v: 1,
              type: 'persona_list_request',
              traceId: TRACE.personaList,
              ts: Date.now(),
              payload: {},
            })
          } else {
            setNotice({
              text: `保存失败：${msg.payload.error ?? '未知错误'}`,
              level: 'error',
            })
          }
          break
        case 'settings_update_response':
          if (!msg.payload.ok) {
            setNotice({
              text: `设置写回失败：${msg.payload.error ?? '未知错误'}`,
              level: 'error',
            })
          }
          break
        default:
          break
      }
    })
    send({
      v: 1,
      type: 'persona_list_request',
      traceId: TRACE.personaList,
      ts: Date.now(),
      payload: {},
    })
    send({
      v: 1,
      type: 'character_list_request',
      traceId: TRACE.characterList,
      ts: Date.now(),
      payload: {},
    })
    send({
      v: 1,
      type: 'adapter_list_request',
      traceId: TRACE.adapterList,
      ts: Date.now(),
      payload: {},
    })
  }, [transport, send])

  const requestPreview = useCallback(
    (
      personaId: string,
      text: string,
      voice: PersonaVoiceUpdate,
    ): Promise<PreviewResult> => {
      return new Promise((resolve) => {
        previewResolver.current = resolve
        send({
          v: 1,
          type: 'voice_preview_request',
          traceId: TRACE.preview,
          ts: Date.now(),
          payload: { personaId, text, voice },
        })
      })
    },
    [send],
  )

  const handleSave = useCallback(
    (personaId: string, values: VoiceFormValues) => {
      setSaving(true)
      setNotice(null)
      send({
        v: 1,
        type: 'persona_update_request',
        traceId: TRACE.personaUpdate,
        ts: Date.now(),
        payload: {
          personaId,
          name: values.name,
          description: values.description,
          voice: values.voice,
        },
      })
    },
    [send],
  )

  const writeSetting = useCallback(
    (key: SettingsKey, value: string) => {
      send({
        v: 1,
        type: 'settings_update_request',
        traceId: TRACE.settingsUpdate,
        ts: Date.now(),
        payload: { key, value },
      })
    },
    [send],
  )

  const handleDisplayChange = useCallback(
    (device: 'desktop' | 'mobile', mode: DisplayModeSetting) => {
      setDisplay((prev) => ({ ...prev, [device]: mode }))
      writeSetting(
        device === 'desktop'
          ? 'character.display.desktop'
          : 'character.display.mobile',
        mode,
      )
    },
    [writeSetting],
  )

  const handleDefaultPersonaChange = useCallback(
    (personaId: string) => {
      setDefaultPersonaId(personaId)
      writeSetting('persona.default', personaId)
    },
    [writeSetting],
  )

  const handleSaveModel = useCallback(
    (adapterId: string, model: string) => {
      setNotice(null)
      send({
        v: 1,
        type: 'adapter_model_update_request',
        traceId: TRACE.adapterModelUpdate,
        ts: Date.now(),
        payload: { adapterId, model },
      })
    },
    [send],
  )

  const selected = personas?.find((p) => p.id === selectedId) ?? null

  return (
    <div
      data-testid="settings-app"
      className="flex h-full flex-col bg-[var(--dn-bg)] text-[var(--dn-fg)]"
    >
      <header className="border-b border-[var(--dn-border)] px-4 py-3">
        <h1 className="text-base font-semibold">角色与素材库设置</h1>
        {notice && (
          <div
            data-testid="settings-notice"
            className={`mt-1 text-xs ${notice.level === 'error' ? 'text-[var(--dn-error)]' : 'text-[var(--dn-success)]'}`}
          >
            {notice.text}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-[var(--dn-border)] p-2">
          <div className="mb-2 px-1 text-xs font-semibold text-[var(--dn-muted)]">
            角色
          </div>
          {personas === null && (
            <div className="px-1 text-sm text-[var(--dn-muted)]">加载中…</div>
          )}
          {personas?.length === 0 && (
            <div
              data-testid="persona-empty"
              className="px-1 text-sm text-[var(--dn-muted)]"
            >
              未找到任何角色配置。
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {personas?.map((p) => {
              const avatarUrl = resolveAvatarUrl(p, init)
              const active = p.id === selectedId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    data-testid={`persona-item-${p.id}`}
                    aria-pressed={active}
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center gap-2 rounded-[var(--dn-radius-sm)] px-2 py-1.5 text-left ${
                      active
                        ? 'bg-[var(--dn-button-secondary-bg)]'
                        : 'hover:bg-[var(--dn-button-secondary-bg)]'
                    }`}
                  >
                    {avatarUrl ? (
                      <img
                        data-testid={`persona-avatar-${p.id}`}
                        src={avatarUrl}
                        alt={p.name}
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--dn-badge-bg)] text-sm text-[var(--dn-badge-fg)]">
                        {p.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{p.name}</span>
                      <span className="block truncate text-xs text-[var(--dn-muted)]">
                        {p.id}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <VoiceForm
              key={selected.id}
              persona={selected}
              saving={saving}
              onSave={handleSave}
              onPreview={requestPreview}
            />
          ) : (
            <div
              data-testid="no-selection"
              className="text-sm text-[var(--dn-muted)]"
            >
              选择左侧角色以编辑语气。
            </div>
          )}

          <section className="mt-6 border-t border-[var(--dn-border)] pt-4">
            <h2 className="mb-2 text-sm font-semibold">AI 助手与模型</h2>
            <AdapterModelPanel
              adapters={adapters}
              defaultAdapterId={defaultAdapterId}
              onSaveModel={handleSaveModel}
            />
          </section>

          <section className="mt-6 border-t border-[var(--dn-border)] pt-4">
            <h2 className="mb-2 text-sm font-semibold">角色素材库</h2>
            <AssetLibraryPanel
              characters={characters}
              display={display}
              defaultPersonaId={defaultPersonaId}
              personas={personas ?? []}
              onDisplayChange={handleDisplayChange}
              onDefaultPersonaChange={handleDefaultPersonaChange}
            />
          </section>
        </main>
      </div>
    </div>
  )
}

export default SettingsApp
