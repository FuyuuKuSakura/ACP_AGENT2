export interface DionysusWebSocketClientCallbacks {
  onMessage?: (data: unknown) => void
  onOpen?: (event: Event) => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
}

export class DionysusWebSocketClient {
  private url: string
  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectDelayCap = 30000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatInterval = 30000
  private intentionalClose = false

  public onMessage?: (data: unknown) => void
  public onOpen?: (event: Event) => void
  public onClose?: (event: CloseEvent) => void
  public onError?: (event: Event) => void

  constructor(url: string, callbacks?: DionysusWebSocketClientCallbacks) {
    this.url = url
    if (callbacks) {
      this.onMessage = callbacks.onMessage
      this.onOpen = callbacks.onOpen
      this.onClose = callbacks.onClose
      this.onError = callbacks.onError
    }
  }

  connect(): void {
    this.disconnect(true)
    this.intentionalClose = false

    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      this.onError?.(new Event('error'))
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = (event) => {
      this.reconnectAttempts = 0
      this.startHeartbeat()
      this.onOpen?.(event)
    }

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string)
        this.onMessage?.(parsed)
      } catch {
        this.onMessage?.(event.data)
      }
    }

    this.ws.onerror = (event) => {
      this.onError?.(event)
    }

    this.ws.onclose = (event) => {
      this.stopHeartbeat()
      this.onClose?.(event)
      if (!this.intentionalClose) {
        this.scheduleReconnect()
      }
    }
  }

  disconnect(intentional = true): void {
    this.intentionalClose = intentional
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
  }

  send(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    try {
      this.ws.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.reconnectDelayCap)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, this.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
