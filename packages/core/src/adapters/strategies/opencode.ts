/**
 * OpenCode CLI 策略（extract/adapters.md §5.4）。
 *
 * 怪癖（按文档原样实现）：
 * - working_dir 被消费两次：GenericCliAdapter 用它做子进程 cwd，策略又把它拼成
 *   --dir；且 --dir 传的是未解析的原始配置值（可能是相对路径），潜在不一致；
 * - output_format 默认 "json" 而非 "stream-json"，与其余 CLI 不同；
 * - R-7：extract 的映射表中没有 opencode 的 tool_result 行（architecture.md §5.2
 *   标注待真实 CLI 录制验证），本实现只产 tool_call；若后续录制确认存在
 *   tool_result 行，需在此补充分支。
 */
import type { AgentEvent, AgentInput } from '../types.js'
import { JsonStreamStrategy, isRecord, type AdapterContext } from '../strategy.js'

export class OpenCodeStrategy extends JsonStreamStrategy {
  readonly adapterId = 'opencode_cli'
  override readonly supportsModel = true

  /**
   * build_args 完整规则（extract §5.4）：
   * plan/plan_yolo → text 前加英文前缀；
   * ["run", "--format", output_format]（默认 "json"）
   * + ["--model", model]（仅非空）+ ["--dir", workingDir]（仅非空）
   * + ["--session", sid]（仅 resume）+ ["--auto-approve"]（仅 yolo/plan_yolo）
   * + [text]（位置参数）。
   */
  buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
    const mode = input.mode ?? 'normal'
    const outputFormat =
      typeof ctx.config.outputFormat === 'string' && ctx.config.outputFormat
        ? ctx.config.outputFormat
        : 'json'

    let text = input.text
    if (mode === 'plan' || mode === 'plan_yolo') {
      text = this.planModePrefix + text
    }

    const args: string[] = ['run', '--format', outputFormat]
    const model = ctx.config.model
    if (typeof model === 'string' && model.trim()) {
      args.push('--model', model.trim())
    }
    // --dir 传未解析的原始配置值（extract §5.4 怪癖 1）
    if (typeof ctx.config.workingDir === 'string' && ctx.config.workingDir) {
      args.push('--dir', ctx.config.workingDir)
    }
    if (ctx.cliSessionId != null && ctx.cliSessionId !== '') {
      args.push('--session', ctx.cliSessionId)
    }
    if (mode === 'yolo' || mode === 'plan_yolo') {
      args.push('--auto-approve')
    }
    args.push(text)
    return args
  }

  /** 兼容三种键名（extract §5.4 session 捕获）。 */
  protected override extractSessionId(parsed: Record<string, unknown>): string | undefined {
    for (const key of ['session_id', 'session', 'sessionID']) {
      const v = parsed[key]
      if (typeof v === 'string' && v) return v
    }
    return undefined
  }

  /**
   * opencode 方言五个自有分支（extract §5.4 映射表 + step_* 静默），不匹配落回基类：
   * 0. step_start / step_finish → 零事件（步骤边界标记，不泄原始 JSON）
   * 1. message / agent_message / output → status + stream 双事件（content/text/message 取值链）
   * 2. text → 双事件；取嵌套 part.text，兼容顶层 text 兜底（`opencode run --format json`
   *    实际发出的就是这种）
   * 3. tool_call / tool → 结构化 tool_call（R-7：无 tool_result 行，只产 tool_call）
   * 4. 顶层字符串 result → stream
   */
  protected override normalizeObject(parsed: Record<string, unknown>): AgentEvent[] {
    const msgType = parsed.type

    // step_start/step_finish 是步骤边界标记（extract §5.4 映射表无对应语义、
    // 无用户正文）→ 静默吞掉，不泄原始 JSON 进 agent_stream；
    // sessionID 捕获已由 extractSessionId 在此之前完成。
    if (msgType === 'step_start' || msgType === 'step_finish') {
      return []
    }

    if (msgType === 'message' || msgType === 'agent_message' || msgType === 'output') {
      const content = this.pickContent(parsed)
      if (!content) return []
      return this.textBlockEvents(content, 'OpenCode 正在输出...')
    }

    if (msgType === 'text') {
      const part = isRecord(parsed.part) ? parsed.part : {}
      const text =
        typeof part.text === 'string' && part.text
          ? part.text
          : typeof parsed.text === 'string'
            ? parsed.text
            : ''
      if (!text) return []
      return this.textBlockEvents(text, 'OpenCode 正在输出...')
    }

    if (msgType === 'tool_call' || msgType === 'tool') {
      const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : 'tool'
      return [this.makeToolCall(name, parseArguments(parsed.arguments))]
    }

    if (typeof parsed.result === 'string' && parsed.result) {
      return [this.streamEvent(parsed.result)]
    }

    return super.normalizeObject(parsed)
  }
}

/** arguments 可能是 JSON 字符串，先 parse；非法时兜底 { raw }。 */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw
  if (typeof raw === 'string' && raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return { raw }
    }
  }
  return {}
}
