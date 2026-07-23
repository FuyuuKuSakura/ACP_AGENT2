/**
 * lan-server 端点单测（architecture.md §6.3）：真起 http 服务（port: 0 随机端口）。
 * 覆盖：健康检查、配对全流程（一次性/过期/错误请求）、资产路由鉴权（401/200）、
 * 防路径穿越、mobile 静态托管与 404 兜底页、EADDRINUSE 递增、多窗口先到先得。
 */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLanServer, type LanServer } from './lan-server.js'
import { PairingManager } from './pairing.js'

let dir: string
let assetsDir: string
let userLibraryDir: string
let pairing: PairingManager
const servers: LanServer[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-lan-test-'))
  assetsDir = join(dir, 'assets')
  userLibraryDir = join(dir, 'character-library')
  await mkdir(join(assetsDir, 'personas', 'avatars'), { recursive: true })
  await writeFile(join(assetsDir, 'personas', 'avatars', 'kaltsit.png'), 'fake-png-bytes')
  await mkdir(join(userLibraryDir, 'mychar', 'portrait'), { recursive: true })
  await writeFile(join(userLibraryDir, 'mychar', 'portrait', 'default.png'), 'user-portrait')
  // 根目录的「机密」文件：穿越攻击的目标
  await writeFile(join(dir, 'secret.txt'), 'top-secret')
  pairing = await PairingManager.create(join(dir, 'paired-devices.json'))
})

afterEach(async () => {
  for (const srv of servers.splice(0)) await srv.stop()
  await pairing.dispose()
  await rm(dir, { recursive: true, force: true })
})

async function startServer(overrides: Partial<Parameters<typeof createLanServer>[0]> = {}) {
  const srv = createLanServer({ pairing, assetsDir, userLibraryDir, port: 0, ...overrides })
  servers.push(srv)
  await srv.start()
  return srv
}

function base(srv: LanServer): string {
  if (srv.port === null) throw new Error('server not bound')
  return `http://127.0.0.1:${srv.port}`
}

