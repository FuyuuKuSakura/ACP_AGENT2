import { create } from 'zustand'

export type PresenceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'success'
  | 'error'
  | 'sleeping'

export interface LookAtTarget {
  /** Normalized X in range [-1, 1]. */
  x: number
  /** Normalized Y in range [-1, 1]. */
  y: number
  /** Timestamp when the target should be cleared. */
  expiresAt: number
}

export interface Live2DState {
  /** Whether mouse tracking is active. */
  trackingEnabled: boolean
  /** Optional override target from backend look_at actions. */
  lookAtTarget: LookAtTarget | null
  /** Current presence state shown by the status dot. */
  presenceState: PresenceState
  /** Last emotion received from the backend. */
  currentEmotion: string | null
  /** Queued expression request for the Live2D model. */
  pendingExpression: string | null
  /** Queued motion request for the Live2D model. */
  pendingMotion: string | null
  /** Timestamp of the last user interaction with the companion. */
  lastActivityAt: number
  /** Incremented to force the Live2D viewer to reload its model. */
  modelReloadTrigger: number
  /** Enable or disable mouse tracking. */
  setTrackingEnabled: (enabled: boolean) => void
  /** Force the Live2D viewer to reload its model. */
  triggerModelReload: () => void
  /**
   * Set a temporary look-at target.
   * @param target.x Normalized X in range [-1, 1].
   * @param target.y Normalized Y in range [-1, 1].
   * @param target.duration How long the target stays active in milliseconds. Defaults to 2000.
   */
  setLookAtTarget: (target: { x: number; y: number; duration?: number }) => void
  /** Clear the active look-at target. */
  clearLookAtTarget: () => void
  /** Update the current presence state. */
  setPresenceState: (state: PresenceState) => void
  /** Update the current backend emotion. */
  setCurrentEmotion: (emotion: string | null) => void
  /** Queue an expression request to be applied by the viewer. */
  requestExpression: (name: string) => void
  /** Queue a motion request to be applied by the viewer. */
  requestMotion: (name: string) => void
  /** Consume the pending expression request. */
  clearPendingExpression: () => void
  /** Consume the pending motion request. */
  clearPendingMotion: () => void
  /** Mark that the companion was just interacted with. */
  bumpActivity: () => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export const useLive2DStore = create<Live2DState>()((set) => ({
  trackingEnabled: true,
  lookAtTarget: null,
  presenceState: 'idle',
  currentEmotion: null,
  pendingExpression: null,
  pendingMotion: null,
  lastActivityAt: Date.now(),
  modelReloadTrigger: 0,

  setTrackingEnabled: (enabled) => set({ trackingEnabled: enabled }),
  triggerModelReload: () =>
    set((state) => ({ modelReloadTrigger: state.modelReloadTrigger + 1 })),

  setLookAtTarget: ({ x, y, duration = 2000 }) =>
    set({
      lookAtTarget: {
        x: clamp(x, -1, 1),
        y: clamp(y, -1, 1),
        expiresAt: Date.now() + Math.max(0, duration),
      },
    }),

  clearLookAtTarget: () => set({ lookAtTarget: null }),

  setPresenceState: (presenceState) => set({ presenceState }),

  setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),

  requestExpression: (name) =>
    set({ pendingExpression: name, lastActivityAt: Date.now() }),

  requestMotion: (name) =>
    set({ pendingMotion: name, lastActivityAt: Date.now() }),

  clearPendingExpression: () => set({ pendingExpression: null }),

  clearPendingMotion: () => set({ pendingMotion: null }),

  bumpActivity: () => set({ lastActivityAt: Date.now() }),
}))
