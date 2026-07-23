/**
 * Kimi Code CLI 策略（extract/adapters.md §5.1）。
 *
 * kimi 是 5 个策略里唯一不覆写 normalizeObject 的——基类解析器本质就是
 * "kimi 方言解析器"。kimi CLI 支持 `-m, --model <model>`（别名解析见
 * ~/.kimi-code/config.toml 的 [models.*] 段），supportsModel=true；
 * kimi 无原生 system prompt 参数，supportsSystemPrompt 保守标 'prompt-prefix'。
 */
import type { AgentInput } from '../types.js'
import { readKimiSessionIndex } from '../cli-session-index.js'
import { JsonStreamStrategy, type AdapterContext, type CliSessionIndexEntry } from '../strategy.js'

/** plan-mode 中文前缀（extract §5.1 原文引用）。 */
export const KIMI_PLAN_MODE_PREFIX =
  '请进入 plan mode：先列出清晰的执行步骤和计划，得到确认后再继续实施。\n\n'

export class KimiStrategy extends JsonStreamStrategy {
  readonly adapterId = 'kimi_cli'
  override readonly supportsModel = true
  protected override readonly planModePrefix = KIMI_PLAN_MODE_PREFIX

  /**
   * build_args 完整规则（extract §5.1 + kimi CLI 实测 `-m, --model`）：
   * plan/plan_yolo → text 前加中文前缀；[-S <session_id>]（仅 resume）；
   * [-y]（仅 yolo/plan_yolo）；[-m <model>]（仅非空 config.model，与 -p 同级的
   * 旗标位，参照 extract §5.1 参数顺序惯例：旗标在前、-p/--output-format 收尾）；
   * 尾部恒为 -p <text> --output-format <fmt>。
   */
  buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
    const mode = input.mode ?? 'normal'
    const outputFormat =
      typeof ctx.config.outputFormat === 'string' && ctx.config.outputFormat
        ? ctx.config.outputFormat
        : 'stream-json'

    let text = input.text
    if (mode === 'plan' || mode === 'plan_yolo') {
      text = this.planModePrefix + text
    }

    const args: string[] = []
    if (ctx.cliSessionId != null) {
      args.push('-S', ctx.cliSessionId)
    }
    if (mode === 'yolo' || mode === 'plan_yolo') {
      args.push('-y')
    }
    const model = ctx.config.model
    if (typeof model === 'string' && model.trim()) {
      args.push('-m', model.trim())
    }
    args.push('-p', text, '--output-format', outputFormat)
    return args
  }

  /** 仅 meta + session.resume_hint 行携带会话 id（extract §5.1 session 捕获）。 */
  protected override extractSessionId(parsed: Record<string, unknown>): string | undefined {
    if (
      parsed.role === 'meta' &&
      parsed.type === 'session.resume_hint' &&
      typeof parsed.session_id === 'string' &&
      parsed.session_id
    ) {
      return parsed.session_id
    }
    return undefined
  }

  /** kimi 会话索引能力：读 ~/.kimi-code/session_index.jsonl（/sessions 与「恢复历史会话」数据源）。 */
  async listSessionIndex(indexPath?: string): Promise<CliSessionIndexEntry[]> {
    return readKimiSessionIndex(indexPath)
  }
}
