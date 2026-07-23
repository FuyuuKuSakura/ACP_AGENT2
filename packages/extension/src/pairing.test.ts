/**
 * PairingManager 单测（architecture.md §6.4 / §11）：
 * TTL、一次性、换发即旧失效、设备白名单/撤销、持久化、last_seen 节流刷新、
 * constant-time 比较路径（错误 token 拒绝）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LAST_SEEN_FLUSH_MS, PAIR_TOKEN_TTL_MS, PairingManager } from './pairing.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-pairing-test-'))
  file = join(dir, 'paired-devices.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function readDevices(): Promise<Record<string, { createdAt: number; lastSeen: number }>> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as {
    devices: Record<string, { createdAt: number; lastSeen: number }>
  }
  return parsed.devices
}

/** 轮询等待条件成立（节流落盘是异步的）。 */
async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await cond()) return
    if (Date.now() - start > timeoutMs) throw new Error('until: condition not met within timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('pair token', () => {
  it('签发 128-bit token（base64url 22 字符），TTL 300s', async () => {
    const now = 1_000_000
    const mgr = await PairingManager.create(file, { now: () => now })
    const { token, expiresAt } = mgr.issueToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(expiresAt).toBe(now + PAIR_TOKEN_TTL_MS)
    await mgr.dispose()
  })

  it('校验通过后一次性作废；错误 token 拒绝', async () => {
    const mgr = await PairingManager.create(file)
    const { token } = mgr.issueToken()
    expect(mgr.verifyPairToken('wrong-token')).toBe(false)
    expect(mgr.verifyPairToken(token)).toBe(true)
    // 一次性：同一 token 第二次校验失败
    expect(mgr.verifyPairToken(token)).toBe(false)
    await mgr.dispose()
  })

  it('TTL 过期后校验失败', async () => {
    let now = 1_000_000
    const mgr = await PairingManager.create(file, { now: () => now })
    const { token } = mgr.issueToken()
    now += PAIR_TOKEN_TTL_MS + 1
    expect(mgr.verifyPairToken(token)).toBe(false)
    await mgr.dispose()
  })

  it('换发新 token 后旧 token 立即失效（§6.4 倒计时换发语义）', async () => {
    const mgr = await PairingManager.create(file)
    const old = mgr.issueToken()
    const next = mgr.issueToken()
    expect(mgr.verifyPairToken(old.token)).toBe(false)
    expect(mgr.verifyPairToken(next.token)).toBe(true)
    await mgr.dispose()
  })
})

describe('device token', () => {
  it('签发后可验票；未知 token 拒绝；撤销后拒绝', async () => {
    const mgr = await PairingManager.create(file)
    const deviceToken = await mgr.issueDeviceToken()
    expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/) // 256-bit base64url
    expect(mgr.validateDeviceToken(deviceToken)).toBe(true)
    expect(mgr.validateDeviceToken('no-such-token')).toBe(false)
    expect(await mgr.revokeDevice(deviceToken)).toBe(true)
    expect(mgr.validateDeviceToken(deviceToken)).toBe(false)
    // 撤销不存在的设备返回 false
    expect(await mgr.revokeDevice(deviceToken)).toBe(false)
    await mgr.dispose()
  })

  it('设备白名单持久化：新实例从同一文件恢复', async () => {
    const mgr1 = await PairingManager.create(file)
    const deviceToken = await mgr1.issueDeviceToken()
    await mgr1.dispose()

    const mgr2 = await PairingManager.create(file)
    expect(mgr2.validateDeviceToken(deviceToken)).toBe(true)
    const devices = mgr2.listDevices()
    expect(devices).toHaveLength(1)
    expect(devices[0].token).toBe(deviceToken)
    await mgr2.dispose()
  })

  it('验票刷新 last_seen，落盘节流到每分钟一次', async () => {
    let now = 1_000_000
    const mgr = await PairingManager.create(file, { now: () => now, lastSeenFlushMs: LAST_SEEN_FLUSH_MS })
    const deviceToken = await mgr.issueDeviceToken()
    expect((await readDevices())[deviceToken].lastSeen).toBe(now)

    // 节流窗口内验票：内存更新但不落盘
    now += 10_000
    expect(mgr.validateDeviceToken(deviceToken)).toBe(true)
    expect(mgr.listDevices()[0].lastSeen).toBe(now)
    expect((await readDevices())[deviceToken].lastSeen).toBe(now - 10_000)

    // 越过节流窗口后验票：落盘追平
    now += LAST_SEEN_FLUSH_MS
    expect(mgr.validateDeviceToken(deviceToken)).toBe(true)
    await until(async () => (await readDevices())[deviceToken].lastSeen === now)
    await mgr.dispose()
  })

  it('损坏的持久化文件按空设备表处理，不抛错', async () => {
    await writeFile(file, '{ not json', 'utf8')
    const mgr = await PairingManager.create(file)
    expect(mgr.listDevices()).toHaveLength(0)
    expect(mgr.validateDeviceToken('anything')).toBe(false)
    await mgr.dispose()
  })
})
