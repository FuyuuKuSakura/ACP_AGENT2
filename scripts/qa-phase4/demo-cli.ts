/**
 * Phase 4 门禁验证脚本：对指定真实 CLI 各跑一轮最小真实对话（core 层，不经 VS Code UI）。
 *
 * 用法：node_modules/.bin/tsx scripts/qa-phase4/demo-cli.ts --adapter <kimi_cli|claude_cli|opencode_cli|codex_cli|codebuddy_cli>
 *
 * 判定口径（全部满足才 PASS）：
 *  1. 收到至少一条 agent_stream 或 status_update；
 *  2. 恰好收到一条 agent_complete，且 status === 'success'；
 *  3. 每条 ServerMessage 均通过 @dionysus/protocol 的 parseServerMessage schema 校验；
 *  4. 180s 总超时内完成。
 *
 * 安全约束：prompt 只要求纯文本回复并显式禁止工具调用，无任何文件/命令副作用。
 * 输出：控制台打印事件序列摘要；同时在 scripts/qa-phase4/out/ 落一份 JSON 报告。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseServerMessage, type ServerMessage } from '@dionysus/protocol'
import { JsonlSessionStore } from '../../packages/core/dist/session/store.js'
import { SessionManager } from '../../packages/core/dist/session/manager.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, 'out')
const TOTAL_TIMEOUT_MS = 180_000
const PROMPT = '只回复两个字：你好。不要调用任何工具，不要读写任何文件，不要执行任何命令。'

/** CLI id → dionysus.adapters 条目的 type 别名（与 extension core-host.ts CLI_ID_TO_ADAPTER_TYPE 一致）。 */
const ADAPTERS: Record<string, { type: string; command: string }> = {
  kimi_cli: { type: 'kimi_code_cli', command: 'kimi' },
  claude_cli: { type: 'claude_code_cli', command: 'claude' },
  opencode_cli: { type: 'opencode_cli', command: 'opencode' },
  codex_cli: { type: 'codex_cli', command: 'codex' },
  codebuddy_cli: { type: 'codebuddy_cli', command: 'codebuddy' },
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const adapterId = argOf('--adapter')
if (!adapterId || !ADAPTERS[adapterId]) {
  console.error(`用法: tsx demo-cli.ts --adapter <${Object.keys(ADAPTERS).join('|')}>`)
  process.exit(2)
}
const spec = ADAPTERS[adapterId]

const storageDir = mkdtempSync(join(tmpdir(), `dionysus-qa4-${adapterId}-`))
const store = new JsonlSessionStore(storageDir)
const manager = new SessionManager({
  store,
  adapters: {
    [adapterId]: {
      type: spec.type,
      command: spec.command,
      workingDir: process.cwd(),
      requestTimeoutSeconds: 120,
    },
  },
  defaultAdapterId: adapterId,
})

interface EventRec {
  n: number
  type: string
  brief: string
  schemaOk: boolean
  schemaError?: string
}

const events: EventRec[] = []
const counts: Record<string, number> = {}
const completes: { status: string; errorMessage?: string }[] = []
let done = false

function brief(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'agent_stream':
      return JSON.stringify(String(p.chunk ?? p.text ?? '')).slice(0, 80)
    case 'status_update':
      return `${p.status}${p.detail ? ` — ${String(p.detail).slice(0, 60)}` : ''}`
    case 'tool_call':
      return `${p.kind} ${p.name} ${String(p.displayTarget ?? '').slice(0, 60)}`
    case 'tool_result':
      return `ok=${p.ok} ${String(p.summary ?? '').slice(0, 60)}`
    case 'agent_complete':
      return `status=${p.status}${p.errorMessage ? ` error=${String(p.errorMessage).slice(0, 120)}` : ''}`
    case 'system_notice':
      return `[${p.level}] ${String(p.message).slice(0, 120)}`
    default:
      return JSON.stringify(p).slice(0, 80)
  }
}

manager.onMessage((msg: ServerMessage) => {
  const env = msg as { type: string; payload: Record<string, unknown> }
  const rec: EventRec = { n: events.length + 1, type: env.type, brief: '', schemaOk: true }
  try {
    parseServerMessage(msg)
  } catch (err) {
    rec.schemaOk = false
    rec.schemaError = err instanceof Error ? err.message.split('\n')[0] : String(err)
  }
  rec.brief = brief(env.type, env.payload)
  events.push(rec)
  counts[env.type] = (counts[env.type] ?? 0) + 1

  if (env.type === 'agent_stream') process.stdout.write(String(env.payload.chunk ?? ''))
  else console.log(`\n#${rec.n} [${env.type}] ${rec.brief}${rec.schemaOk ? '' : `  <<< SCHEMA FAIL: ${rec.schemaError}`}`)
  if (env.type === 'agent_complete') {
    completes.push({
      status: String(env.payload.status),
      ...(env.payload.errorMessage ? { errorMessage: String(env.payload.errorMessage) } : {}),
    })
    done = true
  }
})

const session = await manager.createSession({ title: `qa4-${adapterId}` })
console.log(`adapter=${adapterId} command=${spec.command}`)
console.log(`session=${session.id} storage=${storageDir}`)
console.log(`prompt=${PROMPT}\n---`)

const startedAt = Date.now()
await manager.runAgentTurn(session.id, { text: PROMPT, attachments: [], mode: 'normal' })

const deadline = startedAt + TOTAL_TIMEOUT_MS
while (!done && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 200))
}
const elapsedMs = Date.now() - startedAt

// ---- 判定 ----
const failures: string[] = []
if (!done) failures.push(`180s 内未收到 agent_complete`)
const streamOrStatus = (counts['agent_stream'] ?? 0) + (counts['status_update'] ?? 0)
if (streamOrStatus < 1) failures.push('未收到任何 agent_stream / status_update')
if (completes.length !== 1) failures.push(`agent_complete 条数=${completes.length}（要求恰好 1）`)
if (completes.length >= 1 && completes[0].status !== 'success')
  failures.push(`agent_complete.status=${completes[0].status}（要求 success）${completes[0].errorMessage ? ` errorMessage=${completes[0].errorMessage}` : ''}`)
const schemaFails = events.filter((e) => !e.schemaOk)
if (schemaFails.length > 0) failures.push(`${schemaFails.length} 条消息未通过 protocol schema 校验`)

const verdict = failures.length === 0 ? 'PASS' : 'FAIL'
const report = {
  adapter: adapterId,
  command: spec.command,
  prompt: PROMPT,
  startedAt: new Date(startedAt).toISOString(),
  elapsedMs,
  verdict,
  failures,
  counts,
  completes,
  events,
}
mkdirSync(OUT_DIR, { recursive: true })
const reportPath = join(OUT_DIR, `demo-${adapterId}-${startedAt}.json`)
writeFileSync(reportPath, JSON.stringify(report, null, 2))

console.log(`\n--- 事件序列摘要（${events.length} 条, ${(elapsedMs / 1000).toFixed(1)}s）`)
for (const e of events) console.log(`  #${e.n} ${e.type} ${e.brief}${e.schemaOk ? '' : ' [SCHEMA FAIL]'}`)
console.log(`counts: ${JSON.stringify(counts)}`)
console.log(`report: ${reportPath}`)
console.log(verdict === 'PASS' ? `\nDEMO OK (${adapterId})` : `\nDEMO FAIL (${adapterId}): ${failures.join('；')}`)
process.exit(verdict === 'PASS' ? 0 : 1)