describe('HTTP 端点', () => {
  it('GET /api/health 仅返回 {"ok":true}', async () => {
    const srv = await startServer()
    const res = await fetch(`${base(srv)}/api/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /api/health?token=：有效 device token 200，无效/撤销 401', async () => {
    const srv = await startServer()
    const deviceToken = await pairing.issueDeviceToken()

    const ok = await fetch(`${base(srv)}/api/health?token=${encodeURIComponent(deviceToken)}`)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })

    const bad = await fetch(`${base(srv)}/api/health?token=bogus`)
    expect(bad.status).toBe(401)
    expect(await bad.json()).toEqual({ error: 'invalid_device_token' })

    // 撤销设备后同一 token 探到 401（mobile 据此清 token 跳配对页，§6.3）
    await pairing.revokeDevice(deviceToken)
    const revoked = await fetch(`${base(srv)}/api/health?token=${encodeURIComponent(deviceToken)}`)
    expect(revoked.status).toBe(401)
  })

  it('POST /api/pair：pair token 一次性换 device token', async () => {
    const srv = await startServer()
    const { token } = pairing.issueToken()
    const res = await fetch(`${base(srv)}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair_token: token }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { device_token: string }
    expect(body.device_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pairing.validateDeviceToken(body.device_token)).toBe(true)

    // 一次性：同一 pair token 重放被拒
    const replay = await fetch(`${base(srv)}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair_token: token }),
    })
    expect(replay.status).toBe(401)
    expect(await replay.json()).toEqual({ error: 'invalid_or_expired_pair_token' })
  })

  it('POST /api/pair：错误 token / 缺字段 / 坏 JSON 分别 401/400', async () => {
    const srv = await startServer()
    const badToken = await fetch(`${base(srv)}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ pair_token: 'bogus' }),
    })
    expect(badToken.status).toBe(401)

    const missing = await fetch(`${base(srv)}/api/pair`, { method: 'POST', body: '{}' })
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: 'missing_pair_token' })

    const badJson = await fetch(`${base(srv)}/api/pair`, { method: 'POST', body: '{ nope' })
    expect(badJson.status).toBe(400)
    expect(await badJson.json()).toEqual({ error: 'invalid_json' })
  })

  it('GET /assets/*：无 token / 错 token 401，有效 device token 200 + 缓存头', async () => {
    const srv = await startServer()
    const deviceToken = await pairing.issueDeviceToken()
    const path = '/assets/personas/avatars/kaltsit.png'

    const noToken = await fetch(`${base(srv)}${path}`)
    expect(noToken.status).toBe(401)
    expect(await noToken.json()).toEqual({ error: 'invalid_device_token' })

    const badToken = await fetch(`${base(srv)}${path}?token=bogus`)
    expect(badToken.status).toBe(401)

    const ok = await fetch(`${base(srv)}${path}?token=${encodeURIComponent(deviceToken)}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect(ok.headers.get('Content-Type')).toBe('image/png')
    expect(await ok.text()).toBe('fake-png-bytes')
  })

  it('GET /assets/user/* 映射到 character-library/', async () => {
    const srv = await startServer()
    const deviceToken = await pairing.issueDeviceToken()
    const res = await fetch(
      `${base(srv)}/assets/user/mychar/portrait/default.png?token=${encodeURIComponent(deviceToken)}`,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('user-portrait')
  })

  it('路径穿越：../ 与编码变体均无法读出 assets 根之外的文件', async () => {
    const srv = await startServer()
    const deviceToken = await pairing.issueDeviceToken()
    for (const p of [
      '/assets/../secret.txt',
      '/assets/%2e%2e/secret.txt',
      '/assets/personas/../../secret.txt',
      '/assets/user/../secret.txt',
      '/assets/%252e%252e/secret.txt',
    ]) {
      const res = await fetch(`${base(srv)}${p}?token=${encodeURIComponent(deviceToken)}`)
      expect(res.status).not.toBe(200)
      expect(await res.text()).not.toContain('top-secret')
    }
  })

  it('GET /：mobile/dist 存在时托管静态应用，未知路径 SPA 兜底 index.html', async () => {
    const mobileDist = join(dir, 'mobile-dist')
    await mkdir(join(mobileDist, 'assets'), { recursive: true })
    await writeFile(join(mobileDist, 'index.html'), '<html>mobile-app</html>')
    await writeFile(join(mobileDist, 'assets', 'app.js'), 'console.log(1)')
    const srv = await startServer({ mobileDistDir: mobileDist })

    const root = await fetch(`${base(srv)}/`)
    expect(root.status).toBe(200)
    expect(await root.text()).toContain('mobile-app')

    const spa = await fetch(`${base(srv)}/pair/some-token`)
    expect(spa.status).toBe(200)
    expect(await spa.text()).toContain('mobile-app')

    const js = await fetch(`${base(srv)}/assets/app.js`)
    expect(js.status).toBe(200)
    expect(await js.text()).toBe('console.log(1)')

    // mobileDist 中不存在的角色资产路径仍强制鉴权（不因静态优先而绕过）
    const protectedAsset = await fetch(`${base(srv)}/assets/personas/avatars/kaltsit.png`)
    expect(protectedAsset.status).toBe(401)
  })

  it('GET /：mobile/dist 不存在时回 404 兜底页', async () => {
    const srv = await startServer() // 未注入 mobileDistDir
    const res = await fetch(`${base(srv)}/`)
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('移动端尚未就绪')
  })
})

describe('端口绑定', () => {
  it('EADDRINUSE（非本插件占用）自动递增端口重试', async () => {
    // 用一个不带 /api/health 的裸服务占用端口
    const blocker = createServer((req, res) => {
      res.writeHead(404).end()
    })
    await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', resolve))
    const blockerPort = (blocker.address() as { port: number }).port
    try {
      const srv = await startServer({ port: blockerPort })
      expect(srv.state).toBe('running')
      expect(srv.port).toBe(blockerPort + 1)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('多窗口先到先得：配置端口被另一个 Dionysus 实例占用 → disabled，不抢占', async () => {
    const first = await startServer() // port: 0 → 随机端口
    const second = await startServer({ port: first.port! })
    expect(second.state).toBe('disabled')
    expect(second.disabledReason).toBe('port-taken-by-dionysus')
    expect(second.port).toBeNull()
    // 先占者不受影响
    expect(first.state).toBe('running')
    const res = await fetch(`${base(first)}/api/health`)
    expect(res.status).toBe(200)
  })

  it('stop 后端口释放，可重新 start（热重启路径）', async () => {
    const srv = await startServer()
    const port = srv.port!
    await srv.stop()
    expect(srv.state).toBe('stopped')
    expect(srv.port).toBeNull()
    srv.setPort(port)
    await srv.start()
    expect(srv.state).toBe('running')
    expect(srv.port).toBe(port)
  })
})
