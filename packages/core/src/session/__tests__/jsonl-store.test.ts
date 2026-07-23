/**
 * jsonl-store 测试（roadmap Phase 2 具名用例；test_session_store.py 的
 * JSONL 语义改写 + 坏行容忍 + meta 原子重写 + list 扫目录 + corrupt 标注）。
 */
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JsonlSessionStore } from '../store.js'
import type { SessionMeta } from '../types.js'

let dir: string
let store: JsonlSessionStore

function makeMeta(id: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    title: `会话 ${id}`,
    personaId: 'default',
    adapterId: 'kimi_cli',
    status: 'idle',
    updatedAt: Date.now(),
    createdAt: Date.now(),
    unreadCount: 0,
    ...overrides,
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-store-'))
  store = new JsonlSessionStore(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('JsonlSessionStore CRUD', () => {
  it('create → get 往返；list 含新会话', async () => {
    const meta = makeMeta('s1')
    await store.create(meta)
    const got = await store.get('s1')
    expect(got?.meta).toEqual(meta)
    const list = await store.list()
    expect(list.map((m) => m.id)).toContain('s1')
  })

  it('get 不存在返回 null；delete 后 get/list 均消失', async () => {
    expect(await store.get('nope')).toBeNull()
    await store.create(makeMeta('s2'))
    await store.delete('s2')
    expect(await store.get('s2')).toBeNull()
    expect((await store.list()).map((m) => m.id)).not.toContain('s2')
  })

  it('appendMessage 落 message 行，loadMessages 按序读回；时间戳为毫秒整数', async () => {
    await store.create(makeMeta('s3'))
    const now = Date.now()
    await store.appendMessage('s3', { type: 'message', id: 'm1', role: 'user', text: '你好', ts: now })
    await store.appendMessage('s3', { type: 'message', id: 'm2', role: 'agent', text: '回复', ts: now + 1 })
    const msgs = await store.loadMessages('s3')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', text: '你好', ts: now })
    expect(Number.isInteger(msgs[0].ts)).toBe(true)
  })

  it('瞬态 event 行（companion_message / todo_update）可 append，经 loadEntries 读回且不进 loadMessages', async () => {
    await store.create(makeMeta('s4'))
    await store.appendMessage('s4', { type: 'message', id: 'm1', role: 'user', text: 'x', ts: 1 })
    await store.appendMessage('s4', {
      type: 'event',
      eventType: 'companion_message',
      payload: { text: '播报', scope: 'session' },
      ts: 2,
    })
    await store.appendMessage('s4', {
      type: 'event',
      eventType: 'todo_update',
      payload: { items: [{ id: 't1', text: '步骤', done: true }] },
      ts: 3,
    })
    const entries = await store.loadEntries('s4')
    expect(entries).toHaveLength(3)
    expect(entries.filter((e) => e.type === 'event')).toHaveLength(2)
    const msgs = await store.loadMessages('s4')
    expect(msgs).toHaveLength(1)
  })
})

describe('坏行容忍', () => {
  it('坏行跳过 + warning，其余行正常读回', async () => {
    await store.create(makeMeta('s5'))
    await store.appendMessage('s5', { type: 'message', id: 'm1', role: 'user', text: 'ok', ts: 1 })
    // 模拟进程被杀留下的末行截断半行
    const file = join(dir, 'sessions', 's5.jsonl')
    await writeFile(file, '{"type":"message","id":"m2","role":"ag', { flag: 'a' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const msgs = await store.loadMessages('s5')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('ok')
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})

describe('meta 原子重写', () => {
  it('updateTitle 重写首行 meta 且保留后续 message 行；目录无残留临时文件', async () => {
    await store.create(makeMeta('s6'))
    await store.appendMessage('s6', { type: 'message', id: 'm1', role: 'user', text: '保留我', ts: 1 })
    await store.updateTitle('s6', '新标题')
    const got = await store.get('s6')
    expect(got?.meta.title).toBe('新标题')
    const msgs = await store.loadMessages('s6')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('保留我')
    const { readdir } = await import('node:fs/promises')
    const names = await readdir(join(dir, 'sessions'))
    expect(names).toEqual(['s6.jsonl'])
  })

  it('updateMeta 可更新 systemPromptInjected 等内部字段', async () => {
    await store.create(makeMeta('s7'))
    await store.updateMeta('s7', { systemPromptInjected: true })
    expect((await store.get('s7'))?.meta.systemPromptInjected).toBe(true)
  })
})

describe('list 扫目录（无 index.json）', () => {
  it('多会话按 mtime 排序返回；不创建 index.json', async () => {
    await store.create(makeMeta('a'))
    await store.create(makeMeta('b'))
    await store.create(makeMeta('c'))
    // 手工调整 mtime：b 最新，a 最旧
    const base = new Date('2026-01-01T00:00:00Z')
    await utimes(join(dir, 'sessions', 'a.jsonl'), base, base)
    await utimes(join(dir, 'sessions', 'b.jsonl'), new Date(base.getTime() + 2000), new Date(base.getTime() + 2000))
    await utimes(join(dir, 'sessions', 'c.jsonl'), new Date(base.getTime() + 1000), new Date(base.getTime() + 1000))
    const list = await store.list()
    expect(list.map((m) => m.id)).toEqual(['b', 'c', 'a'])
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(dir)).toEqual(['sessions'])
    const mtime = await stat(join(dir, 'sessions', 'b.jsonl'))
    expect(mtime.mtimeMs).toBeGreaterThan(0)
  })
})

describe('corrupt 标注', () => {
  it('首行 meta 损坏的会话在 list 中标注 corrupt 而非静默消失', async () => {
    await store.create(makeMeta('good'))
    await writeFile(join(dir, 'sessions', 'broken.jsonl'), 'not-json-at-all\n{"type":"message"}\n')
    const list = await store.list()
    const broken = list.find((m) => m.id === 'broken')
    expect(broken).toBeDefined()
    expect(broken?.corrupt).toBe(true)
    expect(list.find((m) => m.id === 'good')?.corrupt).toBeUndefined()
    // 损坏会话 get 返回 null（meta 不可用），但 list 可见
    expect(await store.get('broken')).toBeNull()
  })
})
