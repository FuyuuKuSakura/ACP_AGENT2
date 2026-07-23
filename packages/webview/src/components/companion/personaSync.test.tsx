// @vitest-environment jsdom
/**
 * personaSync 接线测试（Phase 4）：chat role 挂载发 persona_list_request，
 * 响应按 init.personaId 选中 persona，把 modelUrl/portraitUrls/live2d/touchZones/name
 * 灌进 useCompanionConfigStore（替换 DEFAULT_COMPANION_CONFIG 占位）。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { PersonaSummary } from '@dionysus/protocol'

import { ChatApp } from '../chat/ChatApp.js'
import { FakeTransport, envelope, resetAllStores } from '../chat/testUtils.js'
import { DEFAULT_COMPANION_CONFIG, useCompanionConfigStore } from './config.js'

const VOICE = {
  tone: '冷静克制',
  catchphrases: ['——以上。'],
  taboos: ['卖萌'],
  examples: [{ plain: '任务完成。', styled: '任务完成，博士。' }],
  rewriterPrompt: '请以「{tone}」的语气改写：\n{examples}',
}

const PERSONAS: PersonaSummary[] = [
  {
    id: 'exusiai',
    name: '能天使',
    description: '企鹅物流的信使。',
    voice: VOICE,
    touchZones: {},
  },
  {
    id: "kal'tsit",
    name: '凯尔希',
    description: '罗德岛医疗部门负责人。',
    voice: VOICE,
    touchZones: { head: { expression: '惊讶', lines: ['博士，有事吗？'] } },
    modelUrl: "vscode-webview://x/assets/live2d/kal'tsit/凯尔希直播版1.model3.json",
    portraitUrls: { default: 'vscode-webview://x/assets/personas/default_avatars/kaltsit.png' },
    live2d: {
      expressions: { happy: '微笑', neutral: '原皮' },
      motions: { idle: 'M3待机', nod: '待机动耳朵' },
      defaultExpression: '原皮',
      scale: 0.5,
      motionFiles: [
        { name: 'M3待机', file: 'M3待机.motion3.json' },
        { name: '待机动耳朵', file: '待机动耳朵.motion3.json' },
      ],
    },
  },
]

beforeEach(() => {
  resetAllStores()
  useCompanionConfigStore.getState().reset()
})
afterEach(cleanup)

describe('chat role 陪伴区 persona 接线（usePersonaCompanionConfig）', () => {
  it('挂载发 persona_list_request；响应按 init.personaId 灌 companion store', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} personaId="kal'tsit" />)

    expect(transport.ofType('persona_list_request')).toHaveLength(1)
    // 响应到达前保持中立默认占位
    expect(useCompanionConfigStore.getState().config).toEqual(DEFAULT_COMPANION_CONFIG)

    act(() => {
      transport.emit(envelope('persona_list_response', { personas: PERSONAS }))
    })

    const config = useCompanionConfigStore.getState().config
    expect(config.personaId).toBe("kal'tsit")
    expect(config.name).toBe('凯尔希')
    expect(config.modelUrl).toBe("vscode-webview://x/assets/live2d/kal'tsit/凯尔希直播版1.model3.json")
    expect(config.portraitUrls).toEqual({
      default: 'vscode-webview://x/assets/personas/default_avatars/kaltsit.png',
    })
    expect(config.live2d.expressions).toEqual({ happy: '微笑', neutral: '原皮' })
    expect(config.live2d.motions).toEqual({ idle: 'M3待机', nod: '待机动耳朵' })
    expect(config.live2d.defaultExpression).toBe('原皮')
    expect(config.live2d.scale).toBe(0.5)
    expect(config.live2d.motionFiles).toEqual([
      { name: 'M3待机', file: 'M3待机.motion3.json' },
      { name: '待机动耳朵', file: '待机动耳朵.motion3.json' },
    ])
    expect(config.live2d.expressionFiles).toEqual([])
    expect(config.touchZones.head).toEqual({ expression: '惊讶', lines: ['博士，有事吗？'] })
  })

  it('init.personaId 未命中时回退列表首个 persona', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} personaId="no_such" />)
    act(() => {
      transport.emit(envelope('persona_list_response', { personas: PERSONAS }))
    })
    const config = useCompanionConfigStore.getState().config
    expect(config.personaId).toBe('exusiai')
    expect(config.modelUrl).toBeUndefined()
  })

  it('未注入 personaId 时同样回退列表首个；空列表保持默认占位', () => {
    const transport = new FakeTransport()
    render(<ChatApp clientId="webview:chat" transport={transport} />)
    act(() => {
      transport.emit(envelope('persona_list_response', { personas: PERSONAS }))
    })
    expect(useCompanionConfigStore.getState().config.personaId).toBe('exusiai')

    useCompanionConfigStore.getState().reset()
    act(() => {
      transport.emit(envelope('persona_list_response', { personas: [] }))
    })
    expect(useCompanionConfigStore.getState().config).toEqual(DEFAULT_COMPANION_CONFIG)
  })
})
