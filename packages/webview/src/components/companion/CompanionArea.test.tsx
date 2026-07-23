// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCompanionStore, useSessionStore, useSettingsStore } from '@dionysus/client-core'

import type { Live2DHandle } from '../../live2d-viewer.js'
import { loadLive2D } from '../../live2d-viewer.js'
import { CompanionArea } from './CompanionArea.js'
import { DEFAULT_COMPANION_CONFIG, useCompanionConfigStore } from './config.js'
import type { CompanionConfig } from './config.js'

vi.mock('../../live2d-viewer.js', () => ({
  isLive2DRuntimeReady: vi.fn(() => true),
  loadLive2D: vi.fn(),
}))

const mockLoadLive2D = vi.mocked(loadLive2D)

function fakeHandle(): Live2DHandle {
  return {
    app: {},
    model: {},
    expressions: new Set(['惊讶']),
    motions: new Set(),
    playExpression: vi.fn(async () => true),
    playMotion: vi.fn(async () => true),
    resize: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Live2DHandle
}

function configWith(overrides: Partial<CompanionConfig>): CompanionConfig {
  return { ...DEFAULT_COMPANION_CONFIG, ...overrides }
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  useCompanionStore.getState().reset()
  useSettingsStore.getState().reset()
  useCompanionConfigStore.getState().reset()
  useSessionStore.getState().reset()
  mockLoadLive2D.mockResolvedValue(fakeHandle())
})

describe('CompanionArea 展示模式分流', () => {
  it("displayMode='live2d' 且有模型 URL → Live2DViewer", async () => {
    useCompanionConfigStore
      .getState()
      .setConfig(configWith({ modelUrl: 'https://cdn/m.model3.json' }))
    render(<CompanionArea />)
    expect(screen.getByTestId('live2d-viewer')).toBeTruthy()
    await waitFor(() => expect(mockLoadLive2D).toHaveBeenCalled())
  })

  it("displayMode='static' → StaticPortrait（即使有 live2d 素材）", () => {
    useSettingsStore.getState().setDisplayMode('static')
    useCompanionConfigStore
      .getState()
      .setConfig(
        configWith({
          modelUrl: 'https://cdn/m.model3.json',
          portraitUrls: { default: 'https://cdn/p.png' },
        }),
      )
    render(<CompanionArea />)
    expect(screen.getByTestId('static-portrait')).toBeTruthy()
    expect(screen.queryByTestId('live2d-viewer')).toBeNull()
    expect(mockLoadLive2D).not.toHaveBeenCalled()
  })

  it("displayMode='live2d' 但无模型 URL → 静态立绘兜底", () => {
    render(<CompanionArea />)
    expect(screen.getByTestId('static-portrait')).toBeTruthy()
    expect(mockLoadLive2D).not.toHaveBeenCalled()
  })

  it('Live2D 加载失败自动降级 static 并 console.warn', async () => {
    mockLoadLive2D.mockRejectedValue(new Error('moc3 404'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useCompanionConfigStore
      .getState()
      .setConfig(
        configWith({
          modelUrl: 'https://cdn/m.model3.json',
          portraitUrls: { default: 'https://cdn/p.png' },
        }),
      )
    render(<CompanionArea />)
    await waitFor(() => expect(screen.getByTestId('static-portrait')).toBeTruthy())
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Live2D 加载失败'),
      expect.any(Error),
    )
    warn.mockRestore()
  })
})

describe('CompanionArea 触摸互动（ADR-16 纯前端）', () => {
  it('点击模型头部 → 本地选句进气泡 + 播对应 expression', async () => {
    const handle = fakeHandle()
    mockLoadLive2D.mockResolvedValue(handle)
    useCompanionConfigStore.getState().setConfig(
      configWith({
        modelUrl: 'https://cdn/m.model3.json',
        touchZones: {
          head: { expression: '惊讶', lines: ['博士，有事吗？'] },
          body: { lines: ['……请注意分寸。'] },
        },
      }),
    )
    render(<CompanionArea />)
    const viewer = screen.getByTestId('live2d-viewer')
    await waitFor(() => expect(mockLoadLive2D).toHaveBeenCalled())
    viewer.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 100, height: 200, bottom: 200, right: 100 }) as DOMRect

    // jsdom 无 PointerEvent 构造器：用 MouseEvent 模拟 pointerdown 以携带 clientY
    fireEvent(viewer, new MouseEvent('pointerdown', { bubbles: true, clientY: 30 }))
    await waitFor(() =>
      expect(useCompanionStore.getState().lines.map((l) => l.text)).toContain('博士，有事吗？'),
    )
    await waitFor(() => expect(handle.playExpression).toHaveBeenCalledWith('惊讶'))

    fireEvent(viewer, new MouseEvent('pointerdown', { bubbles: true, clientY: 150 }))
    await waitFor(() =>
      expect(useCompanionStore.getState().lines.map((l) => l.text)).toContain('……请注意分寸。'),
    )
  })

  it('touch_zones 缺失时点击无反应（容错，不抛错）', async () => {
    useCompanionConfigStore
      .getState()
      .setConfig(configWith({ modelUrl: 'https://cdn/m.model3.json' }))
    render(<CompanionArea />)
    const viewer = screen.getByTestId('live2d-viewer')
    await waitFor(() => expect(mockLoadLive2D).toHaveBeenCalled())
    viewer.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 100, height: 200, bottom: 200, right: 100 }) as DOMRect
    fireEvent(viewer, new MouseEvent('pointerdown', { bubbles: true, clientY: 30 }))
    expect(useCompanionStore.getState().lines).toHaveLength(0)
  })
})

