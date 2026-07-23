/**
 * lan-server：插件进程内嵌 HTTP/WS 服务（architecture.md §6.3），移动端链路载体。
 *
 * - Node 内置 `http` + `ws`（不引 Express/Fastify，§6.3 依赖控制决策）；
 * - HTTP 端点：
 *   - `GET  /` 与其余非 /api、/assets 路径 → 托管 mobile 静态应用
 *     （`mobile/dist` 按 vsix 路径约定注入；产物不存在时回 404 兜底页——
 *     mobile 包在后续波次构建，本服务先行）；
 *   - `POST /api/pair`：pair token 一次性换 device token（§6.4 配对时序）；
 *   - `GET  /api/health`：仅 `{"ok":true}`，不带版本/配置信息；兼作多窗口
 *     占用探测的身份标记（先到先得，见下）。携带 `?token=` 时校验设备
 *     token，无效/已撤销回 401（mobile 设备探测的 401 闭环，§6.3）；
 *   - `GET  /assets/*`：角色资产路由，`?token=<device_token>` 鉴权（ADR-15：
 *     `<img>`/XHR 无法带 Authorization，query 是唯一可行通道），
 *     前缀映射 `builtin/` → 内嵌 assets/、`user/` → character-library/
 *     （无前缀默认 builtin），`path.normalize` + 前缀校验防穿越（§11 同款），
 *     响应 `Cache-Control: private, max-age=300`；**例外**：mobile 应用自身
 *     的打包资源（vite 产物目录同样叫 assets/，配对页未持 token 就要加载）
 *     在 mobileDist 中精确命中时按公开静态文件直出，不要求 token；
 * - 鉴权失败统一 `401 {"error":"invalid_device_token"}` JSON（mobile 收到 401
 *   清本地 token 跳配对页，§6.3）；
 * - WS upgrade 不在此校验 token：本模块把 upgrade 事件转交 `onUpgrade` 钩子
 *   （WsTransport 在 handleUpgrade 之前验票，§6.3）；
 * - 绑定 `0.0.0.0`；`EADDRINUSE` 自动递增端口重试（8765→8775 上限，共 11 次）；
 *   **多窗口先到先得**：配置端口被占用且对端 `/api/health` 应答 `{"ok":true}`
 *   （即另一个 VS Code 窗口的 Dionysus）时进入 disabled 态，不抢占、不递增；
 * - 生命周期由 core-host 管理：`lan.enabled=false` 不启动（§6.3 攻击面决策）、
 *   `lan.enabled`/`lan.port` 变更热重启、deactivate 关闭。
 *
 * 零 vscode 依赖：纯 node 可测（测试用 `port: 0` 由 OS 分配随机端口）。
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, get as httpGet, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import type { Duplex } from 'node:stream'

import type { PairingManager } from './pairing.js'

/** EADDRINUSE 递增重试上限次数（8765→8775，§6.3） */
export const PORT_RETRY_ATTEMPTS = 11

export type LanServerState = 'stopped' | 'running' | 'disabled'
export type LanDisabledReason = 'port-taken-by-dionysus' | 'no-free-port'

/** WS upgrade 处理钩子（WsTransport.handleUpgrade；未设置时 upgrade 直接断开）。 */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void

export interface LanServerDeps {
  pairing: PairingManager
  /** 内嵌 assets/ 绝对路径 */
  assetsDir: string
  /** globalStorageUri/character-library/ 绝对路径（可缺省） */
  userLibraryDir?: string
  /** packages/mobile/dist 绝对路径（mobile 未构建时缺省 → 404 兜底页） */
  mobileDistDir?: string
  /** 监听起始端口；0 = OS 随机分配（测试用） */
  port: number
  /** 递增重试次数（默认 PORT_RETRY_ATTEMPTS） */
  portRetryAttempts?: number
  /** 多窗口健康探测超时（毫秒） */
  probeTimeoutMs?: number
}

