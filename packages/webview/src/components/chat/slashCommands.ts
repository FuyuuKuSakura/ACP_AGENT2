/**
 * 斜杠命令候选元数据（ux-core-flows.md §5：候选列表 + 一句话白话说明）。
 * 命令行为以 core session/commands.ts 分发表为准，这里只是输入框提示。
 */
export interface SlashCommandHint {
  command: string
  description: string
}

export const SLASH_COMMANDS: readonly SlashCommandHint[] = [
  { command: '/new', description: '创建新会话' },
  { command: '/sessions', description: '列出全部会话' },
  { command: '/resume', description: '恢复 CLI 会话（用法：/resume <cliSessionId>）' },
]

/** 输入以 / 开头时按前缀过滤候选；返回空数组表示不弹候选。 */
export function filterSlashCommands(input: string): SlashCommandHint[] {
  if (!input.startsWith('/')) return []
  // 已含空格（在输参数）时不再提示
  if (/\s/.test(input.trimStart())) return []
  return SLASH_COMMANDS.filter((c) => c.command.startsWith(input.trimStart()))
}
