/**
 * CodeBuddyStrategy 单测（extract/adapters.md §5.5）。
 * 全部用例翻译自 legacy/backend/tests/test_codebuddy_strategy.py（13 条），
 * 其中 v2 的 emoji/无 emoji 展示文本断言升级为 v3 结构化 tool_call/tool_result 断言；
 * 另补 buildArgs 其余模式与 fixture 全量回放。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../types.js'
import { PLAN_MODE_PREFIX_EN, type AdapterContext } from '../../strategy.js'
import { CodeBuddyStrategy } from '../../strategies/codebuddy.js'

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  cliSessionId: null,
  config: {},
  ...over,
})

describe('CodeBuddyStrategy 元数据', () => {
  it('adapterId / supportsModel / supportsSystemPrompt / supportedModes', () => {
    const s = new CodeBuddyStrategy()
    expect(s.adapterId).toBe('codebuddy_cli')
    expect(s.supportsModel).toBe(true)
    expect(s.supportsSystemPrompt).toBe('prompt-prefix')
    expect(s.supportedModes).toEqual(['normal', 'plan', 'yolo', 'plan_yolo'])
  })
})

describe('CodeBuddyStrategy.buildArgs（翻译 pytest TestBuildArgs）', () => {
  const s = new CodeBuddyStrategy()

  it('test_normal_mode：stream-json 硬编码 + -y 恒加', () => {
    expect(s.buildArgs({ text: 'hello' }, ctx())).toEqual([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '-y',
    ])
  })

  it('test_plan_mode_prefix：英文前缀 + 尾部固定', () => {
    const args = s.buildArgs({ text: 'hello', mode: 'plan' }, ctx())
    expect(args[0]).toBe('-p')
    expect(args[1].toLowerCase()).toContain('plan mode')
    expect(args[1]).toBe(PLAN_MODE_PREFIX_EN + 'hello')
    expect(args.slice(2)).toEqual(['--output-format', 'stream-json', '-y'])
  })

  it('test_resume_and_model：--resume 与 --model 都在', () => {
    const args = s.buildArgs(
      { text: 'hi' },
      ctx({ cliSessionId: 'sess-1', config: { model: 'gpt-4o' } }),
    )
    expect(args).toEqual([
      '-p',
      'hi',
      '--output-format',
      'stream-json',
      '--resume',
      'sess-1',
      '--model',
      'gpt-4o',
      '-y',
    ])
  })

  it('yolo 与 normal 参数相同（-y 本来就恒加，extract §5.5）', () => {
    expect(s.buildArgs({ text: 'hello', mode: 'yolo' }, ctx())).toEqual(
      s.buildArgs({ text: 'hello', mode: 'normal' }, ctx()),
    )
  })

  it('outputFormat 配置键无效（extract §5.5 怪癖 4：硬编码 stream-json）', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { outputFormat: 'json' } }))
    expect(args).toContain('stream-json')
    expect(args).not.toContain('json')
  })
})

describe('CodeBuddyStrategy.parseLine（翻译 pytest TestSessionExtraction / TestEventParsing）', () => {
  it('test_extract_session_id_from_init', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"system","subtype":"init","session_id":"abc"}')
    expect(r.cliSessionId).toBe('abc')
  })

  it('test_system_init_yields_no_events', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"system","subtype":"init","session_id":"abc"}')
    expect(r.events).toEqual([])
  })

  it('test_file_history_snapshot_ignored', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"file-history-snapshot","files":[]}')
    expect(r.events).toEqual([])
  })

  it('test_assistant_text：status + stream 双事件，outputting，非 thinking', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}',
    )
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: 'CodeBuddy 正在输出...' },
      { type: 'stream', chunk: 'Hi', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })

  it('test_assistant_thinking：唯一打 thinking 状态的策略', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine(
      '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"step 1"}]}}',
    )
    expect(r.events).toEqual([
      { type: 'thinking', chunk: 'step 1', isFinal: false, status: 'thinking', isThinking: true },
    ])
  })

  it('test_assistant_tool_use：结构化 tool_call（v3 取代 v2 "调用工具:" 文本）', () => {
    const s = new CodeBuddyStrategy()
    s.beginTurn()
    const r = s.parseLine(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"read","input":{"path":"x"}}]}}',
    )
    expect(r.events).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'codebuddy_cli-1',
        name: 'read',
        kind: 'read',
        args: { path: 'x' },
        displayTarget: 'x',
      },
    ])
  })

  it('test_assistant_tool_result：结构化 tool_result，FIFO 配对', () => {
    const s = new CodeBuddyStrategy()
    s.beginTurn()
    s.parseLine(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"read","input":{"path":"x"}}]}}',
    )
    const r = s.parseLine(
      '{"type":"assistant","message":{"content":[{"type":"tool_result","content":"done"}]}}',
    )
    expect(r.events).toEqual([
      { type: 'tool_result', toolCallId: 'codebuddy_cli-1', ok: true, summary: 'done' },
    ])
  })

  it('test_result_error：complete{status:error, errorMessage, durationMs}', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine(
      '{"type":"result","is_error":true,"result":"boom","duration_ms":123}',
    )
    expect(r.events).toEqual([
      {
        type: 'complete',
        status: 'error',
        artifacts: [],
        errorMessage: 'boom',
        durationMs: 123,
      },
    ])
  })

  it('result 错误缺 result 文本时兜底中文文案（extract §5.5 怪癖 3）', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"result","is_error":true}')
    expect(r.events[0]).toMatchObject({ type: 'complete', errorMessage: 'CodeBuddy 执行出错' })
  })

  it('is_error truthy 强转：字符串 "false" 也判错（extract §5.5 怪癖 2）', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"result","is_error":"false","result":"weird"}')
    expect(r.events[0]).toMatchObject({ type: 'complete', status: 'error' })
  })

  it('test_result_success_is_silent：成功 result 零事件（成功 complete 由适配器发）', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"result","is_error":false,"result":"ok"}')
    expect(r.events).toEqual([])
  })

  it('message.content 非数组时丢弃整条消息（extract §5.5 怪癖 1）', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"assistant","message":{"content":"not-a-list"}}')
    expect(r.events).toEqual([])
  })

  it('test_unknown_shape_falls_back：落回基类 → 原始 JSON 文本流', () => {
    const s = new CodeBuddyStrategy()
    const r = s.parseLine('{"type":"weird","data":1}')
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ type: 'stream' })
    expect((r.events[0] as { chunk: string }).chunk).toContain('weird')
  })
})

describe('CodeBuddyStrategy fixture 全量回放', () => {
  it('codebuddy-stream.jsonl 逐行回放（fixture 翻译自 pytest 真实 fixture）', () => {
    const path = fileURLToPath(new URL('../fixtures/codebuddy-stream.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))

    const s = new CodeBuddyStrategy()
    s.beginTurn()
    const events: AgentEvent[] = []
    let cliSessionId: string | undefined
    for (const line of lines) {
      const r = s.parseLine(line)
      if (r.cliSessionId) cliSessionId = r.cliSessionId
      events.push(...r.events)
    }

    expect(cliSessionId).toBe('abc')

    // system/init、system/status、file-history-snapshot、成功 result 均零事件
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(0)
    expect(events.filter((e) => e.type === 'thinking')).toHaveLength(1)
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1)
    const toolResults = events.filter((e) => e.type === 'tool_result')
    expect(toolResults).toHaveLength(1)
    expect(toolResults[0]).toMatchObject({ ok: true, summary: 'done' })

    const streamChunks = events
      .filter((e) => e.type === 'stream')
      .map((e) => (e as { chunk: string }).chunk)
    expect(streamChunks).toContain('Hi')
  })
})
