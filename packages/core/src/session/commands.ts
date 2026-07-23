/**
 * 斜杠命令子系统（architecture.md §5.3）：分发表替代 v2 的 if 链，
 * 独立于 SessionManager 的回合管线。
 *
 * 每条命令返回要回发给客户端的 system_notice 列表（由宿主广播）；
 * Kimi 等 CLI 专有命令用 cliSpecific 标注并委托策略侧能力接口（Phase 4 补全）。
 */
import type { ServerMessage, SystemNoticePayload } from '@dionysus/protocol'

import type { SessionManager } from './manager.js'

export interface SlashCommandContext {
  manager: SessionManager
  /** 命令发起的会话（/resume 等需要）；全局命令可缺省 */
  sessionId?: string
  /** 命令参数（client_command 的 args or text，沿用 v2 语义） */
  args: string
  /** 来源标识（多端回显/标注用） */
  origin: string
}

export interface SlashCommand {
  description: string
  /** CLI 专有命令标注（如 'kimi'），通用命令省略 */
  cliSpecific?: string
  handler: (ctx: SlashCommandContext) => Promise<SystemNoticePayload[]>
}

function notice(text: string, level: 'info' | 'warning' | 'error' = 'info'): SystemNoticePayload {
  return { text, level }
}

/** 分发表：Phase 2 先实现 /new、/sessions、/resume 三条。 */
export function createSlashCommands(): Record<string, SlashCommand> {
  return {
    '/new': {
      description: '创建新会话',
      handler: async (ctx) => {
        const meta = await ctx.manager.createSession()
        return [notice(`已创建新会话：${meta.title}（${meta.id}）`)]
      },
    },
    '/sessions': {
      description: '列出全部会话（含当前目录下的 CLI 历史会话）',
      handler: async (ctx) => {
        const sessions = await ctx.manager.listSessions()
        const lines = sessions.length
          ? sessions.map((s) => `${s.corrupt ? '[损坏] ' : ''}${s.title}（${s.id}）— ${s.status}`)
          : ['当前没有会话，可用 /new 创建']
        // CLI 历史会话段（cliSpecific 委托框架：经 manager 委托策略侧索引能力，
        // kimi 读 ~/.kimi-code/session_index.jsonl，语义对齐 legacy _cmd_list_kimi_sessions）
        if (ctx.sessionId) {
          try {
            const cli = await ctx.manager.listCliSessions(ctx.sessionId)
            if (!cli.supported) {
              lines.push('', '当前助手暂不支持列出 CLI 历史会话')
            } else if (cli.sessions.length === 0) {
              lines.push('', '该工作目录下没有 CLI 历史会话')
            } else {
              lines.push('', 'CLI 历史会话（用 /resume <id> 恢复）：')
              for (const s of cli.sessions.slice(0, 20)) {
                const time = s.updatedAt ? ` — ${new Date(s.updatedAt).toLocaleString()}` : ''
                lines.push(`• ${s.id}${s.title ? ` — ${s.title}` : ''}${time}`)
              }
            }
          } catch {
            // 会话刚被删除等竞态：CLI 段省略，不影响主列表
          }
        }
        return [notice(lines.join('\n'))]
      },
    },
    '/resume': {
      description: '恢复 CLI 会话（用法：/resume <cliSessionId>）',
      handler: async (ctx) => {
        if (!ctx.sessionId) return [notice('/resume 需要在会话上下文中使用', 'error')]
        const cliSessionId = ctx.args.trim()
        if (!cliSessionId) return [notice('用法：/resume <cliSessionId>', 'error')]
        // 委托 adapter.switchSession（v3 正式可选方法，不再靠 hasattr 探测）
        await ctx.manager.switchCliSession(ctx.sessionId, cliSessionId)
        return [notice(`已请求恢复 CLI 会话：${cliSessionId}`)]
      },
    },
  }
}

/**
 * 执行斜杠命令。未知命令回 error 级 system_notice。
 * 返回的 notice 列表由宿主包装为 system_notice 消息广播。
 */
export async function executeSlashCommand(
  command: string,
  ctx: SlashCommandContext,
  commands: Record<string, SlashCommand> = createSlashCommands(),
): Promise<SystemNoticePayload[]> {
  const entry = commands[command]
  if (!entry) return [notice(`未知命令：${command}`, 'error')]
  return entry.handler(ctx)
}

/** 把命令结果包装成 system_notice 消息（宿主可直接 broadcast）。 */
export function noticesToMessages(
  notices: SystemNoticePayload[],
  sessionId: string | undefined,
  ts: number,
): ServerMessage[] {
  return notices.map((payload) => ({
    v: 1 as const,
    type: 'system_notice' as const,
    ...(sessionId ? { sessionId } : {}),
    ts,
    payload,
  }))
}
