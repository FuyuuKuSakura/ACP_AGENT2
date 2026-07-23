/**
 * sidebar 会话列表的纯展示 helpers（ux-core-flows.md §2.2）：
 * 一行摘要格式、相对时间、首字母色块配色。全部纯函数，可单测。
 */
import type { SessionStatus } from '@dionysus/protocol'

/** 摘要行数据源的最小形状（与 digestStore.DigestEntry 兼容）。 */
export interface DigestSummarySource {
  status: SessionStatus
  currentAction?: string
  todoProgress?: { done: number; total: number }
}

/**
 * 一行摘要（§2.2）：
 * - 进行中优先 todo 进度 + 当前动作（`3/7 · 正在改 auth.ts`），无 todo 退化为 currentAction；
 * - 其余状态显示 currentAction，缺省时给状态兜底文案。
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

/** 相对时间（§2.2「3 分钟前」）：<1 分钟「刚刚」，其后分钟/小时/天。 */
export function formatRelativeTime(ts: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * 无头像图时的首字母色块底色（§2.2）：按会话 key 散列到
 * --dn-avatar-* token（vscode.css 映射 var(--vscode-charts-*)），
 * 保证同一会话颜色稳定且跟随 VS Code 主题。
 */
const AVATAR_COLORS = [
  'var(--dn-avatar-1)',
  'var(--dn-avatar-2)',
  'var(--dn-avatar-3)',
  'var(--dn-avatar-4)',
  'var(--dn-avatar-5)',
  'var(--dn-avatar-6)',
] as const

export function avatarColorFor(key: string): string {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/** 首字母色块显示的字符（会话名首字符，缺省「·」）。 */
export function avatarInitial(title: string): string {
  const trimmed = title.trim()
  return trimmed.length > 0 ? [...trimmed][0].toUpperCase() : '·'
}

/**
 * adapter 徽标缩写（ux-core-flows §2.2「头像右下角小圆标」）：
 * 去掉 `_cli` 后缀取首个字母/数字并大写（`kimi_cli` → `K`），
 * 无可用字符时兜底「?」。
 */
export function adapterBadgeLabel(adapterId: string): string {
  const base = adapterId.replace(/_cli$/, '')
  const ch = base.match(/[a-z0-9]/i)?.[0]
  return ch ? ch.toUpperCase() : '?'
}
