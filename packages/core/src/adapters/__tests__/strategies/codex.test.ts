/**
 * CodexStrategy 单测（extract/adapters.md §5.3）。
 * build_args 各模式 + 每种行类型 parseLine 断言 + fixture 全量回放。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../types.js'
import { PLAN_MODE_PREFIX_EN, type AdapterContext } from '../../strategy.js'
import { CodexStrategy } from '../../strategies/codex.js'

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  cliSessionId: null,
  config: {},
  ...over,
})

describe('CodexStrategy 元数据', () => {
  it('adapterId / supportsModel / supportsSystemPrompt / supportedModes', () => {
    const s = new CodexStrategy()
    expect(s.adapterId).toBe('codex_cli')
    // 名义 true：exec 实际无 --model 参数（extract §5.3 怪癖 1）
    expect(s.supportsModel).toBe(true)
    expect(s.supportsSystemPrompt).toBe('prompt-prefix')
    expect(s.supportedModes).toEqual(['normal', 'plan', 'yolo', 'plan_yolo'])
  })
})

describe('CodexStrategy.buildArgs', () => {
  const s = new CodexStrategy()

  it('首轮 normal（extract §5.3 参数示例）：prompt 是裸位置参数', () => {
    expect(s.buildArgs({ text: 'hello' }, ctx())).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      'hello',
    ])
  })

  it('yolo + resume（extract §5.3 参数示例）', () => {
    expect(
      s.buildArgs({ text: '继续', mode: 'yolo' }, ctx({ cliSessionId: 'thr-1' })),
    ).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
      '--dangerously-bypass-approvals-and-sandbox',
      '--thread',
      'thr-1',
      '继续',
    ])
  })

  it('plan 模式注入英文前缀（在裸位置参数 text 上）', () => {
    const args = s.buildArgs({ text: 'hello', mode: 'plan' }, ctx())
    expect(args.at(-1)).toBe(PLAN_MODE_PREFIX_EN + 'hello')
    expect(args.slice(0, 5)).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'workspace-write',
    ])
  })

  it('config.model 完全不被使用（extract §5.3 怪癖 1）', () => {
    const args = s.buildArgs({ text: 'hi' }, ctx({ config: { model: 'gpt-5' } }))
    expect(args).not.toContain('--model')
    expect(args).not.toContain('gpt-5')
  })
})

describe('CodexStrategy.parseLine 行类型映射', () => {
  it('thread_id 捕获（rollout thread），兼容 session_id', () => {
    const s = new CodexStrategy()
    expect(s.parseLine('{"type":"thread.started","thread_id":"thr-1"}').cliSessionId).toBe('thr-1')
    expect(s.parseLine('{"session_id":"s2"}').cliSessionId).toBe('s2')
  })

  it('thread.started / turn.started → 零事件（生命周期标记，不泄原始 JSON）', () => {
    const s = new CodexStrategy()
    expect(s.parseLine('{"type":"thread.started","thread_id":"thr-1"}').events).toEqual([])
    expect(s.parseLine('{"type":"turn.started"}').events).toEqual([])
  })

  it('error → status_update(error) + complete(error)，message 带入 errorMessage', () => {
    const s = new CodexStrategy()
    const r = s.parseLine('{"type":"error","message":"stream boom"}')
    expect(r.events).toEqual([
      { type: 'status', status: 'error', detail: 'stream boom' },
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'stream boom' },
    ])
  })

  it('turn.failed → 取嵌套 error.message；缺 message 时兜底文案', () => {
    const s = new CodexStrategy()
    const r = s.parseLine('{"type":"turn.failed","error":{"message":"turn blew up"}}')
    expect(r.events).toEqual([
      { type: 'status', status: 'error', detail: 'turn blew up' },
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'turn blew up' },
    ])
    const bare = s.parseLine('{"type":"turn.failed"}')
    expect(bare.events[1]).toMatchObject({ type: 'complete', errorMessage: 'Codex 执行失败' })
  })

  it('agent_message → status + stream 双事件', () => {
    const s = new CodexStrategy()
    const r = s.parseLine('{"type":"agent_message","content":"修复完成"}')
    expect(r.events).toEqual([
      { type: 'status', status: 'outputting', detail: 'Codex 正在输出...' },
      {
        type: 'stream',
        chunk: '修复完成',
        isFinal: false,
        status: 'outputting',
        isThinking: false,
      },
    ])
  })

  it('message / output 取值链 content→text→message', () => {
    const s = new CodexStrategy()
    expect(s.parseLine('{"type":"message","text":"t"}').events[1]).toMatchObject({ chunk: 't' })
    expect(s.parseLine('{"type":"output","message":"m"}').events[1]).toMatchObject({ chunk: 'm' })
  })

  it('command_execution → 结构化 tool_call（bash 类）', () => {
    const s = new CodexStrategy()
    s.beginTurn()
    const r = s.parseLine('{"type":"command_execution","command":"ls -la"}')
    expect(r.events).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'codex_cli-1',
        name: 'command_execution',
        kind: 'bash',
        args: { command: 'ls -la' },
        displayTarget: 'ls -la',
      },
    ])
  })

  it('tool_call → 结构化 tool_call（arguments JSON 字符串先 parse）', () => {
    const s = new CodexStrategy()
    s.beginTurn()
    const r = s.parseLine('{"type":"tool_call","name":"shell","arguments":"{\\"cmd\\":\\"ls\\"}"}')
    expect(r.events[0]).toMatchObject({
      type: 'tool_call',
      name: 'shell',
      kind: 'bash',
      args: { cmd: 'ls' },
      displayTarget: 'ls',
    })
  })

  it('item.completed agent_message → 单 stream 事件', () => {
    const s = new CodexStrategy()
    const r = s.parseLine('{"type":"item.completed","item":{"type":"agent_message","text":"完成了"}}')
    expect(r.events).toEqual([
      { type: 'stream', chunk: '完成了', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })

  it('item.completed command_execution → tool_call + tool_result（ok = exit_code===0）', () => {
    const s = new CodexStrategy()
    s.beginTurn()
    const ok = s.parseLine(
      '{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"a.py","exit_code":0}}',
    )
    expect(ok.events).toEqual([
      {
        type: 'tool_call',
        toolCallId: 'codex_cli-1',
        name: 'command_execution',
        kind: 'bash',
        args: { command: 'ls' },
        displayTarget: 'ls',
      },
      { type: 'tool_result', toolCallId: 'codex_cli-1', ok: true, summary: 'a.py' },
    ])

    const fail = s.parseLine(
      '{"type":"item.completed","item":{"type":"command_execution","command":"false","aggregated_output":"","exit_code":1}}',
    )
    expect(fail.events[1]).toMatchObject({ type: 'tool_result', ok: false })
  })

  it('item.completed 未知 item.type → 零事件', () => {
    const s = new CodexStrategy()
    expect(s.parseLine('{"type":"item.completed","item":{"type":"reasoning","text":"x"}}').events).toEqual([])
  })

  it('顶层 result 结果信封 → stream', () => {
    const s = new CodexStrategy()
    const r = s.parseLine('{"type":"result","result":"done"}')
    expect(r.events).toEqual([
      { type: 'stream', chunk: 'done', isFinal: false, status: 'outputting', isThinking: false },
    ])
  })
})

describe('CodexStrategy fixture 全量回放', () => {
  it('codex-stream.jsonl 逐行回放：事件序列与 thread 捕获符合预期', () => {
    const path = fileURLToPath(new URL('../fixtures/codex-stream.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'))

    const s = new CodexStrategy()
    s.beginTurn()
    const events: AgentEvent[] = []
    let cliSessionId: string | undefined
    for (const line of lines) {
      const r = s.parseLine(line)
      if (r.cliSessionId) cliSessionId = r.cliSessionId
      events.push(...r.events)
    }

    expect(cliSessionId).toBe('thr-1')

    const toolCalls = events.filter((e) => e.type === 'tool_call')
    const toolResults = events.filter((e) => e.type === 'tool_result')
    // command_execution + tool_call + 2 条 item.completed command_execution
    expect(toolCalls).toHaveLength(4)
    expect(toolResults).toHaveLength(2)
    expect(toolResults.map((e) => (e as { ok: boolean }).ok)).toEqual([true, false])

    const streamChunks = events
      .filter((e) => e.type === 'stream')
      .map((e) => (e as { chunk: string }).chunk)
    expect(streamChunks).toContain('修复完成')
    expect(streamChunks).toContain('完成了')
    expect(streamChunks).toContain('done')
    // 生命周期/错误行与裸文本噪声不再泄原始 JSON 进正文流
    expect(streamChunks.some((c) => c.includes('thread.started'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('turn.started'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('turn.failed'))).toBe(false)
    expect(streamChunks.some((c) => c.includes('codex stderr noise line'))).toBe(false)
    const statusDetails = events
      .filter((e) => e.type === 'status')
      .map((e) => (e as { detail: string }).detail)
    expect(statusDetails).toContain('codex stderr noise line')
    expect(statusDetails).toContain('stream boom')
    expect(statusDetails).toContain('turn blew up')
    // error 与 turn.failed 各产一条 complete(error)，message 带入 errorMessage
    const completes = events.filter((e) => e.type === 'complete')
    expect(completes).toEqual([
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'stream boom' },
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'turn blew up' },
    ])
  })
})
