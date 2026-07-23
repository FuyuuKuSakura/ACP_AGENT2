export type { AgentEvent, AgentInput, IAgentAdapter } from './types.js'
export {
  JsonStreamStrategy,
  PLAN_MODE_PREFIX_EN,
  extractJsonObjects,
} from './strategy.js'
export type {
  AdapterConfig,
  AdapterContext,
  CliAdapterStrategy,
  CliSessionIndexEntry,
  SystemPromptSupport,
} from './strategy.js'
export { GenericCliAdapter } from './generic-cli.js'
export {
  defaultKimiSessionIndexPath,
  parseKimiSessionIndexLine,
  readKimiSessionIndex,
} from './cli-session-index.js'
export { KIMI_PLAN_MODE_PREFIX, KimiStrategy } from './strategies/kimi.js'
export { ClaudeStrategy } from './strategies/claude.js'
export { CodexStrategy } from './strategies/codex.js'
export { OpenCodeStrategy } from './strategies/opencode.js'
export { CodeBuddyStrategy } from './strategies/codebuddy.js'
export {
  createAdapter,
  registerStrategy,
  registerTypeAlias,
  resolveStrategy,
  type StrategyConstructor,
} from './registry.js'
