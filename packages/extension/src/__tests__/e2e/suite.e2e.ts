/**
 * 宿主集成测试套件（roadmap Phase 3「宿主集成测试」任务）。
 * 在 @vscode/test-electron 下载的真实 VS Code 扩展宿主内运行：
 *   a) 插件激活 + 七个命令注册；b) openChat 创建聊天 webview 面板；
 *   c) sidebar 视图 dionysus.sessionList 已注册；d) redetectAgents 可执行；
 *   e) 经 core-host 注入 FakeAdapter 跑一轮 user_input→agent_complete 通路。
 * 本文件只在扩展宿主内执行，不进 vitest（命名 *.e2e.ts 不匹配 *.test.ts）。
 */
import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import * as vscode from 'vscode'

import type { AgentEvent, AgentInput, IAgentAdapter } from '@dionysus/core'
import type { ServerMessage } from '@dionysus/protocol'

import type { CliDetection } from '../../cli-detect.js'
import { createConfigService } from '../../config.js'
import { createCoreHost } from '../../core-host.js'
import { CHAT_VIEW_TYPE, SESSION_LIST_VIEW_TYPE } from '../../webview-provider.js'

/** package.json contributes.commands 声明的七个命令 */
const EXPECTED_COMMANDS = [
  'dionysus.openChat',
  'dionysus.newSession',
  'dionysus.interrupt',
  'dionysus.selectAdapter',
  'dionysus.selectPersona',
  'dionysus.showPairingQr',
  'dionysus.redetectAgents',
]

const EXTENSION_ID = 'dionysus.dionysus-vscode'

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** 在 tabGroups 中找 viewType 匹配的 webview tab */
function findWebviewTab(viewType: string): boolean {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      // webview panel 的 tab input 在宿主内序列化形态为 mainThreadWebview-<viewType>，
      // instanceof TabInputWebview 在该内部类上不成立，改用鸭子类型判断
      const input = tab.input as { viewType?: string } | undefined
      if (input?.viewType === viewType || input?.viewType === `mainThreadWebview-${viewType}`) return true
    }
  }
  return false
}

/** 调试输出：列出当前所有 tab 的 input 形态 */
function dumpTabs(): void {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { viewType?: string } | undefined
      console.log(
        `[e2e-debug] tab label=${JSON.stringify(tab.label)} input=${input?.constructor?.name ?? String(input)} viewType=${input?.viewType ?? '-'}`,
      )
    }
  }
}

/** 测试用 FakeAdapter：固定产出 stream 两块 + success complete。 */
class E2eFakeAdapter implements IAgentAdapter {
  readonly agentId = 'fake_cli'
  readonly sentInputs: AgentInput[] = []

  async start(): Promise<void> {}

  async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    this.sentInputs.push(input)
    yield { type: 'stream', chunk: '你好，', isFinal: false, status: 'outputting', isThinking: false }
    yield { type: 'stream', chunk: '这是 e2e。', isFinal: true, status: 'outputting', isThinking: false }
    yield { type: 'complete', status: 'success', artifacts: [] }
  }

  async interrupt(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

export const tests: Array<[string, () => Promise<void>]> = [
  [
    'a) 插件激活成功且七个命令已注册',
    async () => {
      const ext = vscode.extensions.getExtension(EXTENSION_ID)
      assert.ok(ext, `扩展 ${EXTENSION_ID} 未找到`)
      await ext.activate()
      assert.ok(ext.isActive, '扩展未处于激活状态')
      const commands = await vscode.commands.getCommands(true)
      for (const cmd of EXPECTED_COMMANDS) {
        assert.ok(commands.includes(cmd), `命令未注册：${cmd}`)
      }
    },
  ],
  [
    'b) dionysus.openChat 创建聊天 webview 面板',
    async () => {
      await vscode.commands.executeCommand('dionysus.openChat')
      try {
        await waitFor(() => findWebviewTab(CHAT_VIEW_TYPE), 10000, `webview 面板 ${CHAT_VIEW_TYPE} 出现`)
      } catch (err) {
        dumpTabs()
        throw err
      }
    },
  ],
  [
    'c) sidebar 视图 dionysus.sessionList 已注册',
    async () => {
      const commands = await vscode.commands.getCommands(true)
      // VS Code 为每个贡献的视图自动注册 <viewId>.focus 命令，存在即视图注册成功
      assert.ok(
        commands.includes(`${SESSION_LIST_VIEW_TYPE}.focus`),
        `sidebar 视图未注册（缺 ${SESSION_LIST_VIEW_TYPE}.focus 命令）`,
      )
    },
  ],
  [
    'd) dionysus.redetectAgents 可执行不抛错',
    async () => {
      // 处理器 fire-and-forget（弹窗不阻塞命令本身），executeCommand 拒收即失败
      await vscode.commands.executeCommand('dionysus.redetectAgents')
    },
  ],
  [
    'e) core-host 注入 FakeAdapter：user_input → agent_stream → agent_complete 通路',
    async () => {
      const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dionysus-e2e-'))
      // extensionDevelopmentPath = packages/extension；出厂 assets 在仓库根
      const assetsDir = path.resolve(__dirname, '..', '..', '..', 'assets')
      const adapter = new E2eFakeAdapter()
      const detections: CliDetection[] = [
        { id: 'fake_cli', command: 'fake', installed: true, version: '0.0.1', withinTestedRange: true },
      ]
      const host = await createCoreHost({
        storageDir,
        assetsDir,
        configService: createConfigService({ get: () => undefined }),
        detections,
        adapterFactory: () => adapter,
      })
      try {
        const received: ServerMessage[] = []
        const unsub = host.manager.onMessage((msg) => received.push(msg))

        const meta = await host.manager.createSession({ adapterId: 'fake_cli' })
        assert.strictEqual(host.needCliGuide, false, 'fake_cli 已装时不应 needCliGuide')

        await host.handleClientMessage('e2e', {
          v: 1,
          type: 'user_input',
          sessionId: meta.id,
          ts: Date.now(),
          payload: { text: '打个招呼', attachments: [], mode: 'normal' },
        })

        await waitFor(
          () => received.some((m) => m.type === 'agent_complete' && m.sessionId === meta.id),
          10000,
          'agent_complete 事件',
        )
        unsub()

        const streams = received.filter((m) => m.type === 'agent_stream' && m.sessionId === meta.id)
        assert.ok(streams.length >= 2, `应收到 >=2 条 agent_stream，实际 ${streams.length}`)
        const complete = received.find((m) => m.type === 'agent_complete' && m.sessionId === meta.id)
        assert.ok(complete, '缺 agent_complete')
        if (complete?.type === 'agent_complete') {
          assert.strictEqual(complete.payload.status, 'success')
          assert.ok(complete.turnId, 'agent_complete 应携带 turnId')
          assert.strictEqual(typeof complete.seq, 'number', 'agent_complete 应携带 seq')
        }
        assert.strictEqual(adapter.sentInputs.length, 1, 'FakeAdapter 应恰好收到一次 send')
        assert.strictEqual(adapter.sentInputs[0].text, '打个招呼')
        // 持久化断言：会话 JSONL 已落盘
        assert.ok(
          fs.existsSync(path.join(storageDir, 'sessions', `${meta.id}.jsonl`)),
          '会话 JSONL 未落盘',
        )
      } finally {
        host.dispose()
        fs.rmSync(storageDir, { recursive: true, force: true })
      }
    },
  ],
]
