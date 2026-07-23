/**
 * hash 路由（ux-core-flows.md §6.2「用 hash 路由保证刷新可恢复」）。
 *
 * 路由表：
 * - #/list          首屏会话状态列表（默认）
 * - #/chat/:id      会话详情对话页
 * - #/status/:id    会话工作状态全屏页
 * - #/settings      设置（三态主题）
 * - #/pair[/<token>] 配对页；<token> 来自二维码 `#/pair/<token>`（ADR-15：
 *   pair token 放 fragment，不进浏览器历史/日志）
 */
import { useEffect, useState } from 'react'

export type Route =
  | { name: 'list' }
  | { name: 'chat'; sessionId: string }
  | { name: 'status'; sessionId: string }
  | { name: 'settings' }
  | { name: 'pair'; pairToken?: string }

/** 解析 location.hash 为路由；无法识别时回退首屏列表。 */
export function parseHashRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const segments = path.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return { name: 'list' }
  switch (segments[0]) {
    case 'list':
      return { name: 'list' }
    case 'chat':
      return segments[1]
        ? { name: 'chat', sessionId: decodeURIComponent(segments[1]) }
        : { name: 'list' }
    case 'status':
      return segments[1]
        ? { name: 'status', sessionId: decodeURIComponent(segments[1]) }
        : { name: 'list' }
    case 'settings':
      return { name: 'settings' }
    case 'pair':
      return segments[1]
        ? { name: 'pair', pairToken: decodeURIComponent(segments[1]) }
        : { name: 'pair' }
    default:
      return { name: 'list' }
  }
}

/** 跳转（写 location.hash，经 hashchange 驱动 React）。 */
export function navigate(route: Route): void {
  let hash = '#/list'
  switch (route.name) {
    case 'list':
      hash = '#/list'
      break
    case 'chat':
      hash = `#/chat/${encodeURIComponent(route.sessionId)}`
      break
    case 'status':
      hash = `#/status/${encodeURIComponent(route.sessionId)}`
      break
    case 'settings':
      hash = '#/settings'
      break
    case 'pair':
      hash = route.pairToken
        ? `#/pair/${encodeURIComponent(route.pairToken)}`
        : '#/pair'
      break
  }
  if (window.location.hash === hash) return
  window.location.hash = hash
}

/** 配对完成后抹掉地址栏里的 pair token（ADR-15），同时落到目标路由。 */
export function replaceHash(route: Route): void {
  const url = new URL(window.location.href)
  url.hash =
    route.name === 'chat'
      ? `#/chat/${encodeURIComponent(route.sessionId)}`
      : route.name === 'status'
        ? `#/status/${encodeURIComponent(route.sessionId)}`
        : route.name === 'settings'
          ? '#/settings'
          : route.name === 'pair'
            ? '#/pair'
            : '#/list'
  window.history.replaceState(null, '', url.toString())
  // replaceState 不触发 hashchange，手动补一个让 hook 收敛
  window.dispatchEvent(new Event('hashchange'))
}

/** 当前 hash 路由的 React 订阅。 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseHashRoute(window.location.hash),
  )
  useEffect(() => {
    const onChange = () => setRoute(parseHashRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
