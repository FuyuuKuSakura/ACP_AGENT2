/**
 * CompanionBubbles — 角色旁白气泡滚动面板（ux-core-flows.md §4.1）。
 *
 * - 常驻陪伴区角色头顶上方，数据只来自 companionStore（companion_message 一律不进
 *   会话消息流，由 messageRouter 保证），跨会话切换不消失；
 * - 全部历史可滚动查看：不再截断 3 条、不再折叠展开——滚动面板 flex-1 铺满
 *   角色上方空间，最久的汇报在面板顶部，最新的在底部（贴角色头顶）；
 * - 滚动跟随：用户贴底时新句到达自动滚到底；用户上翻阅历史时不强行跳转，
 *   改亮「有新汇报 ↓」浮钮，点击滚到底（入场 CSS keyframe 从简，不引
 *   framer-motion——webview 依赖单 bundle 且现有依赖无 framer-motion）；
 * - 右下角小字标注来源会话（sourceTitle），点击经 onJumpSource 切换会话；
 * - 每条气泡左侧小图标标注情绪（emotion_update 联动，emotionIcon.ts）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { CompanionLine } from '@dionysus/client-core'

import { Icon } from '../Icon.js'
import { emotionIcon, emotionTone, type EmotionTone } from './emotionIcon.js'

/** 距底多少 px 内视为「贴底」（跟随滚动判定容差） */
export const BOTTOM_THRESHOLD_PX = 24

/** 徽记 tone → token 色（V4：error/success 语义着色，其余 muted）。 */
const TONE_CLASS: Record<EmotionTone, string> = {
  error: 'text-[var(--dn-error)]',
  success: 'text-[var(--dn-success)]',
  muted: 'text-[var(--dn-muted)]',
}

export interface CompanionBubblesProps {
  /** companionStore.lines（时间升序）；面板内同序渲染，最久在顶、最新在底 */
  lines: CompanionLine[]
  /** 当前情绪（emotion_update），行内无 emotion 时回退用它标徽记 */
  currentEmotion?: string
  /** 来源标注点击：切换会话（经 chatActions.switchToSession） */
  onJumpSource?: (sessionId: string) => void
}

function Bubble({
  line,
  currentEmotion,
  onJumpSource,
}: {
  line: CompanionLine
  currentEmotion?: string
  onJumpSource?: (sessionId: string) => void
}) {
  const emotion = line.emotion ?? currentEmotion
  const icon = emotionIcon(emotion)
  return (
    <div
      data-testid="companion-bubble"
      data-line-id={line.id}
      className="dn-bubble-in w-full rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-agent-bubble-bg)]/95 px-3 py-2 text-sm leading-relaxed text-[var(--dn-fg)] shadow-lg"
    >
      <div className="flex items-start gap-1.5">
        {icon && (
          <span
            data-testid="companion-bubble-icon"
            aria-hidden
            className={`mt-0.5 shrink-0 ${TONE_CLASS[emotionTone(emotion)]}`}
          >
            <Icon name={icon} size={14} />
          </span>
        )}
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {line.text}
        </span>
      </div>
      {line.sourceSessionId && line.sourceTitle && (
        <div className="mt-1 text-right">
          <button
            type="button"
            data-testid="companion-bubble-source"
            title={`跳转会话：${line.sourceTitle}`}
            onClick={() => onJumpSource?.(line.sourceSessionId!)}
            className="text-xs text-[var(--dn-muted)] underline-offset-2 hover:text-[var(--dn-accent)] hover:underline"
          >
            来自：{line.sourceTitle}
          </button>
        </div>
      )}
    </div>
  )
}

export function CompanionBubbles({
  lines,
  currentEmotion,
  onJumpSource,
}: CompanionBubblesProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // 贴底状态：true 时新句到达自动跟随滚到底；false（翻阅历史中）时不打断
  const [atBottom, setAtBottom] = useState(true)
  const [hasNew, setHasNew] = useState(false)
  const lastLineIdRef = useRef<string | undefined>(lines.at(-1)?.id)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX
    setAtBottom(nearBottom)
    if (nearBottom) setHasNew(false)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAtBottom(true)
    setHasNew(false)
  }, [])

  // 首屏定位到面板底部（最新句贴角色头顶）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // 新句到达（以末行 id 判定，兼容 store cap 截头）：贴底则跟随，翻阅中则亮浮钮
  const lastLineId = lines.at(-1)?.id
  useEffect(() => {
    if (lastLineId === lastLineIdRef.current) return
    lastLineIdRef.current = lastLineId
    const el = scrollRef.current
    if (!el || lastLineId === undefined) return
    if (atBottom) {
      el.scrollTop = el.scrollHeight
    } else {
      setHasNew(true)
    }
  }, [lastLineId, atBottom])

  if (lines.length === 0) return null

  return (
    <div
      data-testid="companion-bubbles"
      className="relative flex min-h-0 w-full flex-1 flex-col"
    >
      {/* 入场动画（新句贴头顶浮入的从简实现）；定义在本组件内避免改全局 css */}
      <style>{`@keyframes dn-bubble-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } .dn-bubble-in { animation: dn-bubble-in 220ms ease-out; }`}</style>
      <div
        ref={scrollRef}
        data-testid="companion-scroll"
        onScroll={onScroll}
        className="dn-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
      >
        {/* 行数不足铺满时把气泡压到面板底部（贴角色头顶）；溢出时收缩为 0 */}
        <div aria-hidden className="flex-1" />
        {lines.map((line) => (
          <Bubble
            key={line.id}
            line={line}
            currentEmotion={currentEmotion}
            onJumpSource={onJumpSource}
          />
        ))}
      </div>
      {hasNew && (
        <button
          type="button"
          data-testid="companion-new-lines"
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-2 py-1 text-xs text-[var(--dn-muted)] shadow-lg hover:text-[var(--dn-accent)]"
        >
          有新汇报
          <Icon name="chevron-down" size={12} />
        </button>
      )}
    </div>
  )
}
