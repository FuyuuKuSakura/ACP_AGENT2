/**
 * SidebarApp — sidebar webview（role='sidebar'）的会话列表根组件
 * （architecture.md §6.6 / ux-core-flows.md §2）。
 *
 * 布局：顶部聚合条（全部会话总览）+ QQ 式会话列表 + 底部「新建会话」按钮
 * （旁挂「目录」「选项」两个可选步骤面板：工作目录；助手/角色/模型——
 * 助手与角色随 new_session payload 发出、会话创建时绑定，模型写全局
 * dionysus.adapters.<id>.model）。
 * 数据源为 client-core 的 digestStore（session_digest_update 广播落点），
 * 排序经 selectSortedDigests（waiting_option 置顶 → error → running → idle/done，
 * 组内 lastActivityAt 倒序）。列表项 title 的「助手 · 角色」来自
 * session_list（SessionMeta.personaId）+ persona_list（id→显示名）。
 *
 * 宿主集成约定（与聊天视图代理的接口）：本组件**不** acquire vscode API、
 * 不自行构造 transport；宿主（main.tsx）经 props 注入：
 * - transport：ClientTransport，用于「新建会话」发 new_session；
 * - onSelectSession(sessionId)：点击列表项——宿主负责聚焦/切换 editor 区聊天面板；
 * - onNewSession()：点击「新建会话」的附加通知（如聚焦聊天面板），协议消息已由本组件发出；
 * - onFocusCompanion()：点击聚合条——聚焦 Live2D 陪伴区/全局汇报。
 * 全部回调可选，缺省时组件仍可独立渲染与自测。
 */
import { useEffect, useMemo, useState } from 'react'

import type { ClientTransport } from '@dionysus/client-core'
import {
  selectSortedDigests,
  selectStatusBarAggregate,
  useDigestStore,
} from '@dionysus/client-core'
import type { AdapterListEntry } from '@dionysus/protocol'

import { AggregateBar } from './AggregateBar.js'
import { Icon } from '../Icon.js'
import { sendNewSession } from '../chat/chatActions.js'
import { SessionListItem } from './SessionListItem.js'
import './sidebar.css'

/** working_dir_pick_request 的 traceId（响应经它关联回填目录输入框）。 */
const PICK_DIR_TRACE = 'sidebar:working-dir-pick'
/** 新建会话「选项」面板与列表项 title 的数据源 traceId。 */
const ADAPTER_LIST_TRACE = 'sidebar:adapter-list'
const PERSONA_LIST_TRACE = 'sidebar:persona-list'
const SESSION_LIST_TRACE = 'sidebar:session-list'
const MODEL_UPDATE_TRACE = 'sidebar:adapter-model-update'

/**
 * 各 CLI 的模型名建议（模型输入框的 datalist；数据源为实测可用值，
 * 选模型方法详见用户指南 FAQ「各助手怎么选模型」）。只列有把握的值。
 */
const MODEL_SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  claude_cli: ['claude-sonnet-4-5'],
}

export interface SidebarAppProps {
  /** C→S 传输（新建会话发 new_session）；缺省时按钮仅触发 onNewSession 回调 */
  transport?: ClientTransport
  /** 点击会话项：通知宿主聚焦/切换聊天面板到该会话（未读由本组件 markSessionRead 清零） */
  onSelectSession?: (sessionId: string) => void
  /** 点击「新建会话」的附加通知（协议消息已发出） */
  onNewSession?: () => void
  /** 点击聚合条：通知宿主聚焦 Live2D 陪伴区/最近全局汇报 */
  onFocusCompanion?: () => void
  /** sessionId → persona 头像 URL（宿主经 asWebviewUri 解析）；无则首字母色块 */
  avatarUrls?: Record<string, string>
  /** 当前聚焦会话 id（列表高亮选中态） */
  activeSessionId?: string
  /** 相对时间渲染基准（Unix 毫秒）；缺省 Date.now() 并每 30s 自刷新 */
  now?: number
}

