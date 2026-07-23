/**
 * 会话工作目录 + CLI 历史会话测试：
 * - SessionMeta.workingDir 持久化与全局回落（缺省回落 defaultWorkingDir getter）；
 * - applySessionWorkingDir：adapter 创建时的会话目录覆盖；
 * - listCliSessions：委托 kimi 策略索引能力（fixture），按工作目录过滤，
 *   无索引能力的策略 supported=false；
 * - /sessions 命令追加 CLI 历史会话段。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AdapterConfig } from '../../adapters/strategy.js'
import { executeSlashCommand } from '../commands.js'
import { applySessionWorkingDir, SessionManager, type SessionManagerDeps } from '../manager.js'
import { JsonlSessionStore } from '../store.js'
import { MessageCollector } from './helpers/fake-adapter.js'

let dir: string
let store: JsonlSessionStore
let collector: MessageCollector

const ADAPTERS: Record<string, AdapterConfig> = {
  kimi: { type: 'kimi_code_cli', command: 'kimi', workingDir: '/global/default' },
  claude: { type: 'claude_code_cli', command: 'claude' },
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-workingdir-'))
  store = new JsonlSessionStore(dir)
  collector = new MessageCollector()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function makeManager(overrides: Partial<SessionManagerDeps> = {}): SessionManager {
  const manager = new SessionManager({
    store,
    adapters: ADAPTERS,
    defaultAdapterId: 'kimi',
    defaultWorkingDir: () => '/global/default',
    ...overrides,
  })
  manager.onMessage(collector.handler)
  return manager
}

async function writeIndex(lines: unknown[]): Promise<string> {
  const file = join(dir, 'session_index.jsonl')
  await writeFile(
    file,
    lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'),
    'utf8',
  )
  return file
}

describe('SessionMeta.workingDir 持久化与回落', () => {
  it('createSession 携带 workingDir：随首行 meta 持久化，重启后 get/list 可见', async () => {
    const manager = makeManager()
    const meta = await manager.createSession({ workingDir: '/proj/a' })
    expect(meta.workingDir).toBe('/proj/a')

    // 持久化：从磁盘读回（新 store 实例模拟进程重启）
    const reloaded = await new JsonlSessionStore(dir).get(meta.id)
    expect(reloaded?.meta.workingDir).toBe('/proj/a')
    const listed = await new JsonlSessionStore(dir).list()
    expect(listed.find((m) => m.id === meta.id)?.workingDir).toBe('/proj/a')
  })

  it('缺省不写 workingDir：meta 无该键（向后兼容旧格式），effectiveWorkingDir 回落全局默认', async () => {
    const manager = makeManager()
    const meta = await manager.createSession()
    expect(meta.workingDir).toBeUndefined()
    expect(manager.effectiveWorkingDir(meta)).toBe('/global/default')

    // 磁盘上的 meta 行不含 workingDir 键（旧会话文件同形，解析不炸）
    const reloaded = await new JsonlSessionStore(dir).get(meta.id)
    expect(reloaded?.meta.workingDir).toBeUndefined()
    expect(manager.effectiveWorkingDir(reloaded!.meta)).toBe('/global/default')
  })

  it('会话 workingDir 优先于全局默认', async () => {
    const manager = makeManager()
    const meta = await manager.createSession({ workingDir: '/proj/a' })
    expect(manager.effectiveWorkingDir(meta)).toBe('/proj/a')
  })

  it('digest 携带生效工作目录（列表项展示数据源）', async () => {
    const manager = makeManager()
    await manager.createSession({ workingDir: '/proj/a' })
    const digest = collector.ofType('session_digest_update').at(-1)
    expect(digest?.payload.workingDir).toBe('/proj/a')
  })
})

describe('applySessionWorkingDir（adapter 目录覆盖）', () => {
  it('会话目录覆盖配置条目的 workingDir（浅拷贝，不改原 record）', () => {
    const next = applySessionWorkingDir(ADAPTERS, 'kimi', '/proj/a')
    expect(next.kimi.workingDir).toBe('/proj/a')
    expect(ADAPTERS.kimi.workingDir).toBe('/global/default')
    expect(next.claude).toBe(ADAPTERS.claude)
  })

  it('无生效目录或与现值相同：返回原 record 引用', () => {
    expect(applySessionWorkingDir(ADAPTERS, 'kimi', undefined)).toBe(ADAPTERS)
    expect(applySessionWorkingDir(ADAPTERS, 'kimi', '/global/default')).toBe(ADAPTERS)
  })

  it('条目缺失时返回原 record（createAdapter 照旧报 unknown adapter）', () => {
    expect(applySessionWorkingDir(ADAPTERS, 'missing', '/proj/a')).toBe(ADAPTERS)
  })
})

describe('listCliSessions（kimi 策略索引能力）', () => {
  it('按会话工作目录过滤索引条目', async () => {
    const indexPath = await writeIndex([
      { sessionId: 'ses_a1', workDir: '/proj/a', title: '甲' },
      { sessionId: 'ses_b1', workDir: '/proj/b' },
      { sessionId: 'ses_a2', workDir: '/proj/a', updatedAt: 1_700_000_000_000 },
    ])
    const manager = makeManager({ cliSessionIndexPath: indexPath })
    const meta = await manager.createSession({ workingDir: '/proj/a' })

    const result = await manager.listCliSessions(meta.id)
    expect(result.supported).toBe(true)
    expect(result.sessions.map((s) => s.id)).toEqual(['ses_a1', 'ses_a2'])
  })

  it('会话无 workingDir 时按全局默认目录过滤', async () => {
    const indexPath = await writeIndex([
      { sessionId: 'ses_g', workDir: '/global/default' },
      { sessionId: 'ses_o', workDir: '/other' },
    ])
    const manager = makeManager({ cliSessionIndexPath: indexPath })
    const meta = await manager.createSession()

    const result = await manager.listCliSessions(meta.id)
    expect(result.sessions.map((s) => s.id)).toEqual(['ses_g'])
  })

  it('无索引能力的策略（claude）：supported=false', async () => {
    const manager = makeManager({ cliSessionIndexPath: await writeIndex([]) })
    const meta = await manager.createSession({ adapterId: 'claude' })
    const result = await manager.listCliSessions(meta.id)
    expect(result).toEqual({ supported: false, sessions: [] })
  })

  it('会话不存在抛 Unknown session', async () => {
    const manager = makeManager()
    await expect(manager.listCliSessions('nope')).rejects.toThrow('Unknown session')
  })
})

describe('/sessions 命令的 CLI 历史会话段', () => {
  it('kimi 会话：追加该目录下的历史会话列表', async () => {
    const indexPath = await writeIndex([
      { sessionId: 'ses_a1', workDir: '/proj/a', title: '甲', updatedAt: 1_700_000_000_000 },
    ])
    const manager = makeManager({ cliSessionIndexPath: indexPath })
    const meta = await manager.createSession({ workingDir: '/proj/a' })

    const notices = await executeSlashCommand('/sessions', {
      manager,
      sessionId: meta.id,
      args: '',
      origin: 'test',
    })
    const text = notices.map((n) => n.text).join('\n')
    expect(text).toContain(meta.title)
    expect(text).toContain('CLI 历史会话')
    expect(text).toContain('ses_a1')
    expect(text).toContain('/resume <id>')
  })

  it('无索引能力的助手：标注暂不支持', async () => {
    const manager = makeManager({ cliSessionIndexPath: await writeIndex([]) })
    const meta = await manager.createSession({ adapterId: 'claude' })

    const notices = await executeSlashCommand('/sessions', {
      manager,
      sessionId: meta.id,
      args: '',
      origin: 'test',
    })
    expect(notices.map((n) => n.text).join('\n')).toContain('暂不支持')
  })

  it('该目录下无历史会话：明确提示', async () => {
    const manager = makeManager({ cliSessionIndexPath: await writeIndex([]) })
    const meta = await manager.createSession({ workingDir: '/proj/empty' })

    const notices = await executeSlashCommand('/sessions', {
      manager,
      sessionId: meta.id,
      args: '',
      origin: 'test',
    })
    expect(notices.map((n) => n.text).join('\n')).toContain('没有 CLI 历史会话')
  })

  it('无会话上下文（全局调用）：只列 Dionysus 会话，不附加 CLI 段', async () => {
    const manager = makeManager()
    await manager.createSession()
    const notices = await executeSlashCommand('/sessions', { manager, args: '', origin: 'test' })
    const text = notices.map((n) => n.text).join('\n')
    expect(text).not.toContain('CLI 历史会话')
    expect(text).not.toContain('暂不支持')
  })
})
