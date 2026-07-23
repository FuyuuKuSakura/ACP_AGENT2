/**
 * persona/rewriter.ts — 输出后处理改写（ADR-12：角色语气的默认通道）。
 *
 * 改写范围：只处理**角色通道文本**——Scheduler 聚合句、Supervisor 播报、归来摘要、
 * digest 一行摘要的展示文案、触摸台词；**不改写 agent 会话正文**
 * （agent_stream / agent_complete 内容原样呈现，保护代码/命令/路径不被润色破坏）。
 *
 * 引擎分级（architecture.md §5.4）：
 * - template 模式（默认，零 LLM 依赖）：{@link TemplateRewriter} ——
 *   tone_rules 前后缀 + keyword_replacements（v2 死字段复活）+ random_insertions
 *   （v2 死字段复活）+ voice.catchphrases 句式拼装 + voice.taboos 输出校验；
 * - LLM 模式（agent_session / deepseek_api）：{@link LlmRewriter}，Phase 2 仅占位。
 *
 * 确定性设计：所有随机性（前后缀掷点、口癖选取、概率插入）都经 `opts.random`
 * 注入，默认 `Math.random`；测试注入固定序列即可得到完全确定的输出（快照测试前提）。
 *
 * 防静默失效：template 模式输出与输入完全相同时记 debug 日志（辅助发现 persona
 * 配置问题，§12 角色语气双防线①）。
 */
import type { Persona } from './loader.js'

export interface RewriterLogger {
  debug(message: string, context?: Record<string, unknown>): void
}

const defaultLogger: RewriterLogger = {
  debug: (message) => console.debug(`[persona/rewriter] ${message}`),
}

export interface RewriteOptions {
  /** 随机源注入点（返回 [0,1)）；测试注入固定值/序列以获得确定性输出 */
  random?: () => number
  logger?: RewriterLogger
}

export interface RewriterEngine {
  rewrite(text: string, persona: Persona, opts?: RewriteOptions): string
}

/** 句尾口癖附加概率（template 模式固定值；确定性测试注入 random=()=>0 必命中） */
export const CATCHPHRASE_PROBABILITY = 0.5

/** 前后缀掷点阈值（v2 `_apply_tone` 语义：前缀/后缀各约 1/3 概率、二选一） */
const PREFIX_ROLL = 1 / 3
const SUFFIX_ROLL = 2 / 3

function pick(list: string[], random: () => number): string {
  const index = Math.min(list.length - 1, Math.floor(random() * list.length))
  return list[Math.max(0, index)]
}

export class TemplateRewriter implements RewriterEngine {
  rewrite(text: string, persona: Persona, opts: RewriteOptions = {}): string {
    const random = opts.random ?? Math.random
    const logger = opts.logger ?? defaultLogger
    let out = text

    // 1. keyword_replacements：全量替换（v2 声明但无代码读取，v3 复活）
    for (const [keyword, replacement] of Object.entries(
      persona.toneRules.keywordReplacements,
    )) {
      if (keyword) out = out.split(keyword).join(replacement)
    }

    // 2. random_insertions：keyword 命中文本且按概率掷中时，句尾插入一条口癖（v2 死字段复活）
    for (const rule of persona.toneRules.randomInsertions) {
      let pattern: RegExp
      try {
        pattern = new RegExp(rule.keyword)
      } catch {
        logger.debug(`skip invalid random_insertions regex: ${rule.keyword}`, {
          personaId: persona.id,
        })
        continue
      }
      if (pattern.test(out) && random() < rule.probability) {
        out = out + pick(rule.phrases, random)
      }
    }

    // 3. tone_rules 前后缀：掷点决定加前缀、加后缀或都不加（前缀优先，二选一）
    const { prefixTemplates, suffixTemplates } = persona.toneRules
    if (prefixTemplates.length > 0 || suffixTemplates.length > 0) {
      const roll = random()
      if (roll < PREFIX_ROLL && prefixTemplates.length > 0) {
        out = pick(prefixTemplates, random) + out
      } else if (roll < SUFFIX_ROLL && suffixTemplates.length > 0) {
        out = out + pick(suffixTemplates, random)
      }
    }

    // 4. voice.catchphrases 句式拼装：按概率在句尾附加一条口癖
    const { catchphrases } = persona.voice
    if (catchphrases.length > 0 && random() < CATCHPHRASE_PROBABILITY) {
      out = out + pick(catchphrases, random)
    }

    // 5. voice.taboos 输出校验：命中即移除全部出现并记 debug
    for (const taboo of persona.voice.taboos) {
      if (taboo && out.includes(taboo)) {
        logger.debug(`rewrite output hit taboo "${taboo}", removed`, {
          personaId: persona.id,
        })
        out = out.split(taboo).join('')
      }
    }

    // 防静默失效：输出与输入完全相同记 debug（提示 persona 可能缺少 voice/tone_rules 配置）
    if (out === text) {
      logger.debug('rewrite output identical to input', {
        personaId: persona.id,
      })
    }
    return out
  }
}

/**
 * LLM 模式（agent_session / deepseek_api，与 Supervisor 共用模式配置）：
 * 以 voice.rewriterPrompt + voice.examples few-shot 整句润色。Phase 2 仅占位。
 */
export class LlmRewriter implements RewriterEngine {
  rewrite(_text: string, _persona: Persona, _opts?: RewriteOptions): string {
    throw new Error('LlmRewriter.rewrite: not implemented in Phase 2')
  }
}
