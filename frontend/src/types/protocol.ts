export type MessageType =
  | 'user_input'
  | 'option_selected'
  | 'interrupt'
  | 'client_command'
  | 'new_session'
  | 'ping'
  | 'handshake'
  | 'agent_stream'
  | 'agent_complete'
  | 'option_request'
  | 'status_update'
  | 'emotion_update'
  | 'sticker_send'
  | 'live2d_action'
  | 'companion_message'
  | 'todo_update'
  | 'pong'
  | 'system_notice'

export type StatusEnum =
  | 'thinking'
  | 'reading_file'
  | 'executing'
  | 'outputting'
  | 'error'
  | 'idle'

export type SessionStatus =
  | 'idle'
  | 'processing'
  | 'waiting_option'
  | 'streaming'
  | 'interrupted'

export interface Attachment {
  id: string
  filename: string
  mime_type: string
  size: number
  data: string
}

export interface Artifact {
  type: 'image' | 'file' | 'mermaid' | 'latex'
  mime_type?: string
  data?: string
  caption?: string
}

export interface OptionItem {
  id: string
  label: string
  description?: string
  icon?: string
}

export interface BaseMessage {
  type: MessageType
  trace_id: string
  timestamp: number
  session_id: string
}

export type AgentMode = 'normal' | 'plan' | 'yolo' | 'plan_yolo'

export interface UserInputMessage extends BaseMessage {
  type: 'user_input'
  payload: {
    text: string
    attachments: Attachment[]
    interrupt_before_send: boolean
    mode?: AgentMode
  }
}

export interface OptionSelectedMessage extends BaseMessage {
  type: 'option_selected'
  payload: {
    selected_id: string
    selected_label: string
  }
}

export interface InterruptMessage extends BaseMessage {
  type: 'interrupt'
  payload: {
    reason: 'user_request' | 'timeout' | 'system'
    insert_message?: string
  }
}

export interface NewSessionMessage extends BaseMessage {
  type: 'new_session'
  payload: {
    persona_id?: string
  }
}

export type ClientCommand =
  | 'change_working_dir'
  | 'open_working_dir'
  | 'list_kimi_sessions'
  | 'switch_kimi_session'
  | 'restart_adapter'
  | 'switch_adapter'
  | 'switch_persona'

export interface ClientCommandMessage extends BaseMessage {
  type: 'client_command'
  payload: {
    command: ClientCommand
    args?: string
    text?: string
  }
}

export interface PingMessage extends BaseMessage {
  type: 'ping'
}

export type ClientMessage =
  | UserInputMessage
  | OptionSelectedMessage
  | InterruptMessage
  | ClientCommandMessage
  | NewSessionMessage
  | PingMessage

export interface HandshakeMessage extends BaseMessage {
  type: 'handshake'
  payload: {
    server_version: string
    session_id: string
    persona_id?: string
    supported_features: string[]
  }
}

export interface AgentStreamMessage extends BaseMessage {
  type: 'agent_stream'
  payload: {
    chunk: string
    is_final: boolean
    status: StatusEnum
    is_thinking?: boolean
  }
}

export interface AgentCompleteMessage extends BaseMessage {
  type: 'agent_complete'
  payload: {
    status: 'success' | 'error' | 'interrupted'
    duration_ms?: number
    artifacts?: Artifact[]
    error_message?: string
  }
}

export interface OptionRequestMessage extends BaseMessage {
  type: 'option_request'
  payload: {
    question: string
    options: OptionItem[]
    ui_type: 'button_group' | 'dropdown' | 'card_list' | 'input_confirm'
    timeout_seconds?: number
  }
}

export interface StatusUpdateMessage extends BaseMessage {
  type: 'status_update'
  payload: {
    status: StatusEnum
    detail: string
    progress?: number
  }
}

export interface EmotionUpdateMessage extends BaseMessage {
  type: 'emotion_update'
  payload: {
    emotion: string
    confidence: number
    live2d_expression?: string
    live2d_motion?: string
  }
}

export interface StickerSendMessage extends BaseMessage {
  type: 'sticker_send'
  payload: {
    emotion: string
    sticker_url: string
    sticker_id: string
  }
}

export interface Live2DActionMessage extends BaseMessage {
  type: 'live2d_action'
  payload: {
    action_type: 'expression' | 'motion' | 'look_at' | 'lip_sync'
    name: string
    fade_duration?: number
    params?: Record<string, unknown>
  }
}

export interface CompanionMessage extends BaseMessage {
  type: 'companion_message'
  payload: {
    text: string
    emotion?: string
    sticker_id?: string
  }
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
}

export interface TodoUpdateMessage extends BaseMessage {
  type: 'todo_update'
  payload: {
    items: TodoItem[]
  }
}

export interface PongMessage extends BaseMessage {
  type: 'pong'
}

export interface SystemNoticeMessage extends BaseMessage {
  type: 'system_notice'
  payload: {
    text: string
    level: 'info' | 'warning' | 'error'
  }
}

export type ServerMessage =
  | HandshakeMessage
  | AgentStreamMessage
  | AgentCompleteMessage
  | OptionRequestMessage
  | StatusUpdateMessage
  | EmotionUpdateMessage
  | StickerSendMessage
  | Live2DActionMessage
  | CompanionMessage
  | TodoUpdateMessage
  | PongMessage
  | SystemNoticeMessage

export type WebSocketMessage = ClientMessage | ServerMessage

export type MessageRole = 'user' | 'agent' | 'system'

export interface ToolCall {
  id: string
  name: string
  args: string
  status: 'running' | 'success' | 'error'
  result?: string
  timestamp: number
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  thinking?: string
  timestamp: number
  trace_id: string
  status?: 'streaming' | 'interrupted' | 'complete' | 'error'
  options?: OptionItem[]
  selectedOption?: OptionItem
  metadata?: Record<string, unknown>
}

export interface Session {
  id: string
  title: string
  persona_id: string
  adapter_id?: string
  working_dir?: string
  status: SessionStatus
  created_at: number
  updated_at: number
  messages: ChatMessage[]
}

export interface ThemeColors {
  primary: string
  primaryHover: string
  accent: string
  background: string
  chatBackground: string
  userBubble: string
  agentBubbleLight: string
  agentBubbleDark: string
  textPrimaryLight: string
  textPrimaryDark: string
  textSecondary: string
  system: string
  danger: string
  success: string
  codeBackgroundLight: string
  codeBackgroundDark: string
  borderLight: string
  borderDark: string
}

export interface Theme {
  id: string
  name: string
  mode: 'light' | 'dark' | 'auto'
  fonts: {
    body: string
    code: string
  }
  colors: ThemeColors
  assets: {
    manifestThemeColor: string
    manifestBackgroundColor: string
  }
}
