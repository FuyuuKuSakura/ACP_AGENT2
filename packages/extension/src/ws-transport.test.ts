/**
 * WsTransport 单测（architecture.md §6.2/§6.3/§4.1）：真起 lan-server（port: 0）
 * + 真 ws 客户端。覆盖：
 * - upgrade 前验票：无效 token 401、不产生 WS 连接（v2 漏洞修复回归）；
 * - 有效 token 建连：每连接一个 mobile clientId、onConnect/onDisconnect；
 * - 消息通路：parseClientMessage 校验后分发、非法消息回 warning、send/broadcast；
 * - 心跳：75s 无帧断开注销（测试注入短超时）、持续收发帧保活；
 * - core-host 集成：配对 → WS hello → handshake 全链路（§9.2 时序）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClientMessage, ServerMessage } from '@dionysus/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { createLanServer, type LanServer } from './lan-server.js'
import { PairingManager } from './pairing.js'
import { installedCli, makeTestHost, until, type TestHostContext } from './test-utils.js'
import { WsTransport } from './ws-transport.js'

let dir: string
let pairing: PairingManager
let lan: LanServer
let transport: WsTransport
let sockets: WebSocket[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-ws-test-'))
  pairing = await PairingManager.create(join(dir, 'paired-devices.json'))
  sockets = []
})

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    try {
      ws.terminate()
    } catch {
      // 已断开
    }
  }
  transport?.dispose()
  await lan?.stop()
  await pairing.dispose()
  await rm(dir, { recursive: true, force: true })
})

async function startStack(transportOptions: Partial<ConstructorParameters<typeof WsTransport>[0]> = {}) {
  transport = new WsTransport({ pairing, ...transportOptions })
  lan = createLanServer({ pairing, assetsDir: join(dir, 'no-assets'), port: 0 })
  lan.onUpgrade = (req, socket, head) => transport.handleUpgrade(req, socket, head)
  await lan.start()
  return `ws://127.0.0.1:${lan.port}`
}

/** 建连并等 open；预期握手失败时等 error 并返回错误。 */
function connect(wsBase: string, token: string): Promise<{ ws?: WebSocket; error?: Error }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`)
    sockets.push(ws)
    ws.on('open', () => resolve({ ws }))
    ws.on('error', (err) => resolve({ error: err }))
  })
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data: Buffer) => resolve(JSON.parse(data.toString('utf8')) as ServerMessage))
  })
}

const HELLO: ClientMessage = { v: 1, type: 'hello', ts: Date.now(), payload: { minVersion: 1, maxVersion: 1 } }

describe('upgrade 前验票', () => {
  it('无效 token：401 拒绝，不产生 WS 连接、不触发 onConnect', async () => {
    const wsBase = await startStack()
    const onConnect: string[] = []
    transport.onConnect((id) => onConnect.push(id))

    const { ws, error } = await connect(wsBase, 'bogus-token')
    expect(ws).toBeUndefined()
    expect(error?.message).toContain('401')
    expect(transport.clientIds).toHaveLength(0)
    expect(onConnect).toHaveLength(0)

    const missing = await connect(wsBase, '')
    expect(missing.error?.message).toContain('401')
    expect(transport.clientIds).toHaveLength(0)
  })

  it('有效 token：建连成功并分配 mobile clientId', async () => {
    const wsBase = await startStack()
    const deviceToken = await pairing.issueDeviceToken()
    const connected = new Promise<string>((resolve) => transport.onConnect(resolve))

    const { ws, error } = await connect(wsBase, deviceToken)
    expect(error).toBeUndefined()
    const clientId = await connected
    expect(clientId).toMatch(/^mobile:/)
    expect(transport.clientIds).toEqual([clientId])
    expect(ws).toBeDefined()
  })

  it('设备被撤销后新连接被拒（白名单唯一回收手段，§11）', async () => {
    const wsBase = await startStack()
    const deviceToken = await pairing.issueDeviceToken()
    expect((await connect(wsBase, deviceToken)).error).toBeUndefined()
    await pairing.revokeDevice(deviceToken)
    const { error } = await connect(wsBase, deviceToken)
    expect(error?.message).toContain('401')
  })
})

describe('消息通路', () => {
  it('合法消息经 parseClientMessage 校验后分发；ping 保活帧刷新心跳计时', async () => {
    const wsBase = await startStack()
    const deviceToken = await pairing.issueDeviceToken()
    const received: ClientMessage[] = []
    transport.onMessage((_id, msg) => received.push(msg))

    const { ws } = await connect(wsBase, deviceToken)
    ws!.send(JSON.stringify(HELLO))
    await until(() => received.length === 1)
    expect(received[0].type).toBe('hello')
  })

  it('非法消息只给来源端回 system_notice(warning)，不影响其他客户端', async () => {
    const wsBase = await startStack()
    const tokenA = await pairing.issueDeviceToken()
    const tokenB = await pairing.issueDeviceToken()
    const received: ClientMessage[] = []
    transport.onMessage((_id, msg) => received.push(msg))

    const { ws: wsA } = await connect(wsBase, tokenA)
    const { ws: wsB } = await connect(wsBase, tokenB)
    const warningPromise = nextMessage(wsA!)
    wsA!.send('{"not":"a protocol message"}')
    const warning = await warningPromise
    expect(warning.type).toBe('system_notice')
    expect(received).toHaveLength(0) // 非法消息不进入分发口
    expect(transport.clientIds).toHaveLength(2) // B 不受影响
    expect(wsB!.readyState).toBe(WebSocket.OPEN)
  })

  it('send/broadcast 到达客户端；客户端主动断开触发 onDisconnect 注销', async () => {
    const wsBase = await startStack()
    const deviceToken = await pairing.issueDeviceToken()
    const clientIdP = new Promise<string>((resolve) => transport.onConnect(resolve))
    const disconnected = new Promise<string>((resolve) => transport.onDisconnect(resolve))

    const { ws } = await connect(wsBase, deviceToken)
    const clientId = await clientIdP

    const pongPromise = nextMessage(ws!)
    transport.send(clientId, { v: 1, type: 'pong', ts: Date.now(), payload: {} })
    expect((await pongPromise).type).toBe('pong')

    const bcastPromise = nextMessage(ws!)
    transport.broadcast({ v: 1, type: 'pong', ts: Date.now(), payload: {} })
    expect((await bcastPromise).type).toBe('pong')

    ws!.close()
    expect(await disconnected).toBe(clientId)
    expect(transport.clientIds).toHaveLength(0)
  })
})

describe('心跳与死连接清理', () => {
  it('超过无帧阈值主动断开并注销（§4.1：75s 语义，测试注入短值）', async () => {
    const wsBase = await startStack({ frameTimeoutMs: 150, heartbeatCheckMs: 30 })
    const deviceToken = await pairing.issueDeviceToken()
    const disconnected = new Promise<string>((resolve) => transport.onDisconnect(resolve))

    const { ws } = await connect(wsBase, deviceToken)
    expect(transport.clientIds).toHaveLength(1)
    // 客户端完全静默 → 服务端超期断开
    const closed = new Promise<void>((resolve) => ws!.on('close', () => resolve()))
    await disconnected
    await closed
    expect(transport.clientIds).toHaveLength(0)
  })

  it('持续收发帧的连接不被误杀', async () => {
    const wsBase = await startStack({ frameTimeoutMs: 200, heartbeatCheckMs: 30 })
    const deviceToken = await pairing.issueDeviceToken()
    const received: ClientMessage[] = []
    transport.onMessage((_id, msg) => received.push(msg))

    const { ws } = await connect(wsBase, deviceToken)
    // 每 50ms 一帧，总时长远超 200ms 阈值
    for (let i = 0; i < 8; i += 1) {
      ws!.send(JSON.stringify({ v: 1, type: 'ping', ts: Date.now(), payload: {} }))
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await until(() => received.length === 8)
    expect(transport.clientIds).toHaveLength(1)
    expect(ws!.readyState).toBe(WebSocket.OPEN)
  })
})

describe('core-host 集成（§9.2 配对 → WS → handshake 时序）', () => {
  let hostCtx: TestHostContext | undefined

  afterEach(async () => {
    if (hostCtx) {
      // 先等配对写盘链落定（host.dispose 内是 void 调用），避免清理目录与在途 rename 竞争
      hostCtx.host.dispose()
      await hostCtx.host.pairing.dispose()
      await rm(hostCtx.storageDir, { recursive: true, force: true })
      hostCtx = undefined
    }
  })

  it('lan.enabled=true 起服：配对换 token → WS hello → handshake → 断开注销', async () => {
    hostCtx = await makeTestHost({
      settings: { 'lan.enabled': true, 'lan.port': 0 },
      detections: [installedCli('kimi_cli', 'kimi')],
    })
    const { host } = hostCtx
    expect(host.lan.state).toBe('running')

    const httpBase = `http://127.0.0.1:${host.lan.port}`
    const { token } = host.pairing.issueToken()
    const pairRes = await fetch(`${httpBase}/api/pair`, {
      method: 'POST',
      body: JSON.stringify({ pair_token: token }),
    })
    expect(pairRes.status).toBe(200)
    const { device_token: deviceToken } = (await pairRes.json()) as { device_token: string }

    const ws = new WebSocket(`ws://127.0.0.1:${host.lan.port}/ws?token=${encodeURIComponent(deviceToken)}`)
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    await until(() => host.hub.clientCount === 1)

    const handshakePromise = nextMessage(ws)
    ws.send(JSON.stringify(HELLO))
    const handshake = await handshakePromise
    expect(handshake.type).toBe('handshake')
    if (handshake.type === 'handshake') {
      expect(handshake.payload.clientId).toMatch(/^mobile:/)
      expect(handshake.payload.sessions).toEqual([])
    }

    ws.close()
    await until(() => host.hub.clientCount === 0)
  })

  it('lan.enabled=false 不启动；配置热更新开启后 lan-server 热重启上线', async () => {
    hostCtx = await makeTestHost({
      settings: { 'lan.enabled': false },
      detections: [installedCli('kimi_cli', 'kimi')],
    })
    const { host } = hostCtx
    expect(host.lan.state).toBe('stopped')

    hostCtx.reader.values['lan.enabled'] = true
    hostCtx.reader.values['lan.port'] = 0
    host.configService.refresh()
    await until(() => host.lan.state === 'running')
    expect(host.lan.port).not.toBeNull()

    hostCtx.reader.values['lan.enabled'] = false
    host.configService.refresh()
    await until(() => host.lan.state === 'stopped')
  })
})
