import { exec } from 'node:child_process'

/**
 * CLI 安装检测与版本探测（architecture.md §6.1.1）。
 *
 * 对五个受支持的 agent CLI 执行 which/where 探测，命中后跑 `<cmd> --version`
 * （5s 超时，失败不阻断）。本模块不依赖 vscode，可在纯 node/vitest 下测试。
 *
 * 适配边界（ADR-19）：只能检测与警告，不能自动修复解析——CLI 输出格式
 * 变更必须改策略代码。超出已适配版本范围仅产生警告状态，不阻断使用。
 */

/** 单个 CLI 的静态描述 */
export interface CliSpec {
  /** 适配器 id，与 core registry 的策略 id 对齐（extract/adapters.md §5 各 adapter_id） */
  id: string
  /** CLI 可执行文件名（extract/adapters.md §3.1 command 字段） */
  command: string
}

/** 五个受支持的 agent CLI（顺序即默认选择器的候选顺序） */
export const SUPPORTED_CLIS: readonly CliSpec[] = [
  { id: 'kimi_cli', command: 'kimi' },
  { id: 'claude_cli', command: 'claude' },
  { id: 'opencode_cli', command: 'opencode' },
  { id: 'codex_cli', command: 'codex' },
  { id: 'codebuddy_cli', command: 'codebuddy' },
]

/**
 * 每个 CLI 已验证适配的版本（fixture 录制时验证过的版本范围，
 * architecture.md §6.1.1）。格式示例：'1.2.x'。
 *
 * 现状：extract/adapters.md 只记录了各 CLI 的行格式与参数规格，没有记录
 * 任何实测版本号；策略 fixture 尚未录制（roadmap Phase 2 任务）。因此五个
 * CLI 一律标 'unknown'，待各策略 fixture 录制时回填。
 */
export const TESTED_VERSIONS: Readonly<Record<string, string>> = {
  kimi_cli: 'unknown',
  claude_cli: 'unknown',
  opencode_cli: 'unknown',
  codex_cli: 'unknown',
  codebuddy_cli: 'unknown',
}

/** 单个 CLI 的探测结果 */
export interface CliDetection {
  id: string
  command: string
  installed: boolean
  /** `<cmd> --version` 解析出的版本号；未安装、探测失败或无法解析时缺省 */
  version?: string
  /**
   * 本机版本是否落在已适配范围内（主版本号级粗判）。
   * TESTED_VERSIONS 为 'unknown' 或任一侧版本无法解析时恒为 true
   * （无法判断则不误报，「尽力配对」原则）。
   */
  withinTestedRange: boolean
}

/** 探测超时（which 与 --version 共用），5 秒 */
export const DETECT_TIMEOUT_MS = 5000

export interface ExecOutput {
  stdout: string
  stderr: string
}

/** 执行一条 shell 命令；超时被杀或退出码非零时 reject */
export type ExecFn = (command: string, timeoutMs: number) => Promise<ExecOutput>

const defaultExec: ExecFn = (command, timeoutMs) =>
  new Promise<ExecOutput>((resolve, reject) => {
    exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })

/** 从 --version 输出中提取首个 x.y[.z] 形式的版本号 */
export function parseVersion(raw: string): string | undefined {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(raw)
  return match ? match[1] : undefined
}

function extractMajor(version: string): number | undefined {
  const match = /^\s*(\d+)/.exec(version)
  return match ? Number(match[1]) : undefined
}

/**
 * 主版本号级别的粗判（SemVer 严格解析不必要）：
 * 已适配版本为 'unknown' 或任一侧解析不出主版本号时返回 true（不误报）。
 */
export function isWithinTestedRange(testedVersion: string, localVersion: string): boolean {
  if (testedVersion === 'unknown') return true
  const testedMajor = extractMajor(testedVersion)
  const localMajor = extractMajor(localVersion)
  if (testedMajor === undefined || localMajor === undefined) return true
  return testedMajor === localMajor
}

async function probeOne(spec: CliSpec, execFn: ExecFn): Promise<CliDetection> {
  const base: Omit<CliDetection, 'installed' | 'version'> = {
    id: spec.id,
    command: spec.command,
    withinTestedRange: true,
  }

  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    await execFn(`${whichCmd} ${spec.command}`, DETECT_TIMEOUT_MS)
  } catch {
    return { ...base, installed: false }
  }

  // 命中后续跑 --version；失败/超时/无法解析均不阻断
  let version: string | undefined
  try {
    const output = await execFn(`${spec.command} --version`, DETECT_TIMEOUT_MS)
    version = parseVersion(`${output.stdout}\n${output.stderr}`)
  } catch {
    version = undefined
  }

  return {
    ...base,
    installed: true,
    version,
    withinTestedRange:
      version === undefined ? true : isWithinTestedRange(TESTED_VERSIONS[spec.id] ?? 'unknown', version),
  }
}

/**
 * 探测全部五个 CLI（并行）。永不抛异常——单个 CLI 的任何失败都只体现在
 * 该条结果上。
 */
export async function detectClis(execFn: ExecFn = defaultExec): Promise<CliDetection[]> {
  return Promise.all(SUPPORTED_CLIS.map((spec) => probeOne(spec, execFn)))
}
