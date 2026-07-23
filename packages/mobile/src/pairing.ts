/**
 * 配对流程（architecture.md §6.4 / §9.2，extract/pairing-mobile.md §5 缺陷 5 的闭环）：
 *
 * 二维码 → `http://<LAN-IP>:<port>/#/pair/<pairToken>`
 *   → 读 location.hash 拿 pair token
 *   → POST /api/pair {"pair_token"} → 200 {"device_token"}
 *   → device token 持久化 localStorage
 *   → history.replaceState 抹掉 hash 里的 pair token
 *
 * 401 闭环：任何 HTTP/WS 鉴权失败 → 清本地 token → 跳配对页。
 */
import { navigate, replaceHash } from './router.js'

const DEVICE_TOKEN_KEY = 'dionysus.mobile.deviceToken'

export function getDeviceToken(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_TOKEN_KEY)
  } catch {
    return null
  }
}

export function saveDeviceToken(token: string): void {
  try {
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token)
  } catch {
    // 隐私模式等场景下落不了盘：配对成功态仅存内存（由调用方持有）
  }
}

export function clearDeviceToken(): void {
  try {
    window.localStorage.removeItem(DEVICE_TOKEN_KEY)
  } catch {
    // 忽略
  }
}

/** 从 hash 提取 pair token（`#/pair/<token>`；兼容 v2 风格的 `#pair=`/`#/?pair=`）。 */
export function readPairTokenFromHash(hash: string): string | null {
  const m = /^#\/pair\/([^/]+)/.exec(hash)
  if (m) return decodeURIComponent(m[1])
  const m2 = /[#&?]pair(?:_token)?=([^&]+)/.exec(hash)
  if (m2) return decodeURIComponent(m2[1])
  return null
}

export type PairResult =
  | { ok: true; deviceToken: string }
  | { ok: false; reason: 'invalid_token' | 'network' }

type FetchLike = typeof fetch

/**
 * 用 pair token 换 device token。成功：持久化 + replaceState 抹掉 hash；
 * 失败：replaceState 到干净配对页（hash 里的 pair token 同样抹掉）。
 */
export async function pairWithServer(
  pairToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<PairResult> {
  let res: Response
  try {
    res = await fetchImpl('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair_token: pairToken }),
    })
  } catch {
    replaceHash({ name: 'pair' })
    return { ok: false, reason: 'network' }
  }
  if (!res.ok) {
    replaceHash({ name: 'pair' })
    return { ok: false, reason: 'invalid_token' }
  }
  const body = (await res.json()) as { device_token?: string; deviceToken?: string }
  const deviceToken = body.device_token ?? body.deviceToken
  if (!deviceToken) {
    replaceHash({ name: 'pair' })
    return { ok: false, reason: 'network' }
  }
  saveDeviceToken(deviceToken)
  replaceHash({ name: 'list' })
  return { ok: true, deviceToken }
}

export type ProbeResult = 'ok' | 'unauthorized' | 'unreachable'

/**
 * 探测 device token 是否仍有效（GET /api/health?token=）。
 * 用于 WS 首次连接失败后的 401 判定——浏览器 WS 拿不到 HTTP 状态码，
 * 只能借 HTTP 端点区分「token 失效」与「电脑不可达」。
 */
export async function probeDeviceToken(
  deviceToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<ProbeResult> {
  let res: Response
  try {
    res = await fetchImpl(
      `/api/health?token=${encodeURIComponent(deviceToken)}`,
    )
  } catch {
    return 'unreachable'
  }
  if (res.status === 401) return 'unauthorized'
  return res.ok ? 'ok' : 'unreachable'
}

/** 401 → 清 token → 跳配对页（「401 → 重新配对」闭环，§5.5）。 */
export function handleUnauthorized(): void {
  clearDeviceToken()
  navigate({ name: 'pair' })
}

/** 资产 URL（GET /assets/* 鉴权走 ?token= query，ADR-15）。 */
export function assetUrl(path: string, deviceToken: string): string {
  if (/^(https?:|data:|blob:)/.test(path)) return path
  const rel = path.startsWith('/') ? path : `/assets/${path}`
  const sep = rel.includes('?') ? '&' : '?'
  return `${rel}${sep}token=${encodeURIComponent(deviceToken)}`
}

/** WS 端点（/ws?token=，upgrade 前服务端校验，architecture.md §6.3）。 */
export function wsUrl(deviceToken: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws?token=${encodeURIComponent(deviceToken)}`
}
