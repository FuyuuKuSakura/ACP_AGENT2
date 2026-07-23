/**
 * 配对流程测试（P0 门禁）：hash 解析 → POST /api/pair → 持久化 →
 * replaceState 抹掉 pair token；401 → 清 token → 跳配对页闭环。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDeviceToken,
  getDeviceToken,
  handleUnauthorized,
  pairWithServer,
  probeDeviceToken,
  readPairTokenFromHash,
  saveDeviceToken,
} from './pairing.js'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = ''
})

describe('readPairTokenFromHash', () => {
  it('解析 #/pair/<token>', () => {
    expect(readPairTokenFromHash('#/pair/abc123')).toBe('abc123')
    expect(readPairTokenFromHash('#/pair/a%20b')).toBe('a b')
  })

  it('兼容 #pair= / #?pair_token= 形式', () => {
    expect(readPairTokenFromHash('#pair=t1')).toBe('t1')
    expect(readPairTokenFromHash('#/?pair_token=t2')).toBe('t2')
  })

  it('无 token 返回 null', () => {
    expect(readPairTokenFromHash('#/list')).toBeNull()
    expect(readPairTokenFromHash('')).toBeNull()
  })
})

describe('pairWithServer', () => {
  it('成功：POST pair_token → 持久化 device_token → hash 抹掉并落 #/list', async () => {
    window.location.hash = '#/pair/PAIR-T'
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { device_token: 'DEV-T' }),
    )
    const res = await pairWithServer('PAIR-T', fetchImpl as unknown as typeof fetch)
    expect(res).toEqual({ ok: true, deviceToken: 'DEV-T' })
    expect(fetchImpl).toHaveBeenCalledWith('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair_token: 'PAIR-T' }),
    })
    expect(getDeviceToken()).toBe('DEV-T')
    expect(window.location.hash).toBe('#/list')
    expect(window.location.href).not.toContain('PAIR-T')
  })

  it('401：不换票、hash 抹掉回配对页', async () => {
    window.location.hash = '#/pair/EXPIRED'
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: 'invalid_or_expired_pair_token' }),
    )
    const res = await pairWithServer('EXPIRED', fetchImpl as unknown as typeof fetch)
    expect(res).toEqual({ ok: false, reason: 'invalid_token' })
    expect(getDeviceToken()).toBeNull()
    expect(window.location.hash).toBe('#/pair')
    expect(window.location.href).not.toContain('EXPIRED')
  })

  it('网络异常：reason=network', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'))
    const res = await pairWithServer('T', fetchImpl as unknown as typeof fetch)
    expect(res).toEqual({ ok: false, reason: 'network' })
  })
})

describe('401 闭环', () => {
  it('handleUnauthorized：清 token → 跳配对页', () => {
    saveDeviceToken('DEV-T')
    window.location.hash = '#/list'
    handleUnauthorized()
    expect(getDeviceToken()).toBeNull()
    expect(window.location.hash).toBe('#/pair')
  })

  it('probeDeviceToken：200 ok / 401 unauthorized / 异常 unreachable', async () => {
    const okFetch = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    await expect(
      probeDeviceToken('D', okFetch as unknown as typeof fetch),
    ).resolves.toBe('ok')
    expect(okFetch).toHaveBeenCalledWith('/api/health?token=D')

    const unauthFetch = vi.fn().mockResolvedValue(
      jsonResponse(401, { error: 'invalid_device_token' }),
    )
    await expect(
      probeDeviceToken('D', unauthFetch as unknown as typeof fetch),
    ).resolves.toBe('unauthorized')

    const downFetch = vi.fn().mockRejectedValue(new Error('down'))
    await expect(
      probeDeviceToken('D', downFetch as unknown as typeof fetch),
    ).resolves.toBe('unreachable')
  })

  it('clearDeviceToken 幂等', () => {
    saveDeviceToken('X')
    clearDeviceToken()
    clearDeviceToken()
    expect(getDeviceToken()).toBeNull()
  })
})
