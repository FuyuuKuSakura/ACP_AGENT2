/**
 * 会话工作目录 + CLI 历史会话的宿主链路单测（纯 node + FakeWebview）：
 * - new_session 追加字段（workingDir/title/adapterId）全链路透传到 SessionManager；
 * - session_list_response 携带 workingDir；digest 生效目录（含 ${workspaceFolder} 解析回落）；
 * - cli_session_list_request/response 单播回路（kimi 索引 fixture，按工作目录过滤）；
 * - working_dir_pick_request/response：宿主回调注入/取消/未注入三分支。
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FakeWebview, makeTestHost, until, type TestHostContext } from './test-utils.js'

describe('会话工作目录与历史会话（宿主链路）', () => {
  let ctx: TestHostContext | null = null
  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
  })

  it('new_session 携带 workingDir/title/adapterId → 会话元数据全链路生效', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)

    sidebar.emit({
      v: 1,
      type: 'new_session',
      ts: Date.now(),
      payload: { workingDir: '/proj/a', title: '在 a 目录干活', adapterId: 'kimi_cli' },
    })
    await until(() => sidebar.ofType('session_digest_update').length > 0)

    const digest = sidebar.ofType('session_digest_update')[0]
    expect(digest.payload.title).toBe('在 a 目录干活')
    expect(digest.payload.workingDir).toBe('/proj/a')
    const meta = await ctx.host.manager.getSession(digest.payload.sessionId)
    expect(meta?.workingDir).toBe('/proj/a')
    expect(meta?.title).toBe('在 a 目录干活')
    expect(meta?.adapterId).toBe('kimi_cli')
  })

  it('new_session 不带 workingDir：digest 回落全局默认（${workspaceFolder} 经 resolveWorkingDir 解析）', async () => {
    ctx = await makeTestHost({
      settings: { workingDir: '${workspaceFolder}' },
      deps: { resolveWorkingDir: (configured) => configured.replaceAll('${workspaceFolder}', '/ws/root') },
    })
    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)

    sidebar.emit({ v: 1, type: 'new_session', ts: Date.now(), payload: {} })
    await until(() => sidebar.ofType('session_digest_update').length > 0)

    const digest = sidebar.ofType('session_digest_update')[0]
    expect(digest.payload.workingDir).toBe('/ws/root')
    const meta = await ctx.host.manager.getSession(digest.payload.sessionId)
    expect(meta?.workingDir).toBeUndefined()
  })

  it('session_list_response 携带会话 workingDir', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)
    await ctx.host.manager.createSession({ adapterId: 'kimi_cli', workingDir: '/proj/a' })

    sidebar.emit({ v: 1, type: 'session_list_request', ts: Date.now(), payload: {} })
    await until(() => sidebar.ofType('session_list_response').length > 0)

    const resp = sidebar.ofType('session_list_response')[0]
    expect(resp.payload.sessions[0]?.workingDir).toBe('/proj/a')
  })

  it('cli_session_list_request：kimi 索引按会话工作目录过滤后单播返回', async () => {
    // 索引文件落在独立临时路径（host 的 storageDir 由 makeTestHost 内部创建，不便预写）
    const indexDir = await mkdtemp(join(osTmpdir(), 'dionysus-idx-'))
    const indexPath = join(indexDir, 'session_index.jsonl')
    await writeFile(
      indexPath,
      [
        JSON.stringify({ sessionId: 'ses_a1', workDir: '/proj/a', title: '甲' }),
        JSON.stringify({ sessionId: 'ses_b1', workDir: '/proj/b' }),
      ].join('\n'),
      'utf8',
    )
    ctx = await makeTestHost({ deps: { cliSessionIndexPath: indexPath } })

    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)
    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli', workingDir: '/proj/a' })

    sidebar.emit({
      v: 1,
      type: 'cli_session_list_request',
      traceId: 'tr-cli',
      ts: Date.now(),
      payload: { sessionId: meta.id },
    })
    await until(() => sidebar.ofType('cli_session_list_response').length > 0)

    const resp = sidebar.ofType('cli_session_list_response')[0]
    expect(resp.traceId).toBe('tr-cli')
    expect(resp.payload.supported).toBe(true)
    expect(resp.payload.sessions.map((s) => s.id)).toEqual(['ses_a1'])
  })

  it('cli_session_list_request：无索引能力的助手 supported=false', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)
    // claude_cli 探测条目（type=claude_code_cli，策略无 listSessionIndex）
    ctx.host.refreshDetections([
      { id: 'claude_cli', command: 'claude', installed: true, version: '1.0.0', withinTestedRange: true },
    ])
    const meta = await ctx.host.manager.createSession({ adapterId: 'claude_cli' })

    sidebar.emit({
      v: 1,
      type: 'cli_session_list_request',
      ts: Date.now(),
      payload: { sessionId: meta.id },
    })
    await until(() => sidebar.ofType('cli_session_list_response').length > 0)

    expect(sidebar.ofType('cli_session_list_response')[0].payload).toEqual({
      sessionId: meta.id,
      supported: false,
      sessions: [],
    })
  })

  it('working_dir_pick_request：宿主回调返回路径 → response 携带 path', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)
    const seenDefaults: (string | undefined)[] = []
    ctx.host.setWorkingDirPickHandler(async (defaultPath) => {
      seenDefaults.push(defaultPath)
      return '/picked/dir'
    })

    sidebar.emit({
      v: 1,
      type: 'working_dir_pick_request',
      traceId: 'tr-pick',
      ts: Date.now(),
      payload: { defaultPath: '/proj/a' },
    })
    await until(() => sidebar.ofType('working_dir_pick_response').length > 0)

    const resp = sidebar.ofType('working_dir_pick_response')[0]
    expect(resp.traceId).toBe('tr-pick')
    expect(resp.payload).toEqual({ path: '/picked/dir', canceled: false })
    expect(seenDefaults).toEqual(['/proj/a'])
  })

  it('working_dir_pick_request：用户取消 / 未注入回调 → canceled=true', async () => {
    ctx = await makeTestHost()
    const sidebar = new FakeWebview()
    ctx.host.attachWebview('webview:sidebar', sidebar)

    // 未注入回调
    sidebar.emit({ v: 1, type: 'working_dir_pick_request', ts: Date.now(), payload: {} })
    await until(() => sidebar.ofType('working_dir_pick_response').length > 0)
    expect(sidebar.ofType('working_dir_pick_response')[0].payload).toEqual({ canceled: true })

    // 回调返回 null（用户取消）
    ctx.host.setWorkingDirPickHandler(async () => null)
    sidebar.emit({ v: 1, type: 'working_dir_pick_request', ts: Date.now(), payload: {} })
    await until(() => sidebar.ofType('working_dir_pick_response').length > 1)
    expect(sidebar.ofType('working_dir_pick_response')[1].payload).toEqual({ canceled: true })
  })
})
