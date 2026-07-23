/**
 * FakeAdapter：会话层测试用的 IAgentAdapter 假实现。
 *
 * 三种形态：
 * - 脚本回合：constructor 传入 scripts（每次 send 消费一段脚本），脚本按序产出；
 *   脚本未以 complete 收尾时自动补一条 success complete（适配器契约：一轮恰好一条）；
 * - 阻塞回合：new FakeAdapter({ blockUntilInterrupt: true }) 时 send 产出脚本后
 *   挂起，直到 interrupt() 被调用，再产出 complete{status:'interrupted'}；
 * - 故障注入：failFirstSend 让首次 send 在产生任何事件前抛错
 *   （测注入增强「发送失败按原始输入重发」路径）。
 */
import type { AgentEvent, AgentInput, IAgentAdapter } from '../../../adapters/types.js'

export interface FakeAdapterOptions {
  agentId?: string
  /** 每次 send 消费一段脚本（FIFO）；用完后默认空脚本（直接 success complete） */
  scripts?: AgentEvent[][]
  /** send 产出脚本后挂起，直到 interrupt() 才以 interrupted complete 收尾 */
  blockUntilInterrupt?: boolean
  /** 首次 send 在任何事件前抛错（注入重发路径） */
  failFirstSend?: boolean
  /** 支持 switchSession（/resume 测试） */
  supportSwitchSession?: boolean
}

export class FakeAdapter implements IAgentAdapter {
  readonly agentId: string
  readonly sentInputs: AgentInput[] = []
  readonly switchedTo: string[] = []
  interruptCalls = 0
  shutdownCalls = 0
  started = false

  private readonly scripts: AgentEvent[][]
  /** 一次性阻塞：首个 send 挂起直到 interrupt()，后续 send 正常（避免排队回合死锁） */
  private blockFirstSend: boolean
  private failFirstSend: boolean
  private readonly supportSwitch: boolean
  private interruptWaiters: Array<() => void> = []

  constructor(options: FakeAdapterOptions = {}) {
    this.agentId = options.agentId ?? 'fake_cli'
    this.scripts = [...(options.scripts ?? [])]
    this.blockFirstSend = options.blockUntilInterrupt ?? false
    this.failFirstSend = options.failFirstSend ?? false
    this.supportSwitch = options.supportSwitchSession ?? false
  }

  async start(): Promise<void> {
    this.started = true
  }

  async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    this.sentInputs.push(input)
    if (this.failFirstSend) {
      this.failFirstSend = false
      throw new Error('simulated send failure')
    }
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
    if (!hasComplete) {
      yield { type: 'complete', status: 'success', artifacts: [] }
    }
  }

  async interrupt(): Promise<void> {
    this.interruptCalls += 1
    const waiters = this.interruptWaiters
    this.interruptWaiters = []
    for (const resolve of waiters) resolve()
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1
  }

  get switchSession(): ((cliSessionId: string) => Promise<void>) | undefined {
    if (!this.supportSwitch) return undefined
    return async (cliSessionId: string) => {
      this.switchedTo.push(cliSessionId)
    }
  }
}

/** 便捷构造：stream 文本若干 + success complete 的常规回合脚本。 */
export function successTurnScript(...chunks: string[]): AgentEvent[] {
  return [
    ...chunks.map((chunk): AgentEvent => ({ type: 'stream', chunk, isFinal: false, status: 'outputting', isThinking: false })),
    { type: 'complete', status: 'success', artifacts: [] },
  ]
}

/** 收集 SessionManager onMessage 外发事件的测试帮手。 */
export class MessageCollector {
  readonly messages: import('@dionysus/protocol').ServerMessage[] = []

  readonly handler = (msg: import('@dionysus/protocol').ServerMessage): void => {
    this.messages.push(msg)
  }

  ofType<T extends import('@dionysus/protocol').ServerMessage['type']>(type: T) {
    return this.messages.filter((m) => m.type === type)
  }

  forSession(sessionId: string) {
    return this.messages.filter((m) => m.sessionId === sessionId)
  }
}
