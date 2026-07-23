// @vitest-environment jsdom
/**
 * 设置页（role='settings'）jsdom 测试（ux-core-flows.md §5.5）：
 * - 挂载即发 persona_list_request / character_list_request；
 * - 角色列表渲染（头像 img / 首字母兜底），选中切换表单；
 * - voice 表单编辑 → 试听（voice_preview_request 携带未保存编辑）→ 结果显示；
 * - 保存（persona_update_request 五字段 + name/description）→ 已保存提示；
 * - 展示模式 / 默认角色下拉 → settings_update_request 写回。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ClientTransport } from '@dionysus/client-core'
import type {
  CharacterListResponsePayload,
  ClientMessage,
  PersonaListResponsePayload,
  PersonaSummary,
  ServerMessage,
} from '@dionysus/protocol'

import { SettingsApp } from './SettingsApp.js'

class FakeTransport implements ClientTransport {
  readonly sent: ClientMessage[] = []
  private cb: ((msg: ServerMessage) => void) | null = null

  send(msg: ClientMessage): void {
    this.sent.push(msg)
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.cb = cb
  }

  emit(msg: ServerMessage): void {
    act(() => this.cb?.(msg))
  }

  ofType<T extends ClientMessage['type']>(type: T): Extract<ClientMessage, { type: T }>[] {
    return this.sent.filter((m) => m.type === type) as Extract<ClientMessage, { type: T }>[]
  }
}

function envelope<T extends ServerMessage['type']>(
  type: T,
  payload: Extract<ServerMessage, { type: T }>['payload'],
  traceId?: string,
): ServerMessage {
  return { v: 1, type, ts: Date.now(), ...(traceId ? { traceId } : {}), payload } as ServerMessage
}

function persona(partial: Partial<PersonaSummary> & { id: string }): PersonaSummary {
  return {
    name: partial.id,
    description: '',
    voice: { tone: '', catchphrases: [], taboos: [], examples: [], rewriterPrompt: '' },
    touchZones: {},
    ...partial,
  }
}

const PERSONAS: PersonaListResponsePayload['personas'] = [
  persona({
    id: "kal'tsit",
    name: '凯尔希',
    description: '罗德岛医疗部门负责人。',
    avatarPath: 'personas/default_avatars/kaltsit.png',
    avatarSource: 'builtin',
    voice: {
      tone: '冷静克制',
      catchphrases: ['……请注意分寸。'],
      taboos: ['卖萌'],
      examples: [{ plain: '任务完成。', styled: '任务完成，博士。' }],
      rewriterPrompt: '以{tone}语气改写',
    },
    touchZones: { head: { expression: '惊讶', lines: ['博士，有事吗？'] } },
  }),
  persona({ id: 'my_char', name: '自创角色', voice: { tone: '元气', catchphrases: [], taboos: [], examples: [], rewriterPrompt: '' } }),
]

const CHARACTER_LIST: CharacterListResponsePayload = {
  characters: [
    { id: "kal'tsit:live2d", name: '凯尔希', personaId: "kal'tsit", kind: 'live2d', source: 'builtin' },
    { id: 'my_char:static', name: '自创角色', personaId: 'my_char', kind: 'static', source: 'user' },
  ],
  display: { desktop: 'live2d', mobile: 'static' },
  defaultPersonaId: "kal'tsit",
}

function setup(): FakeTransport {
  // 设置页经 __DIONYSUS_INIT__ 拿到 asWebviewUri 素材根（头像 URL 拼接）
  window.__DIONYSUS_INIT__ = {
    clientId: 'webview:settings',
    role: 'settings',
    needCliGuide: false,
    builtinAssetsUri: 'vscode-resource://builtin-assets',
    userLibraryUri: 'vscode-resource://user-library',
  } as unknown as typeof window.__DIONYSUS_INIT__
  const transport = new FakeTransport()
  render(<SettingsApp transport={transport} />)
  transport.emit(envelope('persona_list_response', { personas: PERSONAS }, 'settings:persona-list'))
  transport.emit(envelope('character_list_response', CHARACTER_LIST, 'settings:character-list'))
  return transport
}

afterEach(() => {
  cleanup()
  delete window.__DIONYSUS_INIT__
})

describe('SettingsApp', () => {
  it('挂载即发 persona_list_request 与 character_list_request', () => {
    const transport = new FakeTransport()
    render(<SettingsApp transport={transport} />)
    expect(transport.ofType('persona_list_request')).toHaveLength(1)
    expect(transport.ofType('character_list_request')).toHaveLength(1)
  })

  it('角色列表渲染头像与名称；无头像角色回退首字母；素材库区带 kind 徽标', () => {
    setup()
    expect(screen.getByTestId("persona-item-kal'tsit")).toBeTruthy()
    const avatar = screen.getByTestId("persona-avatar-kal'tsit") as HTMLImageElement
    expect(avatar.src).toContain('personas/default_avatars/kaltsit.png')
    // my_char 无头像：无 img，按钮内有首字母
    expect(screen.queryByTestId('persona-avatar-my_char')).toBeNull()
    expect(screen.getByTestId('persona-item-my_char').textContent).toContain('自')
    // 素材库区
    expect(screen.getByTestId("asset-kind-kal'tsit:live2d").textContent).toBe('Live2D')
    expect(screen.getByTestId('asset-kind-my_char:static').textContent).toBe('静态立绘')
  })

  it('默认选中首个角色并回填 voice 表单；切换角色重置表单', () => {
    setup()
    expect((screen.getByTestId('vf-tone') as HTMLInputElement).value).toBe('冷静克制')
    expect((screen.getByTestId('vf-catchphrases') as HTMLTextAreaElement).value).toBe('……请注意分寸。')
    expect((screen.getByTestId('vf-example-plain-0') as HTMLInputElement).value).toBe('任务完成。')

    fireEvent.click(screen.getByTestId('persona-item-my_char'))
    expect((screen.getByTestId('vf-tone') as HTMLInputElement).value).toBe('元气')
    expect((screen.getByTestId('vf-name') as HTMLInputElement).value).toBe('自创角色')
  })

  it('试听：voice_preview_request 携带未保存编辑，响应显示改写结果', async () => {
    const transport = setup()
    fireEvent.change(screen.getByTestId('vf-tone'), { target: { value: '更冷淡' } })
    fireEvent.change(screen.getByTestId('vf-preview-input'), { target: { value: '会话 A 完成了。' } })
    fireEvent.click(screen.getByTestId('vf-preview-button'))

    const req = transport.ofType('voice_preview_request')
    expect(req).toHaveLength(1)
    expect(req[0].payload.personaId).toBe("kal'tsit")
    expect(req[0].payload.text).toBe('会话 A 完成了。')
    expect(req[0].payload.voice?.tone).toBe('更冷淡') // 未保存的编辑随试听下发

    transport.emit(
      envelope(
        'voice_preview_response',
        { personaId: "kal'tsit", original: '会话 A 完成了。', rewritten: '会话 A 完成了，博士。' },
        'settings:voice-preview',
      ),
    )
    expect(await screen.findByTestId('vf-preview-output')).toBeTruthy()
    expect(screen.getByTestId('vf-preview-output').textContent).toBe('会话 A 完成了，博士。')
  })

  it('保存：persona_update_request 携带五字段 + name/description，成功后提示并刷新列表', () => {
    const transport = setup()
    fireEvent.change(screen.getByTestId('vf-tone'), { target: { value: '温和' } })
    fireEvent.change(screen.getByTestId('vf-catchphrases'), { target: { value: '嗯。\n好的。' } })
    fireEvent.click(screen.getByTestId('vf-example-add'))
    fireEvent.change(screen.getByTestId('vf-example-plain-1'), { target: { value: '报错了。' } })
    fireEvent.change(screen.getByTestId('vf-example-styled-1'), { target: { value: '……出现偏差。' } })
    fireEvent.click(screen.getByTestId('vf-save'))

    const req = transport.ofType('persona_update_request')
    expect(req).toHaveLength(1)
    expect(req[0].payload.personaId).toBe("kal'tsit")
    expect(req[0].payload.name).toBe('凯尔希')
    expect(req[0].payload.voice?.tone).toBe('温和')
    expect(req[0].payload.voice?.catchphrases).toEqual(['嗯。', '好的。'])
    expect(req[0].payload.voice?.taboos).toEqual(['卖萌'])
    expect(req[0].payload.voice?.examples).toEqual([
      { plain: '任务完成。', styled: '任务完成，博士。' },
      { plain: '报错了。', styled: '……出现偏差。' },
    ])

    const listCallsBefore = transport.ofType('persona_list_request').length
    transport.emit(envelope('persona_update_response', { personaId: "kal'tsit", ok: true }, 'settings:persona-update'))
    expect(screen.getByTestId('settings-notice').textContent).toContain('已保存')
    // 保存成功后重新拉取 persona 列表（显示深合并后的真实值）
    expect(transport.ofType('persona_list_request').length).toBe(listCallsBefore + 1)
  })

  it('保存失败显示错误提示', () => {
    const transport = setup()
    fireEvent.click(screen.getByTestId('vf-save'))
    transport.emit(
      envelope('persona_update_response', { personaId: "kal'tsit", ok: false, error: '磁盘只读' }, 'settings:persona-update'),
    )
    expect(screen.getByTestId('settings-notice').textContent).toContain('磁盘只读')
  })

  it('展示模式与默认角色下拉 → settings_update_request 写回', () => {
    const transport = setup()
    fireEvent.change(screen.getByTestId('display-mobile'), { target: { value: 'live2d' } })
    fireEvent.change(screen.getByTestId('default-persona'), { target: { value: 'my_char' } })

    const writes = transport.ofType('settings_update_request')
    expect(writes).toHaveLength(2)
    expect(writes[0].payload).toEqual({ key: 'character.display.mobile', value: 'live2d' })
    expect(writes[1].payload).toEqual({ key: 'persona.default', value: 'my_char' })
    // 乐观更新本地显示
    expect((screen.getByTestId('display-mobile') as HTMLSelectElement).value).toBe('live2d')
  })

  it('「AI 助手与模型」区：挂载发 adapter_list_request；不支持选模型的助手标注且无输入框', () => {
    const transport = setup()
    expect(transport.ofType('adapter_list_request')).toHaveLength(1)
    transport.emit(
      envelope(
        'adapter_list_response',
        {
          adapters: [
            { id: 'kimi_cli', command: 'kimi', installed: true, supportsModel: false, model: '' },
            { id: 'claude_cli', command: 'claude', installed: true, supportsModel: true, model: 'claude-sonnet-4-5' },
            { id: 'codex_cli', command: 'codex', installed: true, supportsModel: false, model: '' },
          ],
          defaultAdapterId: 'kimi_cli',
        },
        'settings:adapter-list',
      ),
    )
    // 默认助手徽标；supportsModel=false（kimi/codex）标注「该助手不支持选模型」
    expect(screen.getByTestId('adapter-default-badge-kimi_cli')).toBeTruthy()
    expect(screen.getByTestId('adapter-model-unsupported-kimi_cli').textContent).toContain('该助手不支持选模型')
    expect(screen.getByTestId('adapter-model-unsupported-codex_cli')).toBeTruthy()
    expect(screen.queryByTestId('adapter-model-input-codex_cli')).toBeNull()
    // 支持的助手有输入框并回填当前模型
    expect((screen.getByTestId('adapter-model-input-claude_cli') as HTMLInputElement).value).toBe('claude-sonnet-4-5')
  })

  it('模型输入框保存 → adapter_model_update_request（去空白）；成功后刷新清单并提示', () => {
    const transport = setup()
    transport.emit(
      envelope(
        'adapter_list_response',
        {
          adapters: [
            { id: 'claude_cli', command: 'claude', installed: true, supportsModel: true, model: '' },
          ],
          defaultAdapterId: 'claude_cli',
        },
        'settings:adapter-list',
      ),
    )
    const input = screen.getByTestId('adapter-model-input-claude_cli') as HTMLInputElement
    // 未改动时保存按钮禁用
    expect((screen.getByTestId('adapter-model-save-claude_cli') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: ' claude-sonnet-4-5 ' } })
    fireEvent.click(screen.getByTestId('adapter-model-save-claude_cli'))

    const req = transport.ofType('adapter_model_update_request')
    expect(req).toHaveLength(1)
    expect(req[0].payload).toEqual({ adapterId: 'claude_cli', model: 'claude-sonnet-4-5' })

    const listCallsBefore = transport.ofType('adapter_list_request').length
    transport.emit(
      envelope('adapter_model_update_response', { adapterId: 'claude_cli', ok: true }, 'settings:adapter-model-update'),
    )
    expect(screen.getByTestId('settings-notice').textContent).toContain('已保存')
    // 保存成功后重新拉取清单（显示 settings.json 真实值）
    expect(transport.ofType('adapter_list_request').length).toBe(listCallsBefore + 1)
  })

  it('模型保存失败显示错误提示', () => {
    const transport = setup()
    transport.emit(
      envelope(
        'adapter_list_response',
        {
          adapters: [
            { id: 'claude_cli', command: 'claude', installed: true, supportsModel: true, model: '' },
          ],
          defaultAdapterId: 'claude_cli',
        },
        'settings:adapter-list',
      ),
    )
    fireEvent.change(screen.getByTestId('adapter-model-input-claude_cli'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('adapter-model-save-claude_cli'))
    transport.emit(
      envelope(
        'adapter_model_update_response',
        { adapterId: 'claude_cli', ok: false, error: '配置只读' },
        'settings:adapter-model-update',
      ),
    )
    expect(screen.getByTestId('settings-notice').textContent).toContain('配置只读')
  })
})
