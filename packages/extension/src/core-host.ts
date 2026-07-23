/**
 * core-host：@dionysus/core 的装配层（architecture.md §6.1 core-host.ts）。
 *
 * 职责：
 * - 以 createConfigService 的**唯一引用**为配置源（ADR-6 热更新语义）：
 *   交给 SessionManager 的 adapters record 与 inject 对象全程保持 identity 稳定，
 *   配置变更时原地深替换内容（与 config.ts replaceContents 同款手法），
 *   杜绝 v2 配置双副本导致热更新失效的 bug；
 * - JsonlSessionStore：storageDir = context.globalStorageUri.fsPath，
 *   会话文件落在 <globalStorage>/sessions/*.jsonl；
 * - SessionManager：adapters 配置 = settings 的 dionysus.adapters ∪ 按 CLI
 *   探测结果合成的缺省条目；dionysus.adapter.default 为空时用首个可用 CLI
 *   （§6.1.1）；cli-detect 一个 CLI 都没找到时 needCliGuide=true（webview 引导页）；
 * - manager.onMessage → BroadcastHub.broadcast（seq 赋值/环形缓冲在 hub 内）；
 * - handleClientMessage：协议消息 → core 调用的唯一分发口（transport 校验后转交）。
 *
 * 本模块零 vscode 依赖：宿主需要的值（storageDir/assetsDir）以参数注入，
 * webview 以 WebviewLike 结构类型接入，可在纯 node/vitest 下完整测试。
 * 素材 URL（modelUrl/portraitUrls）只能由持有 webview 的层经 asWebviewUri 解析，
 * 故 attachWebview 接受 per-clientId 的 uriResolver 注入（Phase 4），
 * persona_list/character_list 响应按请求来源 clientId 的 resolver 补全 URL。
 *
 * 陪伴层装配（OBS-4 修复）：supervisor.mode !== 'disabled' 时装配
 * createCompanion——hooks 挂进 SessionManager（engine/scheduler/supervisor/
 * todo-tracker 由此在真机生效），audienceCount 取 BroadcastHub.clientCount，
 * 归来摘要改写接 hub 的 returnSummaryRewriter 挂钩；周期 tick 计时器由本层
 * start/stop（dispose 时停止）。
 *
 * focus_session（BUG-2 修复）：sidebar 点击会话 → setFocusSessionHandler
 * 回调（宿主聚焦聊天面板）+ 向 chat webview 单播 session_switched。
 *
 * 归来摘要（BUG-P5-1 修复）：webview detach / WS onDisconnect 记录各 clientId
 * 断连时刻；sync_request 处理时先以该会话游标 + 断连时长调
 * hub.maybeSendReturnSummary（落后超阈值或断连 >60s 才单播，发出即销账），
 * 再走环形缓冲回放。
 *
 * 移动端链路（Phase 5，§6.3/§6.4）：PairingManager（设备白名单）+
 * WsTransport（每连接一个 mobile clientId，消息走同一 handleClientMessage
 * 分发口）+ lan-server（lan.enabled=false 不启动、配置热重启、多窗口
 * 先到先得）；配对弹层经 host.pairing / host.lan 取 token 与实际端口。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DEFAULT_EMOTION } from '@dionysus/client-core'
import {
  BroadcastHub,
  JsonlSessionStore,
  PersonaLoader,
  SessionManager,
  TemplateRewriter,
  createCompanion,
  createSlashCommands,
  deepMerge,
  executeSlashCommand,
  noticesToMessages,
  resolveStrategy,
  type Companion,
  type IAgentAdapter,
  type SessionMeta as CoreSessionMeta,
} from '@dionysus/core'
import type { AdapterConfig, CliAdapterStrategy } from '@dionysus/core'
import {
  PROTOCOL_VERSION,
  type AdapterListEntry,
  type ClientMessage,
  type PersonaLive2d,
  type PersonaSummary,
  type PersonaUpdateRequestPayload,
  type PersonaVoiceUpdate,
  type ServerMessage,
  type SessionMeta as ProtocolSessionMeta,
  type SettingsKey,
} from '@dionysus/protocol'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

import { scanCharacterLibrary } from './asset-library.js'
import type { CliDetection } from './cli-detect.js'
import type { ConfigService } from './config.js'
import { createLanServer, type LanServer } from './lan-server.js'
import { PairingManager } from './pairing.js'
import { WebviewTransport, type WebviewLike } from './transport.js'
import { WsTransport } from './ws-transport.js'

/** cli-detect 的 CLI id → dionysus.adapters 条目的 type 别名（registry 推策略用）。 */
const CLI_ID_TO_ADAPTER_TYPE: Readonly<Record<string, string>> = {
  kimi_cli: 'kimi_code_cli',
  claude_cli: 'claude_code_cli',
  opencode_cli: 'opencode_cli',
  codex_cli: 'codex_cli',
  codebuddy_cli: 'codebuddy_cli',
}

/**
 * chat webview 的固定 clientId（architecture.md §6.2 postMessage 通道语义）。
 * 与 webview-provider.ts 的 CHAT_CLIENT_ID 同值；本模块零 vscode 依赖故不复用其导出。
 */
const CHAT_CLIENT_ID = 'webview:chat'

export interface CoreHostDeps {
  /** context.globalStorageUri.fsPath（会话落 <storageDir>/sessions/，素材库落 <storageDir>/character-library/） */
  storageDir: string
  /** 内嵌 assets/ 绝对路径（persona loader 的 builtin 目录来源） */
  assetsDir: string
  configService: ConfigService
  /** activate 时的 CLI 探测结果（redetectAgents 后经 refreshDetections 更新） */
  detections: CliDetection[]
  /** 测试注入点：替代 registry.createAdapter（如 FakeAdapter），透传给 SessionManager */
  adapterFactory?: (adapterId: string) => IAgentAdapter
  /**
   * dionysus.workingDir 的占位符解析器（宿主侧把 ${workspaceFolder} 换成工作区路径）；
   * 未注入时按配置原值使用。返回空串视为无默认目录。
   */
  resolveWorkingDir?: (configured: string) => string
  /** 测试注入点：CLI 会话索引文件路径（透传 SessionManager；缺省用各策略约定路径） */
  cliSessionIndexPath?: string
  /** packages/mobile/dist 绝对路径（lan-server 静态托管；mobile 未构建时缺省 → 404 兜底页） */
  mobileDistDir?: string
  now?: () => number
  idGen?: () => string
}

