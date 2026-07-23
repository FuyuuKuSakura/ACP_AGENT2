/**
 * 静态立绘（mobile 版，等价于 webview 的 StaticPortrait）。
 *
 * 复用评估：webview 的 StaticPortrait 是 70 行纯 UI 组件；移到 client-core
 * 共享需给 client-core 引入 React/TSX 构建（现为纯 TS tsc 包，无 react 依赖），
 * 构建拓扑成本大于收益——按「选简单方案」在 mobile 自持一份，立绘解析逻辑
 * （resolvePortraitUrl）仍复用 client-core 单份实现。
 *
 * 形态（architecture.md §7 静态立绘形态）：静态立绘 + 台词气泡，
 * emotion_update 仅驱动气泡文案与表情贴图切换；立绘底部锚定。
 */
import { resolvePortraitUrl } from '@dionysus/client-core'

export interface StaticPortraitProps {
  /** emotion → 立绘图片 URL（宿主已解析为可加载 URL）；至少应含 default 键 */
  portraitUrls: Record<string, string>
  /** 当前表情（emotion_update 驱动）；未命中回退 default */
  emotion?: string
  /** 当前台词文本；空则不渲染气泡 */
  line?: string
  /** 角色名（img alt 与气泡署名） */
  characterName?: string
}

export function StaticPortrait({
  portraitUrls,
  emotion,
  line,
  characterName,
}: StaticPortraitProps) {
  const src = resolvePortraitUrl(portraitUrls, emotion)
  const showBubble = Boolean(line && line.length > 0)

  return (
    <div
      data-testid="static-portrait"
      className="relative flex h-full w-full flex-col items-center justify-end overflow-hidden"
    >
      {showBubble && (
        <div
          data-testid="static-portrait-bubble"
          className="absolute left-1/2 top-2 z-10 w-[88%] -translate-x-1/2 rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)]/95 px-3 py-2 text-sm leading-relaxed text-[var(--dn-fg)] shadow-lg"
        >
          {characterName && (
            <div className="mb-0.5 text-xs font-semibold opacity-70">
              {characterName}
            </div>
          )}
          {line}
        </div>
      )}
      {src ? (
        <img
          key={src}
          data-testid="static-portrait-img"
          data-emotion={emotion ?? ''}
          src={src}
          alt={characterName ? `${characterName} 立绘` : '角色立绘'}
          className="max-h-full max-w-full object-contain transition-opacity duration-300"
          draggable={false}
        />
      ) : (
        <div
          data-testid="static-portrait-empty"
          className="flex h-full w-full items-center justify-center text-sm text-[var(--dn-muted)]"
        >
          未安装角色立绘素材
        </div>
      )}
    </div>
  )
}
