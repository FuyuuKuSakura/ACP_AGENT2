/**
 * companion/touch — Live2D 触摸互动的纯前端决策（ADR-16）。
 *
 * 点击模型的头部/身体区域，从 persona companion.touch_zones 对应 zone 的
 * lines 本地随机选句 + 取对应 expression，全程不经 core、不占协议消息。
 * 容错：touch_zones 缺失 / zone 未配置 / lines 为空 → 返回 null（UI 无反应）。
 */
import type { TouchZoneConfig } from './config.js'

export type TouchZoneName = 'head' | 'body'

/** 头部区域阈值：相对高度（顶部为 0）小于该值视为头部，否则身体 */
export const HEAD_ZONE_RATIO = 0.35

/**
 * 简单上下半区命中判定（pixi hit 检测的从简方案，ux §4 允许）：
 * relY = 点击相对容器顶部的高度占比（0..1）。
 */
export function hitZoneFromPoint(relY: number): TouchZoneName {
  return relY < HEAD_ZONE_RATIO ? 'head' : 'body'
}

export interface TouchReaction {
  line: string
  expression?: string
}

/** 从 touch_zones 选句；zone 未配置或 lines 为空返回 null（缺失容错）。 */
export function pickTouchReaction(
  touchZones: Record<string, TouchZoneConfig>,
  zone: TouchZoneName,
  random: () => number = Math.random,
): TouchReaction | null {
  const cfg = touchZones[zone]
  if (!cfg || cfg.lines.length === 0) return null
  const line = cfg.lines[Math.floor(random() * cfg.lines.length)]
  return { line, expression: cfg.expression }
}