export default function SidebarApp({
  transport,
  onSelectSession,
  onNewSession,
  onFocusCompanion,
  avatarUrls,
  activeSessionId,
  now: nowProp,
}: SidebarAppProps) {
  // 订阅 digests 记录（引用稳定，变更才重渲染），排序/聚合派生经 useMemo
  const digests = useDigestStore((s) => s.digests)
  const sorted = useMemo(() => selectSortedDigests({ digests }), [digests])
  const aggregate = useMemo(
    () => selectStatusBarAggregate({ digests }),
    [digests],
  )
  const doneCount = useMemo(
    () => Object.values(digests).filter((d) => d.status === 'done').length,
    [digests],
  )

  // 相对时间每 30s 自刷新（注入 now 时由调用方控制，便于测试）
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (nowProp !== undefined) return
    const timer = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [nowProp])
  const now = nowProp ?? tick

  const handleSelect = (sessionId: string) => {
    // 进入会话即清零未读（已读游标推进到该会话最新 seq）
    useDigestStore.getState().markSessionRead(sessionId)
    onSelectSession?.(sessionId)
  }

  const handleNewSession = () => {
    if (transport) sendNewSession(transport)
    onNewSession?.()
  }

  // ── 「选择工作目录」可选步骤（ux：新建会话入口旁）──────────────────────
  // 面板里可手输路径，或点「选择目录…」发 working_dir_pick_request 让宿主
  // 弹系统目录选择框（showOpenDialog），响应经 traceId 关联回填输入框。
  const [dirPanelOpen, setDirPanelOpen] = useState(false)
  const [dirInput, setDirInput] = useState('')
  const [picking, setPicking] = useState(false)

  // ── 新建会话「选项」面板：助手 / 模型 / 角色（默认 = 跟随全局设置）────────
  // 助手与角色选择随 new_session payload 发出（会话创建时绑定，之后不可切换）；
  // 模型不走会话——写全局 dionysus.adapters.<id>.model（adapter_model_update_request），
  // 与设置页「AI 助手与模型」区同一数据源（adapter_list_response）。
  const [optPanelOpen, setOptPanelOpen] = useState(false)
  const [adapters, setAdapters] = useState<AdapterListEntry[]>([])
  const [defaultAdapterId, setDefaultAdapterId] = useState('')
  const [personaNames, setPersonaNames] = useState<Record<string, string>>({})
  const [selAdapter, setSelAdapter] = useState('')
  const [selPersona, setSelPersona] = useState('')
  const [selModel, setSelModel] = useState('')
  // 列表项 title 的「角色：xxx」数据源（session_list 的 personaId → persona 名）
  const [sessionPersonas, setSessionPersonas] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!transport) return
    transport.onMessage((msg) => {
      if (msg.type === 'working_dir_pick_response' && msg.traceId === PICK_DIR_TRACE) {
        setPicking(false)
        if (!msg.payload.canceled && msg.payload.path) setDirInput(msg.payload.path)
      }
      if (msg.type === 'adapter_list_response' && msg.traceId === ADAPTER_LIST_TRACE) {
        setAdapters(msg.payload.adapters)
        setDefaultAdapterId(msg.payload.defaultAdapterId)
      }
      if (msg.type === 'persona_list_response' && msg.traceId === PERSONA_LIST_TRACE) {
        setPersonaNames(
          Object.fromEntries(msg.payload.personas.map((p) => [p.id, p.name])),
        )
      }
      if (msg.type === 'session_list_response' && msg.traceId === SESSION_LIST_TRACE) {
        setSessionPersonas(
          Object.fromEntries(msg.payload.sessions.map((s) => [s.id, s.personaId])),
        )
      }
    })
  }, [transport])

  const handlePickDir = () => {
    if (!transport) return
    setPicking(true)
    transport.send({
      v: 1,
      type: 'working_dir_pick_request',
      traceId: PICK_DIR_TRACE,
      ts: Date.now(),
      payload: dirInput.trim() ? { defaultPath: dirInput.trim() } : {},
    })
  }

  // 列表项 title 的「助手/角色」数据源：挂载拉 persona_list（id→显示名），
  // 会话集合变化时拉 session_list（SessionMeta.personaId 是会话创建时的绑定）。
  const sessionIdKey = useMemo(() => sorted.map((d) => d.sessionId).join(','), [sorted])
  useEffect(() => {
    if (!transport) return
    transport.send({ v: 1, type: 'persona_list_request', traceId: PERSONA_LIST_TRACE, ts: Date.now(), payload: {} })
  }, [transport])
  useEffect(() => {
    if (!transport || !sessionIdKey) return
    transport.send({ v: 1, type: 'session_list_request', traceId: SESSION_LIST_TRACE, ts: Date.now(), payload: {} })
  }, [transport, sessionIdKey])

  // 「选项」面板每次打开都重拉 adapter_list（模型值可能被设置页改动）
  const handleToggleOptions = () => {
    setOptPanelOpen((v) => {
      const next = !v
      if (next && transport) {
        transport.send({ v: 1, type: 'adapter_list_request', traceId: ADAPTER_LIST_TRACE, ts: Date.now(), payload: {} })
      }
      return next
    })
  }

  const effectiveAdapterId = selAdapter || defaultAdapterId
  const effectiveAdapter = adapters.find((a) => a.id === effectiveAdapterId)
  const modelSuggestions = MODEL_SUGGESTIONS[effectiveAdapterId] ?? []

  const handleNewSessionWithOptions = () => {
    if (transport) {
      const model = selModel.trim()
      // 模型写全局配置（不随会话）；与当前配置相同或不支持选模型时不发
      if (model && effectiveAdapter?.supportsModel && model !== effectiveAdapter.model) {
        transport.send({
          v: 1,
          type: 'adapter_model_update_request',
          traceId: MODEL_UPDATE_TRACE,
          ts: Date.now(),
          payload: { adapterId: effectiveAdapter.id, model },
        })
      }
      sendNewSession(transport, {
        ...(selAdapter ? { adapterId: selAdapter } : {}),
        ...(selPersona ? { personaId: selPersona } : {}),
      })
    }
    setOptPanelOpen(false)
    setSelAdapter('')
    setSelPersona('')
    setSelModel('')
    onNewSession?.()
  }

  const handleNewSessionWithDir = () => {
    if (transport) {
      const workingDir = dirInput.trim()
      sendNewSession(transport, workingDir ? { workingDir } : {})
    }
    setDirPanelOpen(false)
    setDirInput('')
    onNewSession?.()
  }

  return (
    <div
      data-testid="sidebar-app"
      className="flex h-screen w-full flex-col bg-[var(--dn-panel-bg)] text-[var(--dn-fg)]"
    >
      <AggregateBar
        running={aggregate.running}
        waitingOption={aggregate.waitingOption}
        done={doneCount}
        onClick={onFocusCompanion}
      />
      <div
        data-testid="session-list"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {sorted.length === 0 ? (
          <div
            data-testid="session-list-empty"
            className="px-3 py-4 text-center text-xs text-[var(--dn-muted)]"
          >
            暂无会话，点击下方「新建会话」开始
          </div>
        ) : (
          sorted.map((d) => {
            const personaId = sessionPersonas[d.sessionId]
            const personaLabel = personaId ? (personaNames[personaId] ?? personaId) : undefined
            return (
              <SessionListItem
                key={d.sessionId}
                digest={d}
                active={d.sessionId === activeSessionId}
                {...(avatarUrls?.[d.sessionId]
                  ? { avatarUrl: avatarUrls[d.sessionId] }
                  : {})}
                {...(personaLabel ? { personaLabel } : {})}
                now={now}
                onSelect={handleSelect}
              />
            )
          })
        )}
      </div>
      <div className="m-2 flex flex-none flex-col gap-1.5">
        {dirPanelOpen ? (
          <div
            data-testid="new-session-dir-panel"
            className="flex flex-col gap-1.5 rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-bg)] p-2"
          >
            <label className="text-xs text-[var(--dn-muted)]" htmlFor="new-session-dir-input">
              工作目录（可选，留空用默认目录）
            </label>
            <div className="flex items-center gap-1">
              <input
                id="new-session-dir-input"
                data-testid="new-session-dir-input"
                value={dirInput}
                onChange={(e) => setDirInput(e.target.value)}
                placeholder="/path/to/project"
                className="min-w-0 flex-1 rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-2 py-1 text-xs text-[var(--dn-fg)] focus:outline-none"
              />
              <button
                type="button"
                data-testid="pick-dir-button"
                disabled={!transport || picking}
                onClick={handlePickDir}
                className="flex-none rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)] disabled:opacity-50"
              >
                {picking ? '选择中…' : '选择目录…'}
              </button>
            </div>
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                data-testid="new-session-dir-cancel"
                onClick={() => {
                  setDirPanelOpen(false)
                  setDirInput('')
                }}
                className="rounded-[var(--dn-radius-sm)] px-2 py-1 text-xs text-[var(--dn-muted)] hover:bg-[var(--dn-list-hover-bg)]"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="new-session-dir-submit"
                onClick={handleNewSessionWithDir}
                className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] bg-[var(--dn-button-bg)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)]"
              >
                新建
              </button>
            </div>
          </div>
        ) : null}
        {optPanelOpen ? (
          <div
            data-testid="new-session-options-panel"
            className="flex flex-col gap-1.5 rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-bg)] p-2"
          >
            <label className="text-xs text-[var(--dn-muted)]" htmlFor="new-session-adapter-select">
              助手（默认 = 跟随全局设置）
            </label>
            <select
              id="new-session-adapter-select"
              data-testid="new-session-adapter-select"
              value={selAdapter}
              onChange={(e) => setSelAdapter(e.target.value)}
              className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-2 py-1 text-xs text-[var(--dn-fg)] focus:outline-none"
            >
              <option value="">默认（{defaultAdapterId || '自动'}）</option>
              {adapters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id}
                </option>
              ))}
            </select>
            <label className="text-xs text-[var(--dn-muted)]" htmlFor="new-session-persona-select">
              角色（默认 = 跟随全局设置）
            </label>
            <select
              id="new-session-persona-select"
              data-testid="new-session-persona-select"
              value={selPersona}
              onChange={(e) => setSelPersona(e.target.value)}
              className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-2 py-1 text-xs text-[var(--dn-fg)] focus:outline-none"
            >
              <option value="">默认角色</option>
              {Object.entries(personaNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}（{id}）
                </option>
              ))}
            </select>
            <label className="text-xs text-[var(--dn-muted)]" htmlFor="new-session-model-input">
              模型（写入全局配置，对之后所有会话生效）
            </label>
            {effectiveAdapter && !effectiveAdapter.supportsModel ? (
              <div data-testid="new-session-model-unsupported" className="text-xs text-[var(--dn-muted)]">
                该助手不支持选模型
              </div>
            ) : (
              <input
                id="new-session-model-input"
                data-testid="new-session-model-input"
                list="new-session-model-suggestions"
                value={selModel}
                onChange={(e) => setSelModel(e.target.value)}
                placeholder={
                  effectiveAdapter?.model
                    ? `当前：${effectiveAdapter.model}`
                    : '模型名，留空用 CLI 默认模型'
                }
                className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-2 py-1 text-xs text-[var(--dn-fg)] focus:outline-none"
              />
            )}
            <datalist id="new-session-model-suggestions">
              {modelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                data-testid="new-session-options-cancel"
                onClick={() => {
                  setOptPanelOpen(false)
                  setSelAdapter('')
                  setSelPersona('')
                  setSelModel('')
                }}
                className="rounded-[var(--dn-radius-sm)] px-2 py-1 text-xs text-[var(--dn-muted)] hover:bg-[var(--dn-list-hover-bg)]"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="new-session-options-submit"
                onClick={handleNewSessionWithOptions}
                className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] bg-[var(--dn-button-bg)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)]"
              >
                新建
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="new-session-button"
            onClick={handleNewSession}
            className="flex min-h-[28px] flex-1 items-center justify-center gap-1 rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] bg-[var(--dn-button-bg)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)] focus:outline-none"
          >
            <Icon name="plus" size={12} />
            新建会话
          </button>
          <button
            type="button"
            data-testid="new-session-options-button"
            title="选择助手 / 角色 / 模型新建会话"
            aria-label="选择助手、角色、模型新建会话"
            aria-expanded={optPanelOpen}
            onClick={handleToggleOptions}
            className="flex min-h-[28px] flex-none items-center justify-center rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)] focus:outline-none"
          >
            <Icon name={optPanelOpen ? 'chevron-up' : 'chevron-down'} size={12} />
            选项
          </button>
          <button
            type="button"
            data-testid="new-session-dir-button"
            title="选择工作目录新建会话"
            aria-label="选择工作目录新建会话"
            aria-expanded={dirPanelOpen}
            onClick={() => setDirPanelOpen((v) => !v)}
            className="flex min-h-[28px] flex-none items-center justify-center rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)] focus:outline-none"
          >
            <Icon name={dirPanelOpen ? 'chevron-up' : 'chevron-down'} size={12} />
            目录
          </button>
        </div>
      </div>
    </div>
  )
}
