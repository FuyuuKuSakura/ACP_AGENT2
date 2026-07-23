/**
 * KimiStrategy 单测（extract/adapters.md §5.1；roadmap Phase 2 测试基座）。
 * build_args 各模式 + 每种行类型 parseLine 断言（含结构化 tool_call/tool_result）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../types.js'
import type { AdapterContext } from '../../strategy.js'
import { KIMI_PLAN_MODE_PREFIX, KimiStrategy } from '../../strategies/kimi.js'

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  cliSessionId: null,
  config: {},
  ...over,
})

describe('KimiStrategy 元数据', () => {
  it('adapterId / supportsModel / supportsSystemPrompt / supportedModes', () => {
    const s = new KimiStrategy()
    expect(s.adapterId).toBe('kimi_cli')
    // kimi CLI 支持 `-m, --model <model>`（别名见 ~/.kimi-code/config.toml [models.*]）
    expect(s.supportsModel).toBe(true)
    expect(s.supportsSystemPrompt).toBe('prompt-prefix')
    expect(s.supportedModes).toEqual(['normal', 'plan', 'yolo', 'plan_yolo'])
  })
})

describe('KimiStrategy.buildArgs', () => {
  const s = new KimiStrategy()

  it('首轮 normal，outputFormat 缺省', () => {
    expect(s.buildArgs({ text: 'hello' }, ctx())).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
    ])
  })

  it('plan 模式注入中文前缀（原文）', () => {
    const args = s.buildArgs({ text: 'hello', mode: 'plan' }, ctx())
    expect(args[0]).toBe('-p')
    expect(args[1]).toBe(KIMI_PLAN_MODE_PREFIX + 'hello')
    expect(args[1]).toContain('请进入 plan mode：先列出清晰的执行步骤和计划，得到确认后再继续实施。')
    expect(args.slice(2)).toEqual(['--output-format', 'stream-json'])
  })

  it('yolo 模式加 -y', () => {
    expect(s.buildArgs({ text: 'hello', mode: 'yolo' }, ctx())).toEqual([
      '-y',
      '-p',
      'hello',
      '--output-format',
      'stream-json',
    ])
  })

  it('plan_yolo 同时有前缀与 -y', () => {
    const args = s.buildArgs({ text: 'hello', mode: 'plan_yolo' }, ctx())
    expect(args).toEqual([
      '-y',
      '-p',
      KIMI_PLAN_MODE_PREFIX + 'hello',
      '--output-format',
      'stream-json',
    ])
  })

  it('resume + yolo：-S 在 -y 前（extract §5.1 参数示例）', () => {
    expect(
      s.buildArgs({ text: '继续', mode: 'yolo' }, ctx({ cliSessionId: 'sess-abc' })),
    ).toEqual(['-S', 'sess-abc', '-y', '-p', '继续', '--output-format', 'stream-json'])
  })

  it('自定义 outputFormat', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { outputFormat: 'json' } }))
    expect(args).toEqual(['-p', 'hi', '--output-format', 'json'])
  })

  it('非空 config.model 拼 -m <model>（旗标位，在 -p 之前）', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { model: 'k2' } }))
    expect(args).toEqual(['-m', 'k2', '-p', 'hi', '--output-format', 'stream-json'])
  })

  it('model 与 -S/-y 同现时位于其后、-p 之前', () => {
    const args = s.buildArgs(
      { text: '继续', mode: 'yolo' },
      ctx({ cliSessionId: 'sess-abc', config: { model: 'k2' } }),
    )
    expect(args).toEqual(['-S', 'sess-abc', '-y', '-m', 'k2', '-p', '继续', '--output-format', 'stream-json'])
  })

  it('model 缺失/空白/非字符串时不加 -m', () => {
    expect(s.buildArgs({ text: 'hi' }, ctx())).not.toContain('-m')
    expect(s.buildArgs({ text: 'hi' }, ctx({ config: { model: '' } }))).not.toContain('-m')
    expect(s.buildArgs({ text: 'hi' }, ctx({ config: { model: '   ' } }))).not.toContain('-m')
    expect(s.buildArgs({ text: 'hi' }, ctx({ config: { model: null } }))).not.toContain('-m')
  })
})

describe('KimiStrategy.parseLine 行类型映射（基类五分支）', () => {
  it('meta resume_hint → 零事件 + cliSessionId', () => {
    const s = new KimiStrategy()
    const r = s.parseLine(
      '{"role": "meta", "type": "session.resume_hint", "session_id": "sess-abc-123"}',
    )
    expect(r.events).toEqual([])
    expect(r.cliSessionId).toBe('sess-abc-123')
  })

  it('assistant content → status_update + stream 双事件', () => {
    const s = new KimiStrategy()
    const r = s.parseLine('{"role": "assistant", "content": "好的。"}')
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: '正在输出回复...' },
      { type: 'stream', chunk: '好的。', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })

  it('assistant tool_calls → 结构化 tool_call（arguments JSON.parse、kind 映射、合成 id）', () => {
    const s = new KimiStrategy()
    s.beginTurn()
    const r = s.parseLine(
      '{"role": "assistant", "tool_calls": [{"function": {"name": "read_file", "arguments": "{\\"path\\": \\"a.py\\"}"}}]}',
    )
    expect(r.events).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'kimi_cli-1',
        name: 'read_file',
        kind: 'read',
        args: { path: 'a.py' },
        displayTarget: 'a.py',
      },
    ])
  })

  it('tool_call 有原生 id 时直接使用', () => {
    const s = new KimiStrategy()
    s.beginTurn()
    const r = s.parseLine(
      '{"role": "assistant", "tool_calls": [{"id": "call-1", "function": {"name": "run_command", "arguments": "{\\"cmd\\": \\"npm test\\"}"}}]}',
    )
    const ev = r.events[0]
    expect(ev).toMatchObject({ type: 'tool_call', toolCallId: 'call-1', kind: 'bash', displayTarget: 'npm test' })
  })

  it('tool_call arguments 非法 JSON 时兜底 { raw }', () => {
    const s = new KimiStrategy()
    s.beginTurn()
    const r = s.parseLine(
      '{"role": "assistant", "tool_calls": [{"function": {"name": "x", "arguments": "not-json"}}]}',
    )
    expect(r.events[0]).toMatchObject({ type: 'tool_call', args: { raw: 'not-json' } })
  })

  it('role=tool → 结构化 tool_result，FIFO 配对最近未闭合 tool_call', () => {
    const s = new KimiStrategy()
    s.beginTurn()
    s.parseLine(
      '{"role": "assistant", "tool_calls": [{"function": {"name": "read_file", "arguments": "{}"}}]}',
    )
    const r = s.parseLine('{"role": "tool", "content": "file contents..."}')
    expect(r.events).toEqual([
      { type: 'tool_result', toolCallId: 'kimi_cli-1', ok: true, summary: 'file contents...' },
    ])
  })

  it('role=tool 无未闭合调用时合成 id 兜底', () => {
    const s = new KimiStrategy()
    s.beginTurn()
    const r = s.parseLine('{"role": "tool", "content": "orphan"}')
    expect(r.events[0]).toMatchObject({ type: 'tool_result', toolCallId: 'kimi_cli-1' })
  })

  it('一行多 JSON + 裸文本尾巴（尾巴降级为 status，不进正文流）', () => {
    const s = new KimiStrategy()
    const r = s.parseLine(
      '{"role":"assistant","content":"A"} {"role":"tool","content":"B"} trailing',
    )
    expect(r.events.map((e) => e.type)).toEqual(['status', 'stream', 'tool_result', 'status'])
    const tail = r.events.at(-1)
    expect(tail).toMatchObject({ type: 'status', detail: 'trailing' })
  })

  it('纯裸文本行 → status_update(detail)，不再泄进 agent_stream（CLI 日志噪声）', () => {
    const s = new KimiStrategy()
    const r = s.parseLine('Traceback (most recent call last):')
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: 'Traceback (most recent call last):' },
    ])
  })

  it('kimi CLI 噪声行 "Reading additional input from stdin..." 不进正文流', () => {
    const s = new KimiStrategy()
    const r = s.parseLine('Reading additional input from stdin...')
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: 'Reading additional input from stdin...' },
    ])
  })

  it('未知 JSON 形状 → 原始 JSON 文本流', () => {
    const s = new KimiStrategy()
    const r = s.parseLine('{"foo": "bar"}')
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ type: 'stream', chunk: '{"foo":"bar"}\n' })
  })

  it('协议透传：agent_stream', () => {
    const s = new KimiStrategy()
    const r = s.parseLine('{"type": "agent_stream", "payload": {"chunk": "x"}}')
    expect(r.events).toEqual([
      { type: 'stream', chunk: 'x', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })

  it('协议透传：agent_complete（无 payload 时用其余字段拼）', () => {
    const s = new KimiStrategy()
    const r = s.parseLine('{"type": "agent_complete", "status": "error", "errorMessage": "boom"}')
    expect(r.events).toEqual([
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'boom' },
    ])
  })

  it('beginTurn 重置合成 id 计数与配对队列', () => {
    const s = new KimiStrategy()
    s.beginTurn()
    s.parseLine(
      '{"role": "assistant", "tool_calls": [{"function": {"name": "a", "arguments": "{}"}}]}',
    )
    s.beginTurn()
    const r = s.parseLine(
      '{"role": "assistant", "tool_calls": [{"function": {"name": "b", "arguments": "{}"}}]}',
    )
    expect(r.events[0]).toMatchObject({ toolCallId: 'kimi_cli-1' })
  })
})

describe('KimiStrategy fixture 全量回放', () => {
  it('kimi-stream.jsonl 逐行回放：事件序列与 session 捕获符合预期', () => {
    const path = fileURLToPath(new URL('../fixtures/kimi-stream.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))

    const s = new KimiStrategy()
    s.beginTurn()
    const events: AgentEvent[] = []
    let cliSessionId: string | undefined
    for (const line of lines) {
      const r = s.parseLine(line)
      if (r.cliSessionId) cliSessionId = r.cliSessionId
      events.push(...r.events)
    }

    expect(cliSessionId).toBe('sess-abc-123')

    const toolCalls = events.filter((e) => e.type === 'tool_call')
    const toolResults = events.filter((e) => e.type === 'tool_result')
    expect(toolCalls).toHaveLength(2)
    expect(toolResults).toHaveLength(2)
    // FIFO 配对：两条 tool_result 分别对上两条 tool_call（合成 id 与原生 id 各一）
    expect(toolResults.map((e) => (e as { toolCallId: string }).toolCallId)).toEqual(
      toolCalls.map((e) => (e as { toolCallId: string }).toolCallId),
    )
    // 裸文本与 CLI 噪声行降级为 status_update，不再泄进 stream 正文；
    // 未知 JSON 形状仍走原始 JSON 文本流（调试兜底），透传行进 stream
    const streamChunks = events
      .filter((e) => e.type === 'stream')
      .map((e) => (e as { chunk: string }).chunk)
    expect(streamChunks.some((c) => c.includes('trailing noise'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('plain non-json line'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('Reading additional input from stdin'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('"foo"'))).toBe(true)
    expect(streamChunks).toContain('passthrough chunk')
    const statusDetails = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { detail: string }).detail)
    expect(statusDetails).toContain('trailing noise')
    expect(statusDetails).toContain('plain non-json line (e.g. stderr traceback leak)')
    expect(statusDetails).toContain('Reading additional input from stdin...')
    // 无 complete 事件（fixture 不含 agent_complete 行；收尾由适配器负责）
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(0)
  })
})
