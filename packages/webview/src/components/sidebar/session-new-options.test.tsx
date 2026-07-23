// @vitest-environment jsdom
/**
 * sidebar 新建会话「选项」面板 + 列表项「助手 · 角色」title 测试：
 * - 「选项」面板：打开拉 adapter_list；助手/角色下拉（默认 = 跟随全局设置），
 *   选择后随 new_session payload 发出（会话创建时绑定）；
 * - 模型：支持选模型的助手显示输入框（datalist 建议），值写入全局
 *   dionysus.adapters.<id>.model（adapter_model_update_request，不随会话）；
 *   与当前配置相同 / supportsModel=false 时不发；
 * - 列表项 title：digest.adapterId + session_list 的 personaId（经 persona_list
 *   解析显示名）拼「助手：xxx · 角色：xxx」。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useDigestStore } from '@dionysus/client-core'
import type { SessionDigestUpdatePayload } from '@dionysus/protocol'

import SidebarApp from './index.js'
import { FakeTransport, resetAllStores } from '../chat/testUtils.js'

const NOW = 1_000_000_000_000

function digest(
  partial: Partial<SessionDigestUpdatePayload> & { sessionId: string },
): SessionDigestUpdatePayload {
  return {
    title: partial.sessionId,
    status: 'idle',
    pendingOptionRequest: false,
    lastActivityAt: NOW,
    seq: 1,
    ...partial,
  }
}

function emitAdapterList(transport: FakeTransport) {
  act(() => {
    transport.emit({
      v: 1,
      type: 'adapter_list_response',
      traceId: 'sidebar:adapter-list',
      ts: Date.now(),
      payload: {
        adapters: [
          { id: 'kimi_cli', command: 'kimi', installed: true, supportsModel: false, model: '' },
          { id: 'claude_cli', command: 'claude', installed: true, supportsModel: true, model: '' },
        ],
        defaultAdapterId: 'kimi_cli',
      },
    })
  })
}

function emitPersonaList(transport: FakeTransport) {
  act(() => {
    transport.emit({
      v: 1,
      type: 'persona_list_response',
      traceId: 'sidebar:persona-list',
      ts: Date.now(),
      payload: {
        personas: [
          {
            id: "kal'tsit",
            name: '凯尔希',
            description: '',
            voice: { tone: '', catchphrases: [], taboos: [], examples: [], rewriterPrompt: '' },
            touchZones: {},
          },
        ],
      },
    })
  })
}

beforeEach(() => {
  resetAllStores()
})
afterEach(cleanup)

describe('新建会话「选项」面板', () => {
  it('打开发 adapter_list_request；默认选项 = 跟随全局默认助手/角色', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-options-button'))
    expect(transport.ofType('adapter_list_request')).toHaveLength(1)

    emitAdapterList(transport)
    emitPersonaList(transport)
    const adapterSelect = screen.getByTestId('new-session-adapter-select') as HTMLSelectElement
    expect(adapterSelect.value).toBe('')
    expect(adapterSelect.querySelector('option')!.textContent).toContain('默认（kimi_cli）')
    const personaSelect = screen.getByTestId('new-session-persona-select') as HTMLSelectElement
    expect(personaSelect.value).toBe('')
    expect(personaSelect.textContent).toContain("凯尔希（kal'tsit）")
  })

  it('选择助手与角色 → new_session payload 携带 adapterId/personaId', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-options-button'))
    emitAdapterList(transport)
    emitPersonaList(transport)
    fireEvent.change(screen.getByTestId('new-session-adapter-select'), { target: { value: 'claude_cli' } })
    fireEvent.change(screen.getByTestId('new-session-persona-select'), { target: { value: "kal'tsit" } })
    fireEvent.click(screen.getByTestId('new-session-options-submit'))

    const msgs = transport.ofType('new_session')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].payload).toEqual({ adapterId: 'claude_cli', personaId: "kal'tsit" })
    // 提交后面板关闭并复位
    expect(screen.queryByTestId('new-session-options-panel')).toBeNull()
  })

  it('全默认提交 → new_session 不带 adapterId/personaId（跟随全局默认）', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-options-button'))
    emitAdapterList(transport)
    fireEvent.click(screen.getByTestId('new-session-options-submit'))
    expect(transport.ofType('new_session')[0].payload).toEqual({})
  })

  it('模型：写入全局配置（adapter_model_update_request）；与当前配置相同则不发', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-options-button'))
    emitAdapterList(transport)
    fireEvent.change(screen.getByTestId('new-session-adapter-select'), { target: { value: 'claude_cli' } })
    fireEvent.change(screen.getByTestId('new-session-model-input'), { target: { value: 'claude-sonnet-4-5' } })
    fireEvent.click(screen.getByTestId('new-session-options-submit'))

    const modelWrites = transport.ofType('adapter_model_update_request')
    expect(modelWrites).toHaveLength(1)
    expect(modelWrites[0].payload).toEqual({ adapterId: 'claude_cli', model: 'claude-sonnet-4-5' })
    expect(transport.ofType('new_session')).toHaveLength(1)
  })

  it('supportsModel=false 的助手显示「该助手不支持选模型」，无模型输入框', () => {
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    fireEvent.click(screen.getByTestId('new-session-options-button'))
    emitAdapterList(transport)
    // 默认助手 kimi_cli（supportsModel=false）
    expect(screen.getByTestId('new-session-model-unsupported').textContent).toContain('该助手不支持选模型')
    expect(screen.queryByTestId('new-session-model-input')).toBeNull()
    // 切到 claude_cli 后出现输入框
    fireEvent.change(screen.getByTestId('new-session-adapter-select'), { target: { value: 'claude_cli' } })
    expect(screen.getByTestId('new-session-model-input')).toBeTruthy()
  })
})

describe('列表项「助手 · 角色」title', () => {
  it('digest.adapterId + session_list personaId（persona_list 解析显示名）拼进 title', () => {
    useDigestStore.getState().upsertDigest(
      digest({ sessionId: 's1', adapterId: 'kimi_cli', workingDir: '/proj/a' }),
    )
    const transport = new FakeTransport()
    render(<SidebarApp now={NOW} transport={transport} />)

    // 会话集合非空 → 自动拉 session_list
    expect(transport.ofType('session_list_request')).toHaveLength(1)
    emitPersonaList(transport)
    act(() => {
      transport.emit({
        v: 1,
        type: 'session_list_response',
        traceId: 'sidebar:session-list',
        ts: Date.now(),
        payload: {
          sessions: [
            { id: 's1', title: '重构 auth', personaId: "kal'tsit", status: 'idle', updatedAt: NOW, unreadCount: 0 },
          ],
        },
      })
    })

    const title = screen.getByTestId('session-item-s1').getAttribute('title')
    expect(title).toBe('助手：kimi_cli · 角色：凯尔希\n工作目录：/proj/a')
  })
})
