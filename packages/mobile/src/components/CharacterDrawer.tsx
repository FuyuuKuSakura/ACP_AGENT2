/**
 * 角色唤起抽屉（ux-core-flows.md §6.2）：Apple 风格底部 sheet。
 *
 * - 非全屏：抽屉占屏 ~85%，顶部露出一小段内容区透出底下对话流的实时
 *   动态（滚动/新消息可见），遮罩只覆盖露出区；
 * - 抽屉内：静态立绘（P0 形态，Live2D 渲染管线为 P1）+ 汇报气泡
 *   （最新 companion 行）+ 情绪状态 + 汇报流（近 20 条）；
 * - 下拉手势或点遮罩收起（上滑唤起由 ChatScreen 手势接线）。
 */
import { useEffect, useRef } from 'react'

import { useCompanionStore } from '@dionysus/client-core'

import { bindSwipe, detectSwipe } from '../gestures.js'
import { emotionLabel } from '../format.js'
import { navigate } from '../router.js'
import type { PersonaEntry } from '../stores/personaStore.js'
import { emotionIcon, Icon } from './Icon.js'
import { StaticPortrait } from './StaticPortrait.js'

export interface CharacterDrawerProps {
  open: boolean
  onClose(): void
  persona?: PersonaEntry
}

export function CharacterDrawer({
  open,
  onClose,
  persona,
}: CharacterDrawerProps) {
  const lines = useCompanionStore((s) => s.lines)
  const emotion = useCompanionStore((s) => s.currentEmotion)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  // 下拉收起（抽屉把手区域下滑手势）
  useEffect(() => {
    const el = sheetRef.current
    if (!el || !open) return
    return bindSwipe(el, (direction) => {
      if (direction === 'down') onClose()
    })
  }, [open, onClose])

  const latestLine = lines.length > 0 ? lines[lines.length - 1] : undefined
  const recent = lines.slice(-20).reverse()

  return (
    <div
      data-testid="character-drawer"
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
      className={`pointer-events-none fixed inset-0 z-40 ${open ? '' : 'invisible'}`}
    >
      {/* 遮罩：只覆盖顶部露出区（点按收起），抽屉本体之上无遮罩 */}
      <div
        data-testid="drawer-backdrop"
        onClick={onClose}
        className="absolute inset-x-0 top-0 h-[15%] bg-[var(--dn-backdrop)]"
        style={{ pointerEvents: open ? 'auto' : 'none' }}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="角色陪伴抽屉"
        className={`dn-drawer absolute inset-x-0 bottom-0 top-[15%] rounded-t-2xl bg-[var(--dn-panel-bg)] shadow-2xl ${
          open ? 'dn-drawer-open' : ''
        }`}
        style={{ pointerEvents: open ? 'auto' : 'none' }}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            dragStart.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            }
          }
        }}
        onTouchEnd={(e) => {
          const start = dragStart.current
          dragStart.current = null
          if (!start || e.changedTouches.length !== 1) return
          const direction = detectSwipe(start, {
            x: e.changedTouches[0].clientX,
            y: e.changedTouches[0].clientY,
          })
          if (direction === 'down') onClose()
        }}
      >
        {/* 把手 */}
        <div className="flex justify-center pb-1 pt-2">
          <div className="h-1 w-10 rounded-full bg-[var(--dn-border)]" />
        </div>
        <div className="flex items-center gap-2 px-4 pb-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--dn-fg)]">
            {persona?.name ?? '角色陪伴'}
          </span>
          <span
            data-testid="drawer-emotion"
            className="flex flex-none items-center gap-1 rounded-full bg-[var(--dn-button-secondary-bg)] px-2 py-0.5 text-xs text-[var(--dn-muted)]"
          >
            <Icon name={emotionIcon(emotion?.emotion)} size={12} />
            情绪：{emotionLabel(emotion?.emotion)}
          </span>
          <button
            type="button"
            data-testid="drawer-close"
            aria-label="收起抽屉"
            onClick={onClose}
            className="flex-none px-1 text-lg leading-none text-[var(--dn-muted)]"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {/* 立绘区（静态立绘 + 最新汇报气泡） */}
        <div className="h-[45%] px-4">
          <StaticPortrait
            portraitUrls={persona?.portraitUrls ?? {}}
            emotion={emotion?.emotion}
            line={latestLine?.text}
            characterName={persona?.name}
          />
        </div>
        {/* 汇报流 */}
        <div
          data-testid="drawer-companion-lines"
          className="mt-3 h-[calc(55%-5.5rem)] overflow-y-auto border-t border-[var(--dn-border)] px-4 py-2"
        >
          {recent.length === 0 ? (
            <p className="py-4 text-center text-xs text-[var(--dn-muted)]">
              还没有汇报。agent 工作起来后角色会在这里播报进展。
            </p>
          ) : (
            recent.map((l) => (
              <div key={l.id} className="mb-2 text-sm leading-relaxed text-[var(--dn-fg)]">
                {l.sourceTitle && (
                  <button
                    type="button"
                    onClick={() => {
                      if (l.sourceSessionId) {
                        onClose()
                        navigate({ name: 'chat', sessionId: l.sourceSessionId })
                      }
                    }}
                    className="mr-1 text-xs text-[var(--dn-accent)]"
                  >
                    来自：{l.sourceTitle}
                  </button>
                )}
                <span className={l.scope === 'global' ? 'text-[var(--dn-muted)]' : ''}>
                  {l.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
