/**
 * CLI 历史会话索引读取（architecture.md §5.3 的 cliSpecific 委托能力之一）。
 *
 * kimi 的会话按工作目录落盘，索引在 ~/.kimi-code/session_index.jsonl——
 * 每行一个 JSON 对象（至少 { sessionId, workDir }，可能带 title/updatedAt）。
 * 语义对齐 legacy _cmd_list_kimi_sessions（manager.py:670-707）：
 * 文件缺失/不可读返回空列表；坏行跳过不拖垮整份索引。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { isRecord, type CliSessionIndexEntry } from './strategy.js'

/** kimi 会话索引的约定路径（测试可经参数覆盖）。 */
export function defaultKimiSessionIndexPath(): string {
  return join(homedir(), '.kimi-code', 'session_index.jsonl')
}

/**
 * 解析一行索引 JSON → CliSessionIndexEntry；缺 sessionId/workDir 或形状非法返回 null。
 * updatedAt 兼容秒级时间戳（< 1e12 视为秒，转 Unix 毫秒）。
 */
export function parseKimiSessionIndexLine(line: string): CliSessionIndexEntry | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const id = parsed.sessionId
  const workDir = parsed.workDir
  if (typeof id !== 'string' || !id || typeof workDir !== 'string' || !workDir) return null
  const entry: CliSessionIndexEntry = { id, workDir }
  if (typeof parsed.title === 'string' && parsed.title) entry.title = parsed.title
  const ts = parsed.updatedAt
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    entry.updatedAt = Math.trunc(ts < 1e12 ? ts * 1000 : ts)
  }
  return entry
}

/** 读取整份索引（坏行跳过）；文件不存在/读取失败返回空列表。 */
export async function readKimiSessionIndex(
  indexPath: string = defaultKimiSessionIndexPath(),
): Promise<CliSessionIndexEntry[]> {
  let content: string
  try {
    content = await readFile(indexPath, 'utf8')
  } catch {
    return []
  }
  const entries: CliSessionIndexEntry[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    const entry = parseKimiSessionIndexLine(line)
    if (entry) entries.push(entry)
  }
  return entries
}
