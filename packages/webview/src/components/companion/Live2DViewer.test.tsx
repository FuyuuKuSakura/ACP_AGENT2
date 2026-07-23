// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Live2DHandle } from '../../live2d-viewer.js'
import { isLive2DRuntimeReady, loadLive2D } from '../../live2d-viewer.js'
import { Live2DViewer } from './Live2DViewer.js'
import type { Live2DConfig } from './config.js'

// Live2DViewer 本身 mock pixi 加载层（live2d-viewer.ts），不触达真实 pixi
vi.mock('../../live2d-viewer.js', () => ({
  isLive2DRuntimeReady: vi.fn(() => true),
  loadLive2D: vi.fn(),
}))

const mockLoadLive2D = vi.mocked(loadLive2D)
const mockRuntimeReady = vi.mocked(isLive2DRuntimeReady)

function fakeHandle(): Live2DHandle {
  return {
    app: {},
    model: {},
    expressions: new Set(['微笑', '惊讶']),
    motions: new Set(['Idle']),
    playExpression: vi.fn(async () => true),
    playMotion: vi.fn(async () => true),
    resize: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Live2DHandle
}

const LIVE2D: Live2DConfig = {
  expressions: { happy: '微笑' },
  motions: { idle: 'Idle' },
  defaultExpression: '原皮',
  expressionFiles: [],
  motionFiles: [],
}

/** jsdom 无布局：stub 容器矩形以支撑命中判定 */
function stubRect(el: HTMLElement, height = 200): void {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: 100, height, bottom: height, right: 100 }) as DOMRect
}

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mockRuntimeReady.mockReturnValue(true)
})

describe('Live2DViewer', () => {
  it('加载模型并回调 onReady；卸载时 destroy', async () => {
    const handle = fakeHandle()
    mockLoadLive2D.mockResolvedValue(handle)
    const onReady = vi.fn()
    const { unmount } = render(
      <Live2DViewer modelUrl="https://cdn/m.model3.json" live2d={LIVE2D} onReady={onReady} />,
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(handle))
    expect(mockLoadLive2D).toHaveBeenCalledWith(expect.any(HTMLElement), {
      modelUrl: 'https://cdn/m.model3.json',
      expressionFiles: [],
      motionFiles: [],
      scale: undefined,
    })
    unmount()
    expect(handle.destroy).toHaveBeenCalled()
    expect(onReady).toHaveBeenLastCalledWith(null)
  })

  it('emotion_update：payload 已解析的 expression/motion 优先播放', async () => {
    const handle = fakeHandle()
    mockLoadLive2D.mockResolvedValue(handle)
    render(
      <Live2DViewer
        modelUrl="https://cdn/m.model3.json"
        live2d={LIVE2D}
        emotion={{ emotion: 'happy', expression: '惊讶', motion: 'Idle' }}
      />,
    )
    await waitFor(() => expect(handle.playExpression).toHaveBeenCalledWith('惊讶'))
    expect(handle.playMotion).toHaveBeenCalledWith('Idle')
  })

  it('emotion_update 缺 expression 字段时回退 persona live2d 映射', async () => {
    const handle = fakeHandle()
    mockLoadLive2D.mockResolvedValue(handle)
    render(
      <Live2DViewer
        modelUrl="https://cdn/m.model3.json"
        live2d={LIVE2D}
        emotion={{ emotion: 'happy' }}
      />,
    )
    await waitFor(() => expect(handle.playExpression).toHaveBeenCalledWith('微笑'))
    expect(handle.playMotion).toHaveBeenCalledWith('Idle')
  })

  it('触摸命中：上半区 head、下半区 body', async () => {
    mockLoadLive2D.mockResolvedValue(fakeHandle())
    const onTouchZone = vi.fn()
    render(
      <Live2DViewer
        modelUrl="https://cdn/m.model3.json"
        live2d={LIVE2D}
        onTouchZone={onTouchZone}
      />,
    )
    const el = screen.getByTestId('live2d-viewer')
    stubRect(el, 200)
    // jsdom 无 PointerEvent 构造器：用 MouseEvent 模拟 pointerdown 以携带 clientY
    fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientY: 40 }))
    expect(onTouchZone).toHaveBeenLastCalledWith('head')
    fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientY: 160 }))
    expect(onTouchZone).toHaveBeenLastCalledWith('body')
  })

  it('加载失败经 onError 上报（宿主降级静态立绘）', async () => {
    mockLoadLive2D.mockRejectedValue(new Error('moc3 404'))
    const onError = vi.fn()
    render(
      <Live2DViewer modelUrl="https://cdn/m.model3.json" live2d={LIVE2D} onError={onError} />,
    )
    await waitFor(() => expect(onError).toHaveBeenCalled())
  })

  it('Live2DCubismCore 未注入时立即 onError，不发起加载', () => {
    mockRuntimeReady.mockReturnValue(false)
    const onError = vi.fn()
    render(
      <Live2DViewer modelUrl="https://cdn/m.model3.json" live2d={LIVE2D} onError={onError} />,
    )
    expect(onError).toHaveBeenCalled()
    expect(mockLoadLive2D).not.toHaveBeenCalled()
  })
})
