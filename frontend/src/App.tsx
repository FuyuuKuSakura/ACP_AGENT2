import { useEffect, useCallback } from 'react'
import { useThemeStore } from './stores/themeStore'
import { useChatStore } from './stores/chatStore'
import { useLive2DStore } from './stores/live2dStore'
import { useSettingsStore } from './stores/settingsStore'
import { applyTheme, DEFAULT_THEME } from './lib/theme'
import { useWebSocket } from './hooks/useWebSocket'
import Layout from './components/Layout/Layout'
import { parseToolChunk } from './lib/tools'
import type { WebSocketMessage, ServerMessage } from './types/protocol'

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function isServerMessage(data: unknown): data is ServerMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    typeof (data as { type: string }).type === 'string'
  )
}

function App() {
  const { currentTheme } = useThemeStore()
  const {
    fontSize,
    wallpaperUrl,
    wallpaperOpacity,
    wallpaperBlur,
    wallpaperBrightness,
    initWallpaperFromServer,
  } = useSettingsStore()

  useEffect(() => {
    applyTheme(currentTheme ?? DEFAULT_THEME)
  }, [currentTheme])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-font-size', fontSize)
  }, [fontSize])

  useEffect(() => {
    initWallpaperFromServer()
  }, [initWallpaperFromServer])

  // Expose store for end-to-end / smoke testing only in development builds.
  if (import.meta.env.DEV) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__Dionysus_CHAT_STORE__ = useChatStore
  }

  // Map chat session activity to the Live2D presence state.
  useEffect(() => {
    const chatStore = useChatStore.getState()
    const liveStore = useLive2DStore.getState()

    const sessionId = chatStore.currentSessionId
    const session = chatStore.sessions.find((s) => s.id === sessionId)
    const status = session?.status ?? 'idle'
    const streamingStatus = chatStore.streamingStatus?.status

    let nextPresence: ReturnType<typeof useLive2DStore.getState>['presenceState'] =
      'idle'

    if (status === 'interrupted') {
      nextPresence = 'error'
    } else if (chatStore.isStreaming || status === 'streaming' || status === 'processing') {
      if (streamingStatus === 'thinking') {
        nextPresence = 'thinking'
      } else if (
        streamingStatus === 'executing' ||
        streamingStatus === 'reading_file' ||
        streamingStatus === 'outputting'
      ) {
        nextPresence = 'working'
      } else if (streamingStatus === 'error') {
        nextPresence = 'error'
      } else if (streamingStatus === 'idle') {
        nextPresence = 'idle'
      } else {
        // Default active state while streaming/processing.
        nextPresence = 'thinking'
      }
    }

    if (liveStore.presenceState !== nextPresence) {
      liveStore.setPresenceState(nextPresence)
    }
  })

  const handleMessage = useCallback((data: unknown) => {
    if (!isServerMessage(data)) return

    const message = data as WebSocketMessage
    const store = useChatStore.getState()
    const currentSessionId = store.currentSessionId
    const targetSessionId =
      message.session_id === 'global' ? currentSessionId : message.session_id
    const isCurrentSession = targetSessionId === currentSessionId

    switch (message.type) {
      case 'handshake': {
        const sessionId = message.payload.session_id
        const existing = store.sessions.find((s) => s.id === sessionId)
        if (!existing) {
          store.addSession({
            id: sessionId,
            title: '新会话',
            persona_id: message.payload.persona_id ?? 'exusiai',
          })
        } else {
          store.setCurrentSession(sessionId)
        }
        break
      }
      case 'agent_stream': {
        if (isCurrentSession) {
          store.setStreaming(true)
          store.setSessionStatus('streaming')
          store.setStreamingStatus({
            status: message.payload.status,
            detail: '',
          })
          const toolChunk = parseToolChunk(message.payload.chunk)
          if (toolChunk?.type === 'tool_call' && toolChunk.call) {
            store.addToolCall({ name: toolChunk.call.name, args: toolChunk.call.args })
          } else if (toolChunk?.type === 'tool_result') {
            store.updateActiveToolResult(toolChunk.result ?? '')
          } else {
            store.addAgentChunk(message.payload.chunk)
          }
        } else if (targetSessionId) {
          store.setSessionStatusById(targetSessionId, 'streaming')
          store.setStreamingStatusById(targetSessionId, {
            status: message.payload.status,
            detail: '',
          })
          store.addAgentChunkToSession(targetSessionId, message.payload.chunk)
        }
        break
      }
      case 'agent_complete': {
        const status = message.payload.status
        const mappedStatus = status === 'success' ? 'complete' : status
        if (isCurrentSession) {
          store.finalizeAgentMessage(mappedStatus)
          store.finalizeToolCalls(status === 'success' ? 'success' : 'error')
          store.setSessionStatus(status === 'success' ? 'idle' : 'interrupted')
          if (status === 'error' && message.payload.error_message) {
            store.appendSystemMessage(message.payload.error_message, 'error')
          }
        } else if (targetSessionId) {
          store.finalizeAgentMessageInSession(targetSessionId, mappedStatus)
          store.setSessionStatusById(targetSessionId, status === 'success' ? 'idle' : 'interrupted')
          if (status === 'error' && message.payload.error_message) {
            store.appendSystemMessageToSession(targetSessionId, message.payload.error_message, 'error')
          }
        }
        const liveStore = useLive2DStore.getState()
        if (status === 'success') {
          liveStore.setPresenceState('success')
        } else {
          liveStore.setPresenceState('error')
        }
        break
      }
      case 'option_request': {
        if (isCurrentSession) {
          store.appendSystemMessage(message.payload.question, 'info')
          store.setOptions(message.payload.options, message.payload.ui_type)
          store.setSessionStatus('waiting_option')
        } else if (targetSessionId) {
          store.appendSystemMessageToSession(targetSessionId, message.payload.question, 'info')
          store.setOptionsForSession(targetSessionId, message.payload.options, message.payload.ui_type)
          store.setSessionStatusById(targetSessionId, 'waiting_option')
        }
        break
      }
      case 'status_update': {
        if (isCurrentSession) {
          store.setStreaming(true)
          store.setStreamingStatus(message.payload)
          store.setSessionStatus('processing')
        } else if (targetSessionId) {
          store.setStreamingStatusById(targetSessionId, message.payload)
          store.setSessionStatusById(targetSessionId, 'processing')
        }
        break
      }
      case 'system_notice': {
        if (isCurrentSession) {
          store.appendSystemMessage(message.payload.text, message.payload.level)
        } else if (targetSessionId) {
          store.appendSystemMessageToSession(targetSessionId, message.payload.text, message.payload.level)
        }
        break
      }
      case 'live2d_action': {
        const { action_type, name, params } = message.payload
        const liveStore = useLive2DStore.getState()
        if (action_type === 'look_at' && params) {
          const x = typeof params.x === 'number' ? params.x : 0
          const y = typeof params.y === 'number' ? params.y : 0
          const duration = typeof params.duration === 'number' ? params.duration : 2000
          liveStore.setLookAtTarget({ x, y, duration })
        } else if (action_type === 'expression' && name) {
          liveStore.setCurrentEmotion(name)
          liveStore.requestExpression(name)
        } else if (action_type === 'motion' && name) {
          liveStore.requestMotion(name)
        }
        break
      }
      case 'emotion_update': {
        const { emotion, live2d_expression, live2d_motion } = message.payload
        if (targetSessionId) {
          store.setSessionCompanionEmotion(targetSessionId, emotion)
        }
        if (isCurrentSession) {
          const liveStore = useLive2DStore.getState()
          liveStore.setCurrentEmotion(emotion)
          if (live2d_expression) {
            liveStore.requestExpression(live2d_expression)
          }
          if (live2d_motion) {
            liveStore.requestMotion(live2d_motion)
          }
        }
        break
      }
      case 'companion_message': {
        if (targetSessionId) {
          store.setSessionCompanionLine(targetSessionId, message.payload.text)
        }
        break
      }
      case 'todo_update': {
        if (isCurrentSession) {
          store.setTodos(message.payload.items)
        } else if (targetSessionId) {
          store.setTodosForSession(targetSessionId, message.payload.items)
        }
        break
      }
      case 'pong':
      case 'sticker_send':
      default:
        break
    }
  }, [])

  const { sendMessage: wsSend, connected } = useWebSocket('/ws', {
    onMessage: handleMessage,
  })

  const sendMessage = useCallback(
    (message: unknown): boolean => {
      const store = useChatStore.getState()
      const msgType = (message as { type?: string }).type

      if (msgType === 'user_input') {
        const payload = (message as { payload: { text: string; attachments: unknown[] } }).payload
        store.addUserMessage(payload.text, payload.attachments)
        store.setSessionStatus('processing')
        useLive2DStore.getState().setPresenceState('listening')
      } else if (msgType === 'interrupt') {
        store.setSessionStatus('interrupted')
      } else if (msgType === 'option_selected') {
        store.setSessionStatus('processing')
      }

      const sessionId = store.currentSessionId ?? 'default'
      const enriched = {
        trace_id: generateId(),
        timestamp: Date.now(),
        session_id: sessionId,
        ...(message as Record<string, unknown>),
      }

      return wsSend(enriched)
    },
    [wsSend],
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-dionysus-chat-bg">
      {/* Wallpaper layer */}
      {wallpaperUrl && (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${wallpaperUrl})`,
            opacity: wallpaperOpacity,
            filter: `blur(${wallpaperBlur}px) brightness(${wallpaperBrightness})`,
            transform: 'scale(1.05)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Application content */}
      <div className="relative z-10 h-full w-full">
        <Layout sendMessage={sendMessage} connected={connected} />
      </div>
    </div>
  )
}

export default App
