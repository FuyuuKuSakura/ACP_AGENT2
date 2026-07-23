import { useCallback, useEffect, useRef, useState } from 'react'

export interface Live2DMouseParams {
  ParamAngleX: number
  ParamAngleY: number
  ParamEyeBallX: number
  ParamEyeBallY: number
}

export interface MouseTrackingState {
  /** Normalized X relative to container center, range [-1, 1]. */
  x: number
  /** Normalized Y relative to container center, range [-1, 1]. */
  y: number
  /** Raw mouse X in viewport coordinates. */
  rawX: number
  /** Raw mouse Y in viewport coordinates. */
  rawY: number
  /** Whether the pointer is currently inside the tracked container. */
  isInside: boolean
  /** Values mapped to standard Live2D parameters. */
  params: Live2DMouseParams
}

export interface UseMouseTrackingOptions {
  /** Enable mouse tracking. Defaults to true. */
  enabled?: boolean
  /** Smoothing factor for each frame, range (0, 1]. Lower is smoother. Defaults to 0.12. */
  smooth?: number
  /** Optional override target in normalized [-1, 1] coordinates (e.g. from backend look_at). */
  targetX?: number | null
  /** Optional override target in normalized [-1, 1] coordinates (e.g. from backend look_at). */
  targetY?: number | null
  /** Maximum head angle in degrees. Defaults to 30. */
  maxAngle?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Tracks mouse/touch position relative to a container and produces smoothed
 * normalized coordinates plus Live2D parameter values.
 *
 * When `targetX`/`targetY` are provided (e.g. from a backend `look_at`
 * action), the output smoothly blends towards the target instead of
 * following the physical pointer.
 */
export function useMouseTracking(
  ref: React.RefObject<HTMLElement>,
  options: UseMouseTrackingOptions = {},
): MouseTrackingState {
  const {
    enabled = true,
    smooth = 0.12,
    targetX = null,
    targetY = null,
    maxAngle = 30,
  } = options

  const [state, setState] = useState<MouseTrackingState>({
    x: 0,
    y: 0,
    rawX: 0,
    rawY: 0,
    isInside: false,
    params: {
      ParamAngleX: 0,
      ParamAngleY: 0,
      ParamEyeBallX: 0,
      ParamEyeBallY: 0,
    },
  })

  const stateRef = useRef(state)
  stateRef.current = state

  const targetRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)
  const isInsideRef = useRef(false)

  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const element = ref.current
      if (!element) return

      const rect = element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      const rawX = clientX - centerX
      const rawY = clientY - centerY

      const halfWidth = Math.max(rect.width / 2, 1)
      const halfHeight = Math.max(rect.height / 2, 1)

      const x = clamp(rawX / halfWidth, -1, 1)
      const y = clamp(rawY / halfHeight, -1, 1)

      targetRef.current = { x, y: -y }
      stateRef.current.rawX = clientX
      stateRef.current.rawY = clientY
    },
    [ref],
  )

  useEffect(() => {
    if (!enabled) {
      targetRef.current = { x: 0, y: 0 }
      isInsideRef.current = false
      return
    }

    const element = ref.current
    if (!element) return

    const handleMouseMove = (event: MouseEvent) => {
      updateFromPointer(event.clientX, event.clientY)
    }

    const handleMouseEnter = () => {
      isInsideRef.current = true
    }

    const handleMouseLeave = () => {
      isInsideRef.current = false
      // When leaving, gradually return to center instead of snapping.
      targetRef.current = { x: 0, y: 0 }
    }

    const handleTouchStart = (event: TouchEvent) => {
      isInsideRef.current = true
      const touch = event.touches[0]
      if (touch) {
        updateFromPointer(touch.clientX, touch.clientY)
      }
    }

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (touch) {
        updateFromPointer(touch.clientX, touch.clientY)
      }
    }

    const handleTouchEnd = () => {
      isInsideRef.current = false
      targetRef.current = { x: 0, y: 0 }
    }

    element.addEventListener('mousemove', handleMouseMove)
    element.addEventListener('mouseenter', handleMouseEnter)
    element.addEventListener('mouseleave', handleMouseLeave)
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: true })
    element.addEventListener('touchend', handleTouchEnd)
    element.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      element.removeEventListener('mousemove', handleMouseMove)
      element.removeEventListener('mouseenter', handleMouseEnter)
      element.removeEventListener('mouseleave', handleMouseLeave)
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
      element.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled, ref, updateFromPointer])

  useEffect(() => {
    const tick = () => {
      const current = stateRef.current

      let desiredX: number
      let desiredY: number

      if (targetX !== null && targetY !== null) {
        desiredX = clamp(targetX, -1, 1)
        desiredY = clamp(targetY, -1, 1)
      } else {
        desiredX = targetRef.current.x
        desiredY = targetRef.current.y
      }

      const nextX = lerp(current.x, desiredX, smooth)
      const nextY = lerp(current.y, desiredY, smooth)

      const params: Live2DMouseParams = {
        ParamAngleX: nextX * maxAngle,
        ParamAngleY: nextY * maxAngle,
        ParamEyeBallX: nextX,
        ParamEyeBallY: nextY,
      }

      if (
        current.x !== nextX ||
        current.y !== nextY ||
        current.isInside !== isInsideRef.current ||
        current.params.ParamAngleX !== params.ParamAngleX ||
        current.params.ParamAngleY !== params.ParamAngleY ||
        current.params.ParamEyeBallX !== params.ParamEyeBallX ||
        current.params.ParamEyeBallY !== params.ParamEyeBallY
      ) {
        setState({
          x: nextX,
          y: nextY,
          rawX: current.rawX,
          rawY: current.rawY,
          isInside: isInsideRef.current,
          params,
        })
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [smooth, targetX, targetY, maxAngle])

  return state
}
