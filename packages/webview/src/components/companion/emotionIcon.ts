/**
 * companion/emotionIcon — emotion_update 的气泡旁情绪徽记（ux §4）。
 *
 * emotion 名由 persona 配置决定（协议层不枚举），这里只给常见情绪的默认映射；
 * 未知名返回 undefined（UI 不渲染），不持有角色专属内容。
 * 徽记为 Icon 组件的几何图形（配色 + 形状区分，非 emoji 表情）。
 * tone 为徽记语义色调（design-principles.md §6 V4）：error/success 类按语义
 * 着 --dn-error / --dn-success，其余 muted。
 */
import type { IconName } from '../Icon.js'

/** 徽记色调：着色决策在消费方 className 完成（Icon 本体 currentColor）。 */
export type EmotionTone = 'error' | 'success' | 'muted'

const EMOTION_META: Record<string, { icon: IconName; tone: EmotionTone }> = {
  happy: { icon: 'emotion-happy', tone: 'muted' },
  calm: { icon: 'emotion-calm', tone: 'muted' },
  confident: { icon: 'emotion-confident', tone: 'muted' },
  neutral: { icon: 'emotion-neutral', tone: 'muted' },
  bored: { icon: 'emotion-bored', tone: 'muted' },
  worried: { icon: 'emotion-worried', tone: 'muted' },
  surprised: { icon: 'emotion-surprised', tone: 'muted' },
  annoyed: { icon: 'emotion-annoyed', tone: 'muted' },
  thinking: { icon: 'emotion-thinking', tone: 'muted' },
  working: { icon: 'emotion-working', tone: 'muted' },
  success: { icon: 'emotion-success', tone: 'success' },
  error: { icon: 'emotion-error', tone: 'error' },
  idle: { icon: 'emotion-idle', tone: 'muted' },
}

export function emotionIcon(emotion: string | undefined): IconName | undefined {
  if (!emotion) return undefined
  return EMOTION_META[emotion]?.icon
}

export function emotionTone(emotion: string | undefined): EmotionTone {
  if (!emotion) return 'muted'
  return EMOTION_META[emotion]?.tone ?? 'muted'
}