/** settings_update_request 的实际写入器（宿主侧 vscode.workspace 写 settings.json；由设置面板装配时注入）。 */
export type SettingsWriter = (key: SettingsKey, value: string) => Promise<void>

/**
 * adapter_model_update_request 的实际写入器（宿主侧整体回写 dionysus.adapters 对象）。
 * core-host 负责把「只设 model」补全成完整条目（type/command 兜底取自合成配置），
 * 避免 settings.json 里出现缺 type/command 的残缺条目导致 createAdapter 失败。
 */
export type AdaptersWriter = (adapters: Record<string, AdapterConfig>) => Promise<void>

/**
 * 素材绝对路径 → 可加载 URL 的解析器（Phase 4）。
 * asWebviewUri 只能由持有 webview 的层（webview-provider）执行，core-host 零 vscode
 * 依赖，故由 attachWebview 时按 clientId 注入；未注入的客户端收到的是无 URL 的摘要
 * （保持 Wave2-B 行为）。
 */
export type UriResolver = (absoluteFsPath: string) => string

/** attachWebview 的可选装配参数。 */
export interface AttachWebviewOptions {
  /** 该 clientId 的素材 URL 解析器（persona_list/character_list 响应经它补全 URL） */
  uriResolver?: UriResolver
}

export interface CoreHost {
  readonly manager: SessionManager
  readonly hub: BroadcastHub
  readonly store: JsonlSessionStore
  readonly transport: WebviewTransport
  readonly configService: ConfigService
  readonly personaLoader: PersonaLoader
  /** 移动端配对管理器（§6.4；设备白名单/二维码 token 签发，配对弹层与 lan-server 共用） */
  readonly pairing: PairingManager
  /** 内嵌 HTTP/WS 服务（§6.3；lan.enabled=false 时 state='stopped'；二维码弹层读实际绑定端口） */
  readonly lan: LanServer
  /** 陪伴层（supervisor.mode='disabled' 时不装配，为 null）；诊断与测试可读 */
  readonly companion: Companion | null
  /** 传给 SessionManager 的 adapters record（identity 稳定，原地热更新）；诊断与测试可读 */
  readonly adaptersConfig: Record<string, AdapterConfig>
  readonly detections: readonly CliDetection[]
  /** cli-detect 未找到任何 CLI（webview 显示安装引导页） */
  readonly needCliGuide: boolean
  /** 装配时解析的默认 persona：配置优先，为空按素材库探测（chat 面板 init 注入用） */
  readonly defaultPersonaId: string
  /** dionysus.adapter.default 非空用之；为空用首个可用 CLI；都没有为空串（manager 回合时报 notice） */
  resolveDefaultAdapterId(): string
  /** redetectAgents 后更新探测结果：重算 needCliGuide、补合成 adapters 条目（原地） */
  refreshDetections(detections: CliDetection[]): void
  /** 注入 settings_update_request 的写入器（设置面板 controller 装配时调用；未注入时该请求回 ok=false） */
  setSettingsWriter(writer: SettingsWriter): void
  /** 注入 adapter_model_update_request 的写入器（同上；未注入时该请求回 ok=false） */
  setAdaptersWriter(writer: AdaptersWriter): void
  /** 注入 focus_session 的宿主回调（extension 层聚焦聊天面板；session_switched 单播由本层负责） */
  setFocusSessionHandler(handler: (sessionId: string) => void): void
  /** 注入 working_dir_pick_request 的宿主回调（extension 层 vscode.window.showOpenDialog 选目录） */
  setWorkingDirPickHandler(handler: (defaultPath?: string) => Promise<string | null>): void
  /** 绑定一个 webview：注册进 transport 与 BroadcastHub；dispose 时双向注销 */
  attachWebview(clientId: string, webview: WebviewLike, options?: AttachWebviewOptions): { dispose(): void }
  /** 协议消息分发口（transport 已用 parseClientMessage 校验） */
  handleClientMessage(clientId: string, msg: ClientMessage): Promise<void>
  dispose(): void
}

/** core SessionMeta → protocol SessionMeta（session_list_response 只带协议字段）。 */
function toProtocolMeta(meta: CoreSessionMeta): ProtocolSessionMeta {
  return {
    id: meta.id,
    title: meta.title,
    personaId: meta.personaId,
    status: meta.status,
    ...(meta.lastMessagePreview !== undefined ? { lastMessagePreview: meta.lastMessagePreview } : {}),
    updatedAt: meta.updatedAt,
    unreadCount: meta.unreadCount,
    ...(meta.workingDir !== undefined ? { workingDir: meta.workingDir } : {}),
  }
}

/** 深替换 target 内容为 source（保持 identity，与 config.ts 的热更新手法一致）。 */
function replaceContents(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, source)
}

/** settings 的 AdapterConfig（必填字段）→ core 的 AdapterConfig（带索引签名）。 */
function toCoreAdapters(
  adapters: Record<string, { type: string; command: string; model: string | null }>,
): Record<string, AdapterConfig> {
  const out: Record<string, AdapterConfig> = {}
  for (const [id, entry] of Object.entries(adapters)) {
    out[id] = { type: entry.type, command: entry.command, model: entry.model }
  }
  return out
}

/**
 * 「该助手是否支持经 Dionysus 选模型」的展示口径（adapter_list_response.supportsModel）：
 * 策略声明的 supportsModel 之上排除 codex——其 config.model 从不拼进命令行
 * （extract/adapters.md §5.3/§7.7：exec 无 --model 参数的死配置），名义 true 实际无效，
 * 按 false 呈现，避免 UI「可选、选了无效」的名义与实际不符。
 */
