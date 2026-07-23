/**
 * @dionysus/core — 宿主无关业务核心（architecture.md §5）。
 * Phase 2 垂直切片：adapters（kimi_cli）+ session + broadcast + persona（loader/rewriter）。
 */
export const CORE_PACKAGE = '@dionysus/core' as const

export * from './adapters/index.js'
export * from './session/types.js'
export * from './session/store.js'
export * from './session/manager.js'
export * from './session/commands.js'
export * from './broadcast.js'
export * from './persona/loader.js'
export * from './persona/rewriter.js'
export * from './persona/todo-tracker.js'
export * from './persona/engine.js'
export * from './persona/scheduler.js'
export * from './persona/supervisor.js'
export * from './persona/companion.js'
