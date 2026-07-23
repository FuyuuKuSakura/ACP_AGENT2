/**
 * settings.json 的 dionysus.* 配置读取（architecture.md §6.5 schema）。
 *
 * 热更新语义（§6.5 / ADR-6）：core 在装配时拿到配置对象的**唯一引用**，
 * 设置变更走同一引用原地更新——`config` 的对象 identity 全程稳定，
 * `refresh()` 原地深替换内容，杜绝 v2 配置双副本导致热更新失效的 bug。
 *
 * 本模块零 vscode 运行时依赖：通过 ConfigReader 抽象读取配置，
 * 宿主侧用 `createVscodeConfigReader(vscode.workspace)` 绑定，
 * 测试用假 vscode 命名空间（settings map）隔离。
 */
import type { DisplayMode } from '@dionysus/client-core'

export type OptionTimeoutAction = 'deny' | 'default' | 'keep'
export type SupervisorMode = 'disabled' | 'template' | 'agent_session' | 'deepseek_api'

export interface AdapterConfig {
  type: string
  command: string
  model: string | null
}

/** architecture.md §6.5 的 dionysus.* 配置 schema（Supervisor API key 走 SecretStorage，不在此） */
export interface DionysusConfig {
  adapter: {
    /** 空 = 使用首个检测到的可用 CLI（§6.1.1） */
    default: string
  }
  adapters: Record<string, AdapterConfig>
  /** 并行 CLI 子进程上限（§5.3） */
  maxConcurrentAgents: number
  /** 默认 ${workspaceFolder}，跟随当前工作区 */
  workingDir: string
  persona: {
    /** 空 = core 按素材库探测结果决定（不写死角色名） */
    default: string
    /** 可选增强：persona 语气拼进 agent 首轮输入（§5.3），rewriter 为默认通道 */
    injectIntoAgent: boolean
  }
  session: {
    optionTimeoutAction: OptionTimeoutAction
  }
  lan: {
    enabled: boolean
    port: number
  }
  supervisor: {
    mode: SupervisorMode
    /** 下限 5（§6.5） */
    intervalSeconds: number
    /** agent_session 模式复用的 CLI adapter；空 = 跟随 default */
    adapterId: string
    llm: {
      baseUrl: string
      model: string
    }
  }
  character: {
    display: {
      desktop: DisplayMode
      /** 移动端默认 live2d（与桌面端一致），用户可改 static 省流量 */
      mobile: DisplayMode
    }
  }
}

/** §6.5 示例 settings 的默认值 */
export const DEFAULT_CONFIG: DionysusConfig = {
  adapter: { default: '' },
  adapters: {},
  maxConcurrentAgents: 3,
  workingDir: '${workspaceFolder}',
  persona: { default: '', injectIntoAgent: false },
  session: { optionTimeoutAction: 'keep' },
  lan: { enabled: false, port: 8765 },
  supervisor: {
    mode: 'template',
    intervalSeconds: 15,
    adapterId: '',
    llm: { baseUrl: '', model: '' },
  },
  character: { display: { desktop: 'live2d', mobile: 'live2d' } },
}

const SUPERVISOR_INTERVAL_MIN = 5
const OPTION_TIMEOUT_ACTIONS: readonly OptionTimeoutAction[] = ['deny', 'default', 'keep']
const SUPERVISOR_MODES: readonly SupervisorMode[] = ['disabled', 'template', 'agent_session', 'deepseek_api']
const DISPLAY_MODES: readonly DisplayMode[] = ['live2d', 'static']

/** 配置读取抽象：key 为 'dionysus.' 之后的段路径，如 'character.display.desktop' */
export interface ConfigReader {
  get<T>(key: string): T | undefined
}

/** vscode.workspace 的最小结构（实际传入 vscode.workspace 即可） */
export interface WorkspaceLike {
  getConfiguration(section?: string): { get<T>(key: string): T | undefined }
}

/** 绑定真实 VS Code：`createVscodeConfigReader(vscode.workspace)` */
export function createVscodeConfigReader(workspace: WorkspaceLike): ConfigReader {
  return {
    get<T>(key: string): T | undefined {
      return workspace.getConfiguration('dionysus').get<T>(key)
    },
  }
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 从 reader 读出完整配置，非法值回退默认（intervalSeconds 钳制到下限 5） */
export function readConfig(reader: ConfigReader): DionysusConfig {
  const defaults = DEFAULT_CONFIG
  return {
    adapter: { default: pickString(reader.get('adapter.default'), defaults.adapter.default) },
    adapters: (reader.get<Record<string, AdapterConfig>>('adapters') ?? {}) as Record<string, AdapterConfig>,
    maxConcurrentAgents: pickNumber(reader.get('maxConcurrentAgents'), defaults.maxConcurrentAgents),
    workingDir: pickString(reader.get('workingDir'), defaults.workingDir),
    persona: {
      default: pickString(reader.get('persona.default'), defaults.persona.default),
      injectIntoAgent: pickBoolean(reader.get('persona.injectIntoAgent'), defaults.persona.injectIntoAgent),
    },
    session: {
      optionTimeoutAction: pickEnum(
        reader.get('session.optionTimeoutAction'),
        OPTION_TIMEOUT_ACTIONS,
        defaults.session.optionTimeoutAction,
      ),
    },
    lan: {
      enabled: pickBoolean(reader.get('lan.enabled'), defaults.lan.enabled),
      port: pickNumber(reader.get('lan.port'), defaults.lan.port),
    },
    supervisor: {
      mode: pickEnum(reader.get('supervisor.mode'), SUPERVISOR_MODES, defaults.supervisor.mode),
      intervalSeconds: Math.max(
        SUPERVISOR_INTERVAL_MIN,
        pickNumber(reader.get('supervisor.intervalSeconds'), defaults.supervisor.intervalSeconds),
      ),
      adapterId: pickString(reader.get('supervisor.adapterId'), defaults.supervisor.adapterId),
      llm: {
        baseUrl: pickString(reader.get('supervisor.llm.baseUrl'), defaults.supervisor.llm.baseUrl),
        model: pickString(reader.get('supervisor.llm.model'), defaults.supervisor.llm.model),
      },
    },
    character: {
      display: {
        desktop: pickEnum(reader.get('character.display.desktop'), DISPLAY_MODES, defaults.character.display.desktop),
        mobile: pickEnum(reader.get('character.display.mobile'), DISPLAY_MODES, defaults.character.display.mobile),
      },
    },
  }
}

export type ConfigChangeListener = (config: DionysusConfig) => void

export interface ConfigService {
  /** 唯一引用：identity 全程稳定，refresh 原地更新（热更新语义） */
  readonly config: DionysusConfig
  /** 重新读取并原地更新；内容有变化时触发 onDidChange 监听 */
  refresh(): void
  /** 订阅配置变更；返回取消订阅函数 */
  onDidChange(listener: ConfigChangeListener): () => void
}

/** 深替换 target 内容为 source（保持 target 的 identity） */
function replaceContents(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, source)
}

export function createConfigService(reader: ConfigReader): ConfigService {
  const config: DionysusConfig = readConfig(reader)
  const listeners = new Set<ConfigChangeListener>()
  return {
    config,
    refresh() {
      const next = readConfig(reader)
      if (JSON.stringify(next) === JSON.stringify(config)) return
      replaceContents(config as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>)
      for (const listener of listeners) listener(config)
    },
    onDidChange(listener: ConfigChangeListener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
