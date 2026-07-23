/**
 * Claude Code CLI 策略（extract/adapters.md §5.2）。
 *
 * 怪癖（按文档原样实现）：
 * - resume 用 --continue --session-id <id> 两个参数同时给——--continue 语义是
 *   "继续最近会话"，与显式 --session-id 叠加是 v2 既有写法（claude.py:43）；
 * - buildArgs 从不加 --output-format：server.yaml 的 output_format 对 claude 是死配置；
 * - yolo 与 normal 参数无区别——--dangerously-skip-permissions 本来就恒加。
 */
import type { AgentEvent, AgentInput } from '../types.js'
import { JsonStreamStrategy, isRecord, type AdapterContext } from '../strategy.js'

export class ClaudeStrategy extends JsonStreamStrategy {
  readonly adapterId = 'claude_cli'
  override readonly supportsModel = true

  /**
   * build_args 完整规则（extract §5.2）：
   * plan/plan_yolo → text 前加英文前缀；["-p", text]
   * + ["--continue", "--session-id", sid]（仅 resume）
   * + ["--model", model]（仅非空 model）
   * + ["--dangerously-skip-permissions"]（恒加）。
   */
  buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
    const mode = input.mode ?? 'normal'

    let text = input.text
    if (mode === 'plan' || mode === 'plan_yolo') {
      text = this.planModePrefix + text
    }

    const args: string[] = ['-p', text]
    if (ctx.cliSessionId != null && ctx.cliSessionId !== '') {
      // --continue 与 --session-id 叠加是 v2 既有写法（extract §5.2 怪癖 1）
      args.push('--continue', '--session-id', ctx.cliSessionId)
    }
    const model = ctx.config.model
    if (typeof model === 'string' && model.trim()) {
      args.push('--model', model.trim())
    }
    // 恒加：normal 与 yolo 在参数层面无区别（extract §5.2 怪癖 3）
    args.push('--dangerously-skip-permissions')
    return args
  }

  /** 任何带 session_id 字段的 JSON 行都更新会话 id（extract §5.2 session 捕获）。 */
  protected override extractSessionId(parsed: Record<string, unknown>): string | undefined {
    return typeof parsed.session_id === 'string' && parsed.session_id
      ? parsed.session_id
      : undefined
  }

  /**
   * claude 方言三个自有分支（extract §5.2 映射表），不匹配落回基类 kimi 方言：
   * 1. content_block_delta / message_delta → status + stream 双事件
   * 2. tool_use / tool_result → 结构化 tool_call / tool_result（v3 取代 v2 emoji 文本）
   * 3. 顶层字符串 result（--output-format json 结果信封）→ stream
   */
  protected override normalizeObject(parsed: Record<string, unknown>): AgentEvent[] {
    const msgType = parsed.type

    if (msgType === 'content_block_delta' || msgType === 'message_delta') {
      const delta = isRecord(parsed.delta) ? parsed.delta : {}
      const text =
        typeof delta.text === 'string' && delta.text
          ? delta.text
          : typeof parsed.text === 'string'
            ? parsed.text
            : ''
      if (!text) return []
      return this.textBlockEvents(text, 'Claude 正在输出...')
    }

    if (msgType === 'tool_use' || msgType === 'tool_result') {
      if (msgType === 'tool_use') {
        const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : 'tool'
        const args = isRecord(parsed.input) ? parsed.input : {}
        const nativeId = typeof parsed.id === 'string' && parsed.id ? parsed.id : undefined
        return [this.makeToolCall(name, args, nativeId)]
      }
      const content = typeof parsed.content === 'string' ? parsed.content : ''
      if (!content) return []
      return [this.makeToolResult(content)]
    }

    if (typeof parsed.result === 'string' && parsed.result) {
      return [this.streamEvent(parsed.result)]
    }

    return super.normalizeObject(parsed)
  }
}
