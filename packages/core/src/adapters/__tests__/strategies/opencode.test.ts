/**
 * OpenCodeStrategy 单测（extract/adapters.md §5.4）。
 * build_args 各模式 + 每种行类型 parseLine 断言 + fixture 全量回放。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../types.js'
import { PLAN_MODE_PREFIX_EN, type AdapterContext } from '../../strategy.js'
import { OpenCodeStrategy } from '../../strategies/opencode.js'

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  cliSessionId: null,
  config: {},
  ...over,
})

describe('OpenCodeStrategy 元数据', () => {
  it('adapterId / supportsModel / supportsSystemPrompt / supportedModes', () => {
    const s = new OpenCodeStrategy()
    expect(s.adapterId).toBe('opencode_cli')
    expect(s.supportsModel).toBe(true)
    expect(s.supportsSystemPrompt).toBe('prompt-prefix')
    expect(s.supportedModes).toEqual(['normal', 'plan', 'yolo', 'plan_yolo'])
  })
})

describe('OpenCodeStrategy.buildArgs', () => {
  const s = new OpenCodeStrategy()

  it('首轮 normal（extract §5.4 参数示例）：output_format 默认 json', () => {
    expect(
      s.buildArgs({ text: 'hello' }, ctx({ config: { workingDir: '../../workspace' } })),
    ).toEqual(['run', '--format', 'json', '--dir', '../../workspace', 'hello'])
  })

  it('resume + yolo + model（extract §5.4 参数示例）', () => {
    expect(
      s.buildArgs(
        { text: '继续', mode: 'yolo' },
        ctx({
          cliSessionId: 's1',
          config: { model: 'gpt-4o', workingDir: '../../workspace' },
        }),
      ),
    ).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'gpt-4o',
      '--dir',
      '../../workspace',
      '--session',
      's1',
      '--auto-approve',
      '继续',
    ])
  })

  it('plan 模式注入英文前缀（在位置参数 text 上）', () => {
    const args = s.buildArgs({ text: 'hello', mode: 'plan' }, ctx())
    expect(args.at(-1)).toBe(PLAN_MODE_PREFIX_EN + 'hello')
    expect(args.slice(0, 3)).toEqual(['run', '--format', 'json'])
  })

  it('自定义 outputFormat；workingDir 缺失时不加 --dir', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { outputFormat: 'stream-json' } }))
    expect(args).toEqual(['run', '--format', 'stream-json', 'hi'])
  })
})

describe('OpenCodeStrategy.parseLine 行类型映射', () => {
  it('session 捕获兼容三种键名（session_id / session / sessionID）', () => {
    const s = new OpenCodeStrategy()
    expect(s.parseLine('{"session_id":"a"}').cliSessionId).toBe('a')
    expect(s.parseLine('{"session":"b"}').cliSessionId).toBe('b')
    expect(s.parseLine('{"sessionID":"c"}').cliSessionId).toBe('c')
  })

  it('step_start / step_finish → 零事件（步骤边界标记，不泄原始 JSON；session 捕获不受影响）', () => {
    const s = new OpenCodeStrategy()
    const r = s.parseLine('{"type":"step_start","sessionID":"oc-1"}')
    expect(r.events).toEqual([])
    expect(r.cliSessionId).toBe('oc-1')
    expect(s.parseLine('{"type":"step_finish"}').events).toEqual([])
  })

  it('message → status + stream 双事件（content/text/message 取值链）', () => {
    const s = new OpenCodeStrategy()
    const r = s.parseLine('{"type":"message","content":"hello"}')
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: 'OpenCode 正在输出...' },
      { type: 'stream', chunk: 'hello', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })

  it('text → 取嵌套 part.text（opencode run --format json 实际形状）', () => {
    const s = new OpenCodeStrategy()
    const r = s.parseLine('{"type":"text","part":{"text":"部分文本"}}')
    expect(r.events).toHaveLength(2)
    expect(r.events[1]).toMatchObject({ type: 'stream', chunk: '部分文本' })
  })

  it('text 兼容顶层 text 兜底', () => {
    const s = new OpenCodeStrategy()
    const r = s.parseLine('{"type":"text","text":"flat"}')
    expect(r.events[1]).toMatchObject({ type: 'stream', chunk: 'flat' })
  })

  it('tool_call → 结构化 tool_call；R-7：无 tool_result 行，只产 tool_call', () => {
    const s = new OpenCodeStrategy()
    s.beginTurn()
    const r = s.parseLine('{"type":"tool_call","name":"edit","arguments":"{\\"path\\":\\"a.ts\\"}"}')
    expect(r.events).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'opencode_cli-1',
        name: 'edit',
        kind: 'edit',
        args: { path: 'a.ts' },
        displayTarget: 'a.ts',
      },
    ])
  })

  it('顶层 result 结果信封 → stream', () => {
    const s = new OpenCodeStrategy()
    const r = s.parseLine('{"type":"result","result":"done"}')
    expect(r.events).toEqual([
      { type: 'stream', chunk: 'done', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })
})

describe('OpenCodeStrategy fixture 全量回放', () => {
  it('opencode-stream.jsonl 逐行回放：事件序列与 session 捕获符合预期', () => {
    const path = fileURLToPath(new URL('../fixtures/opencode-stream.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))

    const s = new OpenCodeStrategy()
    s.beginTurn()
    const events: AgentEvent[] = []
    let cliSessionId: string | undefined
    for (const line of lines) {
      const r = s.parseLine(line)
      if (r.cliSessionId) cliSessionId = r.cliSessionId
      events.push(...r.events)
    }

    expect(cliSessionId).toBe('oc-sess-1')

    // R-7：fixture 无 tool_result 行，策略只产 tool_call
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'tool_result')).toHaveLength(0)

    const streamChunks = events
      .filter((e) => e.type === 'stream')
      .map((e) => (e as { chunk: string }).chunk)
    expect(streamChunks).toContain('hello')
    expect(streamChunks).toContain('部分文本')
    expect(streamChunks).toContain('done')
    // step_* 与裸文本噪声不再泄原始 JSON 进正文流
    expect(streamChunks.some((c) => c.includes('step_start'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('step_finish'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('opencode stderr noise line'))).toBe(false)
    const statusDetails = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { detail: string }).detail)
    expect(statusDetails).toContain('opencode stderr noise line')
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(0)
  })
})
