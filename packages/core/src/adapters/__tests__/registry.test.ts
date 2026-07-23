/**
 * registry 测试（extract/adapters.md §3；roadmap 附录 A test_adapter_registry 翻译，
 * 改为注入配置隔离、只暴露 createAdapter 工厂）。
 */
import { describe, expect, it } from 'vitest'

import { GenericCliAdapter } from '../generic-cli.js'
import { createAdapter } from '../registry.js'
import { KimiStrategy } from '../strategies/kimi.js'

const CONFIG = {
  kimi_cli: {
    type: 'kimi_code_cli',
    command: 'kimi',
    outputFormat: 'stream-json',
    workingDir: '.',
    enabled: true,
  },
  kimi_by_strategy: {
    strategy: 'kimi',
    command: 'kimi',
  },
  disabled_one: {
    type: 'kimi_code_cli',
    enabled: false,
  },
  unknown_type: {
    type: 'no_such_type',
  },
  unknown_strategy: {
    strategy: 'no_such_strategy',
  },
}

describe('createAdapter', () => {
  it('type kimi_code_cli → GenericCliAdapter + KimiStrategy', () => {
    const a = createAdapter('kimi_cli', CONFIG)
    expect(a).toBeInstanceOf(GenericCliAdapter)
    expect(a.agentId).toBe('kimi_cli')
  })

  it.each([
    ['claude_code_cli', 'claude_cli'],
    ['codex_cli', 'codex_cli'],
    ['opencode_cli', 'opencode_cli'],
    ['codebuddy_cli', 'codebuddy_cli'],
  ])('type %s → GenericCliAdapter + 策略 %s（extract §3.2 映射表）', (type, agentId) => {
    const a = createAdapter('x', { x: { type } })
    expect(a).toBeInstanceOf(GenericCliAdapter)
    expect(a.agentId).toBe(agentId)
  })

  it.each(['claude', 'codex', 'opencode', 'codebuddy'])(
    'strategy 字段直接指定 %s（无 type 时兜底）',
    (strategy) => {
      const a = createAdapter('x', { x: { strategy } })
      expect(a.agentId).toBe(`${strategy}_cli`)
    },
  )

  it('type 缺失时显式回退 strategy 字段（无空字符串哨兵）', () => {
    const a = createAdapter('kimi_by_strategy', CONFIG)
    expect(a.agentId).toBe('kimi_cli')
  })

  it('每次调用新建独立实例，不暴露共享实例', () => {
    const a1 = createAdapter('kimi_cli', CONFIG)
    const a2 = createAdapter('kimi_cli', CONFIG)
    expect(a1).not.toBe(a2)
  })

  it('深拷贝配置：传入的配置对象不被实例共享/篡改', () => {
    const cfg = { kimi: { type: 'kimi_code_cli', command: 'kimi', nested: { x: 1 } } }
    const snapshot = JSON.parse(JSON.stringify(cfg))
    createAdapter('kimi', cfg)
    expect(cfg).toEqual(snapshot)
  })

  it('未知 adapterId 抛错', () => {
    expect(() => createAdapter('nope', CONFIG)).toThrow(/Unknown or disabled/)
  })

  it('disabled 适配器拒绝实例化', () => {
    expect(() => createAdapter('disabled_one', CONFIG)).toThrow(/Unknown or disabled/)
  })

  it('未知 type 且无 strategy 兜底 → 抛错', () => {
    expect(() => createAdapter('unknown_type', CONFIG)).toThrow(/Unknown adapter type/)
  })

  it('未知 strategy → 抛错', () => {
    expect(() => createAdapter('unknown_strategy', CONFIG)).toThrow(/Unknown strategy/)
  })
})

describe('registry 扩展点', () => {
  it('registerStrategy / registerTypeAlias 可注册新 CLI（内置 5 个之外的自定义策略走此通道）', async () => {
    const { registerStrategy, registerTypeAlias } = await import('../registry.js')
    registerStrategy('kimi_clone', KimiStrategy)
    registerTypeAlias('kimi_clone_cli', 'kimi_clone')
    const a = createAdapter('x', { x: { type: 'kimi_clone_cli' } })
    expect(a.agentId).toBe('kimi_cli')
  })
})
