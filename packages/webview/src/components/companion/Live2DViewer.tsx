/**
 * Live2DViewer — Live2D 陪伴区的 React 封装（pixi 加载在 live2d-viewer.ts，
 * 测试 mock 该模块即可，组件本身不感知 pixi）。
 *
 * - 模型加载：modelUrl 变化时重建；加载失败经 onError 上报（宿主降级静态立绘）；
 * - emotion_update 驱动：emotion.expression/motion（core 已按 persona 映射解析）
 *   优先，缺省回退 persona live2d.expressions/motions 映射；模型无对应资源时
 *   加载器静默跳过；
 * - 触摸（ADR-16 纯前端）：pointer 命中按上下半区判定 head/body，经
 *   onTouchZone 上报，选句/播表情由宿主决定。
 */
import { useEffect, useRef, useState } from 'react'

import type { EmotionState } from '@dionysus/client-core'

import type { Live2DHandle } from '../../live2d-viewer.js'
import { isLive2DRuntimeReady, loadLive2D } from '../../live2d-viewer.js'
import type { Live2DConfig } from './config.js'
import { hitZoneFromPoint } from './touch.js'
import type { TouchZoneName } from './touch.js'

export interface Live2DViewerProps {
  /** asWebviewUri 解析后的 model3.json URL */
  modelUrl: string
  /** persona live2d 段（表情/动作映射 + 显式文件清单回退） */
  live2d: Live2DConfig
  /** 当前情绪（emotion_update 驱动表情/动作切换） */
  emotion?: EmotionState | null
  /** 加载失败（宿主降级 static + console.warn） */
  onError?: (err: unknown) => void
  /** 触摸命中区域（head/body） */
  onTouchZone?: (zone: TouchZoneName) => void
  /** 加载完成回调（宿主持有 handle 用于触摸播表情）；卸载时回调 null */
  onReady?: (handle: Live2DHandle | null) => void
}

export function Live2DViewer({
  modelUrl,
  live2d,
  emotion,
  onError,
  onTouchZone,
  onReady,
}: Live2DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<Live2DHandle | null>(null)
  const [ready, setReady] = useState(false)

  // 加载模型（modelUrl 变化重建）。onError/onReady 经 ref 避免触发重载循环。
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let handle: Live2DHandle | null = null

    if (!isLive2DRuntimeReady()) {
      onErrorRef.current?.(new Error('Live2DCubismCore 未加载'))
      return
    }

    loadLive2D(container, {
      modelUrl,
      expressionFiles: live2d.expressionFiles,
      motionFiles: live2d.motionFiles,
      scale: live2d.scale,
    })
      .then((h) => {
        if (cancelled) {
          h.destroy()
          return
        }
        handle = h
        handleRef.current = h
        setReady(true)
        onReadyRef.current?.(h)
      })
      .catch((err) => {
        if (!cancelled) onErrorRef.current?.(err)
      })

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect
            if (rect) handleRef.current?.resize(rect.width, rect.height)
          })
        : null
    observer?.observe(container)

    return () => {
      cancelled = true
      observer?.disconnect()
      handle?.destroy()
      handleRef.current = null
      setReady(false)
      onReadyRef.current?.(null)
    }
    // live2d 配置随 persona 切换整体变化，与 modelUrl 同步重建
  }, [modelUrl, live2d])

  // emotion_update → 表情/动作切换（ready 后应用；payload 已按 persona 解析，缺省回退映射）
  useEffect(() => {
    const handle = handleRef.current
    if (!ready || !handle || !emotion) return
    const expression =
      emotion.expression ?? live2d.expressions[emotion.emotion] ?? live2d.defaultExpression
    const motion = emotion.motion ?? live2d.motions[emotion.emotion] ?? live2d.motions['idle']
    void handle.playExpression(expression)
    void handle.playMotion(motion)
  }, [ready, emotion, live2d])

  return (
    <div
      ref={containerRef}
      data-testid="live2d-viewer"
      className="h-full w-full"
      onPointerDown={(e) => {
        if (!onTouchZone) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (rect.height <= 0) return
        onTouchZone(hitZoneFromPoint((e.clientY - rect.top) / rect.height))
      }}
    />
  )
}
