/**
 * GenericCliAdapter：进程生命周期（extract/adapters.md §2；architecture.md §5.2）。
 *
 * 每次 send() spawn 一个新子进程（无常驻进程）；会话连续性靠 CLI 自己的
 * session 持久化 + 适配器记住 cliSessionId 下轮经 buildArgs 传回（resume）。
 *
 * v2 → v3 修正：
 * - interrupt 先置标志再杀进程，收尾产出 complete{status:'interrupted'}，
 *   不再发 "exited with code -9" 伪错误（extract §2.5 / §7）；
 * - parseLine 显式返回 cliSessionId，废除 session_holder 带外通道（§7.3）；
 * - 删除假 _handle_crash_restart 与死配置 restart_on_crash / max_restart_attempts；
 * - 实例级单回合互斥：send 进行中再次调用立即回 'adapter busy'。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'

import type { AdapterConfig, CliAdapterStrategy } from './strategy.js'
import type { AgentEvent, AgentInput, IAgentAdapter } from './types.js'

/** 单行读取超时默认值（extract §2.1：request_timeout_seconds，kimi 配 120）。 */
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 120
/** 杀进程后等待退出的上限（v2 _kill_process 同口径）。 */
const KILL_WAIT_MS = 5000

type LineResult = { kind: 'line'; line: string } | { kind: 'eof' } | { kind: 'timeout' }

/** 读一行，包在超时里：粒度是"一行"——CLI 持续吐行则整轮可无限长，静默超时判负。 */
function nextLine(it: AsyncIterator<string>, timeoutMs: number): Promise<LineResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
    timer.unref?.()
    it.next().then(
      (r) => {
        clearTimeout(timer)
        resolve(r.done ? { kind: 'eof' } : { kind: 'line', line: r.value })
      },
      () => {
        clearTimeout(timer)
        resolve({ kind: 'eof' })
      },
    )
  })
}

export class GenericCliAdapter implements IAgentAdapter {
  private readonly config: AdapterConfig
  private readonly strategy: CliAdapterStrategy
  private readonly command: string
  private readonly workingDir: string
  private readonly requestTimeoutMs: number

  private child: ChildProcess | null = null
  private busy = false
  private interruptedFlag = false
  private cliSessionId: string | null = null

  constructor(config: AdapterConfig, strategy: CliAdapterStrategy) {
    this.config = config
    this.strategy = strategy
    this.command =
      typeof config.command === 'string' && config.command ? config.command : strategy.adapterId
    this.workingDir = typeof config.workingDir === 'string' ? config.workingDir : '.'
    const t = config.requestTimeoutSeconds
    this.requestTimeoutMs =
      (typeof t === 'number' && t > 0 ? t : DEFAULT_REQUEST_TIMEOUT_SECONDS) * 1000
  }

  get agentId(): string {
    return this.strategy.adapterId
  }

  /** 空操作：进程在 send() 时才创建（extract §1.1）。 */
  async start(): Promise<void> {}

