/**
 * rewriter 快照测试（roadmap Phase 2「角色语气双防线」①；architecture.md §12）：
 * 固定 persona YAML + 固定输入 + 注入确定性 random，断言输出含
 * voice.catchphrases / tone_rules 特征、不含 voice.taboos 词句、与输入不完全相同
 * （防「rewriter 静默原样返回」）。
 */
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PersonaLoader, type Persona } from '../loader.js'
import {
  CATCHPHRASE_PROBABILITY,
  LlmRewriter,
  TemplateRewriter,
  type RewriterLogger,
} from '../rewriter.js'

const FIXTURES = fileURLToPath(new URL('fixtures', import.meta.url))

async function loadVoiceTestPersona(): Promise<Persona> {
  return new PersonaLoader({ builtinDir: FIXTURES }).load('voice-test')
}

/** 记录 debug 日志的测试 logger */
function recordingLogger(): RewriterLogger & { messages: string[] } {
  const messages: string[] = []
  return { messages, debug: (message) => messages.push(message) }
}

describe('TemplateRewriter 快照（确定性 random = () => 0）', () => {
  it('输出含 tone_rules 前缀与 voice.catchphrases 特征，与输入不完全相同', async () => {
    const persona = await loadVoiceTestPersona()
    const input = '任务已完成，共修改 3 个文件。'
    const out = new TemplateRewriter().rewrite(input, persona, {
      random: () => 0,
    })

    // random=()=>0 必命中全部概率掷点且全部取下标 0：
    // random_insertions（"完成" 命中，+哼，小菜一碟。）→ 前缀（报告：）→ 口癖（嗯，就这样。）
    expect(out).toBe(
      '报告：任务已完成，共修改 3 个文件。哼，小菜一碟。嗯，就这样。',
    )
    expect(out).toContain('报告：') // tone_rules.prefix_templates[0]
    expect(out).toContain('哼，小菜一碟。') // tone_rules.random_insertions[0].phrases[0]
    expect(out).toContain('嗯，就这样。') // voice.catchphrases[0]
    expect(out).not.toBe(input) // 防静默原样返回
  })

  it('keyword_replacements 生效（您 → 阁下）', async () => {
    const persona = await loadVoiceTestPersona()
    const out = new TemplateRewriter().rewrite('您的任务已完成。', persona, {
      random: () => 0,
    })
    expect(out).toContain('阁下')
    expect(out).not.toContain('您')
  })

  it('输出不含 voice.taboos 词句', async () => {
    const persona = await loadVoiceTestPersona()
    for (const input of ['任务已完成。', '请确认方案。', '正在读取配置。']) {
      const out = new TemplateRewriter().rewrite(input, persona, {
        random: () => 0.42,
      })
      for (const taboo of persona.voice.taboos) {
        expect(out).not.toContain(taboo)
      }
    }
  })
})

describe('taboo 命中处理', () => {
  it('命中 taboo 词被移除并记 debug', async () => {
    const persona = await loadVoiceTestPersona()
    const logger = recordingLogger()
    const out = new TemplateRewriter().rewrite('老板，任务已完成。', persona, {
      random: () => 0,
      logger,
    })
    expect(out).not.toContain('老板')
    expect(out).not.toContain('啊噗噜派')
    expect(
      logger.messages.some((m) => m.includes('taboo') && m.includes('老板')),
    ).toBe(true)
  })

  it('口癖/模板自身含 taboo 词时同样被清除（输出校验在最后）', async () => {
    const persona = await loadVoiceTestPersona()
    // random_insertions 追加不含 taboo；构造 catchphrase 含 taboo 的场景：
    persona.voice.catchphrases = ['啊噗噜派！']
    const out = new TemplateRewriter().rewrite('正在处理。', persona, {
      random: () => 0,
    })
    expect(out).not.toContain('啊噗噜派')
  })
})

describe('防静默失效', () => {
  it('输出与输入完全相同时记 debug（无任何 voice/tone_rules 特征的中立 persona）', async () => {
    const { DEFAULT_PERSONA } = await import('../loader.js')
    const logger = recordingLogger()
    const input = '任务已完成。'
    const out = new TemplateRewriter().rewrite(input, DEFAULT_PERSONA, {
      logger,
    })
    expect(out).toBe(input)
    expect(logger.messages.some((m) => m.includes('identical to input'))).toBe(
      true,
    )
  })

  it('random() >= CATCHPHRASE_PROBABILITY 时不附加口癖', async () => {
    const persona = await loadVoiceTestPersona()
    expect(CATCHPHRASE_PROBABILITY).toBeLessThan(1)
    // 掷点序列：random_insertions 不命中(0.99>0.9?) —— 0.99 > 0.9 不命中；前后缀 roll=0.99 都不加；口癖 0.99 不加
    const out = new TemplateRewriter().rewrite('任务已完成。', persona, {
      random: () => 0.99,
    })
    expect(out).toBe('任务已完成。')
  })
})

describe('LlmRewriter 占位', () => {
  it('Phase 2 抛出 not implemented', async () => {
    const persona = await loadVoiceTestPersona()
    expect(() => new LlmRewriter().rewrite('任务完成。', persona)).toThrow(
      'not implemented in Phase 2',
    )
  })
})
