/**
 * ClaudeStrategy 单测（extract/adapters.md §5.2）。
 * build_args 各模式 + 每种行类型 parseLine 断言 + fixture 全量回放。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../types.js'
import { PLAN_MODE_PREFIX_EN, type AdapterContext } from '../../strategy.js'
import { ClaudeStrategy } from '../../strategies/claude.js'

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  cliSessionId: null,
  config: {},
  ...over,
})

describe('ClaudeStrategy 元数据', () => {
  it('adapterId / supportsModel / supportsSystemPrompt / supportedModes', () => {
    const s = new ClaudeStrategy()
    expect(s.adapterId).toBe('claude_cli')
    expect(s.supportsModel).toBe(true)
    expect(s.supportsSystemPrompt).toBe('prompt-prefix')
    expect(s.supportedModes).toEqual(['normal', 'plan', 'yolo', 'plan_yolo'])
  })
})

describe('ClaudeStrategy.buildArgs', () => {
  const s = new ClaudeStrategy()

  it('首轮 normal，model 为空（extract §5.2 参数示例）', () => {
    expect(s.buildArgs({ text: 'hello' }, ctx())).toEqual([
      '-p',
      'hello',
      '--dangerously-skip-permissions',
    ])
  })

  it('plan 模式注入英文前缀（与 codex/opencode/codebuddy 逐字相同）', () => {
    const args = s.buildArgs({ text: 'hello', mode: 'plan' }, ctx())
    expect(args).toEqual([
      '-p',
      PLAN_MODE_PREFIX_EN + 'hello',
      '--dangerously-skip-permissions',
    ])
  })

  it('yolo 与 normal 参数完全相同（extract §5.2 怪癖 3）', () => {
    expect(s.buildArgs({ text: 'hello', mode: 'yolo' }, ctx())).toEqual(
      s.buildArgs({ text: 'hello', mode: 'normal' }, ctx()),
    )
  })

  it('resume + model：--continue 与 --session-id 叠加（extract §5.2 怪癖 1）', () => {
    expect(
      s.buildArgs(
        { text: '继续' },
        ctx({ cliSessionId: 'sess-1', config: { model: 'claude-sonnet-4-5' } }),
      ),
    ).toEqual([
      '-p',
      '继续',
      '--continue',
      '--session-id',
      'sess-1',
      '--model',
      'claude-sonnet-4-5',
      '--dangerously-skip-permissions',
    ])
  })

  it('model 空白字符串视为缺失', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { model: '   ' } }))
    expect(args).not.toContain('--model')
  })

  it('从不加 --output-format（extract §5.2 怪癖 2：output_format 是死配置）', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { outputFormat: 'stream-json' } }))
    expect(args).not.toContain('--output-format')
  })
})

describe('ClaudeStrategy.parseLine 行类型映射', () => {
  it('任意带 session_id 的行都捕获会话 id（extract §5.2 session 捕获）', () => {
    const s = new ClaudeStrategy()
    const r = s.parseLine('{"type":"system","subtype":"init","session_id":"sess-claude-1"}')
    expect(r.cliSessionId).toBe('sess-claude-1')
  })

  it('content_block_delta → status + stream 双事件（delta.text）', () => {
    const s = new ClaudeStrategy()
    const r = s.parseLine('{"type":"content_block_delta","delta":{"text":"你好"}}')
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: 'Claude 正在输出...' },
      { type: 'stream', chunk: '你好', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })

  it('message_delta 兼容顶层 text 字段', () => {
    const s = new ClaudeStrategy()
    const r = s.parseLine('{"type":"message_delta","text":"继续。"}')
    expect(r.events).toHaveLength(2)
    expect(r.events[1]).toMatchObject({ type: 'stream', chunk: '继续。' })
  })

  it('tool_use → 结构化 tool_call（原生 id、input 作 args）', () => {
    const s = new ClaudeStrategy()
    s.beginTurn()
    const r = s.parseLine(
      '{"type":"tool_use","id":"toolu-1","name":"Bash","input":{"command":"ls -la"}}',
    )
    expect(r.events).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'toolu-1',
        name: 'Bash',
        kind: 'bash',
        args: { command: 'ls -la' },
        displayTarget: 'ls -la',
      },
    ])
  })

  it('tool_result → 结构化 tool_result，FIFO 配对', () => {
    const s = new ClaudeStrategy()
    s.beginTurn()
    s.parseLine('{"type":"tool_use","id":"toolu-1","name":"Bash","input":{"command":"ls"}}')
    const r = s.parseLine('{"type":"tool_result","content":"a.py b.py"}')
    expect(r.events).toEqual([
      { type: 'tool_result', toolCallId: 'toolu-1', ok: true, summary: 'a.py b.py' },
    ])
  })

  it('顶层 result 结果信封 → stream', () => {
    const s = new ClaudeStrategy()
    const r = s.parseLine('{"type":"result","result":"完成","session_id":"s1"}')
    expect(r.events).toEqual([
      { type: 'stream', chunk: '完成', isFinal: false, status: 'outputting', isThinking: false },
    ])
    expect(r.cliSessionId).toBe('s1')
  })

  it('未知形状落回基类（kimi 方言 fallback）', () => {
    const s = new ClaudeStrategy()
    const r = s.parseLine('{"role":"assistant","content":"kimi dialect"}')
    expect(r.events).toHaveLength(2)
    expect(r.events[1]).toMatchObject({ type: 'stream', chunk: 'kimi dialect' })
  })
})

describe('ClaudeStrategy fixture 全量回放', () => {
  it('claude-stream.jsonl 逐行回放：事件序列与 session 捕获符合预期', () => {
    const path = fileURLToPath(new URL('../fixtures/claude-stream.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))

    const s = new ClaudeStrategy()
    s.beginTurn()
    const events: AgentEvent[] = []
    let cliSessionId: string | undefined
    for (const line of lines) {
      const r = s.parseLine(line)
      if (r.cliSessionId) cliSessionId = r.cliSessionId
      events.push(...r.events)
    }

    expect(cliSessionId).toBe('sess-claude-1')

    const toolCalls = events.filter((e) => e.type === 'tool_call')
    const toolResults = events.filter((e) => e.type === 'tool_result')
    expect(toolCalls).toHaveLength(1)
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({ toolCallId: 'toolu-1', ok: true })

    const streamChunks = events
      .filter((e) => e.type === 'stream')
      .map((e) => (e as { chunk: string }).chunk)
    expect(streamChunks).toContain('你好')
    expect(streamChunks).toContain('，继续。')
    expect(streamChunks).toContain('完成')
    // 纯裸文本噪声行降级为 status_update，不进正文流
    expect(streamChunks.some((c) => c.includes('claude stderr noise line'))).toBe(false)
    const statusDetails = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { detail: string }).detail)
    expect(statusDetails).toContain('claude stderr noise line')
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(0)
  })
})
