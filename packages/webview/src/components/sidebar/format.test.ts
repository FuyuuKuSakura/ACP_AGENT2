import { describe, expect, it } from 'vitest'

import {
  adapterBadgeLabel,
  avatarColorFor,
  avatarInitial,
  formatDigestSummary,
  formatRelativeTime,
} from './format.js'

describe('formatDigestSummary', () => {
  it('running + todo 进度：`3/7 · 正在改 auth.ts` 格式（todoProgress 优先）', () => {
    expect(
      formatDigestSummary({
        status: 'running',
        currentAction: '正在改 auth.ts',
        todoProgress: { done: 3, total: 7 },
      }),
    ).toBe('3/7 · 正在改 auth.ts')
  })

  it('running 无 todo：退化为 currentAction', () => {
    expect(
      formatDigestSummary({
        status: 'running',
        currentAction: '正在读取 auth.ts',
      }),
    ).toBe('正在读取 auth.ts')
  })

  it('running 有 todo 但无 currentAction：只显示进度', () => {
    expect(
      formatDigestSummary({
        status: 'running',
        todoProgress: { done: 3, total: 7 },
      }),
    ).toBe('3/7')
  })

  it('各状态无 currentAction 时的兜底文案', () => {
    expect(formatDigestSummary({ status: 'running' })).toBe('进行中')
    expect(formatDigestSummary({ status: 'waiting_option' })).toBe(
      '等待你的决策',
    )
    expect(formatDigestSummary({ status: 'error' })).toBe('出错了')
    expect(formatDigestSummary({ status: 'done' })).toBe('已完成')
    expect(formatDigestSummary({ status: 'idle' })).toBe('空闲')
  })
})

describe('formatRelativeTime', () => {
  const now = 1_000_000_000_000

  it('刚刚 / 分钟 / 小时 / 天', () => {
    expect(formatRelativeTime(now - 20_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3 分钟前')
    expect(formatRelativeTime(now - 5 * 3_600_000, now)).toBe('5 小时前')
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 天前')
  })

  it('未来时间不产生负值', () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe('刚刚')
  })
})

describe('avatar 首字母色块', () => {
  it('同一 key 颜色稳定，且走 --dn-avatar-* token（vscode.css 映射主题变量）', () => {
    const a = avatarColorFor('重构 auth')
    expect(a).toBe(avatarColorFor('重构 auth'))
    expect(a).toMatch(/^var\(--dn-avatar-[1-6]\)$/)
  })

  it('首字符大写，空标题兜底', () => {
    expect(avatarInitial('重构 auth')).toBe('重')
    expect(avatarInitial('auth')).toBe('A')
    expect(avatarInitial('  ')).toBe('·')
  })
})

describe('adapterBadgeLabel', () => {
  it('去 _cli 后缀取首字母大写', () => {
    expect(adapterBadgeLabel('kimi_cli')).toBe('K')
    expect(adapterBadgeLabel('claude_cli')).toBe('C')
    expect(adapterBadgeLabel('opencode')).toBe('O')
    expect(adapterBadgeLabel('my_kimi')).toBe('M')
  })

  it('无字母/数字时兜底「?」', () => {
    expect(adapterBadgeLabel('')).toBe('?')
    expect(adapterBadgeLabel('_cli')).toBe('?')
  })
})
