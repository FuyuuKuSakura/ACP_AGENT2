/**
 * kimi CLI 会话索引读取测试（/sessions 与「恢复历史会话」数据源）：
 * 行解析（合法/缺字段/坏行/秒级时间戳）+ 整份索引读取（坏行容忍、文件缺失）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { parseKimiSessionIndexLine, readKimiSessionIndex } from '../cli-session-index.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dionysus-kimi-index-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parseKimiSessionIndexLine', () => {
  it('合法行：sessionId/workDir 必填，title/updatedAt 透传', () => {
    const entry = parseKimiSessionIndexLine(
      JSON.stringify({ sessionId: 'ses_1', workDir: '/proj/a', title: '重构 auth', updatedAt: 1_700_000_000_000 }),
    )
    expect(entry).toEqual({ id: 'ses_1', workDir: '/proj/a', title: '重构 auth', updatedAt: 1_700_000_000_000 })
  })

  it('秒级 updatedAt 转 Unix 毫秒', () => {
    const entry = parseKimiSessionIndexLine(
      JSON.stringify({ sessionId: 'ses_1', workDir: '/proj/a', updatedAt: 1_700_000_000 }),
    )
    expect(entry?.updatedAt).toBe(1_700_000_000_000)
  })

  it('缺 sessionId 或 workDir 返回 null', () => {
    expect(parseKimiSessionIndexLine(JSON.stringify({ workDir: '/a' }))).toBeNull()
    expect(parseKimiSessionIndexLine(JSON.stringify({ sessionId: 'ses_1' }))).toBeNull()
    expect(parseKimiSessionIndexLine(JSON.stringify({ sessionId: '', workDir: '/a' }))).toBeNull()
  })

  it('坏 JSON / 非对象返回 null', () => {
    expect(parseKimiSessionIndexLine('{not json')).toBeNull()
    expect(parseKimiSessionIndexLine('[1,2]')).toBeNull()
  })
})

describe('readKimiSessionIndex', () => {
  it('读取整份索引：坏行跳过，空行跳过', async () => {
    const file = join(dir, 'session_index.jsonl')
    await writeFile(
      file,
      [
        JSON.stringify({ sessionId: 'ses_1', workDir: '/proj/a', title: '甲' }),
        '{corrupt',
        '',
        JSON.stringify({ sessionId: 'ses_2', workDir: '/proj/b' }),
      ].join('\n'),
      'utf8',
    )
    const entries = await readKimiSessionIndex(file)
    expect(entries).toEqual([
      { id: 'ses_1', workDir: '/proj/a', title: '甲' },
      { id: 'ses_2', workDir: '/proj/b' },
    ])
  })

  it('文件不存在返回空列表', async () => {
    expect(await readKimiSessionIndex(join(dir, 'missing.jsonl'))).toEqual([])
  })
})
