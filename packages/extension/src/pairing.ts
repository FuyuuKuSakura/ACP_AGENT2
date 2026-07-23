/**
 * PairingManager：移动端配对体系（architecture.md §6.4 / §11，行为基线
 * extract/pairing-mobile.md §1，并修复其中记录的 v2 缺陷）。
 *
 * 两类 token：
 * - **pair token**：128-bit 随机（base64url 22 字符），TTL 300s，一次性
 *   （验证成功即作废），只存内存；`issueToken()` 换发时旧 token 立即失效
 *   （§6.4 二维码倒计时 <30s 自动换发语义）。
 * - **device token**：256-bit 随机（v2 基线 DEVICE_TOKEN_BYTES=32，≥ §11 的
 *   128-bit 下限），长期有效、不轮换，撤销为唯一回收手段（§11 显式决策）；
 *   持久化于 `globalStorageUri/paired-devices.json`（临时文件 + rename 原子写）。
 *
 * v3 强化（对应 extract/pairing-mobile.md §5 缺陷 1/6）：
 * - 验票强制：pair/device token 均 constant-time 比较（§11）；device token
 *   线性扫描全表比对，不利用 Map 索引的时序侧信道；
 * - 验票成功刷新设备 `last_seen` 并落盘，写盘节流到每分钟最多一次
 *   （内存中始终是最新值，丢一次尾部写只影响「最近活跃」展示精度）；
 * - 设备白名单 + 可撤销（`revokeDevice`）。
 *
 * 零 vscode 依赖：存储文件路径由宿主注入，纯 node 可测。
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** pair token 有效期（§6.4 / v2 PAIR_TOKEN_TTL_SECONDS=300） */
export const PAIR_TOKEN_TTL_MS = 300_000
/** last_seen 落盘节流间隔（§6.4：每分钟最多一次写） */
export const LAST_SEEN_FLUSH_MS = 60_000

const PAIR_TOKEN_BYTES = 16 // 128-bit（§11）
const DEVICE_TOKEN_BYTES = 32 // 256-bit（v2 基线，超过 §11 的 128-bit 下限）

export interface PairToken {
  token: string
  /** 过期时刻（Unix 毫秒） */
  expiresAt: number
}

export interface PairedDevice {
  token: string
  createdAt: number
  lastSeen: number
}

interface DeviceRecord {
  createdAt: number
  lastSeen: number
}

interface DevicesFile {
  devices: Record<string, DeviceRecord>
}

export interface PairingManagerOptions {
  now?: () => number
  pairTokenTtlMs?: number
  lastSeenFlushMs?: number
}

/** constant-time 字符串比较（长度不同也消耗一次比较，长度本身非秘密：token 定长编码）。 */
function timingSafeTokenEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba)
    return false
  }
  return timingSafeEqual(ba, bb)
}

export class PairingManager {
  /** 加载持久化文件后返回实例（文件不存在/损坏按空设备表处理）。 */
  static async create(storageFile: string, options: PairingManagerOptions = {}): Promise<PairingManager> {
    const manager = new PairingManager(storageFile, options)
    await manager.load()
    return manager
  }

  private readonly storageFile: string
  private readonly now: () => number
  private readonly pairTokenTtlMs: number
  private readonly lastSeenFlushMs: number

  /** 当前有效 pair token（单例：换发即旧的立即失效） */
  private pairToken: { token: string; expiresAt: number } | null = null
  private readonly devices = new Map<string, DeviceRecord>()
  private lastSeenDirty = false
  private lastFlushAt = 0
  private flushTimer: NodeJS.Timeout | null = null
  /** 序列化写盘，避免并发 persist 交错 */
  private persistChain: Promise<void> = Promise.resolve()

  private constructor(storageFile: string, options: PairingManagerOptions) {
    this.storageFile = storageFile
    this.now = options.now ?? Date.now
    this.pairTokenTtlMs = options.pairTokenTtlMs ?? PAIR_TOKEN_TTL_MS
    this.lastSeenFlushMs = options.lastSeenFlushMs ?? LAST_SEEN_FLUSH_MS
  }

  // ── pair token（一次性、TTL、换发即旧失效）────────────────────────────────

  /** 签发新 pair token；旧 token 立即失效（§6.4 倒计时换发语义）。 */
  issueToken(): PairToken {
    const token = randomBytes(PAIR_TOKEN_BYTES).toString('base64url')
    const expiresAt = this.now() + this.pairTokenTtlMs
    this.pairToken = { token, expiresAt }
    return { token, expiresAt }
  }

