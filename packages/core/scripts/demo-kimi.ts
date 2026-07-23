/**
 * Phase 2 门禁演示脚本（roadmap Phase 2）：node 直跑一轮真实 kimi 对话，
 * 打印事件序列，验证「输入 → kimi CLI → 流式事件 → 会话持久化」全链路。
 *
 * 运行：npm run demo:kimi -w @dionysus/core
 * 成本说明：会向本机 kimi CLI 发送一个最小 prompt（无工具副作用）。
 */
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlSessionStore } from '../dist/session/store.js'
import { SessionManager } from '../dist/session/manager.js'
import type { ServerMessage } from '@dionysus/protocol'

const storageDir = mkdtempSync(join(tmpdir(), 'dionysus-demo-'))
const store = new JsonlSessionStore(storageDir)

const manager = new SessionManager({
  store,
  adapters: {
    kimi_cli: {
      type: 'kimi_code_cli',
      command: 'kimi',
      workingDir: process.cwd(),
      requestTimeoutSeconds: 120,
    },
  },
  defaultAdapterId: 'kimi_cli',
})

let done = false
let finalStatus: string | null = null
let n = 0

manager.onMessage((msg: ServerMessage) => {
  n += 1
  const env = msg as { type: string; sessionId?: string; payload: Record<string, unknown> }
  const p = env.payload
  switch (env.type) {
    case 'agent_stream':
      process.stdout.write((p.text as string) ?? '')
      return
    case 'status_update':
      console.log(`\n[status] ${p.status}${p.detail ? ` — ${p.detail}` : ''}`)
      return
    case 'tool_call':
      console.log(`\n[tool_call] ${p.kind} ${p.name} ${p.displayTarget}`)
      return
    case 'tool_result':
      console.log(`[tool_result] ok=${p.ok} ${String(p.summary).slice(0, 80)}`)
      return
    case 'agent_complete':
      finalStatus = p.status as string
      done = true
      console.log(`\n[complete] status=${p.status}`)
      return
    case 'system_notice':
      console.log(`\n[notice:${p.level}] ${p.message}`)
      return
    default:
      console.log(`\n[${env.type}]`, JSON.stringify(p).slice(0, 120))
  }
})

const session = await manager.createSession({ title: 'demo-kimi' })
console.log(`session created: ${session.id} (storage: ${storageDir})\n---`)

await manager.runAgentTurn(session.id, {
  text: '只回复「你好」两个字，不要做任何其他操作。',
  attachments: [],
  mode: 'normal',
})

const deadline = Date.now() + 180_000
while (!done && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 200))
}

if (!done) {
  console.error('\nDEMO FAIL: 180s 内未收到 agent_complete')
  process.exit(1)
}

// 持久化核验：JSONL 首行 meta + 消息行存在
const files = readdirSync(join(storageDir, 'sessions'))
const jsonl = readFileSync(join(storageDir, 'sessions', files[0]), 'utf8').trim().split('\n')
console.log(`\n--- persisted: ${files[0]} (${jsonl.length} 行)`)
console.log(`meta: ${jsonl[0].slice(0, 160)}`)
console.log(`\nDEMO OK: 共 ${n} 条消息事件，final=${finalStatus}`)
