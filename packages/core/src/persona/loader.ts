/**
 * persona YAML 加载（architecture.md §5.4；行为基线 extract/persona.md §1）。
 *
 * 相对 v2 的修正：
 * - 配置目录显式注入（builtin 目录 + 可选 runtime 目录），不在模块导入时固化路径
 *   （v2 `loader._PERSONA_DIR` 导入时固化的缺陷不重现）；
 * - runtime 对 builtin 同名 persona 做**逐键深合并**（替代 v2 整文件屏蔽——v2 runtime
 *   kal'tsit.yaml 屏蔽 builtin 完整版导致凯尔希回退到能天使台词的缺陷不重现）；
 * - 全部经 `yaml` 库解析 + zod 校验（ADR-5），缺键逐键回退 {@link DEFAULT_PERSONA}
 *   中立默认，核心代码零角色硬编码；
 * - v3 删除字段（`emotion_mapping` / `corpus_file` / `preferred_theme` /
 *   `theme_override`）由 zod 默认行为剥离，不进入解析结果。
 *
 * YAML 键保持 v2 蛇形命名（资产兼容）；解析后的 {@link Persona} 用 camelCase。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// zod schema（YAML 文件形状，蛇形键；除 id/name 外全部可选，缺键走默认）
// ---------------------------------------------------------------------------

const stringListSchema = z.array(z.string())

const randomInsertionSchema = z.object({
  /** 匹配文本的正则（loader 校验可编译） */
  keyword: z.string(),
  probability: z.number().min(0).max(1),
  phrases: stringListSchema.min(1),
})

const toneRulesSchema = z.object({
  prefix_templates: stringListSchema.optional(),
  suffix_templates: stringListSchema.optional(),
  keyword_replacements: z.record(z.string()).optional(),
  random_insertions: z.array(randomInsertionSchema).optional(),
})

const touchZoneSchema = z
  .object({
    expression: z.string().optional(),
    lines: stringListSchema.optional(),
  })
  .passthrough()

const companionSchema = z
  .object({
    status_to_emotion: z.record(z.string()).optional(),
    /** 宽松透传（前端消费 model_path/expressions/motions/scale 等，core 不逐项解释） */
    live2d: z.record(z.unknown()).optional(),
    touch_zones: z.record(touchZoneSchema).optional(),
  })
  .passthrough()

const voiceExampleSchema = z.object({
  /** 平淡汇报原文 */
  plain: z.string(),
  /** 角色口吻改写结果 */
  styled: z.string(),
})

/** voice 段（architecture.md §5.4：rewriter 路线的客制化核心，逐字段回退中立默认） */
const voiceSchema = z.object({
  /** 语气自然语言描述，如「冷静克制、偶尔毒舌」 */
  tone: z.string().optional(),
  /** 口头禅/句尾口癖 */
  catchphrases: stringListSchema.optional(),
  /** 角色绝不会说的词句，rewriter 输出校验用 */
  taboos: stringListSchema.optional(),
  /** 「平淡汇报 → 角色口吻」改写样例（LLM few-shot / template 风格基准） */
  examples: z.array(voiceExampleSchema).optional(),
  /** LLM 模式指令模板，支持 {tone} {examples} 占位符 */
  rewriter_prompt: z.string().optional(),
})

const schedulerTemplatesSchema = z.object({
  no_session: stringListSchema.optional(),
  any_working: stringListSchema.optional(),
  all_success: stringListSchema.optional(),
  all_error: stringListSchema.optional(),
  partial_error_single: stringListSchema.optional(),
  partial_error_multi: stringListSchema.optional(),
  all_idle: stringListSchema.optional(),
})

const supervisorTemplatesSchema = z.object({
  working: stringListSchema.optional(),
  error: stringListSchema.optional(),
  changed: stringListSchema.optional(),
  idle: stringListSchema.optional(),
})

/**
 * YAML 文件 schema。顶层未知键（含 v3 已删除的 emotion_mapping / corpus_file /
 * preferred_theme / theme_override）被 zod 默认剥离。
 */
