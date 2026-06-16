import { useEffect, useRef, useState, useCallback } from 'react'
import * as PIXI from 'pixi.js'
import { Application, settings, ENV, BatchRenderer } from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { useMouseTracking } from '@/hooks/useMouseTracking'
import { useLive2DStore } from '@/stores/live2dStore'
import { useChatStore } from '@/stores/chatStore'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'

interface Live2DViewerProps {
  enabled?: boolean
  className?: string
}

const DEFAULT_MODEL_URL = '/exusiai_live2d/00.model3.json'
const PLACEHOLDER_URL = '/exusiai_idle.webm'
const DEFAULT_EXPRESSION = '原皮'
const IDLE_MOTION_GROUP = 'Idle'
const CLICK_COOLDOWN_MS = 600

// Pixi's batch renderer can break on certain WebGL contexts that report 0 texture
// units (observed in headless Chromium and some Safari configs). Live2D only needs
// a single texture, so forcing legacy WebGL avoids the problem entirely.
settings.PREFER_ENV = ENV.WEBGL_LEGACY
BatchRenderer.defaultMaxTextures = 1

const HEAD_LINES = ['老板？', '看这里～']
const BODY_LINES = ['嘿嘿～', '呀吼～']

const PRESENCE_DOT_COLORS: Record<
  ReturnType<typeof useLive2DStore.getState>['presenceState'],
  string
> = {
  idle: 'bg-gray-400',
  listening: 'bg-blue-400',
  thinking: 'bg-yellow-400',
  working: 'bg-purple-400',
  success: 'bg-green-400',
  error: 'bg-red-500',
  sleeping: 'bg-indigo-300',
}