export interface LanServer {
  readonly state: LanServerState
  readonly disabledReason: LanDisabledReason | null
  /** 实际绑定端口（running 时非空；二维码一律用它，§6.3） */
  readonly port: number | null
  /** WS upgrade 钩子（core-host 注入 WsTransport.handleUpgrade） */
  onUpgrade: UpgradeHandler | null
  /** 变更起始端口（lan.port 热更新路径；需 stop 后再 start 生效） */
  setPort(port: number): void
  start(): Promise<void>
  stop(): Promise<void>
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.moc3': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const ASSETS_CACHE_CONTROL = 'private, max-age=300'
const MOBILE_MISSING_PAGE = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Dionysus</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32em;margin:4em auto;line-height:1.7">
  <h1>Dionysus 移动端尚未就绪</h1>
  <p>局域网服务已正常运行，但手机端应用（<code>packages/mobile</code>）还没有构建出来，
     暂无可用的页面。请在构建 <code>@dionysus/mobile</code> 后重试。</p>
</body>
</html>`

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(text)
}

/** 读取请求体（超上限直接拒绝）；配对请求体只有几十字节。 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 相对路径安全拼接到 root（§11 归一化校验同款）：
 * decodeURIComponent → path.normalize（path.resolve 内做）→ 前缀校验，
 * 穿越（`..`/绝对路径/编码变体）一律返回 null。
 */
function safeJoin(root: string, rawRel: string): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(rawRel)
  } catch {
    return null
  }
  const abs = path.resolve(root, ...rel.split('/'))
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

/** 探测端口对端是否为另一个 Dionysus 实例（/api/health 恰好应答 {"ok":true}）。 */
function probeDionysusHealth(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
          resolve(
            res.statusCode === 200 &&
              typeof body === 'object' &&
              body !== null &&
              (body as Record<string, unknown>).ok === true &&
              Object.keys(body as Record<string, unknown>).length === 1,
          )
        } catch {
          resolve(false)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

/** 本机第一个非内部 IPv4 地址（二维码的 LAN-IP；无合适网卡时回退 127.0.0.1）。 */
export function getLanAddress(): string {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        return info.address
      }
    }
  }
  return '127.0.0.1'
}

export function createLanServer(deps: LanServerDeps): LanServer {
  let state: LanServerState = 'stopped'
  let disabledReason: LanDisabledReason | null = null
  let boundPort: number | null = null
  let basePort = deps.port
  let server: Server | null = null

  const handle: LanServer = {
    get state() {
      return state
    },
    get disabledReason() {
      return disabledReason
    },
    get port() {
      return boundPort
    },
    onUpgrade: null,
    setPort(port: number): void {
      basePort = port
    },
    start,
    stop,
  }

  // ── 端点处理 ──────────────────────────────────────────────────────────────

  async function handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, 4096)
    if (body === null) {
      sendJson(res, 400, { error: 'invalid_json' })
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      sendJson(res, 400, { error: 'invalid_json' })
      return
    }
    const pairToken =
      parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).pair_token === 'string'
        ? ((parsed as Record<string, unknown>).pair_token as string)
        : null
    if (!pairToken) {
      sendJson(res, 400, { error: 'missing_pair_token' })
      return
    }
    if (!deps.pairing.verifyPairToken(pairToken)) {
      sendJson(res, 401, { error: 'invalid_or_expired_pair_token' })
      return
    }
    const deviceToken = await deps.pairing.issueDeviceToken()
    sendJson(res, 200, { device_token: deviceToken })
  }

  /** /assets/* 的根目录选择：builtin/ 前缀或无前缀 → 内嵌 assets/；user/ → 素材库。 */
  function resolveAssetTarget(pathname: string): { root: string; rel: string } | null {
    const rel = pathname.slice('/assets/'.length)
    if (rel.startsWith('user/')) {
      return deps.userLibraryDir ? { root: deps.userLibraryDir, rel: rel.slice('user/'.length) } : null
    }
    if (rel.startsWith('builtin/')) {
      return { root: deps.assetsDir, rel: rel.slice('builtin/'.length) }
    }
    return { root: deps.assetsDir, rel }
  }

  async function serveAsset(url: URL, res: ServerResponse): Promise<void> {
    // mobile 应用自身的打包资源（vite 默认产物目录也叫 assets/）是同前缀的
    // 公开静态文件——配对页本身就要加载它们，不能要求 token：mobileDist 中
    // 精确命中的文件按静态资源直出；未命中才进入角色资产路由（强制鉴权）。
    if (deps.mobileDistDir) {
      const mobileAbs = safeJoin(deps.mobileDistDir, url.pathname.replace(/^\/+/, ''))
      if (mobileAbs && (await stat(mobileAbs).then((s) => s.isFile(), () => false))) {
        await serveFile(mobileAbs, res, 'no-cache')
        return
      }
    }
    const token = url.searchParams.get('token') ?? ''
    if (!token || !deps.pairing.validateDeviceToken(token)) {
      sendJson(res, 401, { error: 'invalid_device_token' })
      return
    }
    const target = resolveAssetTarget(url.pathname)
    const abs = target ? safeJoin(target.root, target.rel) : null
    if (!abs) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    await serveFile(abs, res, ASSETS_CACHE_CONTROL)
  }

  async function serveFile(abs: string, res: ServerResponse, cacheControl: string): Promise<void> {
    try {
      const st = await stat(abs)
      if (!st.isFile()) {
        sendJson(res, 404, { error: 'not_found' })
        return
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': cacheControl,
      })
      createReadStream(abs).pipe(res)
    } catch {
      sendJson(res, 404, { error: 'not_found' })
    }
  }

  /** GET / 与 SPA 路径：mobile/dist 静态托管；产物不存在回 404 兜底页。 */
  async function serveMobile(url: URL, res: ServerResponse): Promise<void> {
    const root = deps.mobileDistDir
    const indexAbs = root ? path.join(root, 'index.html') : null
    if (!root || !indexAbs || !(await stat(indexAbs).then((s) => s.isFile(), () => false))) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(MOBILE_MISSING_PAGE)
      return
    }
    if (url.pathname !== '/') {
      const abs = safeJoin(root, url.pathname.replace(/^\/+/, ''))
      if (abs && (await stat(abs).then((s) => s.isFile(), () => false))) {
        await serveFile(abs, res, 'no-cache')
        return
      }
    }
    // SPA 兜底：非文件路径一律回 index.html（hash 路由由前端处理）
    await serveFile(indexAbs, res, 'no-cache')
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        // 携带 ?token= 时校验设备 token（mobile probeDeviceToken 的 401 闭环：
        // 设备被撤销后移动端探到 401 清 token 跳配对页，§6.3）；不携带时仍
        // 返回公开 {"ok":true}（多窗口占用探测的身份标记依赖此）。
        const token = url.searchParams.get('token')
        if (token !== null && !deps.pairing.validateDeviceToken(token)) {
          sendJson(res, 401, { error: 'invalid_device_token' })
          return
        }
        sendJson(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/pair') {
        await handlePair(req, res)
        return
      }
      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        await serveAsset(url, res)
        return
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api')) {
        await serveMobile(url, res)
        return
      }
      sendJson(res, 404, { error: 'not_found' })
    } catch (err) {
      console.error(`[dionysus] lan-server 请求处理失败 ${req.method} ${url.pathname}:`, err)
      if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
      else res.end()
    }
  }

  // ── 绑定与生命周期 ────────────────────────────────────────────────────────

  function listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = server
      if (!srv) {
        reject(new Error('lan-server 未初始化'))
        return
      }
      const onError = (err: NodeJS.ErrnoException) => {
        srv.off('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        srv.off('error', onError)
        resolve()
      }
      srv.once('error', onError)
      srv.once('listening', onListening)
      srv.listen(port, '0.0.0.0')
    })
  }

  async function start(): Promise<void> {
    if (state === 'running') return
    state = 'stopped'
    disabledReason = null
    boundPort = null

    server = createServer((req, res) => {
      handleRequest(req, res).catch((err: unknown) => {
        console.error('[dionysus] lan-server 未捕获错误:', err)
        if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
        else res.end()
      })
    })
    server.on('upgrade', (req, socket, head) => {
      if (handle.onUpgrade) handle.onUpgrade(req, socket, head)
      else socket.destroy()
    })

    // port=0：OS 随机分配（测试路径），无递增与多窗口探测
    if (basePort === 0) {
      await listen(0)
      boundPort = (server.address() as { port: number }).port
      state = 'running'
      return
    }

    const attempts = deps.portRetryAttempts ?? PORT_RETRY_ATTEMPTS
    for (let i = 0; i < attempts; i += 1) {
      const port = basePort + i
      try {
        await listen(port)
        boundPort = port
        state = 'running'
        return
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
        // 先到先得（§6.3）：配置端口被本插件另一窗口占用 → disabled，不抢占不递增
        if (i === 0 && (await probeDionysusHealth(port, deps.probeTimeoutMs ?? 800))) {
          state = 'disabled'
          disabledReason = 'port-taken-by-dionysus'
          await closeServer()
          return
        }
      }
    }
    state = 'disabled'
    disabledReason = 'no-free-port'
    await closeServer()
  }

  function closeServer(): Promise<void> {
    return new Promise((resolve) => {
      const srv = server
      server = null
      if (!srv) {
        resolve()
        return
      }
      srv.close(() => resolve())
      // node ≥18.2：立即断开空闲 keep-alive 连接，避免 close 悬挂
      srv.closeAllConnections?.()
    })
  }

  async function stop(): Promise<void> {
    await closeServer()
    state = 'stopped'
    disabledReason = null
    boundPort = null
  }

  return handle
}
