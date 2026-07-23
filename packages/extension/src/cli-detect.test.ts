import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}))

import { exec } from 'node:child_process'

import {
  DETECT_TIMEOUT_MS,
  SUPPORTED_CLIS,
  TESTED_VERSIONS,
  detectClis,
  isWithinTestedRange,
  parseVersion,
} from './cli-detect.js'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

const execMock = vi.mocked(exec)

/** 让 mock 的 exec 按 callback 风格行为：handler 返回 stdout，或抛错表示命令失败 */
function stubExec(handler: (command: string) => string) {
  execMock.mockImplementation(((command: string, _opts: unknown, cb: ExecCallback) => {
    try {
      const stdout = handler(command)
      queueMicrotask(() => cb(null, stdout, ''))
    } catch (error) {
      queueMicrotask(() => cb(error as Error, '', ''))
    }
    return undefined as never
  }) as unknown as typeof exec)
}

const fail = () => {
  throw new Error('command not found')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SUPPORTED_CLIS / TESTED_VERSIONS', () => {
  it('覆盖五个 CLI，命令名与 extract/adapters.md 一致', () => {
    expect(SUPPORTED_CLIS.map((c) => [c.id, c.command])).toEqual([
      ['kimi_cli', 'kimi'],
      ['claude_cli', 'claude'],
      ['opencode_cli', 'opencode'],
      ['codex_cli', 'codex'],
      ['codebuddy_cli', 'codebuddy'],
    ])
  })

  it('每个 CLI 都有 TESTED_VERSIONS 记录（无实测版本时标 unknown）', () => {
    for (const spec of SUPPORTED_CLIS) {
      expect(TESTED_VERSIONS[spec.id]).toBeDefined()
    }
  })
})

describe('parseVersion', () => {
  it('从各种 --version 输出中提取版本号', () => {
    expect(parseVersion('0.5.2\n')).toBe('0.5.2')
    expect(parseVersion('kimi, version 1.2.3')).toBe('1.2.3')
    expect(parseVersion('1.0.0 (Claude Code)')).toBe('1.0.0')
    expect(parseVersion('opencode 2.1')).toBe('2.1')
  })

  it('输出版本无法解析时返回 undefined', () => {
    expect(parseVersion('no version here')).toBeUndefined()
    expect(parseVersion('')).toBeUndefined()
  })
})

describe('isWithinTestedRange（主版本号粗判）', () => {
  it('主版本号一致即在范围内', () => {
    expect(isWithinTestedRange('1.2.x', '1.9.0')).toBe(true)
  })

  it('主版本号不一致判定超范围', () => {
    expect(isWithinTestedRange('2.0.x', '1.9.0')).toBe(false)
  })

  it('已适配版本为 unknown 时不误报', () => {
    expect(isWithinTestedRange('unknown', '9.9.9')).toBe(true)
  })

  it('任一侧版本无法解析时不误报', () => {
    expect(isWithinTestedRange('abc', '1.0.0')).toBe(true)
    expect(isWithinTestedRange('1.2.x', 'dev-build')).toBe(true)
  })
})

describe('detectClis', () => {
  it('全部未安装：installed=false、无版本、不跑 --version', async () => {
    stubExec(fail)

    const results = await detectClis()

    expect(results).toHaveLength(5)
    for (const r of results) {
      expect(r.installed).toBe(false)
      expect(r.version).toBeUndefined()
      expect(r.withinTestedRange).toBe(true)
    }
    // 每个 CLI 只探测一次 which，未命中即停
    expect(execMock).toHaveBeenCalledTimes(5)
    for (const call of execMock.mock.calls) {
      expect(String(call[0])).toMatch(/^(which|where) /)
      expect(call[1]).toMatchObject({ timeout: DETECT_TIMEOUT_MS })
    }
  })

  it('命中后跑 --version 并解析版本', async () => {
    stubExec((command) => {
      if (command === 'which kimi') return '/usr/local/bin/kimi\n'
      if (command === 'kimi --version') return 'kimi, version 0.5.2\n'
      return fail()
    })

    const results = await detectClis()
    const kimi = results.find((r) => r.id === 'kimi_cli')!

    expect(kimi.installed).toBe(true)
    expect(kimi.version).toBe('0.5.2')
    expect(kimi.withinTestedRange).toBe(true)
    expect(results.filter((r) => r.installed)).toHaveLength(1)
  })

  it('--version 失败不阻断：仍视为已安装、版本缺省', async () => {
    stubExec((command) => {
      if (command === 'which claude') return '/usr/local/bin/claude\n'
      return fail()
    })

    const results = await detectClis()
    const claude = results.find((r) => r.id === 'claude_cli')!

    expect(claude.installed).toBe(true)
    expect(claude.version).toBeUndefined()
    expect(claude.withinTestedRange).toBe(true)
  })

  it('单个 CLI 探测异常不影响其他 CLI', async () => {
    stubExec((command) => {
      if (command === 'which codex') return '/usr/local/bin/codex\n'
      if (command === 'codex --version') return 'codex 1.4.0\n'
      return fail()
    })

    const results = await detectClis()

    expect(results.find((r) => r.id === 'codex_cli')!.version).toBe('1.4.0')
    expect(results.find((r) => r.id === 'kimi_cli')!.installed).toBe(false)
  })
})
