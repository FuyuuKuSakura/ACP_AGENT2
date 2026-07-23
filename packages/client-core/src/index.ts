/**
 * @dionysus/client-core — 两端共享的 ClientTransport / messageRouter / stores
 * （architecture.md §3 依赖方向、ADR-18）。
 *
 * 用法：transport.onMessage(msg => dispatchRouteActions(routeServerMessage(msg)))，
 * UI 经各 store 的 hook 与 selector 订阅。
 */
export const CLIENT_CORE_PACKAGE = '@dionysus/client-core' as const

export * from './character.js'
export * from './transport.js'
export * from './messageRouter.js'
export * from './dispatch.js'
export * from './stores/sessionStore.js'
export * from './stores/streamStore.js'
export * from './stores/digestStore.js'
export * from './stores/settingsStore.js'
export * from './stores/companionStore.js'
