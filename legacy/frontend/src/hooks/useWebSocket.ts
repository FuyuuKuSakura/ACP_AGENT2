import { useEffect, useRef, useState, useCallback } from 'react'
import { DionysusWebSocketClient, type DionysusWebSocketClientCallbacks } from '@/services/websocket'

export interface UseWebSocketResult {
  sendMessage: (message: unknown) => boolean
  connected: boolean
  reconnect: () => void
}

const CHAT_STORAGE_KEY = 'dionysus-cache-chat'

function getPersistedSessionId(): string | null {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state?.currentSessionId ?? null
  } catch {
    return null
  }
}

function buildWebSocketUrl(baseUrl: string): string {
  const sessionId = getPersistedSessionId()
  if (!sessionId) return baseUrl
  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}session_id=${encodeURIComponent(sessionId)}`
}

export function useWebSocket(url: string, callbacks?: DionysusWebSocketClientCallbacks): UseWebSocketResult {
  const clientRef = useRef<DionysusWebSocketClient | null>(null)
  const callbacksRef = useRef(callbacks)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  useEffect(() => {
    const fullUrl = buildWebSocketUrl(url)
    const client = new DionysusWebSocketClient(fullUrl, {
      onOpen: (event) => {
        setConnected(true)
        callbacksRef.current?.onOpen?.(event)
      },
      onClose: (event) => {
        setConnected(false)
        callbacksRef.current?.onClose?.(event)
      },
      onError: (event) => {
        setConnected(false)
        callbacksRef.current?.onError?.(event)
      },
      onMessage: (data) => {
        callbacksRef.current?.onMessage?.(data)
      },
    })
    clientRef.current = client
    client.connect()

    return () => {
      client.disconnect()
      clientRef.current = null
    }
  }, [url])

  const sendMessage = useCallback((message: unknown): boolean => {
    return clientRef.current?.send(message) ?? false
  }, [])

  const reconnect = useCallback(() => {
    clientRef.current?.disconnect()
    clientRef.current?.connect()
  }, [])

  return { sendMessage, connected, reconnect }
}
