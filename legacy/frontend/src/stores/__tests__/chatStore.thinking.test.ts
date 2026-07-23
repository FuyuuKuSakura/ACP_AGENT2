import { describe, it, expect } from 'vitest'
import { useChatStore } from '../chatStore'

describe('chatStore thinking helpers', () => {
  it('addThinkingChunk appends to the current streaming agent message', () => {
    const store = useChatStore.getState()
    const session = store.addSession({ title: 'Test' })
    store.setCurrentSession(session.id)
    store.addThinkingChunk('a')
    store.addThinkingChunk('b')
    const state = useChatStore.getState()
    const last = state.messages[state.messages.length - 1]
    expect(last.role).toBe('agent')
    expect(last.thinking).toBe('ab')
    expect(last.content).toBe('')
  })

  it('addThinkingChunkToSession updates a non-current session', () => {
    const store = useChatStore.getState()
    const a = store.addSession({ title: 'A' })
    const b = store.addSession({ title: 'B' })
    store.setCurrentSession(a.id)
    store.addThinkingChunkToSession(b.id, 'x')
    const state = useChatStore.getState()
    const bSession = state.sessions.find((s) => s.id === b.id)!
    expect(bSession.messages[0].thinking).toBe('x')
    // Current view should not switch.
    expect(state.currentSessionId).toBe(a.id)
  })
})