  async *send(input: AgentInput): AsyncIterable<AgentEvent> {
    // 实例级单回合互斥（architecture.md §5.2）
    if (this.busy) {
      yield { type: 'complete', status: 'error', artifacts: [], errorMessage: 'adapter busy' }
      return
    }
    // 空输入短路（extract §2.2-1）
    if (!input.text || !input.text.trim()) {
      yield { type: 'complete', status: 'error', artifacts: [], errorMessage: 'empty input' }
      return
    }

    this.busy = true
    this.interruptedFlag = false
    const startedAt = Date.now()
    try {
      // mode 降级：策略不支持则静默置 normal（extract §2.2-2）
      let mode = input.mode ?? 'normal'
      if (!this.strategy.supportedModes.includes(mode)) mode = 'normal'

      this.strategy.beginTurn?.()
      // 当前 cliSessionId 在拼参数时传入，resume 语义由策略在命令行层面实现
      const args = this.strategy.buildArgs(
        { ...input, mode },
        { cliSessionId: this.cliSessionId, config: this.config },
      )

      await mkdir(this.workingDir, { recursive: true })

      let child: ChildProcess
      try {
        child = spawn(this.command, args, {
          cwd: this.workingDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (err) {
        yield {
          type: 'complete',
          status: 'error',
          artifacts: [],
          errorMessage: `Failed to start ${this.command}: ${(err as Error).message}`,
          durationMs: Date.now() - startedAt,
        }
        return
      }
      this.child = child
      // once(child,'close') 在进程 'error'（如 ENOENT）时会 reject；统一吞成 [null, null]，
      // 真正的 spawn 错误由 spawnErrorRef 分支表达。
      const exitPromise = once(child, 'close').then(
        (r) => r as [number | null, string | null],
        () => [null, null] as [number | null, string | null],
      )
      const spawnErrorRef: { err: (Error & { code?: string }) | null } = { err: null }
      child.once('error', (err: Error & { code?: string }) => {
        spawnErrorRef.err = err
      })

      // 立即关闭 stdin（extract §2.2-5）：多数 agent CLI 检测到 stdin 管道打开
      // 会等待交互输入；prompt 走命令行参数，必须尽早关闭。
      child.stdin?.end()

      // stderr 并入事件流：缓冲后在行间/EOF 作为裸文本 stream 事件产出
      // （v2 直接把 stderr 合并进 stdout；v3 分开读、同效果且不打乱 JSON 行解析）。
      const stderrChunks: string[] = []
      let stderrPartial = ''
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (d: string) => {
        stderrChunks.push(d)
      })
      const drainStderr = (flush: boolean): AgentEvent[] => {
        if (!stderrChunks.length && !(flush && stderrPartial)) return []
        const text = stderrPartial + stderrChunks.join('')
        stderrChunks.length = 0
        const parts = text.split('\n')
        stderrPartial = flush ? '' : (parts.pop() ?? '')
        return parts
          .filter((l) => l.trim())
          .map((l) => ({
            type: 'stream' as const,
            chunk: l + '\n',
            isFinal: false,
            status: 'outputting' as const,
            isThinking: false,
          }))
      }

      const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity })
      const lines = rl[Symbol.asyncIterator]()
      let timedOut = false
      // 策略可能自行产出 complete（如 codex error/turn.failed 行）：记下后适配器
      // 收尾不再补第二条，保持「一轮 send 恰好一条 complete」契约（adapters/types.ts）
      let strategyCompleted = false
      try {
        for (;;) {
          const next = await nextLine(lines, this.requestTimeoutMs)
          for (const e of drainStderr(false)) yield e
          if (next.kind === 'timeout') {
            timedOut = true
            break
          }
          if (next.kind === 'eof') break
          const line = next.line
          if (!line.trim()) continue // 空白行跳过（extract §2.3）
          const { events, cliSessionId } = this.strategy.parseLine(line)
          if (cliSessionId && cliSessionId !== this.cliSessionId) {
            this.cliSessionId = cliSessionId
            yield { type: 'session_id', cliSessionId }
          }
          for (const e of events) {
            if (e.type === 'complete') strategyCompleted = true
            yield e
          }
        }
      } finally {
        rl.close()
      }
      for (const e of drainStderr(true)) yield e

      const durationMs = Date.now() - startedAt

      if (timedOut) {
        // 超时：杀进程 + 统一错误事件（extract §2.3）
        await this.killChild()
        if (!strategyCompleted) {
          yield { type: 'complete', status: 'error', artifacts: [], errorMessage: 'request timeout', durationMs }
        }
        return
      }
      const spawnError = spawnErrorRef.err
      if (spawnError) {
        const errorMessage =
          spawnError.code === 'ENOENT'
            ? `Command not found: ${this.command}`
            : `Failed to start ${this.command}: ${spawnError.message}`
        if (!strategyCompleted) {
          yield { type: 'complete', status: 'error', artifacts: [], errorMessage, durationMs }
        }
        return
      }

      const [code, signal] = await exitPromise
      if (strategyCompleted) {
        // 回合已由策略 complete 收尾（含 errorMessage），进程退出码不再重复裁决
      } else if (this.interruptedFlag) {
        // interrupt 语义（architecture.md §5.2）：收尾 interrupted 而非伪 error
        yield { type: 'complete', status: 'interrupted', artifacts: [], durationMs }
      } else if (code !== 0) {
        const errorMessage =
          code != null
            ? `${this.agentId} exited with code ${code}`
            : `${this.agentId} killed by signal ${signal ?? 'unknown'}`
        yield { type: 'complete', status: 'error', artifacts: [], errorMessage, durationMs }
      } else {
        yield { type: 'complete', status: 'success', artifacts: [], durationMs }
      }
    } finally {
      this.interruptedFlag = false
      this.busy = false
      await this.killChild()
    }
  }

  /** 打断当前生成：置标志后杀进程；无运行中进程则为空操作。 */
  async interrupt(): Promise<void> {
    const child = this.child
    if (child && child.exitCode === null && !child.killed) {
      this.interruptedFlag = true
      child.kill('SIGKILL')
    }
  }

  /** 清理资源 = 杀子进程（不置 interrupt 标志）。 */
  async shutdown(): Promise<void> {
    await this.killChild()
  }

  /** 切换 CLI 会话 id 并杀当前进程（extract §2.5 switch_session）。 */
  async switchSession(cliSessionId: string): Promise<void> {
    this.cliSessionId = cliSessionId
    await this.killChild()
  }

  /** SIGKILL + 最多等 5 秒；查找失败/超时吞掉；最后清空引用。 */
  private async killChild(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null || child.killed) return
    try {
      child.kill('SIGKILL')
    } catch {
      return
    }
    await Promise.race([
      once(child, 'close').catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, KILL_WAIT_MS)),
    ])
  }
}