function effectiveSupportsModel(strategy: CliAdapterStrategy | null): boolean {
  if (!strategy) return false
  if (strategy.adapterId === 'codex_cli') return false
  return strategy.supportsModel
}

/** personaId 将直接拼成 runtime YAML 文件名，拒绝路径成分与穿越（同 §11 的归一化校验精神）。 */
function isSafePersonaId(personaId: string): boolean {
  return personaId.length > 0 && !/[/\\]/.test(personaId) && !personaId.includes('..')
}

/** unknown → Record<string, string>（仅当确为字符串值 record；否则 undefined） */
function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') return undefined
    out[k] = v
  }
  return out
}

/** unknown → {name, file}[]（显式动作/表情清单；形状不符返回 undefined） */
function asManifestEntries(value: unknown): { name: string; file: string }[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: { name: string; file: string }[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return undefined
    const { name, file } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof file !== 'string') return undefined
    out.push({ name, file })
  }
  return out
}

/**
 * persona companion.live2d 段（loader 宽松透传的 Record，蛇形键）→ 协议的
 * PersonaLive2d（camelCase）。model_path 键忽略——模型 URL 一律以素材库扫描结果为准。
 */
function extractLive2dConfig(raw: Record<string, unknown>): PersonaLive2d | undefined {
  const out: PersonaLive2d = {}
  const expressions = asStringRecord(raw.expressions)
  if (expressions) out.expressions = expressions
  const motions = asStringRecord(raw.motions)
  if (motions) out.motions = motions
  if (typeof raw.default_expression === 'string') out.defaultExpression = raw.default_expression
  if (typeof raw.scale === 'number') out.scale = raw.scale
  const expressionFiles = asManifestEntries(raw.expression_files)
  if (expressionFiles) out.expressionFiles = expressionFiles
  const motionFiles = asManifestEntries(raw.motion_files)
  if (motionFiles) out.motionFiles = motionFiles
  return Object.keys(out).length > 0 ? out : undefined
}

/** voice 增量（camelCase）→ YAML 蛇形键；只保留请求中实际出现的 diff 键。 */
function voiceUpdateToYamlKeys(voice: PersonaVoiceUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (voice.tone !== undefined) out.tone = voice.tone
  if (voice.catchphrases !== undefined) out.catchphrases = voice.catchphrases
  if (voice.taboos !== undefined) out.taboos = voice.taboos
  if (voice.examples !== undefined) out.examples = voice.examples
  if (voice.rewriterPrompt !== undefined) out.rewriter_prompt = voice.rewriterPrompt
  return out
}