export const personaFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  name_en: z.string().optional(),
  description: z.string().optional(),
  /** 支持 {session_id} / {working_dir} 占位符（§5.4），仅可选注入增强开启时使用 */
  system_prompt: z.string().optional(),
  companion: companionSchema.optional(),
  tone_rules: toneRulesSchema.optional(),
  voice: voiceSchema.optional(),
  scheduler_templates: schedulerTemplatesSchema.optional(),
  supervisor_templates: supervisorTemplatesSchema.optional(),
  /** CompanionEngine 台词模板（Phase 4 消费），此处仅解析保留 */
  companion_templates: z.record(stringListSchema).optional(),
  status_phrases: z.record(stringListSchema).optional(),
})

export type PersonaFile = z.infer<typeof personaFileSchema>

// ---------------------------------------------------------------------------
// 解析后的 Persona 类型（camelCase）
// ---------------------------------------------------------------------------

export interface RandomInsertion {
  keyword: string
  probability: number
  phrases: string[]
}

export interface ToneRules {
  prefixTemplates: string[]
  suffixTemplates: string[]
  keywordReplacements: Record<string, string>
  randomInsertions: RandomInsertion[]
}

export interface TouchZone {
  expression?: string
  lines: string[]
}

export interface CompanionConfig {
  statusToEmotion: Record<string, string>
  /** 宽松透传：model_path / default_expression / expressions / motions / scale 等 */
  live2d: Record<string, unknown>
  touchZones: Record<string, TouchZone>
}

export interface VoiceExample {
  plain: string
  styled: string
}

export interface VoiceConfig {
  tone: string
  catchphrases: string[]
  taboos: string[]
  examples: VoiceExample[]
  rewriterPrompt: string
}

/** scheduler_templates 七键（architecture.md §5.4，对应 v2 硬编码聚合文案） */
export interface SchedulerTemplates {
  noSession: string[]
  anyWorking: string[]
  allSuccess: string[]
  allError: string[]
  partialErrorSingle: string[]
  partialErrorMulti: string[]
  allIdle: string[]
}

export interface SupervisorTemplates {
  working: string[]
  error: string[]
  changed: string[]
  idle: string[]
}

export interface Persona {
  id: string
  name: string
  nameEn?: string
  description: string
  systemPrompt?: string
  companion: CompanionConfig
  toneRules: ToneRules
  voice: VoiceConfig
  schedulerTemplates: SchedulerTemplates
  supervisorTemplates: SupervisorTemplates
  companionTemplates: Record<string, string[]>
  statusPhrases: Record<string, string[]>
}

// ---------------------------------------------------------------------------
// 中立默认 persona（全套中性文案；缺键回退的唯一来源，代码内零角色专属文案）
// ---------------------------------------------------------------------------

export const DEFAULT_PERSONA: Persona = {
  id: 'default',
  name: '默认助手',
  description: '中立默认角色：不带任何特定角色口吻的助手。',
  companion: {
    statusToEmotion: {
      thinking: 'neutral',
      reading_file: 'neutral',
      executing: 'neutral',
      outputting: 'neutral',
      success: 'neutral',
      error: 'worried',
      idle: 'neutral',
      long_workflow: 'neutral',
    },
    live2d: {},
    touchZones: {},
  },
  toneRules: {
    prefixTemplates: [],
    suffixTemplates: [],
    keywordReplacements: {},
    randomInsertions: [],
  },
  voice: {
    tone: '中性、简洁、专业',
    catchphrases: [],
    taboos: [],
    examples: [],
    rewriterPrompt:
      '请以「{tone}」的语气改写以下汇报文本，保持事实与内容不变。\n参考示例：\n{examples}',
  },
  schedulerTemplates: {
    noSession: ['当前没有进行中的会话。'],
    anyWorking: ['有 {working} 个会话正在工作中。'],
    allSuccess: ['全部 {total} 个会话均已完成。'],
    allError: ['{total} 个会话全部出现错误，请查看。'],
    partialErrorSingle: ['1 个会话出现错误，其余 {working} 个仍在工作。'],
    partialErrorMulti: ['{error} 个会话出现错误，其余 {working} 个仍在工作。'],
    allIdle: ['所有会话均处于空闲状态。'],
  },
  supervisorTemplates: {
    working: ['仍有 {working} 个会话在工作中。'],
    error: ['有会话出现错误，请关注。'],
    changed: ['会话状态有更新。'],
    idle: ['当前没有需要关注的变化。'],
  },
  companionTemplates: {
    work_start: ['开始处理当前任务。'],
    long_workflow: ['任务流程较长，请耐心等待。'],
    error: ['出现错误，正在处理。'],
    success: ['任务已完成。'],
  },
  statusPhrases: {
    thinking: ['正在思考。'],
    reading_file: ['正在读取文件。'],
    executing: ['正在执行操作。'],
    outputting: ['正在整理输出。'],
    success: ['已完成。'],
    error: ['出现错误。'],
    idle: ['待命中。'],
  },
}

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