export default function Live2DViewer({
  enabled = true,
  className = '',
}: Live2DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const modelRef = useRef<Live2DModel | null>(null)
  const expressionMapRef = useRef<Map<string, number>>(new Map())
  const motionGroupMapRef = useRef<Map<string, string[]>>(new Map())
  const lastClickAtRef = useRef(0)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [modelUrl, setModelUrl] = useState(DEFAULT_MODEL_URL)

  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const personaId =
    useChatStore((state) =>
      state.sessions.find((s) => s.id === currentSessionId)?.persona_id,
    ) ?? 'exusiai'

  useEffect(() => {
    fetch(`/api/personas/${personaId}/companion`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const path = data?.model_path
        if (path) {
          setModelUrl(path)
        }
      })
      .catch(() => {
        // Keep default model URL on error.
      })
  }, [personaId])

  const {
    trackingEnabled,
    lookAtTarget,
    clearLookAtTarget,
    presenceState,
    pendingExpression,
    pendingMotion,
    clearPendingExpression,
    clearPendingMotion,
    bumpActivity,
  } = useLive2DStore()

  useEffect(() => {
    if (!lookAtTarget) return
    if (Date.now() >= lookAtTarget.expiresAt) {
      clearLookAtTarget()
      return
    }
    const timer = setTimeout(() => {
      clearLookAtTarget()
    }, lookAtTarget.expiresAt - Date.now())
    return () => clearTimeout(timer)
  }, [lookAtTarget, clearLookAtTarget])

  const effectiveEnabled = enabled && trackingEnabled

  const { x, y, params } = useMouseTracking(containerRef, {
    enabled: effectiveEnabled,
    targetX: lookAtTarget?.x ?? null,
    targetY: lookAtTarget?.y ?? null,
    smooth: 0.15,
    maxAngle: 30,
  })

  const handleRetry = useCallback(() => {
    setError(null)
    setLoading(true)
    setRetryKey((k) => k + 1)
  }, [])

  // Initialize Pixi application and load Live2D model.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let resizeObserver: ResizeObserver | null = null

    const init = async () => {
      try {
        const { width, height } = container.getBoundingClientRect()
        const app = new Application({
          width: Math.max(1, width),
          height: Math.max(1, height),
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        })
        appRef.current = app

        // Make sure the renderer canvas is part of the DOM and styled correctly.
        const view = app.view as HTMLCanvasElement
        view.className = `absolute inset-0 h-full w-full touch-none ${enabled ? 'opacity-100' : 'opacity-30'}`
        view.style.cssText = 'display: block; width: 100%; height: 100%;'
        if (view.parentElement !== container) {
          container.appendChild(view)
        }

        // Expose globals for debugging and for pixi-live2d-display internals.
        ;(window as unknown as Record<string, unknown>).PIXI = PIXI
        ;(window as unknown as Record<string, unknown>).__pixiLive2D = Live2DModel
        ;(window as unknown as Record<string, unknown>).__live2dApp = app
        ;(window as unknown as Record<string, unknown>).__live2dModel = null

        const model = (await Live2DModel.from(encodeURI(modelUrl), {
          autoInteract: false,
          autoUpdate: true,
        })) as Live2DModel

        if (cancelled) {
          try {
            model.destroy()
            app.destroy(true, { children: true })
          } catch {
            // Ignore destroy-time errors from Pixi resize plugin internals.
          }
          return
        }

        modelRef.current = model
        ;(window as unknown as Record<string, unknown>).__live2dModel = model
        app.stage.addChild(model)

        // Build maps for debugging/fallback.
        expressionMapRef.current = new Map()
        motionGroupMapRef.current = new Map()
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const settingsAny = (model as any).settings
          const expressions: Array<{ Name?: string; name?: string; File?: string; file?: string }> =
            settingsAny?.expressions ?? []
          expressions.forEach((expr, index) => {
            const name = expr.Name ?? expr.name
            if (name) {
              expressionMapRef.current.set(name, index)
            } else {
              const file = expr.File ?? expr.file ?? ''
              const base = file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
              if (base) expressionMapRef.current.set(base, index)
            }
          })

          const motions: Record<string, unknown[]> = settingsAny?.motions ?? {}
          Object.entries(motions).forEach(([group, files]) => {
            motionGroupMapRef.current.set(group, Array.isArray(files) ? files.map((f) => String(f)) : [])
          })
        } catch (mapErr) {
          console.warn('[Live2D] failed to build settings maps:', mapErr)
        }

        // Start a gentle idle motion/expression so the model is never stuck on a blank frame.
        try {
          if (motionGroupMapRef.current.has(IDLE_MOTION_GROUP)) {
            model.motion(IDLE_MOTION_GROUP)
          } else {
            model.motion('Idle')
          }
        } catch {
          // Some models may not have an Idle group; ignore.
        }
        try {
          if (expressionMapRef.current.has(DEFAULT_EXPRESSION)) {
            model.expression(DEFAULT_EXPRESSION)
          } else {
            model.expression(0)
          }
        } catch {
          // Ignore missing expression.
        }

        const resizeModel = () => {
          if (!model || !app) return
          const scale = Math.min(
            app.screen.width / 1600,
            app.screen.height / 1800,
          )
          model.scale.set(Math.max(0.2, scale))
          model.anchor.set(0.5, 0.5)
          model.x = app.screen.width / 2
          model.y = app.screen.height / 2 + app.screen.height * 0.1
        }

        resizeModel()

        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (!entry) return
          const { width: w, height: h } = entry.contentRect
          app.renderer.resize(Math.max(1, w), Math.max(1, h))
          resizeModel()
        })
        resizeObserver.observe(container)

        setLoading(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const stack = err instanceof Error ? err.stack : ''
        console.error('[Live2D] init failed:', message, stack)
        setError(message)
        setLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      try {
        modelRef.current?.destroy()
        appRef.current?.destroy(true, { children: true })
        const view = appRef.current?.view as HTMLCanvasElement | undefined
        if (view && view.parentElement === container) {
          container.removeChild(view)
        }
      } catch {
        // Ignore destroy-time errors from Pixi resize plugin internals.
      }
      modelRef.current = null
      appRef.current = null
    }
  }, [retryKey, enabled, modelUrl])

  // Drive model parameters from mouse tracking output.
  useEffect(() => {
    const model = modelRef.current
    if (!model || !model.internalModel) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = model.internalModel.coreModel as any
    if (typeof core.setParameterValueById !== 'function') return

    core.setParameterValueById('ParamAngleX', params.ParamAngleX)
    core.setParameterValueById('ParamAngleY', params.ParamAngleY)
    core.setParameterValueById('ParamEyeBallX', params.ParamEyeBallX)
    core.setParameterValueById('ParamEyeBallY', params.ParamEyeBallY)
  }, [x, y, params])

  // Apply queued expression requests.
  useEffect(() => {
    const model = modelRef.current
    if (!model || !pendingExpression) return
    try {
      if (expressionMapRef.current.has(pendingExpression)) {
        const index = expressionMapRef.current.get(pendingExpression)
        if (typeof index === 'number') {
          model.expression(index)
        } else {
          model.expression(pendingExpression)
        }
      } else {
        model.expression(pendingExpression)
      }
    } catch (err) {
      console.warn('[Live2D] expression failed:', pendingExpression, err)
    }
    clearPendingExpression()
  }, [pendingExpression, clearPendingExpression])

  // Apply queued motion requests.
  useEffect(() => {
    const model = modelRef.current
    if (!model || !pendingMotion) return
    try {
      if (motionGroupMapRef.current.has(pendingMotion)) {
        model.motion(pendingMotion)
      } else {
        model.motion(pendingMotion)
      }
    } catch (err) {
      console.warn('[Live2D] motion failed:', pendingMotion, err)
    }
    clearPendingMotion()
  }, [pendingMotion, clearPendingMotion])

  // Pause/resume ticker and fade canvas when disabled to save resources.
  useEffect(() => {
    const app = appRef.current
    if (!app) return
    if (enabled) {
      app.start()
    } else {
      app.stop()
    }
    const view = app.view as HTMLCanvasElement
    view.classList.toggle('opacity-100', enabled)
    view.classList.toggle('opacity-30', !enabled)
  }, [enabled])

  const handleInteraction = useCallback(
    (_clientX: number, clientY: number) => {
      const container = containerRef.current
      if (!container) return

      const now = Date.now()
      if (now - lastClickAtRef.current < CLICK_COOLDOWN_MS) return
      lastClickAtRef.current = now

      const rect = container.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      const halfHeight = Math.max(rect.height / 2, 1)

      const normY = -(clientY - centerY) / halfHeight

      const isHead = normY > 0.35
      const expressionName = isHead ? '？' : '脸红'
      const lines = isHead ? HEAD_LINES : BODY_LINES
      const line = lines[Math.floor(Math.random() * lines.length)]

      useChatStore.getState().setCompanionLine(line)
      useLive2DStore.getState().requestExpression(expressionName)
      bumpActivity()
    },
    [bumpActivity],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      handleInteraction(event.clientX, event.clientY)
    },
    [handleInteraction],
  )

  const showPlaceholder = !loading && (!!error || !modelRef.current)

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden ${className}`}
      aria-label="Live2D 预览区域"
    >
      {loading && (
        <div className="z-10 flex flex-col items-center gap-3 text-sm text-dionysus-text-secondary">
          <Loader2 className="h-6 w-6 animate-spin text-dionysus-primary" />
          <span>正在加载 Live2D 模型…</span>
        </div>
      )}

      {showPlaceholder && (
        <div className="z-10 flex flex-col items-center gap-4 px-6 text-center">
          <video
            src={PLACEHOLDER_URL}
            autoPlay
            muted
            loop
            playsInline
            className="h-80 max-h-[50vh] w-auto rounded-2xl object-cover opacity-95 shadow-lg"
          />
          {error && (
            <div className="flex max-w-[80%] items-center gap-2 rounded-lg border border-dionysus-danger/30 bg-dionysus-danger/10 px-3 py-2 text-xs text-dionysus-danger">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">Live2D 加载失败</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-2 rounded-full bg-dionysus-primary px-4 py-2 text-sm font-medium text-white shadow-md hover:bg-dionysus-primary-hover active:translate-y-px"
          >
            <RefreshCw className="h-4 w-4" />
            重试加载
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="absolute bottom-2 left-3 z-10 flex items-center gap-1.5 text-xs text-dionysus-text-secondary">
          <span
            className={`h-2 w-2 rounded-full ${effectiveEnabled ? 'bg-dionysus-success' : 'bg-dionysus-system'}`}
          />
          <span>{effectiveEnabled ? '鼠标跟踪中' : '跟踪已暂停'}</span>
        </div>
      )}

      {lookAtTarget && (
        <div className="absolute right-3 top-2 z-10 rounded-full bg-dionysus-primary/10 px-2 py-0.5 text-[10px] font-medium text-dionysus-primary">
          look_at
        </div>
      )}

      {!loading && !error && (
        <div
          className="absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-full border border-dionysus-glass-border bg-dionysus-panel-bg/80 px-2 py-0.5 text-[10px] font-medium text-dionysus-text-secondary backdrop-blur-sm"
          title={`状态: ${presenceState}`}
        >
          <span className={`h-2 w-2 rounded-full ${PRESENCE_DOT_COLORS[presenceState]}`} />
          <span>{presenceState}</span>
        </div>
      )}
    </div>
  )
}
