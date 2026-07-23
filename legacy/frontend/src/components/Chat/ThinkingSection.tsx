import { useState } from 'react'
import { ChevronDown, Brain } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'

interface ThinkingSectionProps {
  thinking: string
}

export default function ThinkingSection({ thinking }: ThinkingSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (!thinking) return null

  const contentId = 'thinking-content'

  return (
    <div className="thinking-section mb-2 overflow-hidden rounded-lg border border-dionysus-border/60">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        title="这是 Agent 的内部推理过程，默认折叠，点击展开查看"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-dionysus-text-secondary transition-colors hover:bg-dionysus-glass-highlight"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200 ${
            expanded ? 'rotate-0' : '-rotate-90'
          }`}
        />
        <Brain className="h-3.5 w-3.5 flex-shrink-0" />
        <span>思考过程</span>
        <span className="ml-auto text-[10px] opacity-50">
          {expanded ? '收起' : '展开'}
        </span>
      </button>
      <div
        id={contentId}
        data-testid="thinking-content"
        className={`overflow-hidden border-t border-dionysus-border/60 transition-all duration-200 ease-out ${
          expanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-3 py-2 text-xs leading-relaxed text-dionysus-text-secondary/80">
          <MarkdownRenderer content={thinking} />
        </div>
      </div>
    </div>
  )
}
