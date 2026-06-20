import { useState } from 'react'
import { ChevronDown, ChevronRight, Brain } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'

interface ThinkingSectionProps {
  thinking: string
}

export default function ThinkingSection({ thinking }: ThinkingSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (!thinking) return null

  return (
    <div className="thinking-section mb-2 overflow-hidden rounded-lg border border-dionysus-border/60">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs text-dionysus-text-secondary hover:bg-dionysus-surface-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
        )}
        <Brain className="h-3.5 w-3.5 flex-shrink-0" />
        <span>思考过程</span>
        <span className="ml-auto text-[10px] opacity-50">
          {expanded ? '收起' : '展开'}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-dionysus-border/60 px-3 py-2 text-xs leading-relaxed text-dionysus-text-secondary/80">
          <MarkdownRenderer content={thinking} />
        </div>
      )}
    </div>
  )
}
