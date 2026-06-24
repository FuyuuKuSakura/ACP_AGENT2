import { parseToolCalls } from '@/lib/tools'
import MarkdownRenderer from './MarkdownRenderer'
import ThinkingSection from './ThinkingSection'

interface AgentMessageProps {
  content: string
  status?: 'streaming' | 'interrupted' | 'complete' | 'error'
  thinking?: string
}

export default function AgentMessage({ content, status, thinking }: AgentMessageProps) {
  const { displayContent } = parseToolCalls(content)
  if (!displayContent) return null

  return (
    <div className="flex justify-start">
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
