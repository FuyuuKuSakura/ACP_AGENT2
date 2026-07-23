/**
 * CompanionArea — Live2D 陪伴区（architecture.md §7 / ux-core-flows.md §4）。
 *
 * - 展示模式分流：settingsStore.displayMode === 'live2d' 且有 live2d 素材 →
 *   Live2DViewer；否则 StaticPortrait（含模型加载失败自动降级 + console.warn）；
 * - 旁白气泡滚动面板位于角色头顶上方（ux §4.1：常驻、跨会话切换不消失、不遮挡
 *   输入区——陪伴区在聊天列右侧；设计要求 2：角色底部锚定不垂直居中，气泡区
 *   flex-1 铺满角色上方，全部历史可滚动，最久在顶、最新贴角色头顶）；
 * - 触摸互动（ADR-16 纯前端）：命中区域 → 本地选句进气泡 + 播对应 expression；
 * - emotion_update 联动：表情/动作切换（Live2DViewer）或立绘贴图切换
 *   （StaticPortrait emotion）+ 气泡旁情绪徽记（emotionIcon）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useCompanionStore, useSettingsStore } from '@dionysus/client-core'

import type { Live2DHandle } from '../../live2d-viewer.js'
import { switchToSession } from '../chat/chatActions.js'
import { StaticPortrait } from '../StaticPortrait.js'
import { CompanionBubbles } from './CompanionBubbles.js'
import { Live2DViewer } from './Live2DViewer.js'
import { useCompanionConfigStore } from './config.js'
import { pickTouchReaction } from './touch.js'
import type { TouchZoneName } from './touch.js'

export function CompanionArea() {
  const displayMode = useSettingsStore((s) => s.displayMode)
  const config = useCompanionConfigStore((s) => s.config)
  const lines = useCompanionStore((s) => s.lines)
  const emotion = useCompanionStore((s) => s.currentEmotion)

  const [live2dFailed, setLive2dFailed] = useState(false)
  const handleRef = useRef<Live2DHandle | null>(null)

  // persona/展示模式切换时重置失败态（新模型重新尝试 live2d）
  useEffect(() => {
    setLive2dFailed(false)
  }, [config.modelUrl, displayMode])

  const onLive2DError = useCallback((err: unknown) => {
    console.warn('[dionysus] Live2D 加载失败，降级静态立绘：', err)
    setLive2dFailed(true)
  }, [])

  const onViewerReady = useCallback((handle: Live2DHandle | null) => {
    handleRef.current = handle
  }, [])

  // 触摸（ADR-16）：本地随机选句 + 播对应 expression，不经 core
  const onTouchZone = useCallback(
    (zone: TouchZoneName) => {
      const reaction = pickTouchReaction(config.touchZones, zone)
      if (!reaction) return
      useCompanionStore.getState().addLine({
        text: reaction.line,
        scope: 'session',
        ts: Date.now(),
      })
      void handleRef.current?.playExpression(reaction.expression)
    },
    [config.touchZones],
  )

  const wantLive2D =
    displayMode === 'live2d' && Boolean(config.modelUrl) && !live2dFailed

  return (
    <div
      data-testid="companion-area"
      className="relative flex h-full w-full flex-col overflow-hidden bg-[var(--dn-panel-bg)]"
    >
      {/* endfield 顶部细刻度线（minimal 几何点缀，色走 --dn-muted 即 vscode token） */}
      <div aria-hidden className="dn-ticks flex-none" />
      {/* 气泡区：flex-1 占满角色上方空间，内部为全量滚动面板（CompanionBubbles
          自身 flex-1 铺满此区，justify-end 仅兜空态）；无台词时此区为空但布局不变形 */}
      <div className="flex min-h-0 flex-1 flex-col justify-end p-2 pb-1">
        <CompanionBubbles
          lines={lines}
          currentEmotion={emotion?.emotion}
          onJumpSource={switchToSession}
        />
      </div>
      {/* 角色区：固定锚定列底（设计要求 2），Live2D canvas / 立绘底部与列底对齐 */}
      <div data-testid="companion-stage" className="h-[55%] w-full shrink-0">
        {wantLive2D ? (
          <Live2DViewer
            modelUrl={config.modelUrl!}
            live2d={config.live2d}
            emotion={emotion}
            onError={onLive2DError}
            onTouchZone={onTouchZone}
            onReady={onViewerReady}
          />
        ) : (
          <StaticPortrait
            portraitUrls={config.portraitUrls ?? {}}
            emotion={emotion?.emotion}
            characterName={config.name}
          />
        )}
      </div>
    </div>
  )
}
