/**
 * Codex CLI 策略（extract/adapters.md §5.3）。
 *
 * 怪癖（按文档原样实现）：
 * - config.model 完全不被使用：codex exec 没有 --model 参数，model 仅用于设置页
 *   展示；但 supportsModel 仍返回 true——UI 可选、选了无效，名义与实际不符；
 * - --ephemeral + --sandbox workspace-write 恒加（默认有沙箱）；yolo 的
 *   --dangerously-bypass-approvals-and-sandbox 把它整体关掉；
 * - prompt 是裸位置参数，没有 -p 之类的旗标；
 * - 会话叫 rollout thread：捕获 thread_id，resume 参数是 --thread。
 */
import type { AgentEvent, AgentInput } from '../types.js'
import { JsonStreamStrategy, isRecord, type AdapterContext } from '../strategy.js'

export class CodexStrategy extends JsonStreamStrategy {
  readonly adapterId = 'codex_cli'
  /** 名义 true：exec 实际无 --model 参数（extract §5.3 怪癖 1） */
  override readonly supportsModel = true

  /**
   * build_args 完整规则（extract §5.3）：
   * plan/plan_yolo → text 前加英文前缀；
   * ["exec", "--json", "--ephemeral", "--sandbox", "workspace-write"]
   * + ["--dangerously-bypass-approvals-and-sandbox"]（仅 yolo/plan_yolo）
   * + ["--thread", sid]（仅 resume）+ [text]（裸位置参数）。
   */
  buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
    const mode = input.mode ?? 'normal'

    let text = input.text
    if (mode === 'plan' || mode === 'plan_yolo') {
      text = this.planModePrefix + text
    }

    const args: string[] = ['exec', '--json', '--ephemeral', '--sandbox', 'workspace-write']
    if (mode === 'yolo' || mode === 'plan_yolo') {
      args.push('--dangerously-bypass-approvals-and-sandbox')
    }
    if (ctx.cliSessionId != null && ctx.cliSessionId !== '') {
      args.push('--thread', ctx.cliSessionId)
    }
    // config.model 刻意不读（extract §5.3 怪癖 1）
    args.push(text)
    return args
  }

  /** codex 的会话 id 叫 thread_id，兼容 session_id（extract §5.3 session 捕获）。 */
  protected override extractSessionId(parsed: Record<string, unknown>): string | undefined {
    for (const key of ['thread_id', 'session_id']) {
      const v = parsed[key]
      if (typeof v === 'string' && v) return v
    }
    return undefined
  }

  /**
   * codex 方言六个自有分支 + result 信封（extract §5.3 映射表 + 生命周期/错误行），
   * 不匹配落回基类：
   * 0a. thread.started / turn.started → 零事件（生命周期标记，无用户正文；
   *     thread_id 已由 extractSessionId 捕获，不泄原始 JSON）
   * 0b. error / turn.failed → status_update(error) + complete(error) 收尾，
   *     message 带入 errorMessage（进程退出时适配器还会补一条 complete，
   *     同 turnId 幂等忽略，error 收尾不被覆盖）
   * 1. agent_message / message / output → status + stream 双事件
   * 2. command_execution / command → 结构化 tool_call（bash 类）
   * 3. tool_call / tool → 结构化 tool_call（arguments 为 JSON 字符串时先 parse）
   * 4. item.completed → 按 item.type 分发：agent_message → stream；
   *    command_execution → tool_call + tool_result（ok = exit_code===0）
   * 5. 顶层字符串 result → stream
   */
  protected override normalizeObject(parsed: Record<string, unknown>): AgentEvent[] {
    const msgType = parsed.type

    if (msgType === 'thread.started' || msgType === 'turn.started') {
      return []
    }

    if (msgType === 'error' || msgType === 'turn.failed') {
      const errorRec = isRecord(parsed.error) ? parsed.error : {}
      const message =
        (typeof parsed.message === 'string' && parsed.message) ||
        (typeof errorRec.message === 'string' && errorRec.message) ||
        'Codex 执行失败'
      return [
        { type: 'status', status: 'error', detail: message },
        { type: 'complete', status: 'error', artifacts: [], errorMessage: message },
      ]
    }

    if (msgType === 'agent_message' || msgType === 'message' || msgType === 'output') {
      const content = this.pickContent(parsed)
      if (!content) return []
      return this.textBlockEvents(content, 'Codex 正在输出...')
    }

    if (msgType === 'command_execution' || msgType === 'command') {
      const command = typeof parsed.command === 'string' ? parsed.command : ''
      if (!command) return []
      return [this.makeToolCall('command_execution', { command })]
    }

    if (msgType === 'tool_call' || msgType === 'tool') {
      const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : 'tool'
      return [this.makeToolCall(name, parseArguments(parsed.arguments))]
    }

    if (msgType === 'item.completed') {
      const item = isRecord(parsed.item) ? parsed.item : {}
      if (item.type === 'agent_message') {
        const text = typeof item.text === 'string' ? item.text : ''
        return text ? [this.streamEvent(text)] : []
      }
      if (item.type === 'command_execution') {
        const command = typeof item.command === 'string' ? item.command : ''
        const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : ''
        const exitCode = typeof item.exit_code === 'number' ? item.exit_code : undefined
        const call = this.makeToolCall('command_execution', { command })
        const result = this.makeToolResult(
          output,
          exitCode === undefined ? true : exitCode === 0,
          (call as { toolCallId: string }).toolCallId,
        )
        return [call, result]
      }
      return []
    }

    if (typeof parsed.result === 'string' && parsed.result) {
      return [this.streamEvent(parsed.result)]
    }

    return super.normalizeObject(parsed)
  }
}

/** arguments 可能是 JSON 字符串（extract §5.3 样例），先 parse；非法时兜底 { raw }。 */
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
