/**
 * 角色素材库共享类型（architecture.md §7「角色素材库系统」）。
 * webview / mobile / extension 三方共用，单一真源。
 */

/** 角色展示模式（per-device 可配，§6.5 dionysus.character.display.{desktop,mobile}） */
export type DisplayMode = 'live2d' | 'static'

/** 素材来源：出厂内嵌 assets/ 或用户目录 globalStorageUri/character-library/ */
export type CharacterAssetSource = 'builtin' | 'user'

export type CharacterAssetKind = 'live2d' | 'static'

/** 无匹配表情时的回退键 */
export const DEFAULT_EMOTION = 'default'

/**
 * 一个角色素材条目。同一角色可同时拥有 live2d 与 static 两个条目，
 * id 取 `${personaId}:${kind}`，用户目录同名 id 覆盖出厂（§7）。
 *
 * modelUrl / portraitUrls 的值一律为相对其素材根（builtin 为内嵌 assets/，
 * user 为 character-library/）的 POSIX 风格相对路径，由宿主
 * （webview.asWebviewUri 或 lan-server 的 /assets/* 路由）解析为可加载 URL。
 */
export interface CharacterAsset {
  /** 覆盖键：`${personaId}:${kind}` */
  id: string
  /** 展示名（persona YAML 的 name，缺省回退 personaId） */
  name: string
  personaId: string
  kind: CharacterAssetKind
  /** kind='live2d' 时存在：*.model3.json 的相对路径 */
  modelUrl?: string
  /** kind='static' 时存在：emotion → 立绘图片相对路径；至少含 DEFAULT_EMOTION 键 */
  portraitUrls?: Record<string, string>
  source: CharacterAssetSource
}

/**
 * 按当前 emotion 解析立绘路径：精确命中 → DEFAULT_EMOTION → 排序后的首个键。
 * 无可用立绘返回 undefined（调用方应显示占位而非裂图）。
 */
export function resolvePortraitUrl(
  portraitUrls: Record<string, string> | undefined,
  emotion: string | undefined,
): string | undefined {
  if (!portraitUrls) return undefined
  const keys = Object.keys(portraitUrls)
  if (keys.length === 0) return undefined
  if (emotion && portraitUrls[emotion]) return portraitUrls[emotion]
  if (portraitUrls[DEFAULT_EMOTION]) return portraitUrls[DEFAULT_EMOTION]
  return portraitUrls[keys.sort()[0]]
}
