/**
 * CodeBuddy Code CLI 策略（extract/adapters.md §5.5）——5 个策略中解析最完整、
 * 唯一有真实测试 fixture（legacy/backend/tests/test_codebuddy_strategy.py）的一个。
 *
 * CodeBuddy ``--output-format stream-json`` 输出清单（v2 类 docstring 官方清单）：
 * - {"type":"system","subtype":"init","session_id":"<uuid>",...}
 * - {"type":"system","subtype":"status",...}
 * - {"type":"file-history-snapshot",...}（忽略）
 * - {"type":"assistant","message":{"content":[{"type":"thinking"|"text"|"tool_use"|"tool_result",...}]}}
 * - {"type":"result","subtype":"success|error","is_error":false,"result":"...","session_id":"..."}
 *
 * 怪癖（按文档原样实现）：
 * - --output-format stream-json 硬编码，outputFormat 配置键无效（死配置）；
 * - message.content 不是数组时直接丢弃整条消息；
 * - is_error 用 truthy 强转（字符串 "false" 也会判错）；
 * - result 错误的 errorMessage 兜底文案是中文 "CodeBuddy 执行出错"；
 * - -y 恒加（跳过权限确认），normal 与 yolo 参数无区别。
 */
import type { AgentEvent, AgentInput } from '../types.js'
import { JsonStreamStrategy, isRecord, type AdapterContext } from '../strategy.js'

export class CodeBuddyStrategy extends JsonStreamStrategy {
  readonly adapterId = 'codebuddy_cli'
  override readonly supportsModel = true

  /**
   * build_args 完整规则（extract §5.5）：
   * plan/plan_yolo → text 前加英文前缀；
   * ["-p", text, "--output-format", "stream-json"]（硬编码）
   * + ["--resume", sid]（仅 resume）+ ["--model", model]（仅非空）+ ["-y"]（恒加）。
   */
  buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
    const mode = input.mode ?? 'normal'

    let text = input.text
    if (mode === 'plan' || mode === 'plan_yolo') {
      text = this.planModePrefix + text
    }

    // stream-json 硬编码：outputFormat 配置键对 codebuddy 无效（extract §5.5 怪癖 4）
    const args: string[] = ['-p', text, '--output-format', 'stream-json']
    if (ctx.cliSessionId != null && ctx.cliSessionId !== '') {
      args.push('--resume', ctx.cliSessionId)
    }
    const model = ctx.config.model
    if (typeof model === 'string' && model.trim()) {
      args.push('--model', model.trim())
    }
    // 恒加：非交互模式，跳过权限确认
    args.push('-y')
    return args
  }

  /** 仅 system/init 行携带 session_id（extract §5.5 session 捕获）。 */
  protected override extractSessionId(parsed: Record<string, unknown>): string | undefined {
    if (
      parsed.type === 'system' &&
      parsed.subtype === 'init' &&
      typeof parsed.session_id === 'string' &&
      parsed.session_id
    ) {
      return parsed.session_id
    }
    return undefined
  }

  /**
   * codebuddy 方言四个顶层分支（extract §5.5 映射表），不匹配落回基类：
   * 1. system（所有 subtype）→ 零事件（init 的 session_id 已被 extractSessionId 消费）
   * 2. file-history-snapshot → 零事件（纯噪音）
   * 3. result → 仅 is_error truthy 时产 complete{status:'error'}；成功静默（成功
   *    complete 由适配器在退出码 0 后统一发）
   * 4. assistant → 遍历 message.content[] 内容块：text → 双事件；thinking → thinking
   *    事件（唯一会打 thinking 状态的策略）；tool_use → 结构化 tool_call；
   *    tool_result → 结构化 tool_result（v3 取代 v2 无 emoji 的展示文本）
   */
  protected override normalizeObject(parsed: Record<string, unknown>): AgentEvent[] {
    const msgType = parsed.type

    if (msgType === 'system') {
      return []
    }

    if (msgType === 'file-history-snapshot') {
      return []
    }

    if (msgType === 'result') {
      // truthy 强转是 v2 既有行为（extract §5.5 怪癖 2）
      if (parsed.is_error) {
        const resultText =
          typeof parsed.result === 'string' && parsed.result
            ? parsed.result
            : 'CodeBuddy 执行出错'
        return [
          {
            type: 'complete',
            status: 'error',
            artifacts: [],
            errorMessage: resultText,
            ...(typeof parsed.duration_ms === 'number'
              ? { durationMs: parsed.duration_ms }
              : {}),
          },
        ]
      }
      return []
    }

    if (msgType === 'assistant') {
      const message = isRecord(parsed.message) ? parsed.message : {}
      const contentBlocks = message.content
      // content 不是数组时直接丢弃整条消息（extract §5.5 怪癖 1）
      if (!Array.isArray(contentBlocks)) return []

      const events: AgentEvent[] = []
      for (const block of contentBlocks) {
        if (!isRecord(block)) continue
        if (block.type === 'text') {
          const text = typeof block.text === 'string' ? block.text : ''
          if (text) events.push(...this.textBlockEvents(text, 'CodeBuddy 正在输出...'))
        } else if (block.type === 'thinking') {
          const thinking = typeof block.thinking === 'string' ? block.thinking : ''
          if (thinking) events.push(this.thinkingEvent(thinking))
        } else if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' && block.name ? block.name : 'unknown_tool'
          const input = isRecord(block.input) ? block.input : {}
          const nativeId = typeof block.id === 'string' && block.id ? block.id : undefined
          events.push(this.makeToolCall(name, input, nativeId))
        } else if (block.type === 'tool_result') {
          const content = typeof block.content === 'string' ? block.content : ''
          if (content) events.push(this.makeToolResult(content))
        }
      }
      return events
    }

    return super.normalizeObject(parsed)
  }
}
