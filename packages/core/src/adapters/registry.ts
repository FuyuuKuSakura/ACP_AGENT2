/**
 * 配置驱动注册表（extract/adapters.md §3；architecture.md §5.2/§5.3）。
 *
 * 只暴露 createAdapter 工厂：深拷贝配置新建独立实例（每会话独占 adapter，
 * 语义同 v2 create_adapter），不暴露共享实例——v2 get_adapter 共享单例的语义
 * 废除（共享实例并发两个 send 会互相杀进程、串 session_id）。
 *
 * v2 → v3 修正：
 * - "generic_cli": "" 空字符串哨兵废除（§7.5），用显式 undefined 表达"无映射"；
 * - registry 不自行加载配置（§7.2），配置由宿主注入为 createAdapter 参数。
 */
import { GenericCliAdapter } from './generic-cli.js'
import type { AdapterConfig, CliAdapterStrategy } from './strategy.js'
import { ClaudeStrategy } from './strategies/claude.js'
import { CodeBuddyStrategy } from './strategies/codebuddy.js'
import { CodexStrategy } from './strategies/codex.js'
import { KimiStrategy } from './strategies/kimi.js'
import { OpenCodeStrategy } from './strategies/opencode.js'
import type { IAgentAdapter } from './types.js'

export type StrategyConstructor = new () => CliAdapterStrategy

/** 策略名 → 策略类（extract §3.2 _STRATEGIES）。 */
const STRATEGIES: Record<string, StrategyConstructor> = {
  kimi: KimiStrategy,
  claude: ClaudeStrategy,
  codex: CodexStrategy,
  opencode: OpenCodeStrategy,
  codebuddy: CodeBuddyStrategy,
}

/**
 * type 别名 → 策略名（extract §3.2 _TYPE_TO_STRATEGY；无映射用显式 undefined）。
 * v2 的 "generic_cli": "" 空串哨兵已废除（§7.5）：generic_cli 无映射，回退
 * strategy 字段由 createAdapter 的 ?? 兜底逻辑自然表达。
 */
const TYPE_TO_STRATEGY: Record<string, string | undefined> = {
  kimi_code_cli: 'kimi',
  claude_code_cli: 'claude',
  codex_cli: 'codex',
  opencode_cli: 'opencode',
  codebuddy_cli: 'codebuddy',
}

/** 供后续 CLI（claude/codex/opencode/codebuddy）或测试注册自定义策略。 */
export function registerStrategy(name: string, ctor: StrategyConstructor): void {
  STRATEGIES[name] = ctor
}

/** 注册 type 别名 → 策略名映射。 */
export function registerTypeAlias(type: string, strategyName: string): void {
  TYPE_TO_STRATEGY[type] = strategyName
}

/** 按配置条目解析策略名（type 映射优先，无映射回退 strategy 字段；同 createAdapter 决策）。 */
function strategyNameFor(config: AdapterConfig): string | undefined {
  const mapped = config.type !== undefined ? TYPE_TO_STRATEGY[config.type] : undefined
  return mapped ?? config.strategy
}

/**
 * 仅实例化策略（不建适配器/不碰进程）：/sessions 的 CLI 会话索引等
 * 策略级只读能力经此接入。配置缺失/禁用/策略未知返回 null。
 */
export function resolveStrategy(
  adapterId: string,
  adaptersConfig: Record<string, AdapterConfig>,
): CliAdapterStrategy | null {
  const entry = adaptersConfig[adapterId]
  if (!entry || entry.enabled === false) return null
  const strategyName = strategyNameFor(entry)
  if (typeof strategyName !== 'string' || !strategyName) return null
  const strategyCtor = STRATEGIES[strategyName]
  return strategyCtor ? new strategyCtor() : null
}

/**
 * 按 adapterId 从注入的配置中深拷贝一份并新建独占适配器实例。
 * type 缺省时直接用 strategy 字段；type 有映射用映射值，无映射回退 strategy 字段
 * （对应 v2 registry.py:64-93 的决策逻辑，空串哨兵改为显式 undefined）。
 */
export function createAdapter(
  adapterId: string,
  adaptersConfig: Record<string, AdapterConfig>,
): IAgentAdapter {
  const entry = adaptersConfig[adapterId]
  if (!entry || entry.enabled === false) {
    throw new Error(`Unknown or disabled agent adapter: ${adapterId}`)
  }
  // 深拷贝配置：实例独占，配置不外泄（v2 create_adapter 同语义）
  const config = structuredClone(entry)

  const strategyName = strategyNameFor(config)
  if (typeof strategyName !== 'string' || !strategyName) {
    throw new Error(`Unknown adapter type for ${adapterId}: ${String(config.type)}`)
  }
  const strategyCtor = STRATEGIES[strategyName]
  if (!strategyCtor) {
    throw new Error(`Unknown strategy for ${adapterId}: ${strategyName}`)
  }
  return new GenericCliAdapter(config, new strategyCtor())
}
