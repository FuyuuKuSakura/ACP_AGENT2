/**
 * persona loader 测试（architecture.md §5.4；extract/persona.md §1）：
 * 真实 assets YAML 加载、runtime 对 builtin 逐键深合并、缺键回退中立默认、
 * DEFAULT_PERSONA 完备性、占位符合法性校验。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DEFAULT_PERSONA,
  PersonaLoader,
  PersonaNotFoundError,
  PersonaValidationError,
  deepMerge,
} from '../loader.js'

// 仓库根 assets/personas（测试文件位于 packages/core/src/persona/__tests__/，上溯 5 级）
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url))
const RUNTIME_DIR = join(REPO_ROOT, 'assets', 'personas')
const BUILTIN_DIR = join(REPO_ROOT, 'assets', 'personas', 'builtin')

const loader = new PersonaLoader({
  builtinDir: BUILTIN_DIR,
  runtimeDir: RUNTIME_DIR,
})

describe('真实 assets YAML 加载', () => {
  it("kal'tsit：基本信息 + tone_rules + companion 解析正确", async () => {
    const persona = await loader.load("kal'tsit")
    expect(persona.id).toBe("kal'tsit")
    expect(persona.name).toBe('凯尔希')
    expect(persona.nameEn).toBe("Kal'tsit")
    expect(persona.description).toContain('罗德岛')
    expect(persona.toneRules.keywordReplacements['您']).toBe('博士')
    expect(persona.toneRules.prefixTemplates).toContain('交给我处理。')
    expect(persona.toneRules.randomInsertions).toHaveLength(1)
    expect(persona.companion.statusToEmotion['error']).toBe('worried')
    expect(persona.companion.touchZones['head'].lines).toContain(
      '不要碰我的耳朵。',
    )
    expect(persona.systemPrompt).toContain('博士')
  })

  it('exusiai：加载并解析 tone_rules 与 touch_zones', async () => {
    const persona = await loader.load('exusiai')
    expect(persona.id).toBe('exusiai')
    expect(persona.name).toBe('能天使')
    expect(persona.toneRules.keywordReplacements['您']).toBe('老板')
    expect(persona.companion.touchZones['body'].lines.length).toBeGreaterThan(0)
  })

  it('真实 YAML 的 voice 段（Phase 4 补充）：凯尔希克制口吻、能天使命名不串味', async () => {
    const kaltsit = await loader.load("kal'tsit")
    expect(kaltsit.voice.tone).toContain('冷静克制')
    expect(kaltsit.voice.catchphrases).toContain('——以上。')
    // taboos 含能天使特征词（防角色串味）
    expect(kaltsit.voice.taboos).toContain('老板')
    expect(kaltsit.voice.taboos).toContain('啊噗噜派')
    expect(kaltsit.voice.examples.length).toBeGreaterThanOrEqual(3)
    expect(kaltsit.voice.rewriterPrompt).toContain('{tone}')
    expect(kaltsit.voice.rewriterPrompt).toContain('{examples}')

    const exusiai = await loader.load('exusiai')
    expect(exusiai.voice.tone).toContain('活泼')
    expect(exusiai.voice.catchphrases).toContain('啊噗噜派！')
    expect(exusiai.voice.taboos).toContain('博士')
    expect(exusiai.voice.examples.length).toBeGreaterThanOrEqual(3)
  })

  it('真实 YAML 的 scheduler/supervisor 模板（Phase 4 补充）：全套七键 + 四键', async () => {
    const kaltsit = await loader.load("kal'tsit")
    for (const lines of Object.values(kaltsit.schedulerTemplates)) {
      expect(lines.length).toBeGreaterThan(0)
    }
    for (const lines of Object.values(kaltsit.supervisorTemplates)) {
      expect(lines.length).toBeGreaterThan(0)
    }
    expect(kaltsit.supervisorTemplates.working.join()).toContain('{todos}')

    const exusiai = await loader.load('exusiai')
    expect(exusiai.schedulerTemplates.noSession.join()).toContain('老板')
    expect(exusiai.supervisorTemplates.working.join()).toContain('{todos}')
  })
})

describe('runtime 对 builtin 逐键深合并（真实 assets 两目录）', () => {
  it('system_prompt 叶子键 runtime 胜出（runtime 版无「老猞猁」、builtin 版有）', async () => {
    const builtinOnly = await new PersonaLoader({
      builtinDir: BUILTIN_DIR,
    }).load("kal'tsit")
    const merged = await loader.load("kal'tsit")
    expect(builtinOnly.systemPrompt).toContain('老猞猁')
    expect(merged.systemPrompt).not.toContain('老猞猁')
    expect(merged.systemPrompt).toContain('自称用“我”')
  })

  it('companion 段按叶子键合并：live2d.scale 取自 runtime，expressions 两侧并存', async () => {
    const builtinOnly = await new PersonaLoader({
      builtinDir: BUILTIN_DIR,
    }).load("kal'tsit")
    const merged = await loader.load("kal'tsit")
    // builtin 版 live2d 无 scale（v2 runtime 整文件屏蔽会丢失 expressions 等键）
    expect(builtinOnly.companion.live2d['scale']).toBeUndefined()
    expect(merged.companion.live2d['scale']).toBe(0.5)
    expect(merged.companion.live2d['expressions']).toMatchObject({
      happy: '微笑',
    })
  })

  it('builtin 独有段不被 runtime 屏蔽（companion_templates / status_phrases 保留）', async () => {
    const merged = await loader.load("kal'tsit")
    expect(merged.companionTemplates['success']).toContain('任务完成，博士。')
    expect(merged.statusPhrases['idle']).toContain('随时待命，博士。')
  })
})

describe('临时目录深合并', () => {
  let workDir: string

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dionysus-persona-'))
    await mkdir(join(workDir, 'builtin'), { recursive: true })
    await mkdir(join(workDir, 'runtime'), { recursive: true })
    await writeFile(
      join(workDir, 'builtin', 'demo.yaml'),
      [
        'id: demo',
        'name: 演示',
        'tone_rules:',
        '  prefix_templates:',
        '    - 内置前缀',
        '  keyword_replacements:',
        '    您: 博士',
        'companion:',
        '  status_to_emotion:',
        '    error: worried',
        'voice:',
        '  tone: 内置语气',
        '  taboos:',
        '    - 禁词',
      ].join('\n'),
    )
    await writeFile(
      join(workDir, 'runtime', 'demo.yaml'),
      [
        'id: demo',
        'name: 演示（runtime 改名）',
        'tone_rules:',
        '  keyword_replacements:',
        '    您: 阁下',
      ].join('\n'),
    )
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('runtime 叶子键覆盖、builtin 独有键保留', async () => {
    const persona = await new PersonaLoader({
      builtinDir: join(workDir, 'builtin'),
      runtimeDir: join(workDir, 'runtime'),
    }).load('demo')
    expect(persona.name).toBe('演示（runtime 改名）') // 标量覆盖
    expect(persona.toneRules.keywordReplacements['您']).toBe('阁下') // runtime 覆盖
    expect(persona.toneRules.prefixTemplates).toEqual(['内置前缀']) // builtin 独有键保留
    expect(persona.companion.statusToEmotion['error']).toBe('worried') // builtin 段保留
    expect(persona.voice.tone).toBe('内置语气') // builtin voice 保留
    expect(persona.voice.taboos).toEqual(['禁词'])
  })
})

describe('缺键回退与 DEFAULT_PERSONA 完备性', () => {
  it('最小 YAML（仅 id/name）全量回退中立默认', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'dionysus-persona-min-'))
    try {
      await writeFile(join(workDir, 'min.yaml'), 'id: min\nname: 最小\n')
      const persona = await new PersonaLoader({ builtinDir: workDir }).load(
        'min',
      )
      expect(persona.description).toBe(DEFAULT_PERSONA.description)
      expect(persona.toneRules).toEqual(DEFAULT_PERSONA.toneRules)
      expect(persona.voice).toEqual(DEFAULT_PERSONA.voice)
      expect(persona.schedulerTemplates).toEqual(
        DEFAULT_PERSONA.schedulerTemplates,
      )
      expect(persona.supervisorTemplates).toEqual(
        DEFAULT_PERSONA.supervisorTemplates,
      )
      expect(persona.companionTemplates).toEqual(
        DEFAULT_PERSONA.companionTemplates,
      )
      expect(persona.statusPhrases).toEqual(DEFAULT_PERSONA.statusPhrases)
      expect(persona.companion.statusToEmotion).toEqual(
        DEFAULT_PERSONA.companion.statusToEmotion,
      )
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  it('DEFAULT_PERSONA：scheduler 七键 / supervisor 四键全部非空，voice 字段齐备', () => {
    const schedulerKeys = [
      'noSession',
      'anyWorking',
      'allSuccess',
      'allError',
      'partialErrorSingle',
      'partialErrorMulti',
      'allIdle',
    ] as const
    for (const key of schedulerKeys) {
      expect(DEFAULT_PERSONA.schedulerTemplates[key].length).toBeGreaterThan(0)
    }
    for (const key of ['working', 'error', 'changed', 'idle'] as const) {
      expect(DEFAULT_PERSONA.supervisorTemplates[key].length).toBeGreaterThan(0)
    }
    expect(DEFAULT_PERSONA.voice.tone.length).toBeGreaterThan(0)
    expect(DEFAULT_PERSONA.voice.rewriterPrompt).toContain('{tone}')
    expect(DEFAULT_PERSONA.voice.rewriterPrompt).toContain('{examples}')
    expect(Array.isArray(DEFAULT_PERSONA.voice.catchphrases)).toBe(true)
    expect(Array.isArray(DEFAULT_PERSONA.voice.taboos)).toBe(true)
    expect(Array.isArray(DEFAULT_PERSONA.voice.examples)).toBe(true)
  })

  it('不存在的 id 抛 PersonaNotFoundError', async () => {
    await expect(loader.load('no-such-persona')).rejects.toBeInstanceOf(
      PersonaNotFoundError,
    )
  })
})

describe('占位符与正则校验', () => {
  it('system_prompt 非法占位符拒绝加载，合法占位符放行', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'dionysus-persona-ph-'))
    try {
      await writeFile(
        join(workDir, 'bad.yaml'),
        'id: bad\nname: 坏\nsystem_prompt: 工作目录 {cwd}\n',
      )
      await writeFile(
        join(workDir, 'good.yaml'),
        'id: good\nname: 好\nsystem_prompt: 会话 {session_id} 在 {working_dir}\n',
      )
      const l = new PersonaLoader({ builtinDir: workDir })
      await expect(l.load('bad')).rejects.toBeInstanceOf(PersonaValidationError)
      await expect(l.load('good')).resolves.toMatchObject({ id: 'good' })
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  it('voice.rewriter_prompt 只允许 {tone} {examples}', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'dionysus-persona-rp-'))
    try {
      await writeFile(
        join(workDir, 'bad.yaml'),
        'id: bad\nname: 坏\nvoice:\n  rewriter_prompt: 参考 {corpus}\n',
      )
      await expect(
        new PersonaLoader({ builtinDir: workDir }).load('bad'),
      ).rejects.toBeInstanceOf(PersonaValidationError)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })

  it('random_insertions 非法正则拒绝加载', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'dionysus-persona-re-'))
    try {
      await writeFile(
        join(workDir, 'bad.yaml'),
        'id: bad\nname: 坏\ntone_rules:\n  random_insertions:\n    - keyword: "("\n      probability: 0.5\n      phrases:\n        - x\n',
      )
      await expect(
        new PersonaLoader({ builtinDir: workDir }).load('bad'),
      ).rejects.toBeInstanceOf(PersonaValidationError)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })
})

describe('deepMerge 单元语义', () => {
  it('对象递归合并、数组/标量整体替换、undefined 不覆盖', () => {
    expect(
      deepMerge(
        { a: 1, b: { c: 2, d: [1, 2] }, e: 'x' },
        { b: { c: 3, d: [9] }, e: undefined },
      ),
    ).toEqual({ a: 1, b: { c: 3, d: [9] }, e: 'x' })
  })
})

describe('list', () => {
  it('枚举两目录 persona，runtime 优先去重', async () => {
    const list = await loader.list()
    const kalt = list.find((p) => p.id === "kal'tsit")
    const exusiai = list.find((p) => p.id === 'exusiai')
    expect(kalt).toMatchObject({ name: '凯尔希', source: 'runtime' })
    expect(exusiai).toMatchObject({ name: '能天使', source: 'runtime' })
  })
})