  /** 校验 pair token：TTL + constant-time；成功即作废（一次性）。 */
  verifyPairToken(token: string): boolean {
    const current = this.pairToken
    if (!current) return false
    if (this.now() > current.expiresAt) {
      this.pairToken = null
      return false
    }
    if (!timingSafeTokenEqual(token, current.token)) return false
    this.pairToken = null // 用后作废
    return true
  }

  // ── device token（白名单、可撤销、持久化）─────────────────────────────────

  /** 签发 device token 并落盘（仅应在 pair token 验证通过后调用）。 */
  async issueDeviceToken(): Promise<string> {
    const token = randomBytes(DEVICE_TOKEN_BYTES).toString('base64url')
    const ts = this.now()
    this.devices.set(token, { createdAt: ts, lastSeen: ts })
    await this.persist()
    return token
  }

  /**
   * 校验 device token（白名单成员即有效）。constant-time 线性扫描全表；
   * 成功时刷新 last_seen（内存即时更新，落盘节流到 lastSeenFlushMs 一次）。
   */
  validateDeviceToken(token: string): boolean {
    let matched: string | null = null
    for (const key of this.devices.keys()) {
      if (timingSafeTokenEqual(token, key)) matched = key
    }
    if (!matched) return false
    this.touch(matched)
    return true
  }

  /** 设备列表（按最近活跃降序；设置 UI 展示用）。 */
  listDevices(): PairedDevice[] {
    return [...this.devices.entries()]
      .map(([token, rec]) => ({ token, createdAt: rec.createdAt, lastSeen: rec.lastSeen }))
      .sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /** 撤销设备（唯一回收手段，§11）；不存在返回 false。 */
  async revokeDevice(token: string): Promise<boolean> {
    if (!this.devices.delete(token)) return false
    await this.persist()
    return true
  }

  /** 停止节流计时器；有待写的 last_seen 做最后一次落盘，并等到在途写盘完成。 */
  async dispose(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.lastSeenDirty) await this.persist()
    else await this.persistChain
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────

  private touch(token: string): void {
    const rec = this.devices.get(token)
    if (!rec) return
    rec.lastSeen = this.now()
    this.lastSeenDirty = true
    const elapsed = this.now() - this.lastFlushAt
    if (elapsed >= this.lastSeenFlushMs) {
      void this.persist()
    } else {
      this.scheduleFlush(this.lastSeenFlushMs - elapsed)
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(
      () => {
        this.flushTimer = null
        if (this.lastSeenDirty) void this.persist()
      },
      Math.max(1, delayMs),
    )
    this.flushTimer.unref()
  }

  private async load(): Promise<void> {
    let text: string
    try {
      text = await readFile(this.storageFile, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[dionysus] paired-devices.json 读取失败，按空设备表处理：${(err as Error).message}`)
      }
      return
    }
    try {
      const parsed = JSON.parse(text) as Partial<DevicesFile>
      if (parsed && typeof parsed === 'object' && parsed.devices && typeof parsed.devices === 'object') {
        for (const [token, rec] of Object.entries(parsed.devices)) {
          if (typeof rec?.createdAt !== 'number' || typeof rec?.lastSeen !== 'number') continue
          this.devices.set(token, { createdAt: rec.createdAt, lastSeen: rec.lastSeen })
        }
      }
    } catch {
      console.warn('[dionysus] paired-devices.json 已损坏，按空设备表处理（旧设备需重新配对）')
    }
  }

  /** 原子写盘（临时文件 + rename，同 JsonlSessionStore 手法）；链式串行防交错。 */
  private persist(): Promise<void> {
    this.lastSeenDirty = false
    this.lastFlushAt = this.now()
    const file: DevicesFile = {
      devices: Object.fromEntries(
        [...this.devices.entries()].map(([token, rec]) => [token, { createdAt: rec.createdAt, lastSeen: rec.lastSeen }]),
      ),
    }
    // 失败只记 warning 且链自愈（throttled flush 在宿主关闭/清理后可能扑空，
    // 不应以 unhandled rejection 炸进程）；last_seen 丢失仅影响「最近活跃」精度。
    this.persistChain = this.persistChain
      .then(async () => {
        await mkdir(dirname(this.storageFile), { recursive: true })
        const tmp = `${this.storageFile}.tmp`
        await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8')
        await rename(tmp, this.storageFile)
      })
      .catch((err: unknown) => {
        console.warn(`[dionysus] paired-devices.json 写盘失败：${(err as Error).message}`)
      })
    return this.persistChain
  }
}
