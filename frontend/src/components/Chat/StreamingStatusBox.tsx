import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { parseToolCalls } from '@/lib/tools'
import MarkdownRenderer from './MarkdownRenderer'
import ThinkingSection from './ThinkingSection'

interface StreamingStatusBoxProps {
  content?: string
  status?: string
  detail?: string
  thinking?: string
}

function formatElapsed(seconds: number): string {
  const s = Math.floor(seconds)
  return `${s}s`
}

export default function StreamingStatusBox({
  content = '',
  status = 'thinking',
  detail = '思考中…',
  thinking,
}: StreamingStatusBoxProps) {
  const [elapsed, setElapsed] = useState(0)
  const { displayContent } = parseToolCalls(content)
  const hasContent = displayContent.length > 0

  useEffect(() => {
    const start = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const statusText = detail || status

  if (!hasContent) {
    return (
      <div className="flex justify-start">
        <div className="cel-bubble-agent flex max-w-4/5 items-center gap-3 rounded-2xl rounded-tl-sm px-4 py-3 text-dionysus-text-primary">
          <Loader2 className="h-5 w-5 animate-spin text-dionysus-primary" />
          <div className="flex flex-col">
            <span className="text-sm">{statusText}</span>
            {elapsed > 5 && (
              <span className="text-xs text-dionysus-text-secondary">
                已用时 {formatElapsed(elapsed)}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="cel-bubble-agent max-w-4/5 rounded-2xl rounded-tl-sm px-4 py-2.5 text-dionysus-text-primary">
        <ThinkingSection thinking={thinking ?? ''} />
        <div className="mb-2 flex items-center gap-2 border-b-2 border-dionysus-border pb-1.5">
          <Loader2 className="h-4 w-4 animate-spin text-dionysus-primary" />
          <span className="text-xs font-medium text-dionysus-text-secondary">{statusText}</span>
          {elapsed > 5 && (
            <span className="ml-auto text-xs text-dionysus-text-secondary">
              {formatElapsed(elapsed)}
            </span>
          )}
        </div>
        <MarkdownRenderer content={displayContent} />
      </div>
    </div>
  )
}
