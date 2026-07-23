/**
 * sidebar 会话列表出口（role='sidebar' 视图；main.tsx 经默认导出拿到 SidebarApp）。
 */
export { default } from './SidebarApp.js'
export { default as SidebarApp } from './SidebarApp.js'
export type { SidebarAppProps } from './SidebarApp.js'
export { AggregateBar } from './AggregateBar.js'
export type { AggregateBarProps } from './AggregateBar.js'
export { SessionListItem, STATUS_DOT } from './SessionListItem.js'
export type { SessionListItemProps } from './SessionListItem.js'
export {
  avatarColorFor,
  avatarInitial,
  formatDigestSummary,
  formatRelativeTime,
} from './format.js'
export type { DigestSummarySource } from './format.js'
