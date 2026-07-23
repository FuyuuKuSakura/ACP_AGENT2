/**
 * @dionysus/protocol — 公开接口（architecture.md §4.2）。
 */
import { z } from 'zod'

import {
  clientMessageSchema,
  serverMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from './messages.js'

export const PROTOCOL_VERSION = 1 as const

export * from './messages.js'

/** 单条校验问题：path 为点分字段路径（根级问题为空字符串）。 */
export interface ProtocolIssue {
  path: string
  message: string
  code: string
}

/** zod 校验失败时抛出，携带完整路径信息。 */
export class ProtocolError extends Error {
  override readonly name = 'ProtocolError'
  readonly issues: readonly ProtocolIssue[]

  constructor(direction: 'client' | 'server', issues: ProtocolIssue[]) {
    const detail = issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')
    super(`Invalid ${direction} message: ${detail}`)
    this.issues = issues
  }
}

function toProtocolError(direction: 'client' | 'server', error: z.ZodError): ProtocolError {
  return new ProtocolError(
    direction,
    error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
  )
}

/** 解析 C→S 消息；校验失败抛 ProtocolError（带路径信息）。 */
export function parseClientMessage(raw: unknown): ClientMessage {
  const result = clientMessageSchema.safeParse(raw)
  if (!result.success) throw toProtocolError('client', result.error)
  return result.data
}

/** 解析 S→C 消息；校验失败抛 ProtocolError（带路径信息）。 */
export function parseServerMessage(raw: unknown): ServerMessage {
  const result = serverMessageSchema.safeParse(raw)
  if (!result.success) throw toProtocolError('server', result.error)
  return result.data
}
