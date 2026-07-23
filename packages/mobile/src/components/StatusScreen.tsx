/**
 * 工作状态全屏页（ux-core-flows.md §6.2）：「这个 agent 具体干到哪了」。
 * 对话页左滑进入、右滑返回；内容为 todo 进度 + 操作时间线明细 + 汇报流。
 */
import { useEffect, useRef } from 'react'

import {
  selectSession,
  selectStreamState,
  useCompanionStore,
  useDigestStore,
  useSessionStore,
  useStreamStore,
} from '@dionysus/client-core'

import { bindSwipe } from '../gestures.js'
import { STATUS_LABEL } from '../format.js'
import { navigate } from '../router.js'
import { Icon } from './Icon.js'
import { ReconnectBanner } from './ReconnectBanner.js'
import { KIND_VERB } from './ToolCallChips.js'

export interface StatusScreenProps {
  sessionId: string
}

export function StatusScreen({ sessionId }: StatusScreenProps) {
  const session = useSessionStore((s) => selectSession(s, sessionId))
  const stream = useStreamStore((s) => selectStreamState(s, sessionId))
  const digest = useDigestStore((s) => s.digests[sessionId])
  const companionLines = useCompanionStore((s) => s.lines)
  const rootRef = useRef<HTMLDivElement>(null)

  // 右滑返回对话页（与左滑进入对称，§6.2）
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    return bindSwipe(el, (direction) => {
      if (direction === 'right') navigate({ name: 'chat', sessionId })
    })
  }, [sessionId])

  const todos = stream?.todoItems ?? []
  const todoDone = todos.filter((t) => t.done).length
  const toolCalls = stream?.toolCalls ?? []
  // 汇报流：本会话来源的汇报 + fleet 级 global 播报
  const lines = companionLines.filter(
    (l) => l.sourceSessionId === sessionId || l.scope === 'global',
  )

  return (
    <div ref={rootRef} data-testid="status-screen" className="flex h-full flex-col">
      <header className="flex flex-none items-center gap-2 border-b border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-2.5">
        <button
          type="button"
          data-testid="status-back"
          aria-label="返回对话"
          onClick={() => navigate({ name: 'chat', sessionId })}
          className="flex-none px-1 text-lg text-[var(--dn-accent)]"
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="min-w-0 flex-1 truncate text-base font-semibold">
          {session?.title || digest?.title || '工作状态'}
        </span>
        <span data-testid="status-header-label" className="flex-none text-xs text-[var(--dn-muted)]">
          {digest ? STATUS_LABEL[digest.status] : ''}
        </span>
      </header>
      <ReconnectBanner />
      {/* endfield 校准刻度线：工作状态舞台顶部装饰 */}
      <div aria-hidden className="dn-ticks flex-none" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* todo 进度（endfield 分区 01：大型编号步骤 + 信号黄进度） */}
        <section data-testid="status-todo" className="border-b border-[var(--dn-border)] px-4 py-3">
          <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
            <span aria-hidden className="dn-micro-label text-[10px] text-[var(--dn-muted)]">
              01 / TODO
            </span>
            任务进度
          </h2>
          {todos.length === 0 ? (
            <p className="text-xs text-[var(--dn-muted)]">本回合还没有任务清单。</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-[var(--dn-radius-sm)] bg-[var(--dn-border)]">
                  <div
                    data-testid="todo-progress-bar"
                    className="h-full bg-[var(--dn-signal)] transition-all"
                    style={{
                      width: `${todos.length > 0 ? Math.round((todoDone / todos.length) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span data-testid="todo-progress-text" className="dn-display flex-none text-xs text-[var(--dn-muted)]">
                  {String(todoDone).padStart(2, '0')}/{String(todos.length).padStart(2, '0')}
                </span>
              </div>
              <ul className="space-y-1.5">
                {todos.map((t, i) => {
                  // 当前步骤 = 第一个未完成项，编号着 accent 色（endfield
                  // 大型编号承载「走到哪了」，浅色为墨、深色为信号黄）
                  const isCurrent = !t.done && todos.findIndex((x) => !x.done) === i
                  return (
                    <li key={t.id} className="flex items-start gap-2 text-sm">
                      <span
                        aria-hidden
                        className={`dn-display w-7 flex-none text-right text-base leading-tight ${
                          isCurrent
                            ? 'font-semibold text-[var(--dn-accent)]'
                            : t.done
                              ? 'text-[var(--dn-muted)]'
                              : 'text-[var(--dn-fg)]'
                        }`}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={`mt-0.5 flex-none ${t.done ? 'text-[var(--dn-success)]' : 'text-[var(--dn-muted)]'}`}
                      >
                        <Icon
                          name={t.done ? 'checkbox-checked' : 'checkbox'}
                          size={14}
                          title={t.done ? '已完成' : '待办'}
                        />
                      </span>
                      <span className={t.done ? 'text-[var(--dn-muted)] line-through' : ''}>
                        {t.text}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
        {/* 操作时间线明细 */}
        <section data-testid="status-timeline" className="border-b border-[var(--dn-border)] px-4 py-3">
          <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
            <span aria-hidden className="dn-micro-label text-[10px] text-[var(--dn-muted)]">
              02 / OPS
            </span>
            操作时间线（{toolCalls.length} 项）
          </h2>
          {toolCalls.length === 0 ? (
            <p className="text-xs text-[var(--dn-muted)]">还没有工具调用。</p>
          ) : (
            <ol className="space-y-1.5">
              {toolCalls.map((t, i) => (
                <li
                  key={t.toolCallId}
                  data-testid={`timeline-item-${i}`}
                  className="flex items-baseline gap-2 text-sm"
                >
                  <span className="dn-display flex-none text-xs text-[var(--dn-muted)]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[var(--dn-fg)]">
                      {KIND_VERB[t.kind] ?? KIND_VERB.other}
                    </span>{' '}
                    <span className="text-[var(--dn-accent)]">{t.displayTarget || t.name}</span>
                  </span>
                  <span
                    className={`flex-none ${
                      !t.result
                        ? 'text-xs text-[var(--dn-accent)]'
                        : t.result.ok
                          ? 'text-[var(--dn-success)]'
                          : 'text-[var(--dn-error)]'
                    }`}
                  >
                    {!t.result ? (
                      '进行中'
                    ) : (
                      <Icon
                        name={t.result.ok ? 'done' : 'error'}
                        size={13}
                        title={t.result.ok ? '成功' : '失败'}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        {/* 汇报流 */}
        <section data-testid="status-companion-feed" className="px-4 py-3">
          <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
            <span aria-hidden className="dn-micro-label text-[10px] text-[var(--dn-muted)]">
              03 / LOG
            </span>
            汇报流
          </h2>
          {lines.length === 0 ? (
            <p className="text-xs text-[var(--dn-muted)]">还没有汇报。</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.id} className="text-sm leading-relaxed">
                  <span className="mr-1.5 text-xs text-[var(--dn-muted)]">
                    {new Date(l.ts).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {l.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
