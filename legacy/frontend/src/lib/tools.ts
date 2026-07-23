export interface ParsedToolCall {
  name: string
  args: string
}

export interface ParsedToolChunk {
  type: 'tool_call' | 'tool_result'
  call?: ParsedToolCall
  result?: string
}

const TOOL_CALL_REGEX = /^[ \t]*🔧[ \t]*调用工具[：:]?[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*$/gm
const TOOL_RESULT_REGEX = /^[ \t]*🛠️[ \t]*工具结果[：:]?[ \t]*([\s\S]*?)\s*$/m

/**
 * Parse tool-call metadata lines (e.g. "🔧 调用工具: Write(...)") from agent content.
 * Returns the cleaned content (with those lines removed) and a list of parsed calls.
 */
export function parseToolCalls(content: string): {
  displayContent: string
  calls: ParsedToolCall[]
} {
  const calls: ParsedToolCall[] = []
  let match: RegExpExecArray | null
  // Reset regex state because it is global.
  TOOL_CALL_REGEX.lastIndex = 0
  while ((match = TOOL_CALL_REGEX.exec(content)) !== null) {
    calls.push({ name: match[1], args: match[2] })
  }
  const displayContent = content.replace(TOOL_CALL_REGEX, '').trim()
  return { displayContent, calls }
}

/**
 * Parse a single backend chunk to detect tool-call or tool-result metadata.
 */
export function parseToolChunk(chunk: string): ParsedToolChunk | null {
  const trimmed = chunk.trimEnd()
  const { calls } = parseToolCalls(trimmed)
  if (calls.length > 0) {
    return { type: 'tool_call', call: calls[0] }
  }
  const resultMatch = trimmed.match(TOOL_RESULT_REGEX)
  if (resultMatch) {
    return { type: 'tool_result', result: resultMatch[1].trim() }
  }
  return null
}

/**
 * Build a short human-readable summary of a tool call.
 */
export function formatToolCall(call: ParsedToolCall, maxArgs = 40): string {
  const args = call.args.replace(/\s+/g, ' ').trim()
  const preview = args.length > maxArgs ? `${args.slice(0, maxArgs)}…` : args
  return `${call.name}(${preview})`
}