describe('CompanionArea 底部锚定布局（设计要求 2）', () => {
  it('顶部细刻度线（endfield minimal 点缀）为陪伴区首个区块', () => {
    render(<CompanionArea />)
    const area = screen.getByTestId('companion-area')
    expect(area.firstElementChild?.className).toContain('dn-ticks')
  })

  it('角色区锚定列底且在气泡区之后；气泡区 flex-1 底部对齐', () => {
    useCompanionStore.getState().addLine({ text: '汇报', scope: 'global', ts: Date.now() })
    render(<CompanionArea />)
    const area = screen.getByTestId('companion-area')
    const stage = screen.getByTestId('companion-stage')
    const bubbles = screen.getByTestId('companion-bubbles')
    // 角色区是列的最后一个区块（锚底），不 flex 伸展、固定占列高 55%
    expect(area.lastElementChild).toBe(stage)
    expect(stage.className).toContain('shrink-0')
    expect(stage.className).toContain('h-[55%]')
    // 气泡区在角色区之上，且自身底部对齐（新句贴角色头顶）
    const bubbleRegion = bubbles.parentElement!
    expect(
      bubbleRegion.compareDocumentPosition(stage) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(bubbleRegion.className).toContain('flex-1')
    expect(bubbleRegion.className).toContain('justify-end')
  })

  it('空态（无台词/无会话）布局不变形：角色区仍锚定列底', () => {
    render(<CompanionArea />)
    const area = screen.getByTestId('companion-area')
    const stage = screen.getByTestId('companion-stage')
    expect(screen.queryByTestId('companion-bubbles')).toBeNull()
    expect(area.lastElementChild).toBe(stage)
    expect(stage.className).toContain('shrink-0')
  })
})

describe('CompanionArea 旁白气泡与情绪联动', () => {
  it('渲染 companionStore 的旁白行与来源标注，点击来源切换会话', async () => {
    useSessionStore.getState().ensureSession('s1', '重构 auth')
    useCompanionStore.getState().addLine({
      text: 'auth 重构搞定啦',
      scope: 'session',
      sourceSessionId: 's1',
      sourceTitle: '重构 auth',
      ts: Date.now(),
    })
    render(<CompanionArea />)
    expect(screen.getByText('auth 重构搞定啦')).toBeTruthy()
    fireEvent.click(screen.getByTestId('companion-bubble-source'))
    expect(useSessionStore.getState().currentSessionId).toBe('s1')
  })

  it('emotion_update 驱动静态立绘表情贴图（emotion 透传）', () => {
    useCompanionConfigStore
      .getState()
      .setConfig(configWith({ portraitUrls: { default: 'https://cdn/p.png' } }))
    useCompanionStore.getState().setEmotion({ emotion: 'worried' })
    render(<CompanionArea />)
    expect(screen.getByTestId('static-portrait-img').getAttribute('data-emotion')).toBe('worried')
  })
})
