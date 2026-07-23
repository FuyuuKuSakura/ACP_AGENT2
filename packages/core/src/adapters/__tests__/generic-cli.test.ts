/**
 * GenericCliAdapter 测试：用 node -e 假命令模拟 CLI 进程
 *（roadmap Phase 2 测试基座：逐行流式 / 超时 / interrupt 语义 / 非零退出 / busy 互斥）。
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GenericCliAdapter } from '../generic-cli.js'
import { JsonStreamStrategy, type AdapterContext } from '../strategy.js'
import type { AgentEvent, AgentInput } from '../types.js'

// ---------------------------------------------------------------------------
// 假 CLI：command = node，buildArgs 把脚本路径放首位，其后是 --session 与 prompt
// ---------------------------------------------------------------------------

class FakeStrategy extends JsonStreamStrategy {
  readonly adapterId = 'fake_cli'
  constructor(private readonly scriptPath: string) {
    super()
  }
  override buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
    const args = [this.scriptPath]
    if (ctx.cliSessionId != null) args.push('--session', ctx.cliSessionId)
    args.push(input.text)
    return args
  }
  protected override extractSessionId(parsed: Record<string, unknown>): string | undefined {
    if (
      parsed.role === 'meta' &&
      parsed.type === 'session.resume_hint' &&
      typeof parsed.session_id === 'string'
    ) {
      return parsed.session_id
    }
    return undefined
  }
}

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

const SCRIPTS: Record<string, string> = {
  // 逐行流式：meta(session hint) → assistant content → tool_call → tool_result，退出 0
  'stream.js': `
const lines = [
  { role: 'meta', type: 'session.resume_hint', session_id: 'sess-fake-1' },
  { role: 'assistant', content: 'line one' },
  { role: 'assistant', tool_calls: [{ function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
  { role: 'tool', content: 'contents' },
]
let i = 0
const t = setInterval(() => {
  if (i >= lines.length) { clearInterval(t); process.exit(0) }
  console.log(JSON.stringify(lines[i++]))
}, 30)
`,
  // 静默不吐行（超时用）
  'silent.js': `setTimeout(() => process.exit(0), 30000)`,
  // 非零退出
  'fail.js': `console.log(JSON.stringify({ role: 'assistant', content: 'before crash' })); process.exit(3)`,
  // 慢进程：吐一行后常驻（interrupt / busy 用）
  'slow.js': `
console.log(JSON.stringify({ role: 'assistant', content: 'started' }))
setInterval(() => {}, 1000)
`,
  // stderr 混入
  'stderr.js': `
console.error('Warning: something on stderr')
console.log(JSON.stringify({ role: 'assistant', content: 'ok' }))
process.exit(0)
`,
  // argv 回显（注入/简历断言用）：首行 meta session hint，次行把 argv 编进 content
  'echoargv.js': `
console.log(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'sess-echo-1' }))
console.log(JSON.stringify({ role: 'assistant', content: JSON.stringify(process.argv.slice(2)) }))
process.exit(0)
`,
}

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dionysus-adapter-test-'))
  for (const [name, src] of Object.entries(SCRIPTS)) {
    writeFileSync(join(dir, name), src)
  }
})
afterAll(() => {})

function makeAdapter(script: string, config: Record<string, unknown> = {}) {
  const strategy = new FakeStrategy(join(dir, script))
  const adapter = new GenericCliAdapter(
    { command: process.execPath, workingDir: dir, ...config },
    strategy,
  )
  return { adapter, strategy }
}

describe('GenericCliAdapter 进程生命周期', () => {
  it('逐行流式：事件边到边产出，含 session_id / 结构化 tool_call/tool_result，成功收尾', async () => {
    const { adapter } = makeAdapter('stream.js')
    const events = await collect(adapter.send({ text: 'hi' }))

    expect(events[0]).toEqual({ type: 'session_id', cliSessionId: 'sess-fake-1' })
    const types = events.map((e) => e.type)
    expect(types).toContain('status')
    expect(types).toContain('stream')
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    const complete = events.at(-1)
    expect(complete).toMatchObject({ type: 'complete', status: 'success' })
    // 恰好一条 complete
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(1)
  })

  it('resume：捕获的 cliSessionId 出现在下一轮 argv（--session）', async () => {
    const { adapter } = makeAdapter('echoargv.js')
    const first = await collect(adapter.send({ text: 'hello' }))
    expect(first[0]).toEqual({ type: 'session_id', cliSessionId: 'sess-echo-1' })

    const second = await collect(adapter.send({ text: 'again' }))
    const argvChunk = second.find((e) => e.type === 'stream')
    const argv = JSON.parse((argvChunk as { chunk: string }).chunk) as string[]
    expect(argv).toEqual(['--session', 'sess-echo-1', 'again'])
  })

  it('switchSession：替换 cliSessionId，下轮按新 id resume', async () => {
    const { adapter } = makeAdapter('echoargv.js')
    await collect(adapter.send({ text: 'hello' }))
    await adapter.switchSession!('sess-switched')
    const events = await collect(adapter.send({ text: 'again' }))
    // buildArgs 在回合开始时用切换后的 id；脚本随后发的 hint 才再次覆盖
    const argvChunk = events.find((e) => e.type === 'stream')
    const argv = JSON.parse((argvChunk as { chunk: string }).chunk) as string[]
    expect(argv).toEqual(['--session', 'sess-switched', 'again'])
  })

  it('超时：静默进程被判 request timeout', async () => {
    const { adapter } = makeAdapter('silent.js', { requestTimeoutSeconds: 1 })
    const events = await collect(adapter.send({ text: 'hi' }))
    expect(events).toEqual([
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'request timeout', durationMs: expect.any(Number) },
    ])
  }, 15000)

  it('interrupt：恰好一条 interrupted complete，无 error 级 complete（v2 伪错误回归）', async () => {
    const { adapter } = makeAdapter('slow.js')
    const events: AgentEvent[] = []
    for await (const e of adapter.send({ text: 'hi' })) {
      events.push(e)
      if (e.type === 'stream') {
        await adapter.interrupt()
      }
    }
    const completes = events.filter((e) => e.type === 'complete')
    expect(completes).toHaveLength(1)
    expect(completes[0]).toMatchObject({ type: 'complete', status: 'interrupted' })
    expect(events.some((e) => e.type === 'complete' && e.status === 'error')).toBe(false)
  }, 15000)

  it('非零退出：统一错误事件 exited with code N', async () => {
    const { adapter } = makeAdapter('fail.js')
    const events = await collect(adapter.send({ text: 'hi' }))
    const complete = events.at(-1)
    expect(complete).toMatchObject({
      type: 'complete',
      status: 'error',
      errorMessage: 'fake_cli exited with code 3',
    })
    // 崩溃前的流式内容不丢
    expect(events.some((e) => e.type === 'stream')).toBe(true)
  })

  it('命令不存在：Command not found', async () => {
    const { adapter } = makeAdapter('stream.js', {
      command: 'dionysus-definitely-not-a-command-xyz',
    })
    const events = await collect(adapter.send({ text: 'hi' }))
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      status: 'error',
      errorMessage: 'Command not found: dionysus-definitely-not-a-command-xyz',
    })
  })

  it('空输入短路：empty input', async () => {
    const { adapter } = makeAdapter('stream.js')
    const events = await collect(adapter.send({ text: '   ' }))
    expect(events).toEqual([
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'empty input' },
    ])
  })

  it('busy 互斥：send 进行中再次调用立即产出 adapter busy', async () => {
    const { adapter } = makeAdapter('slow.js')
    const first = adapter.send({ text: 'hi' })[Symbol.asyncIterator]()
    const firstEvent = await first.next()
    expect(firstEvent.done).toBe(false)

    const busyEvents = await collect(adapter.send({ text: 'second' }))
    expect(busyEvents).toEqual([
      { type: 'complete', status: 'error', artifacts: [], errorMessage: 'adapter busy' },
    ])

    // 收尾：打断第一个回合，恰好 interrupted
    await adapter.interrupt()
    const rest: AgentEvent[] = []
    for (;;) {
      const r = await first.next()
      if (r.done) break
      rest.push(r.value)
    }
    expect(rest.filter((e) => e.type === 'complete')).toHaveLength(1)
    expect(rest.at(-1)).toMatchObject({ type: 'complete', status: 'interrupted' })
  }, 15000)

  it('stderr 并入事件流（裸文本 stream），不影响成功收尾', async () => {
    const { adapter } = makeAdapter('stderr.js')
    const events = await collect(adapter.send({ text: 'hi' }))
    const chunks = events
      .filter((e) => e.type === 'stream')
      .map((e) => (e as { chunk: string }).chunk)
    expect(chunks.some((c) => c.includes('Warning: something on stderr'))).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'complete', status: 'success' })
  })

  it('mode 降级：策略不支持的 mode 静默置 normal 再交给 buildArgs', async () => {
    class NormalOnlyStrategy extends FakeStrategy {
      override readonly supportedModes = ['normal'] as const
      lastMode: string | undefined
      override buildArgs(input: AgentInput, ctx: AdapterContext): string[] {
        this.lastMode = input.mode
        return super.buildArgs(input, ctx)
      }
    }
    const strategy = new NormalOnlyStrategy(join(dir, 'echoargv.js'))
    const adapter = new GenericCliAdapter(
      { command: process.execPath, workingDir: dir },
      strategy,
    )
    const events = await collect(adapter.send({ text: 'hi', mode: 'yolo' }))
    expect(strategy.lastMode).toBe('normal')
    expect(events.at(-1)).toMatchObject({ type: 'complete', status: 'success' })
  })
})

describe('prompt-prefix 注入断言（roadmap 双防线之②：防 v2 死代码重演）', () => {
  it('wrapFirstTurnInput 后首轮 argv 的 prompt 文本包含注入前缀', async () => {
    const { adapter, strategy } = makeAdapter('echoargv.js')
    const wrapped = strategy.wrapFirstTurnInput!('SYS-PROMPT-凯尔希', {
      text: 'hello',
      mode: 'normal',
    })
    expect(wrapped.text).toBe('SYS-PROMPT-凯尔希\n\nhello')

    const events = await collect(adapter.send(wrapped))
    const argvChunk = events.find((e) => e.type === 'stream')
    const argv = JSON.parse((argvChunk as { chunk: string }).chunk) as string[]
    // 到达"CLI"的 argv 里确实携带注入后的 prompt
    expect(argv).toContain('SYS-PROMPT-凯尔希\n\nhello')
  })
})