export async function createCoreHost(deps: CoreHostDeps): Promise<CoreHost> {
  const { configService, storageDir } = deps
  const now = deps.now ?? Date.now
  let detections = [...deps.detections]

  // ── adapters record：identity 稳定的唯一引用，交给 SessionManager ──────────
  // 内容 = settings 的 dionysus.adapters ∪ 按探测结果合成的缺省条目；
  // 之后一切变更（settings 热更新 / 重新探测）都原地改这个对象。
  const adaptersRef: Record<string, AdapterConfig> = toCoreAdapters(configService.config.adapters)

  function syncAdaptersFromConfig(): void {
    const merged: Record<string, AdapterConfig> = toCoreAdapters(configService.config.adapters)
    for (const det of detections) {
      if (!det.installed || merged[det.id]) continue
      merged[det.id] = { type: CLI_ID_TO_ADAPTER_TYPE[det.id] ?? det.id, command: det.command, model: null }
    }
    replaceContents(adaptersRef as Record<string, unknown>, merged as Record<string, unknown>)
  }
  syncAdaptersFromConfig()

  function resolveDefaultAdapterId(): string {
    const configured = configService.config.adapter.default
    if (configured) return configured
    return detections.find((d) => d.installed)?.id ?? ''
  }

  // ── persona loader 与可选注入增强（rewriter 为默认通道，注入默认关）────────
  const userLibraryDir = join(storageDir, 'character-library')
  const personaLoader = new PersonaLoader({
    builtinDir: join(deps.assetsDir, 'personas', 'builtin'),
    runtimeDir: userLibraryDir,
  })

  /** persona system_prompt 缓存：getSystemPrompt 是同步接口，首轮未命中时返回 null 并后台填缓存 */
  const promptCache = new Map<string, string | null>()
  function warmPromptCache(personaId: string): void {
    if (promptCache.has(personaId)) return
    promptCache.set(personaId, null)
    void personaLoader
      .load(personaId)
      .then((p) => promptCache.set(personaId, p.systemPrompt?.trim() ? p.systemPrompt : null))
      .catch(() => promptCache.set(personaId, null))
  }

  // 默认 persona：配置优先；为空按素材库探测（已安装模型对应的 persona 优先，§6.5）。
  // 多个 live2d 素材并存时按 §6.5 约定优先 kal'tsit（出厂主推角色），其余按扫描序取首个。
  let defaultPersonaId = configService.config.persona.default
  if (!defaultPersonaId) {
    try {
      const assets = await scanCharacterLibrary({ builtinAssetsDir: deps.assetsDir, userLibraryDir })
      const live2d = assets.filter((a) => a.kind === 'live2d')
      defaultPersonaId =
        live2d.find((a) => a.personaId === "kal'tsit")?.personaId ??
        live2d[0]?.personaId ??
        assets[0]?.personaId ??
        'default'
    } catch {
      defaultPersonaId = 'default'
    }
  }
  warmPromptCache(defaultPersonaId)

  // inject 对象 identity 稳定：enabled 随配置热更新原地改
  const inject = {
    enabled: configService.config.persona.injectIntoAgent,
    getSystemPrompt: (meta: CoreSessionMeta): string | null => {
      if (!promptCache.has(meta.personaId)) warmPromptCache(meta.personaId)
      return promptCache.get(meta.personaId) ?? null
    },
    // Phase 3 仅注册 kimi 策略（prompt-prefix）；其余 CLI 策略落地后按策略元数据分流
    supportsSystemPrompt: 'prompt-prefix' as const,
  }

  // ── store / hub / companion / manager ─────────────────────────────────────
  const store = new JsonlSessionStore(storageDir)

  // hub 先于 companion 装配：归来摘要的口吻改写挂钩（returnSummaryRewriter）由
  // companion 提供，经闭包延迟绑定（hub 实例 identity 稳定，companion 随后就位）。
  let companion: Companion | null = null
  const hub = new BroadcastHub({
    returnSummaryRewriter: (text) => companion?.returnSummaryRewriter(text) ?? text,
  })

  // companion 先于 manager 装配（companion.hooks 是 SessionManager 的挂载点）；
  // listSessions 经 ref 延迟到运行期取 manager（supervisor tick / 回合末播报才调用，
  // 装配期不会触发）。
  const managerRef: { current: SessionManager | null } = { current: null }
  const supervisorConfig = configService.config.supervisor
  if (supervisorConfig.mode !== 'disabled') {
    companion = createCompanion({
      loader: personaLoader,
      defaultPersonaId,
      emit: (msg) => hub.broadcast(msg),
      persist: (sessionId, ev) => store.appendMessage(sessionId, ev),
      audienceCount: () => hub.clientCount,
      listSessions: () => managerRef.current?.listSessions() ?? [],
      supervisor: {
        mode: supervisorConfig.mode,
        intervalSeconds: supervisorConfig.intervalSeconds,
        ...(supervisorConfig.adapterId ? { adapterId: supervisorConfig.adapterId } : {}),
        ...(supervisorConfig.llm.baseUrl && supervisorConfig.llm.model
          ? { llm: { baseUrl: supervisorConfig.llm.baseUrl, model: supervisorConfig.llm.model } }
          : {}),
      },
      now,
    })
    // 预载默认 persona，避免首个回合的加载延迟
    void companion.preloadPersona(defaultPersonaId)
  }

  const manager = new SessionManager({
    store,
    adapters: adaptersRef,
    defaultAdapterId: resolveDefaultAdapterId(),
    defaultPersonaId,
    maxConcurrentAgents: configService.config.maxConcurrentAgents,
    optionTimeoutAction: configService.config.session.optionTimeoutAction,
    inject,
    ...(companion ? { companion: companion.hooks } : {}),
    ...(deps.adapterFactory ? { adapterFactory: deps.adapterFactory } : {}),
    // 会话级 workingDir 的全局兜底：getter 形式取值，配置热更新即时生效
    defaultWorkingDir: () => {
      const configured = configService.config.workingDir
      const resolved = deps.resolveWorkingDir ? deps.resolveWorkingDir(configured) : configured
      return resolved || undefined
    },
    ...(deps.cliSessionIndexPath ? { cliSessionIndexPath: deps.cliSessionIndexPath } : {}),
    now,
    ...(deps.idGen ? { idGen: deps.idGen } : {}),
  })
  managerRef.current = manager

  // supervisor 周期 tick 计时器由 core-host 启停（manager 就位后启动，dispose 停止）
  companion?.start()

  const transport = new WebviewTransport()
  const unsubManager = manager.onMessage((msg) => hub.broadcast(msg))

  // BUG-P5-1：各 clientId 最近一次断连时刻（归来摘要「断连 >60s」阈值的数据源）。
  // webview detach 与移动端 WS 断开共用这一本账；摘要成功单播后销账，
  // 避免同一客户端后续 sync_request 重复播报。
  const disconnectedAt = new Map<string, number>()
  const noteDisconnect = (clientId: string): void => {
    disconnectedAt.set(clientId, now())
    hub.unregisterClient(clientId)
  }
  const unsubTransport = transport.onDisconnect(noteDisconnect)
  const unsubMessage = transport.onMessage((clientId, msg) => {
    handleClientMessage(clientId, msg).catch((err: unknown) => {
      console.error(`[dionysus] handleClientMessage(${msg.type}) failed:`, err)
      broadcastNotice(msg.sessionId, `处理消息 ${msg.type} 失败：${(err as Error).message}`, 'error')
    })
  })

  // ── Phase 5：移动端链路（lan-server + PairingManager + WsTransport，§6.3/§6.4）──
  // - PairingManager：设备白名单持久化于 <storageDir>/paired-devices.json；
  // - WsTransport：每连接一个 mobile:<id> clientId，连接建立/断开经 onConnect/
  //   onDisconnect 对接 BroadcastHub 注册/注销（断连只注销，不碰适配器进程）；
  //   收消息走与 webview 相同的 handleClientMessage 分发口；
  // - lan-server：lan.enabled=false 不启动；enabled/port 变更热重启（复用
  //   配置单引用热更新通道，§6.3）；端口被本插件另一窗口占用时 disabled +
  //   system_notice（先到先得，不抢占）。
  const pairing = await PairingManager.create(join(storageDir, 'paired-devices.json'), { now })
  const wsTransport = new WsTransport({ pairing })
  const lanServer = createLanServer({
    pairing,
    assetsDir: deps.assetsDir,
    userLibraryDir,
    ...(deps.mobileDistDir ? { mobileDistDir: deps.mobileDistDir } : {}),
    port: configService.config.lan.port,
  })
  lanServer.onUpgrade = (req, socket, head) => wsTransport.handleUpgrade(req, socket, head)

  /** 当前已应用的 lan 配置（热重启的变更检测基准） */
  let lanApplied = { ...configService.config.lan }

  async function applyLanConfig(cfg: { enabled: boolean; port: number }): Promise<void> {
    lanApplied = { ...cfg }
    await lanServer.stop()
    if (!cfg.enabled) return
    lanServer.setPort(cfg.port)
    await lanServer.start()
    if (lanServer.state === 'disabled') {
      broadcastNotice(
        undefined,
        lanServer.disabledReason === 'port-taken-by-dionysus'
          ? '局域网端口已被另一个 VS Code 窗口的 Dionysus 占用，本窗口的手机连接已停用。'
          : `局域网端口 ${cfg.port}–${cfg.port + 10} 均被占用，手机连接服务启动失败。`,
        'warning',
      )
    }
  }
  await applyLanConfig(configService.config.lan)

  const unsubWsConnect = wsTransport.onConnect((clientId) => {
    hub.registerClient(clientId, (m) => wsTransport.send(clientId, m))
  })
  const unsubWsDisconnect = wsTransport.onDisconnect(noteDisconnect)
  const unsubWsMessage = wsTransport.onMessage((clientId, msg) => {
    handleClientMessage(clientId, msg).catch((err: unknown) => {
      console.error(`[dionysus] handleClientMessage(${msg.type}) failed (ws ${clientId}):`, err)
      broadcastNotice(msg.sessionId, `处理消息 ${msg.type} 失败：${(err as Error).message}`, 'error')
    })
  })

  // 配置热更新：单引用原地更新（ADR-6）
  const unsubConfig = configService.onDidChange((config) => {
    syncAdaptersFromConfig()
    inject.enabled = config.persona.injectIntoAgent
    if (config.persona.default) warmPromptCache(config.persona.default)
    // lan.enabled/lan.port 变更 → lan-server 热重启（§6.3，复用同一热更新通道）
    if (config.lan.enabled !== lanApplied.enabled || config.lan.port !== lanApplied.port) {
      void applyLanConfig(config.lan)
    }
  })

  const slashCommands = createSlashCommands()

  function unicast(clientId: string, msg: ServerMessage): void {
    hub.unicast(clientId, msg)
  }

  function broadcastNotice(sessionId: string | undefined, text: string, level: 'info' | 'warning' | 'error'): void {
    hub.broadcast({
      v: 1,
      type: 'system_notice',
      ...(sessionId ? { sessionId } : {}),
      ts: now(),
      payload: { text, level },
    })
  }

  // ── 角色素材库与 persona voice 客制化（§7 / ux-core-flows.md §5.5）─────────

  /** settings_update_request 的宿主写入器（设置面板 controller 装配时注入）。 */
  let settingsWriter: SettingsWriter | null = null

  /** adapter_model_update_request 的宿主写入器（设置面板 controller 装配时注入）。 */
  let adaptersWriter: AdaptersWriter | null = null

  /** focus_session 的宿主回调（extension 层注入：聚焦聊天面板）。 */
  let focusSessionHandler: ((sessionId: string) => void) | null = null

  /** working_dir_pick_request 的宿主回调（extension 层注入：showOpenDialog 选目录）。 */
  let workingDirPickHandler: ((defaultPath?: string) => Promise<string | null>) | null = null

  /** per-clientId 素材 URL 解析器（attachWebview 注入；asWebviewUri 属 webview 持有层） */
  const uriResolvers = new Map<string, UriResolver>()

  /**
   * 素材相对路径 → 可加载 URL：按 source 选根目录（builtin = 内嵌 assets/，
   * user = character-library/），拼成绝对路径后交该客户端的 uriResolver。
   * 未注入 resolver 的客户端返回 undefined（响应不带 URL 字段，保持原行为）。
   */
  function resolveAssetUrl(clientId: string, source: 'builtin' | 'user', relPath: string): string | undefined {
    const resolver = uriResolvers.get(clientId)
    if (!resolver) return undefined
    const root = source === 'builtin' ? deps.assetsDir : userLibraryDir
    return resolver(join(root, ...relPath.split('/')))
  }

  /** persona 摘要列表：loader 枚举 + 逐个 load；素材 URL 经 clientId 的 uriResolver 解析。 */
  async function buildPersonaSummaries(clientId: string): Promise<PersonaSummary[]> {
    const assets = await scanCharacterLibrary({ builtinAssetsDir: deps.assetsDir, userLibraryDir })
    const avatarByPersona = new Map<string, { path: string; source: 'builtin' | 'user' }>()
    const live2dByPersona = new Map<string, { modelUrl: string; source: 'builtin' | 'user' }>()
    const staticByPersona = new Map<string, { portraitUrls: Record<string, string>; source: 'builtin' | 'user' }>()
    for (const asset of assets) {
      if (asset.kind === 'static' && asset.portraitUrls) {
        const avatarPath = asset.portraitUrls[DEFAULT_EMOTION]
        if (avatarPath && !avatarByPersona.has(asset.personaId)) {
          avatarByPersona.set(asset.personaId, { path: avatarPath, source: asset.source })
        }
        if (!staticByPersona.has(asset.personaId)) {
          staticByPersona.set(asset.personaId, { portraitUrls: asset.portraitUrls, source: asset.source })
        }
      }
      if (asset.kind === 'live2d' && asset.modelUrl && !live2dByPersona.has(asset.personaId)) {
        live2dByPersona.set(asset.personaId, { modelUrl: asset.modelUrl, source: asset.source })
      }
    }
    const summaries: PersonaSummary[] = []
    for (const entry of await personaLoader.list()) {
      try {
        const persona = await personaLoader.load(entry.id)
        const avatar = avatarByPersona.get(persona.id)
        const live2dAsset = live2dByPersona.get(persona.id)
        const staticAsset = staticByPersona.get(persona.id)
        const modelUrl = live2dAsset
          ? resolveAssetUrl(clientId, live2dAsset.source, live2dAsset.modelUrl)
          : undefined
        let portraitUrls: Record<string, string> | undefined
        if (staticAsset) {
          portraitUrls = {}
          for (const [emotion, rel] of Object.entries(staticAsset.portraitUrls)) {
            const url = resolveAssetUrl(clientId, staticAsset.source, rel)
            if (url) portraitUrls[emotion] = url
          }
          if (Object.keys(portraitUrls).length === 0) portraitUrls = undefined
        }
        const live2d = extractLive2dConfig(persona.companion.live2d)
        summaries.push({
          id: persona.id,
          name: persona.name,
          description: persona.description,
          ...(avatar ? { avatarPath: avatar.path, avatarSource: avatar.source } : {}),
          voice: {
            tone: persona.voice.tone,
            catchphrases: persona.voice.catchphrases,
            taboos: persona.voice.taboos,
            examples: persona.voice.examples,
            rewriterPrompt: persona.voice.rewriterPrompt,
          },
          touchZones: persona.companion.touchZones,
          ...(modelUrl ? { modelUrl } : {}),
          ...(portraitUrls ? { portraitUrls } : {}),
          ...(live2d ? { live2d } : {}),
        })
      } catch {
        // 无法解析的 persona 不出现在列表（loader.list 已过滤一轮，此处双保险）
      }
    }
    return summaries
  }

  /**
   * 写 runtime persona YAML（ADR-5 一律用 yaml 库）。
   * 落点与 PersonaLoader 的 runtimeDir 一致：<storageDir>/character-library/<id>.yaml
   * （assets/personas 为只读内嵌）；loader 对 builtin 逐键深合并，故只写 diff 键——
   * 请求中未出现的字段不落盘，避免 runtime 文件屏蔽 builtin 完整版（§5.4 合并规则）。
   */
  async function writeRuntimePersona(update: PersonaUpdateRequestPayload): Promise<void> {
    await mkdir(userLibraryDir, { recursive: true })
    const file = join(userLibraryDir, `${update.personaId}.yaml`)
    let existing: Record<string, unknown> = {}
    try {
      const parsed = parseYaml(await readFile(file, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const diff: Record<string, unknown> = {}
    if (update.name !== undefined) diff.name = update.name
    if (update.description !== undefined) diff.description = update.description
    if (update.voice) diff.voice = voiceUpdateToYamlKeys(update.voice)
    const isNew = Object.keys(existing).length === 0
    const next = deepMerge(existing, diff) as Record<string, unknown>
    if (isNew) {
      // personaFileSchema 要求 id/name：builtin 能提供时只写 diff 键（避免回写
      // name 屏蔽 builtin 显示名）；仅当 builtin 与 runtime 都无此 persona
      // （自创角色）时补 id/name 兜底。
      const loadable = await personaLoader.load(update.personaId).then(
        () => true,
        () => false,
      )
      if (!loadable) {
        next.id = update.personaId
        if (next.name === undefined) next.name = update.name ?? update.personaId
      }
    }
    await writeFile(file, stringifyYaml(next), 'utf8')
    // 写后校验：builtin+runtime 合并结果必须能被 loader 解析（非法占位符/形状在此暴露）
    await personaLoader.load(update.personaId)
  }

  /**
   * adapter_list_response 数据：合并 adapters record（settings ∪ 探测合成）逐条标注。
   * 排序 = cli-detect 的 SUPPORTED_CLIS 顺序在前，用户自定义适配器随后；
   * 自定义适配器（不在探测清单）视为已安装（用户显式配置）。
   */
  function buildAdapterList(): AdapterListEntry[] {
    const detectedIds = detections.map((d) => d.id).filter((id) => id in adaptersRef)
    const customIds = Object.keys(adaptersRef).filter((id) => !detections.some((d) => d.id === id))
    return [...detectedIds, ...customIds].map((id) => {
      const cfg = adaptersRef[id]
      const det = detections.find((d) => d.id === id)
      return {
        id,
        command: cfg.command ?? det?.command ?? '',
        installed: det ? det.installed : true,
        supportsModel: effectiveSupportsModel(resolveStrategy(id, adaptersRef)),
        model: typeof cfg.model === 'string' ? cfg.model : '',
      }
    })
  }

  /**
   * adapter_model_update_request：把「只设 model」补全成完整 adapters 条目后整体回写
   * dionysus.adapters——残缺条目（缺 type/command）会让 registry 推不出策略而拒建适配器。
   * type/command 兜底取自合并配置（含探测合成条目）；settings 已有的其余键原样保留。
   */
  async function writeAdapterModel(adapterId: string, model: string): Promise<void> {
    if (!adaptersWriter) throw new Error('当前宿主未配置设置写入')
    const effective = adaptersRef[adapterId]
    const current = configService.config.adapters[adapterId] as unknown as
      | Record<string, unknown>
      | undefined
    const entry: AdapterConfig = {
      ...(current ?? {}),
      type: (typeof current?.type === 'string' && current.type) || effective.type,
      command: (typeof current?.command === 'string' && current.command) || effective.command,
      model: model.trim() ? model.trim() : null,
    }
    // 逐条展开为新鲜对象（settings 的 AdapterConfig 无索引签名，直接整体强转不过编译）
    const next: Record<string, AdapterConfig> = {}
    for (const [id, e] of Object.entries(configService.config.adapters)) next[id] = { ...e }
    next[adapterId] = entry
    await adaptersWriter(next)
  }

  async function handleClientMessage(clientId: string, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'hello': {
        const sessions = await manager.listSessions()
        unicast(clientId, {
          v: 1,
          type: 'handshake',
          ts: now(),
          payload: {
            v: PROTOCOL_VERSION,
            clientId,
            sessions: sessions.map((s) => ({
              sessionId: s.id,
              title: s.title,
              status: s.status,
              latestSeq: hub.latestSeq(s.id),
            })),
          },
        })
        return
      }
      case 'ping':
        unicast(clientId, { v: 1, type: 'pong', ts: now(), payload: {} })
        return
      case 'new_session':
        await manager.createSession({
          ...(msg.payload.personaId ? { personaId: msg.payload.personaId } : {}),
          ...(msg.payload.title ? { title: msg.payload.title } : {}),
          ...(msg.payload.workingDir ? { workingDir: msg.payload.workingDir } : {}),
          adapterId: msg.payload.adapterId ?? resolveDefaultAdapterId(),
        })
        // 会话创建本身经 session_digest_update 广播，无需额外响应
        return
      case 'user_input':
        if (!msg.sessionId) {
          unicast(clientId, {
            v: 1,
            type: 'system_notice',
            ts: now(),
            payload: { text: 'user_input 缺少 sessionId', level: 'error' },
          })
          return
        }
        await manager.handleUserInput(msg.sessionId, msg.payload, clientId)
        return
      case 'option_selected':
        if (!msg.sessionId) return
        await manager.handleOptionSelected(msg.sessionId, msg.payload, clientId)
        return
      case 'interrupt':
        if (!msg.sessionId) return
        await manager.interrupt(msg.sessionId, msg.payload)
        return
      case 'client_command': {
        const notices = await executeSlashCommand(
          msg.payload.command,
          {
            manager,
            ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
            args: msg.payload.args ?? msg.payload.text ?? '',
            origin: clientId,
          },
          slashCommands,
        )
        for (const noticeMsg of noticesToMessages(notices, msg.sessionId, now())) {
          hub.broadcast(noticeMsg)
        }
        return
      }
      case 'sync_request': {
        // BUG-P5-1：重连客户端落后超阈值或断连 >60s 时，先向该客户端单播
        // 归来摘要（内置模板，零 LLM），再按 afterSeq 回放补拉。断连时长
        // 来自 noteDisconnect 台账；摘要发出即销账，不重复播报。
        const goneAt = disconnectedAt.get(clientId)
        const sent = hub.maybeSendReturnSummary(
          clientId,
          [{ sessionId: msg.payload.sessionId, afterSeq: msg.payload.afterSeq }],
          { disconnectedMs: goneAt !== undefined ? now() - goneAt : 0 },
        )
        if (sent) disconnectedAt.delete(clientId)
        hub.handleSyncRequest(clientId, msg.payload)
        return
      }
      case 'session_list_request': {
        const sessions = await manager.listSessions()
        unicast(clientId, {
          v: 1,
          type: 'session_list_response',
          ...(msg.traceId ? { traceId: msg.traceId } : {}),
          ts: now(),
          payload: { sessions: sessions.map(toProtocolMeta) },
        })
        return
      }
      case 'history_request': {
        const { sessionId, beforeTs, limit } = msg.payload
        const all = await store.loadEntries(sessionId)
        const eligible = beforeTs !== undefined ? all.filter((e) => e.ts < beforeTs) : all
        const entries = eligible.slice(-limit)
        unicast(clientId, {
          v: 1,
          type: 'history_response',
          ...(msg.traceId ? { traceId: msg.traceId } : {}),
          sessionId,
          ts: now(),
          payload: { sessionId, entries, hasMore: eligible.length > entries.length },
        })
        return
      }
      case 'focus_session': {
        // sidebar 点击会话项：会话存在性校验 → 宿主聚焦聊天面板 → 向 chat
        // webview 单播 session_switched（不经广播，避免多端互抢当前会话）。
        const { sessionId } = msg.payload
        const sessions = await manager.listSessions()
        if (!sessions.some((s) => s.id === sessionId)) {
          unicast(clientId, {
            v: 1,
            type: 'system_notice',
            ts: now(),
            payload: { text: `会话不存在：${sessionId}`, level: 'error' },
          })
          return
        }
        focusSessionHandler?.(sessionId)
        transport.send(CHAT_CLIENT_ID, {
          v: 1,
          type: 'session_switched',
          ts: now(),
          payload: { sessionId },
        })
        return
      }
      case 'cli_session_list_request': {
        // 「恢复历史会话」数据源：委托 core 的策略索引能力（kimi session_index.jsonl），
        // 按会话工作目录过滤；会话不存在回 error notice，不伪造响应。
        const { sessionId } = msg.payload
        try {
          const result = await manager.listCliSessions(sessionId)
          unicast(clientId, {
            v: 1,
            type: 'cli_session_list_response',
            ...(msg.traceId ? { traceId: msg.traceId } : {}),
            ts: now(),
            payload: { sessionId, supported: result.supported, sessions: result.sessions },
          })
        } catch (err) {
          unicast(clientId, {
            v: 1,
            type: 'system_notice',
            ts: now(),
            payload: { text: `查询 CLI 历史会话失败：${(err as Error).message}`, level: 'error' },
          })
        }
        return
      }
      case 'working_dir_pick_request': {
        // 新建会话的「选择工作目录」步骤：宿主弹目录选择框（showOpenDialog 由
        // extension 层注入；未注入时按取消处理）。
        const picked = workingDirPickHandler
          ? await workingDirPickHandler(msg.payload.defaultPath)
          : null
        unicast(clientId, {
          v: 1,
          type: 'working_dir_pick_response',
          ...(msg.traceId ? { traceId: msg.traceId } : {}),
          ts: now(),
          payload: picked ? { path: picked, canceled: false } : { canceled: true },
        })
        return
      }
      case 'persona_list_request': {
        const personas = await buildPersonaSummaries(clientId)
        unicast(clientId, {
          v: 1,
          type: 'persona_list_response',
          ...(msg.traceId ? { traceId: msg.traceId } : {}),
          ts: now(),
          payload: { personas },
        })
        return
      }
      case 'persona_update_request': {
        const { personaId } = msg.payload
        const respond = (ok: boolean, error?: string) =>
          unicast(clientId, {
            v: 1,
            type: 'persona_update_response',
            ...(msg.traceId ? { traceId: msg.traceId } : {}),
            ts: now(),
            payload: { personaId, ok, ...(error !== undefined ? { error } : {}) },
          })
        if (!isSafePersonaId(personaId)) {
          respond(false, `非法 personaId：${personaId}`)
          return
        }
        try {
          await writeRuntimePersona(msg.payload)
          respond(true)
        } catch (err) {
          respond(false, (err as Error).message)
        }
        return
      }
      case 'voice_preview_request': {
        const { personaId, text, voice } = msg.payload
        try {
          const persona = await personaLoader.load(personaId)
          // voice 增量覆盖已加载配置：试听未保存的表单编辑（ux-core-flows.md §5.5）
          if (voice) {
            persona.voice = {
              tone: voice.tone ?? persona.voice.tone,
              catchphrases: voice.catchphrases ?? persona.voice.catchphrases,
              taboos: voice.taboos ?? persona.voice.taboos,
              examples: voice.examples ?? persona.voice.examples,
              rewriterPrompt: voice.rewriterPrompt ?? persona.voice.rewriterPrompt,
            }
          }
          const rewritten = new TemplateRewriter().rewrite(text, persona)
          unicast(clientId, {
            v: 1,
            type: 'voice_preview_response',
            ...(msg.traceId ? { traceId: msg.traceId } : {}),
            ts: now(),
            payload: { personaId, original: text, rewritten },
          })
        } catch (err) {
          unicast(clientId, {
            v: 1,
            type: 'voice_preview_response',
            ...(msg.traceId ? { traceId: msg.traceId } : {}),
            ts: now(),
            payload: { personaId, original: text, rewritten: '', error: (err as Error).message },
          })
        }
        return
      }
      case 'character_list_request': {
        const assets = await scanCharacterLibrary({ builtinAssetsDir: deps.assetsDir, userLibraryDir })
        unicast(clientId, {
          v: 1,
          type: 'character_list_response',
          ...(msg.traceId ? { traceId: msg.traceId } : {}),
          ts: now(),
          payload: {
            characters: assets.map((a) => {
              const modelUrl = a.modelUrl ? resolveAssetUrl(clientId, a.source, a.modelUrl) : undefined
              return {
                id: a.id,
                name: a.name,
                personaId: a.personaId,
                kind: a.kind,
                source: a.source,
                ...(modelUrl ? { modelUrl } : {}),
              }
            }),
            display: {
              desktop: configService.config.character.display.desktop,
              mobile: configService.config.character.display.mobile,
            },
            defaultPersonaId: configService.config.persona.default,
          },
        })
        return
      }
      case 'settings_update_request': {
        const { key, value } = msg.payload
        const respond = (ok: boolean, error?: string) =>
          unicast(clientId, {
            v: 1,
            type: 'settings_update_response',
            ...(msg.traceId ? { traceId: msg.traceId } : {}),
            ts: now(),
            payload: { key, ok, ...(error !== undefined ? { error } : {}) },
          })
        if (key !== 'persona.default' && value !== 'live2d' && value !== 'static') {
          respond(false, `非法展示模式取值：${value}`)
          return
        }
        if (!settingsWriter) {
          respond(false, '当前宿主未配置设置写入')
          return
        }
        try {
          await settingsWriter(key, value)
          respond(true)
        } catch (err) {
          respond(false, (err as Error).message)
        }
        return
      }
      case 'adapter_list_request': {
        unicast(clientId, {
          v: 1,
          type: 'adapter_list_response',
          ...(msg.traceId ? { traceId: msg.traceId } : {}),
          ts: now(),
          payload: { adapters: buildAdapterList(), defaultAdapterId: resolveDefaultAdapterId() },
        })
        return
      }
      case 'adapter_model_update_request': {
        const { adapterId, model } = msg.payload
        const respond = (ok: boolean, error?: string) =>
          unicast(clientId, {
            v: 1,
            type: 'adapter_model_update_response',
            ...(msg.traceId ? { traceId: msg.traceId } : {}),
            ts: now(),
            payload: { adapterId, ok, ...(error !== undefined ? { error } : {}) },
          })
        if (!(adapterId in adaptersRef)) {
          respond(false, `未知助手：${adapterId}`)
          return
        }
        try {
          await writeAdapterModel(adapterId, model)
          respond(true)
        } catch (err) {
          respond(false, (err as Error).message)
        }
        return
      }
    }
  }

  return {
    manager,
    hub,
    store,
    transport,
    configService,
    personaLoader,
    pairing,
    lan: lanServer,
    get companion() {
      return companion
    },
    adaptersConfig: adaptersRef,
    get detections() {
      return detections
    },
    get needCliGuide() {
      return !detections.some((d) => d.installed)
    },
    get defaultPersonaId() {
      // 配置可能热更新；配置优先，为空回退装配时的素材库探测结果
      return configService.config.persona.default || defaultPersonaId
    },
    resolveDefaultAdapterId,
    refreshDetections(next: CliDetection[]): void {
      detections = [...next]
      syncAdaptersFromConfig()
    },
    setSettingsWriter(writer: SettingsWriter): void {
      settingsWriter = writer
    },
    setAdaptersWriter(writer: AdaptersWriter): void {
      adaptersWriter = writer
    },
    setFocusSessionHandler(handler: (sessionId: string) => void): void {
      focusSessionHandler = handler
    },
    setWorkingDirPickHandler(handler: (defaultPath?: string) => Promise<string | null>): void {
      workingDirPickHandler = handler
    },
    attachWebview(clientId: string, webview: WebviewLike, options?: AttachWebviewOptions): { dispose(): void } {
      hub.registerClient(clientId, (m) => transport.send(clientId, m))
      if (options?.uriResolver) uriResolvers.set(clientId, options.uriResolver)
      const sub = transport.attach(clientId, webview)
      return {
        dispose: () => {
          sub.dispose()
          hub.unregisterClient(clientId)
          uriResolvers.delete(clientId)
        },
      }
    },
    handleClientMessage,
    dispose(): void {
      companion?.stop()
      unsubManager()
      unsubTransport()
      unsubMessage()
      unsubConfig()
      unsubWsConnect()
      unsubWsDisconnect()
      unsubWsMessage()
      wsTransport.dispose()
      void pairing.dispose()
      void lanServer.stop()
    },
  }
}
