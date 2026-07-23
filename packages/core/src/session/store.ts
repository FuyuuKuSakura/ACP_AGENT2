/**
 * JsonlSessionStore：会话 JSONL 持久化（architecture.md §5.3 / ADR-2）。
 *
 * 布局：每会话一个 <storageDir>/sessions/<id>.jsonl
 *   第 1 行：{ type: 'meta', meta: SessionMeta }
 *   其后行：message 行（type:'message'）或 TransientEvent event 行（type:'event'）。
 *
 * 要点：
 * - 无 index.json：list() 扫目录读各文件首行 meta + fs.stat mtime 排序，
 *   从根上消灭共享可变状态的读-改-写 lost-update（ADR-2 附注）；
 * - 首行 meta 仅在 create 及 title/persona/adapter 变更时以
 *   「临时文件 + rename」原子重写（低频、用户驱动、天然串行）；
 * - loadMessages/loadEntries 容忍坏行（跳过 + warning，容忍末行截断半行）；
 * - 首行 meta 损坏的会话在 list 中标注 corrupt 而非静默消失；
 * - 时间戳一律 Unix 毫秒整数；
 * - 写者不变量：同一 sessionId 的 appendMessage 只有该会话串行的
 *   runAgentTurn 一个写者（见 types.ts SessionStore 注释）。
 */
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Message, Session, SessionMeta, SessionStore, TransientEvent } from './types.js'

interface MetaLine {
  type: 'meta'
  meta: SessionMeta
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 首行 meta 的最低完整性校验（不引 zod：core 只依赖 protocol 的运行时导出）。 */
function parseMetaLine(line: string): SessionMeta | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.type !== 'meta' || !isRecord(parsed.meta)) return null
  const m = parsed.meta
  if (
    typeof m.id !== 'string' ||
    typeof m.title !== 'string' ||
    typeof m.personaId !== 'string' ||
    typeof m.adapterId !== 'string' ||
    typeof m.updatedAt !== 'number'
  ) {
    return null
  }
  return m as unknown as SessionMeta
}

function corruptMeta(id: string, mtimeMs: number): SessionMeta {
  return {
    id,
    title: id,
    personaId: 'default',
    adapterId: '',
    status: 'error',
    updatedAt: Math.trunc(mtimeMs),
    createdAt: Math.trunc(mtimeMs),
    unreadCount: 0,
    corrupt: true,
  }
}

export class JsonlSessionStore implements SessionStore {
  private readonly sessionsDir: string

  constructor(private readonly storageDir: string) {
    this.sessionsDir = join(storageDir, 'sessions')
  }

  private fileFor(id: string): string {
    return join(this.sessionsDir, `${id}.jsonl`)
  }

  async create(meta: SessionMeta): Promise<Session> {
    await mkdir(this.sessionsDir, { recursive: true })
    const line: MetaLine = { type: 'meta', meta }
    await writeFile(this.fileFor(meta.id), JSON.stringify(line) + '\n', 'utf8')
    return { meta }
  }

  async get(id: string): Promise<Session | null> {
    let content: string
    try {
      content = await readFile(this.fileFor(id), 'utf8')
    } catch {
      return null
    }
    const firstLine = content.split('\n', 1)[0] ?? ''
    const meta = parseMetaLine(firstLine)
    return meta ? { meta } : null
  }

  async list(): Promise<SessionMeta[]> {
    let names: string[]
    try {
      names = await readdir(this.sessionsDir)
    } catch {
      return []
    }
    const metas: { meta: SessionMeta; mtimeMs: number }[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -'.jsonl'.length)
      const path = join(this.sessionsDir, name)
      let mtimeMs = 0
      try {
        mtimeMs = (await stat(path)).mtimeMs
      } catch {
        continue
      }
      let firstLine = ''
      try {
        firstLine = (await readFile(path, 'utf8')).split('\n', 1)[0] ?? ''
      } catch {
        continue
      }
      const meta = parseMetaLine(firstLine)
      metas.push({ meta: meta ?? corruptMeta(id, mtimeMs), mtimeMs })
    }
    metas.sort((a, b) => b.mtimeMs - a.mtimeMs)
    return metas.map((e) => e.meta)
  }

  async appendMessage(sessionId: string, msg: Message | TransientEvent): Promise<void> {
    // 写者不变量：调用方只有该会话串行的 runAgentTurn（或 persona 层的
    // 瞬态事件追加，同样以 sessionId 为键串行），此处无需加锁。
    await appendFile(this.fileFor(sessionId), JSON.stringify(msg) + '\n', 'utf8')
  }

  async loadMessages(sessionId: string): Promise<Message[]> {
    const entries = await this.loadEntries(sessionId)
    return entries.filter((e): e is Message => e.type === 'message')
  }

  async loadEntries(sessionId: string): Promise<(Message | TransientEvent)[]> {
    let content: string
    try {
      content = await readFile(this.fileFor(sessionId), 'utf8')
    } catch {
      return []
    }
    const entries: (Message | TransientEvent)[] = []
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        // 坏行容忍：进程被杀留下的末行截断半行等，跳过 + warning
        console.warn(`[JsonlSessionStore] skip corrupt line ${i + 1} in ${sessionId}: ${line.slice(0, 80)}`)
        continue
      }
      if (!isRecord(parsed) || parsed.type === 'meta') continue
      if (parsed.type === 'message' || parsed.type === 'event') {
        entries.push(parsed as Message | TransientEvent)
      }
    }
    return entries
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    await this.updateMeta(sessionId, { title })
  }

  async updateMeta(sessionId: string, patch: Partial<SessionMeta>): Promise<void> {
    const path = this.fileFor(sessionId)
    const content = await readFile(path, 'utf8')
    const nl = content.indexOf('\n')
    const firstLine = nl === -1 ? content : content.slice(0, nl)
    const rest = nl === -1 ? '' : content.slice(nl)
    const meta = parseMetaLine(firstLine)
    if (!meta) throw new Error(`Session meta corrupt: ${sessionId}`)
    const next: MetaLine = { type: 'meta', meta: { ...meta, ...patch, id: meta.id } }
    // 原子重写：临时文件 + rename（同目录 rename 在 POSIX 上原子）
    const tmp = join(this.sessionsDir, `.${sessionId}.${process.pid}.${Date.now()}.tmp`)
    await writeFile(tmp, JSON.stringify(next) + '\n' + rest.slice(1), 'utf8')
    await rename(tmp, path)
  }

  async delete(id: string): Promise<void> {
    await rm(this.fileFor(id), { force: true })
  }
}
