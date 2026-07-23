import { parseToolCalls } from '@/lib/tools'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import MarkdownRenderer from './MarkdownRenderer'
import ThinkingSection from './ThinkingSection'
import PersonaAvatar from '../Character/PersonaAvatar'

interface AgentMessageProps {
  content: string
  status?: 'streaming' | 'interrupted' | 'complete' | 'error'
  thinking?: string
}

export default function AgentMessage({ content, status, thinking }: AgentMessageProps) {
  const { displayContent } = parseToolCalls(content)
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const sessionPersonaId = useChatStore((state) =>
    state.sessions.find((s) => s.id === currentSessionId)?.persona_id,
  )
  const globalPersonaId = useSettingsStore((state) => state.globalPersonaId)
  const personaId = sessionPersonaId || globalPersonaId

  if (!displayContent) return null

  return (
    <div className="flex justify-start gap-3">
      <div className="flex-shrink-0 pt-1">
        <PersonaAvatar personaId={personaId} size="sm" />
      </div>
      <div className="cel-bubble-agent relative max-w-4/5 min-w-0 overflow-hidden rounded-2xl rounded-tl-sm px-4 py-2.5 text-dionysus-text-primary">
        <ThinkingSection thinking={thinking ?? ''} />
        {status === 'interrupted' && (
          <span className="absolute -top-2 right-3 rounded-full border-2 border-black/20 bg-dionysus-danger px-2 py-0.5 text-xs font-medium text-white shadow-sm">
            已中断
          </span>
        )}
        <MarkdownRenderer content={displayContent} />
      </div>
    </div>
  )
}
