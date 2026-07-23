/**
 * 列表/时间纯展示 helpers（与 webview sidebar/format.ts 同规格，
 * ux-core-flows.md §2.2；client-core 未导出，mobile 自持一份）。
 */
import type { SessionStatus } from '@dionysus/protocol'

export interface DigestSummarySource {
  status: SessionStatus
  currentAction?: string
  todoProgress?: { done: number; total: number }
}

/**
 * 一行摘要（§2.2）：进行中优先 todo 进度 + 当前动作（`3/7 · 正在改 auth.ts`），
 * 无 todo 退化为 currentAction；其余状态 currentAction 缺省给兜底文案。
 */
export function formatDigestSummary(d: DigestSummarySource): string {
  if (d.status === 'running') {
    if (d.todoProgress && d.todoProgress.total > 0) {
      const action = d.currentAction ? ` · ${d.currentAction}` : ''
      return `${d.todoProgress.done}/${d.todoProgress.total}${action}`
    }
    return d.currentAction ?? '进行中'
  }
  switch (d.status) {
    case 'waiting_option':
      return d.currentAction ?? '等待你的决策'
    case 'error':
      return d.currentAction ?? '出错了'
    case 'done':
      return d.currentAction ?? '已完成'
    case 'idle':
      return d.currentAction ?? '空闲'
  }
}

/**
 * 会话状态 → 中文显示文案（protocol SessionStatus 枚举为准，仅显示层映射；
 * ux-core-flows.md §5「不出现黑话」，两端共用口径）。
 */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: '空闲',
  running: '进行中',
  waiting_option: '待决策',
  error: '出错',
  done: '已完成',
}

/** 情绪枚举 → 中文名（emotion_update 的 emotion 为自由字符串，未知值回退「平静」）。 */
export const EMOTION_LABEL: Record<string, string> = {
  happy: '开心',
  calm: '平静',
  confident: '自信',
  neutral: '平静',
  bored: '无聊',
  worried: '担心',
  surprised: '惊讶',
  annoyed: '恼火',
  thinking: '思考中',
  working: '工作中',
  success: '有进展',
  error: '出错',
  idle: '休息中',
}

export function emotionLabel(emotion?: string): string {
  return (emotion && EMOTION_LABEL[emotion]) || '平静'
}

/** 相对时间：<1 分钟「刚刚」，其后分钟/小时/天。 */
export function formatRelativeTime(ts: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

const AVATAR_COLORS = [
  'var(--dn-avatar-1)',
  'var(--dn-avatar-2)',
  'var(--dn-avatar-3)',
  'var(--dn-avatar-4)',
  'var(--dn-avatar-5)',
  'var(--dn-avatar-6)',
] as const

/** 无头像图时的首字母色块底色（按会话 key 散列，稳定）。 */
export function avatarColorFor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/** 首字母色块显示字符（会话名首字符，缺省「·」）。 */
export function avatarInitial(title: string): string {
  const trimmed = title.trim()
  return trimmed.length > 0 ? [...trimmed][0].toUpperCase() : '·'
}
