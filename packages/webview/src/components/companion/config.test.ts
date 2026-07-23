// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from '@dionysus/client-core'

import { applyInitToStores } from '../../App.js'
import {
  DEFAULT_COMPANION_CONFIG,
  companionConfigFromInit,
  useCompanionConfigStore,
} from './config.js'

beforeEach(() => {
  useCompanionConfigStore.getState().reset()
  useSettingsStore.getState().reset()
})

describe('DEFAULT_COMPANION_CONFIG（与 core DEFAULT_PERSONA 同形的中立结构）', () => {
  it('空 live2d 映射、空 touch_zones、无素材 URL', () => {
    expect(DEFAULT_COMPANION_CONFIG.personaId).toBe('default')
    expect(DEFAULT_COMPANION_CONFIG.modelUrl).toBeUndefined()
    expect(DEFAULT_COMPANION_CONFIG.portraitUrls).toBeUndefined()
    expect(DEFAULT_COMPANION_CONFIG.live2d.expressions).toEqual({})
    expect(DEFAULT_COMPANION_CONFIG.live2d.motions).toEqual({})
    expect(DEFAULT_COMPANION_CONFIG.live2d.expressionFiles).toEqual([])
    expect(DEFAULT_COMPANION_CONFIG.live2d.motionFiles).toEqual([])
    expect(DEFAULT_COMPANION_CONFIG.touchZones).toEqual({})
  })
})

describe('companionConfigFromInit', () => {
  it('完整输入透传（含显式动作/表情文件清单与 touch_zones）', () => {
    const cfg = companionConfigFromInit({
      personaId: "kal'tsit",
      name: '凯尔希',
      modelUrl: 'https://cdn/example/model3.json',
      portraitUrls: { default: 'https://cdn/example/default.png' },
      live2d: {
        expressions: { happy: '微笑' },
        motions: { idle: 'Idle' },
        defaultExpression: '原皮',
        scale: 0.5,
        expressionFiles: [{ name: '微笑', file: '微笑.exp3.json' }],
        motionFiles: [{ name: 'Idle', file: 'M3待机.motion3.json' }],
      },
      touchZones: { head: { expression: '惊讶', lines: ['博士，有事吗？'] } },
    })
    expect(cfg.personaId).toBe("kal'tsit")
    expect(cfg.modelUrl).toBe('https://cdn/example/model3.json')
    expect(cfg.live2d.expressions).toEqual({ happy: '微笑' })
    expect(cfg.live2d.expressionFiles).toEqual([{ name: '微笑', file: '微笑.exp3.json' }])
    expect(cfg.touchZones.head).toEqual({ expression: '惊讶', lines: ['博士，有事吗？'] })
  })

  it('缺段逐键回退中立默认；touch_zones 缺 lines 容错为空数组', () => {
    const cfg = companionConfigFromInit({ personaId: 'x' })
    expect(cfg.personaId).toBe('x')
    expect(cfg.name).toBe(DEFAULT_COMPANION_CONFIG.name)
    expect(cfg.live2d).toEqual({ expressions: {}, motions: {}, expressionFiles: [], motionFiles: [] })
    expect(companionConfigFromInit({ touchZones: { body: {} } }).touchZones.body).toEqual({
      expression: undefined,
      lines: [],
    })
  })
})

describe('applyInitToStores（init 注入接线）', () => {
  it('companion 字段落 companionConfigStore；displayMode 落 settingsStore', () => {
    applyInitToStores({
      clientId: 'webview:chat',
      role: 'chat',
      needCliGuide: false,
      displayMode: 'static',
      companion: { personaId: "kal'tsit", name: '凯尔希' },
    })
    expect(useSettingsStore.getState().displayMode).toBe('static')
    expect(useCompanionConfigStore.getState().config.personaId).toBe("kal'tsit")
  })

  it('init 无 companion/displayMode 字段时保持默认（persona RPC 补齐前的降级路径）', () => {
    applyInitToStores({ clientId: 'webview:chat', role: 'chat', needCliGuide: false })
    expect(useSettingsStore.getState().displayMode).toBe('live2d')
    expect(useCompanionConfigStore.getState().config).toBe(DEFAULT_COMPANION_CONFIG)
  })
})
