import { describe, expect, it, vi } from 'vitest'

import {
  createConfigService,
  createVscodeConfigReader,
  DEFAULT_CONFIG,
  readConfig,
} from './config.js'
import type { WorkspaceLike } from './config.js'

/**
 * 假 vscode 命名空间：settings map → WorkspaceLike，
 * 模拟 vscode.workspace.getConfiguration('dionysus').get(key)。
 */
function fakeVscodeWorkspace(settings: Record<string, unknown>): WorkspaceLike {
  return {
    getConfiguration(section?: string) {
      const prefix = section ? `${section}.` : ''
      return {
        get<T>(key: string): T | undefined {
          return settings[`${prefix}${key}`] as T | undefined
        },
      }
    },
  }
}

describe('readConfig', () => {
  it('settings 为空时返回 §6.5 的全部默认值', () => {
    const reader = createVscodeConfigReader(fakeVscodeWorkspace({}))
    expect(readConfig(reader)).toEqual(DEFAULT_CONFIG)
    expect(readConfig(reader).character.display).toEqual({ desktop: 'live2d', mobile: 'live2d' })
  })

  it('读取 dionysus.* 各段配置', () => {
    const reader = createVscodeConfigReader(
      fakeVscodeWorkspace({
        'dionysus.adapter.default': 'kimi_cli',
        'dionysus.adapters': { kimi_cli: { type: 'kimi_code_cli', command: 'kimi', model: null } },
        'dionysus.maxConcurrentAgents': 5,
        'dionysus.persona.default': "kal'tsit",
        'dionysus.persona.injectIntoAgent': true,
        'dionysus.session.optionTimeoutAction': 'deny',
        'dionysus.lan.enabled': true,
        'dionysus.lan.port': 9000,
        'dionysus.supervisor.mode': 'agent_session',
        'dionysus.supervisor.intervalSeconds': 30,
        'dionysus.character.display.desktop': 'static',
        'dionysus.character.display.mobile': 'live2d',
      }),
    )
    const config = readConfig(reader)
    expect(config.adapter.default).toBe('kimi_cli')
    expect(config.adapters.kimi_cli.command).toBe('kimi')
    expect(config.maxConcurrentAgents).toBe(5)
    expect(config.persona).toEqual({ default: "kal'tsit", injectIntoAgent: true })
    expect(config.session.optionTimeoutAction).toBe('deny')
    expect(config.lan).toEqual({ enabled: true, port: 9000 })
    expect(config.supervisor.mode).toBe('agent_session')
    expect(config.character.display).toEqual({ desktop: 'static', mobile: 'live2d' })
  })

  it('非法枚举值回退默认，intervalSeconds 钳制到下限 5', () => {
    const reader = createVscodeConfigReader(
      fakeVscodeWorkspace({
        'dionysus.supervisor.mode': 'bogus',
        'dionysus.supervisor.intervalSeconds': 1,
        'dionysus.session.optionTimeoutAction': 'bogus',
        'dionysus.character.display.desktop': 'bogus',
      }),
    )
    const config = readConfig(reader)
    expect(config.supervisor.mode).toBe('template')
    expect(config.supervisor.intervalSeconds).toBe(5)
    expect(config.session.optionTimeoutAction).toBe('keep')
    expect(config.character.display.desktop).toBe('live2d')
  })
})

describe('createConfigService — 单引用热更新语义', () => {
  it('config 对象 identity 稳定，refresh 原地更新（为配置注入单引用铺路）', () => {
    const settings: Record<string, unknown> = { 'dionysus.character.display.desktop': 'live2d' }
    const service = createConfigService(createVscodeConfigReader(fakeVscodeWorkspace(settings)))
    const ref = service.config

    settings['dionysus.character.display.desktop'] = 'static'
    service.refresh()

    expect(service.config).toBe(ref) // 同一引用
    expect(ref.character.display.desktop).toBe('static') // 内容已原地更新
  })

  it('内容变化时触发 onDidChange，无变化不触发；可取消订阅', () => {
    const settings: Record<string, unknown> = {}
    const service = createConfigService(createVscodeConfigReader(fakeVscodeWorkspace(settings)))
    const listener = vi.fn()
    const dispose = service.onDidChange(listener)

    service.refresh()
    expect(listener).not.toHaveBeenCalled()

    settings['dionysus.lan.enabled'] = true
    service.refresh()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(service.config)

    dispose()
    settings['dionysus.lan.port'] = 9999
    service.refresh()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
