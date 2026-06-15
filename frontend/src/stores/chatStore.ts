import { create } from 'zustand'
import { parseToolCalls } from '@/lib/tools'
import type {
  ChatMessage,
  OptionItem,
  Session,
  SessionStatus,
  StatusUpdateMessage,
  TodoItem,
  ToolCall,
} from '@/types/protocol'

type OptionsUiType = 'button_group' | 'dropdown' | 'card_list' | 'input_confirm'

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function makeTitle(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return '新会话'
  return trimmed.length > 20 ? `${trimmed.slice(0, 20)}…` : trimmed
}

interface ChatState {
  sessions: Session[]
  currentSessionId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  currentOptions: OptionItem[] | null
  currentOptionsUiType: OptionsUiType | null
  optionDisabled: boolean
  streamingStatus: StatusUpdateMessage['payload'] | null
  toolCalls: ToolCall[]
  activeToolCallId: string | null
  companionLine: string | null
  companionHistory: string[]
  todos: TodoItem[]

  addSession: (session?: Partial<Session>) => Session
  setCurrentSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  renameSession: (sessionId: string, title: string) => void
  updateSession: (sessionId: string, patch: Partial<Session>) => void
  addUserMessage: (text: string, attachments?: unknown[]) => ChatMessage
  addAgentChunk: (chunk: string) => void
  finalizeAgentMessage: (status?: 'complete' | 'interrupted' | 'error') => void
  setOptions: (options: OptionItem[], uiType?: OptionsUiType) => void
  selectOption: (option: OptionItem) => void
  clearOptions: () => void
  setStreaming: (isStreaming: boolean) => void
  setStreamingStatus: (status: StatusUpdateMessage['payload'] | null) => void
  setSessionStatus: (status: SessionStatus) => void
  setCompanionLine: (line: string | null) => void
  setTodos: (items: TodoItem[]) => void
  appendSystemMessage: (text: string, level?: 'info' | 'warning' | 'error') => void
  loadSessionMessages: (sessionId: string, messages: ChatMessage[]) => void
  addToolCall: (tool: Pick<ToolCall, 'name' | 'args'>) => ToolCall
  updateActiveToolResult: (result: string, status?: 'success' | 'error') => void
  finalizeToolCalls: (status?: 'success' | 'error') => void
  clearToolCalls: () => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  isStreaming: false,
  currentOptions: null,
  currentOptionsUiType: null,
  optionDisabled: false,
  streamingStatus: null,
  toolCalls: [],
  activeToolCallId: null,
  companionLine: null,
  companionHistory: [],
  todos: [],

  addSession: (session) => {
    const now = Date.now()
    const newSession: Session = {
      id: generateId(),
      title: '新会话',
      persona_id: 'exusiai',
      status: 'idle',
      created_at: now,
      updated_at: now,
      messages: [],
      ...session,
    }
    set((state) => ({
      sessions: [newSession, ...state.sessions],
      currentSessionId: newSession.id,
      messages: newSession.messages,
      currentOptions: null,
      currentOptionsUiType: null,
      optionDisabled: false,
      isStreaming: false,
      streamingStatus: null,
      companionLine: null,
      companionHistory: [],
    }))
    return newSession
  },

  setCurrentSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    set({
      currentSessionId: sessionId,
      messages: session?.messages ?? [],
      currentOptions: null,
      currentOptionsUiType: null,
      optionDisabled: false,
      isStreaming: false,
      streamingStatus: null,
      toolCalls: [],
      activeToolCallId: null,
      companionLine: null,
      companionHistory: [],
    })
  },

  deleteSession: (sessionId) => {
    set((state) => {
      const filtered = state.sessions.filter((s) => s.id !== sessionId)
      let nextSessionId = state.currentSessionId
      let nextMessages: ChatMessage[] = state.messages
      if (state.currentSessionId === sessionId) {
        nextSessionId = filtered[0]?.id ?? null
        nextMessages = filtered[0]?.messages ?? []
      }
      return {
        sessions: filtered,
        currentSessionId: nextSessionId,
        messages: nextMessages,
      }
    })
  },

  renameSession: (sessionId, title) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, title, updated_at: Date.now() } : s,
      ),
    }))
  },

  updateSession: (sessionId, patch) => {
    set((state) => {
      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...patch, updated_at: Date.now() } : s,
      )
      const current = sessions.find((s) => s.id === state.currentSessionId)
      return { sessions, messages: current?.messages ?? state.messages }
    })
  },

  addUserMessage: (text, attachments) => {
    const now = Date.now()
    let sessionId = get().currentSessionId
    if (!sessionId) {
      const newSession = get().addSession({ title: makeTitle(text) })
      sessionId = newSession.id
    }

    const message: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: now,
      trace_id: generateId(),
      metadata: { attachments: attachments ?? [] },
    }

    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s
        return {
          ...s,
          title: s.title === '新会话' ? makeTitle(text) : s.title,
          updated_at: now,
          messages: [...s.messages, message],
        }
      })
      return {
        sessions,
        messages: sessions.find((s) => s.id === sessionId)?.messages ?? state.messages,
        toolCalls: [],
        activeToolCallId: null,
      }
    })

    return message
  },

  addAgentChunk: (chunk) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return

    set((state) => {
      const lastMessage = state.messages[state.messages.length - 1]
      let messages: ChatMessage[]
      if (lastMessage && lastMessage.role === 'agent' && lastMessage.status === 'streaming') {
        messages = state.messages.map((m, idx) =>
          idx === state.messages.length - 1
            ? { ...m, content: m.content + chunk }
            : m,
        )
      } else {
        const newMessage: ChatMessage = {
          id: generateId(),
          role: 'agent',
          content: chunk,
          timestamp: Date.now(),
          trace_id: generateId(),
          status: 'streaming',
        }
        messages = [...state.messages, newMessage]
      }

      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, updated_at: Date.now(), messages } : s,
      )

      let toolCalls = state.toolCalls
      let activeToolCallId = state.activeToolCallId
      const streamingMessage = messages[messages.length - 1]
      if (streamingMessage?.role === 'agent' && streamingMessage.status === 'streaming') {
        const { calls } = parseToolCalls(streamingMessage.content)
        if (calls.length > 0) {
          const lastCall = calls[calls.length - 1]
          const active = activeToolCallId ? toolCalls.find((t) => t.id === activeToolCallId) : null
          if (!active || active.name !== lastCall.name || active.args !== lastCall.args) {
            const tool: ToolCall = {
              id: generateId(),
              name: lastCall.name,
              args: lastCall.args,
              status: 'running',
              timestamp: Date.now(),
            }
            toolCalls = [...toolCalls, tool]
            activeToolCallId = tool.id
          }
        }
      }

      return { sessions, messages, toolCalls, activeToolCallId }
    })
  },

  finalizeAgentMessage: (status = 'complete') => {
    const sessionId = get().currentSessionId
    if (!sessionId) return

    set((state) => {
      const messages = state.messages.map((m, idx) =>
        idx === state.messages.length - 1 && m.role === 'agent' && m.status === 'streaming'
          ? { ...m, status }
          : m,
      )
      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, updated_at: Date.now(), messages } : s,
      )
      const finalToolStatus: Extract<ToolCall['status'], 'success' | 'error'> =
        status === 'complete' ? 'success' : 'error'
      const activeToolId = state.activeToolCallId
      const toolCalls: ToolCall[] = activeToolId
        ? state.toolCalls.map((t) =>
            t.id === activeToolId ? { ...t, status: finalToolStatus } : t,
          )
        : state.toolCalls
      return {
        sessions,
        messages,
        isStreaming: false,
        streamingStatus: null,
        toolCalls,
        activeToolCallId: null,
      }
    })
  },

  setOptions: (options, uiType) => {
    set({
      currentOptions: options,
      currentOptionsUiType: uiType ?? 'button_group',
      optionDisabled: false,
    })
  },

  selectOption: (option) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    const now = Date.now()
    const selectedMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: option.label,
      timestamp: now,
      trace_id: generateId(),
      selectedOption: option,
    }
    set((state) => {
      const messages = [...state.messages, selectedMessage]
      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, updated_at: now, messages } : s,
      )
      return {
        sessions,
        messages,
        optionDisabled: true,
        currentOptions: null,
        currentOptionsUiType: null,
      }
    })
  },

  clearOptions: () => {
    set({
      currentOptions: null,
      currentOptionsUiType: null,
      optionDisabled: false,
    })
  },

  setStreaming: (isStreaming) => {
    set({ isStreaming })
  },

  setStreamingStatus: (streamingStatus) => {
    set({ streamingStatus })
  },

  setCompanionLine: (companionLine) => {
    if (!companionLine) {
      set({ companionLine: null })
      return
    }
    set((state) => ({
      companionLine,
      companionHistory: [companionLine, ...state.companionHistory].slice(0, 20),
    }))
  },

  setTodos: (todos) => set({ todos }),

  setSessionStatus: (status) => {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status } : s,
      ),
    }))
  },

  appendSystemMessage: (text, level = 'info') => {
    const sessionId = get().currentSessionId
    if (!sessionId) return
    const now = Date.now()
    const message: ChatMessage = {
      id: generateId(),
      role: 'system',
      content: text,
      timestamp: now,
      trace_id: generateId(),
      metadata: { level },
    }
    set((state) => {
      const messages = [...state.messages, message]
      const sessions = state.sessions.map((s) =>
        s.id === sessionId ? { ...s, updated_at: now, messages } : s,
      )
      return { sessions, messages }
    })
  },

  loadSessionMessages: (sessionId, messages) => {
    set((state) => ({
      currentSessionId: sessionId,
      messages,
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, messages } : s,
      ),
      currentOptions: null,
      currentOptionsUiType: null,
      optionDisabled: false,
      isStreaming: false,
      streamingStatus: null,
      toolCalls: [],
      activeToolCallId: null,
      companionLine: null,
      companionHistory: [],
    }))
  },

  addToolCall: ({ name, args }) => {
    const tool: ToolCall = {
      id: generateId(),
      name,
      args,
      status: 'running',
      timestamp: Date.now(),
    }
    set((state) => ({
      toolCalls: [...state.toolCalls, tool],
      activeToolCallId: tool.id,
    }))
    return tool
  },

  updateActiveToolResult: (result, status = 'success') => {
    set((state) => {
      const targetId = state.activeToolCallId
      if (!targetId) return state
      const toolCalls = state.toolCalls.map((t) =>
        t.id === targetId ? { ...t, status, result } : t,
      )
      return {
        toolCalls,
        activeToolCallId: null,
      }
    })
  },

  finalizeToolCalls: (status = 'success') => {
    set((state) => ({
      toolCalls: state.toolCalls.map((t) =>
        t.status === 'running' ? { ...t, status } : t,
      ),
      activeToolCallId: null,
    }))
  },

  clearToolCalls: () => {
    set({ toolCalls: [], activeToolCallId: null })
  },
}))