export class PersonaNotFoundError extends Error {
  constructor(
    public readonly personaId: string,
    dirs: string[],
  ) {
    super(`persona "${personaId}" not found in: ${dirs.join(', ')}`)
    this.name = 'PersonaNotFoundError'
  }
}

export class PersonaValidationError extends Error {
  constructor(
    public readonly personaId: string,
    message: string,
  ) {
    super(`persona "${personaId}" invalid: ${message}`)
    this.name = 'PersonaValidationError'
  }
}

// ---------------------------------------------------------------------------
// 占位符校验（§5.4：loader zod 校验时检查占位符合法性）
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g

function assertPlaceholders(
  text: string,
  allowed: readonly string[],
  field: string,
  personaId: string,
): void {
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (!allowed.includes(match[1])) {
      throw new PersonaValidationError(
        personaId,
        `${field} 含非法占位符 {${match[1]}}（允许：${allowed.map((p) => `{${p}}`).join(' ')}）`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 深合并：override 逐键覆盖 base；plain object 递归，数组/标量整体替换
// ---------------------------------------------------------------------------

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return base
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: PlainObject = { ...base }
    for (const [key, value] of Object.entries(override)) {
      out[key] = deepMerge(base[key], value)
    }
    return out
  }
  return override
}

// ---------------------------------------------------------------------------
// PersonaFile → Persona（逐键回退 DEFAULT_PERSONA）
// ---------------------------------------------------------------------------

function resolvePersona(file: PersonaFile): Persona {
  const d = DEFAULT_PERSONA
  assertPlaceholders(
    file.system_prompt ?? '',
    ['session_id', 'working_dir'],
    'system_prompt',
    file.id,
  )
  assertPlaceholders(
    file.voice?.rewriter_prompt ?? '',
    ['tone', 'examples'],
    'voice.rewriter_prompt',
    file.id,
  )
  for (const rule of file.tone_rules?.random_insertions ?? []) {
    try {
      new RegExp(rule.keyword)
    } catch {
      throw new PersonaValidationError(
        file.id,
        `tone_rules.random_insertions 含非法正则: ${rule.keyword}`,
      )
    }
  }

  const touchZones: Record<string, TouchZone> = {}
  for (const [zone, cfg] of Object.entries(file.companion?.touch_zones ?? {})) {
    touchZones[zone] = { expression: cfg.expression, lines: cfg.lines ?? [] }
  }

  return {
    id: file.id,
    name: file.name,
    nameEn: file.name_en,
    description: file.description ?? d.description,
    systemPrompt: file.system_prompt,
    companion: {
      statusToEmotion:
        file.companion?.status_to_emotion ?? d.companion.statusToEmotion,
      live2d: file.companion?.live2d ?? d.companion.live2d,
      touchZones,
    },
    toneRules: {
      prefixTemplates:
        file.tone_rules?.prefix_templates ?? d.toneRules.prefixTemplates,
      suffixTemplates:
        file.tone_rules?.suffix_templates ?? d.toneRules.suffixTemplates,
      keywordReplacements:
        file.tone_rules?.keyword_replacements ??
        d.toneRules.keywordReplacements,
      randomInsertions:
        file.tone_rules?.random_insertions ?? d.toneRules.randomInsertions,
    },
    voice: {
      tone: file.voice?.tone ?? d.voice.tone,
      catchphrases: file.voice?.catchphrases ?? d.voice.catchphrases,
      taboos: file.voice?.taboos ?? d.voice.taboos,
      examples: file.voice?.examples ?? d.voice.examples,
      rewriterPrompt: file.voice?.rewriter_prompt ?? d.voice.rewriterPrompt,
    },
    schedulerTemplates: {
      noSession:
        file.scheduler_templates?.no_session ?? d.schedulerTemplates.noSession,
      anyWorking:
        file.scheduler_templates?.any_working ??
        d.schedulerTemplates.anyWorking,
      allSuccess:
        file.scheduler_templates?.all_success ??
        d.schedulerTemplates.allSuccess,
      allError:
        file.scheduler_templates?.all_error ?? d.schedulerTemplates.allError,
      partialErrorSingle:
        file.scheduler_templates?.partial_error_single ??
        d.schedulerTemplates.partialErrorSingle,
      partialErrorMulti:
        file.scheduler_templates?.partial_error_multi ??
        d.schedulerTemplates.partialErrorMulti,
      allIdle:
        file.scheduler_templates?.all_idle ?? d.schedulerTemplates.allIdle,
    },
    supervisorTemplates: {
      working:
        file.supervisor_templates?.working ?? d.supervisorTemplates.working,
      error: file.supervisor_templates?.error ?? d.supervisorTemplates.error,
      changed:
        file.supervisor_templates?.changed ?? d.supervisorTemplates.changed,
      idle: file.supervisor_templates?.idle ?? d.supervisorTemplates.idle,
    },
    companionTemplates: file.companion_templates ?? d.companionTemplates,
    statusPhrases: file.status_phrases ?? d.statusPhrases,
  }
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface PersonaLoaderOptions {
  /** 出厂 persona 目录（如 <ext>/assets/personas/builtin） */
  builtinDir: string
  /** 用户 runtime persona 目录（如 globalStorage/character-library）；同名文件逐键深合并到 builtin 之上 */
  runtimeDir?: string
}

export interface PersonaSummary {
  id: string
  name: string
  source: 'runtime' | 'builtin'
}

async function readPersonaFile(
  dir: string,
  id: string,
): Promise<unknown | undefined> {
  for (const ext of ['.yaml', '.yml']) {
    try {
      const content = await readFile(join(dir, `${id}${ext}`), 'utf8')
      return parseYaml(content) as unknown
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
  }
  return undefined
}

export class PersonaLoader {
  constructor(private readonly dirs: PersonaLoaderOptions) {}

  /** 按 id 加载：runtime 与 builtin 同名字段逐键深合并，缺键回退中立默认。 */
  async load(id: string): Promise<Persona> {
    const builtin = await readPersonaFile(this.dirs.builtinDir, id)
    const runtime = this.dirs.runtimeDir
      ? await readPersonaFile(this.dirs.runtimeDir, id)
      : undefined
    if (builtin === undefined && runtime === undefined) {
      const searched = this.dirs.runtimeDir
        ? [this.dirs.runtimeDir, this.dirs.builtinDir]
        : [this.dirs.builtinDir]
      throw new PersonaNotFoundError(id, searched)
    }
    const merged = deepMerge(builtin ?? {}, runtime ?? {})
    let file: PersonaFile
    try {
      file = personaFileSchema.parse(merged)
    } catch (err) {
      throw new PersonaValidationError(id, (err as z.ZodError).message)
    }
    return resolvePersona(file)
  }

  /** 枚举两目录中的 persona（按文件名 id 去重，runtime 优先；无法解析的文件跳过）。 */
  async list(): Promise<PersonaSummary[]> {
    const seen = new Set<string>()
    const out: PersonaSummary[] = []
    const sources: Array<{ dir: string; source: PersonaSummary['source'] }> = [
      ...(this.dirs.runtimeDir
        ? [{ dir: this.dirs.runtimeDir, source: 'runtime' as const }]
        : []),
      { dir: this.dirs.builtinDir, source: 'builtin' as const },
    ]
    for (const { dir, source } of sources) {
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw err
      }
      for (const entry of entries.sort()) {
        const stem = entry.replace(/\.(yaml|yml)$/, '')
        if (stem === entry || seen.has(stem)) continue
        seen.add(stem)
        try {
          const persona = await this.load(stem)
          out.push({ id: persona.id, name: persona.name, source })
        } catch {
          // 无法解析的文件不出现在列表中（load 的错误信息已足够定位问题）
        }
      }
    }
    return out
  }
}
