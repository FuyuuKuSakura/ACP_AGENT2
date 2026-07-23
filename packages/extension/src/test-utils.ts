/**
 * extension 单测共享工具：FakeAdapter（语义同 core 测试帮手，包外不可 import 故重写最小版）、
 * FakeWebview、makeTestHost（纯 node 装配 core-host，无需 vscode）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentEvent, AgentInput, IAgentAdapter } from '@dionysus/core'
import type { ServerMessage } from '@dionysus/protocol'

import type { CliDetection } from './cli-detect.js'
import { createConfigService, type ConfigReader } from './config.js'
import { createCoreHost, type CoreHost, type CoreHostDeps } from './core-host.js'
import type { WebviewLike } from './transport.js'

export class FakeAdapter implements IAgentAdapter {
  readonly agentId: string
  readonly sentInputs: AgentInput[] = []
  interruptCalls = 0
  started = false

  private readonly scripts: AgentEvent[][]
  private blockFirstSend: boolean
  private interruptWaiters: Array<() => void> = []

  constructor(options: { agentId?: string; scripts?: AgentEvent[][]; blockUntilInterrupt?: boolean } = {}) {
    this.agentId = options.agentId ?? 'fake_cli'
    this.scripts = [...(options.scripts ?? [])]
    this.blockFirstSend = options.blockUntilInterrupt ?? false
  }

  async start(): Promise<void> {
    this.started = true
  }

  async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    this.sentInputs.push(input)
    const script = this.scripts.shift() ?? []
    let hasComplete = false
    for (const ev of script) {
      if (ev.type === 'complete') hasComplete = true
      yield ev
    }
    if (this.blockFirstSend) {
      this.blockFirstSend = false
      await new Promise<void>((resolve) => this.interruptWaiters.push(resolve))
      yield { type: 'complete', status: 'interrupted', artifacts: [] }
      return
    }
    if (!hasComplete) yield { type: 'complete', status: 'success', artifacts: [] }
  }

  async interrupt(): Promise<void> {
    this.interruptCalls += 1
    const waiters = this.interruptWaiters
    this.interruptWaiters = []
    for (const resolve of waiters) resolve()
  }

  async shutdown(): Promise<void> {}
}

export function successTurnScript(...chunks: string[]): AgentEvent[] {
  return [
    ...chunks.map(
      (chunk): AgentEvent => ({ type: 'stream', chunk, isFinal: false, status: 'outputting', isThinking: false }),
    ),
    { type: 'complete', status: 'success', artifacts: [] },
  ]
}

/** 假 webview：记录 postMessage，emit 模拟 onDidReceiveMessage。 */
export class FakeWebview implements WebviewLike {
  readonly posted: unknown[] = []
  postMessageResult: boolean | Promise<boolean> = true

  private readonly listeners = new Set<(message: unknown) => void>()

  postMessage(message: unknown): Promise<boolean> {
    this.posted.push(message)
    return Promise.resolve(this.postMessageResult as boolean)
  }

  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void } {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  emit(raw: unknown): void {
    for (const cb of [...this.listeners]) cb(raw)
  }

  postedMessages(): ServerMessage[] {
    return this.posted as ServerMessage[]
  }

  ofType<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.postedMessages().filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
  }
}

export interface TestHostContext {
  host: CoreHost
  storageDir: string
  adapters: Map<string, FakeAdapter>
  reader: ConfigReader & { values: Record<string, unknown> }
  cleanup: () => Promise<void>
}

function fakeReader(values: Record<string, unknown>): ConfigReader & { values: Record<string, unknown> } {
  return {
    values,
    get<T>(key: string): T | undefined {
      return values[key] as T | undefined
    },
  }
}

export function installedCli(id: string, command = id.replace(/_cli$/, '')): CliDetection {
  return { id, command, installed: true, version: '1.0.0', withinTestedRange: true }
}

export function missingCli(id: string, command = id.replace(/_cli$/, '')): CliDetection {
  return { id, command, installed: false, withinTestedRange: true }
}

/**
 * 装配一个纯 node 的 core-host：临时 storageDir、假配置 reader、
 * FakeAdapter 工厂（按 adapterId 记录实例）。
 */
export async function makeTestHost(
  options: {
    settings?: Record<string, unknown>
    detections?: CliDetection[]
    adapterScripts?: AgentEvent[][]
    blockUntilInterrupt?: boolean
    deps?: Partial<Pick<CoreHostDeps, 'now' | 'idGen' | 'resolveWorkingDir' | 'cliSessionIndexPath'>>
  } = {},
): Promise<TestHostContext> {
  const storageDir = await mkdtemp(join(tmpdir(), 'dionysus-ext-test-'))
  const reader = fakeReader(options.settings ?? {})
  const configService = createConfigService(reader)
  const adapters = new Map<string, FakeAdapter>()

  const host = await createCoreHost({
    storageDir,
    assetsDir: join(storageDir, 'no-such-assets'),
    configService,
    detections: options.detections ?? [installedCli('kimi_cli', 'kimi')],
    adapterFactory: (adapterId) => {
      const adapter = new FakeAdapter({
        agentId: adapterId,
        scripts: options.adapterScripts,
        blockUntilInterrupt: options.blockUntilInterrupt,
      })
      adapters.set(adapterId, adapter)
      return adapter
    },
    ...options.deps,
  })

  return {
    host,
    storageDir,
    adapters,
    reader,
    cleanup: async () => {
      host.dispose()
      await rm(storageDir, { recursive: true, force: true })
    },
  }
}

/** 轮询等待条件成立（异步消息管线 flush）。 */
export async function until(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (cond()) return
    if (Date.now() - start > timeoutMs) throw new Error('until: condition not met within timeout')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
