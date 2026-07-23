import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useChatStore } from '@/stores/chatStore'

const DEFAULT_GREETING = '我在这里陪着你，有什么需要尽管告诉我~'

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 px-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-1.5 w-1.5 rounded-full bg-dionysus-primary"
          animate={{ y: [0, -4, 0] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.1,
            ease: 'easeInOut',
          }}
        />
      ))}
    </span>
  )
}

export default function CharacterDialogBox() {
  const companionLine = useChatStore((state) => state.companionLine)
  const companionHistory = useChatStore((state) => state.companionHistory)
  const isStreaming = useChatStore((state) => state.isStreaming)

  const [expanded, setExpanded] = useState(false)

  const isTyping = isStreaming && !companionLine
  const currentLine = companionLine || DEFAULT_GREETING

  const displayedLines = useMemo(() => {
    if (expanded) {
      // Show history with the current line on top.
      const history = companionHistory.filter((line) => line !== currentLine)
      return [currentLine, ...history]
    }
    return [currentLine]
  }, [expanded, companionHistory, currentLine])

  const toggleExpanded = () => setExpanded((v) => !v)

  return (
    <div className="relative min-w-0 px-4 pb-4">
      {companionHistory.length > 0 && (
        <div className="mb-1.5 flex items-center justify-end">
          <button
            type="button"
            onClick={toggleExpanded}
            className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium text-dionysus-text-secondary transition-colors hover:text-dionysus-primary"
            aria-label={expanded ? '收起历史' : '展开历史'}
          >
            {expanded ? (
              <>
                收起 <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                历史 <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      )}

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {displayedLines.map((line, index) => {
            const isTop = index === 0
            return (
              <motion.div
                key={`${line}-${index}`}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: isTop ? 1 : 0.75, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                onClick={index === 0 && !expanded ? toggleExpanded : undefined}
                className={`cel-bubble-agent relative max-w-full rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-dionysus-text-primary ${
                  index === 0 && !expanded ? 'cursor-pointer' : ''
                } ${index > 0 ? 'ml-3' : ''}`}
              >
                {isTop && isTyping ? (
                  <span className="flex items-center gap-1 text-dionysus-text-secondary">
                    正在思考
                    <TypingDots />
                  </span>
                ) : (
                  <span className="block max-w-full break-words whitespace-pre-wrap">
                    {line}
                  </span>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      <div className="absolute -bottom-1 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-dionysus-glass-border bg-dionysus-agent-bubble" />
    </div>
  )
}
