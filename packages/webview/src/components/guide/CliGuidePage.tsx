/**
 * CliGuidePage — 未检测到任何 agent CLI 时的安装引导页
 * （ux-core-flows.md §5 步骤 1：全部缺失时显示引导页，而非等用户发消息
 * 才报 spawn ENOENT）。
 *
 * 五个 CLI 各一张卡：一句话白话简介 + 一键复制安装命令 + 官方文档链接。
 * CLI 清单与 extension cli-detect.ts 的 SUPPORTED_CLIS 对齐。
 */
import { useState } from 'react'

import { Icon } from '../Icon.js'

interface CliGuideEntry {
  id: string
  name: string
  /** 一句话白话简介（不出现黑话） */
  intro: string
  installCommand: string
  docsUrl: string
}

/** 五个受支持的 AI 助手 CLI（顺序与 cli-detect.ts 一致）。 */
const CLI_GUIDES: readonly CliGuideEntry[] = [
  {
    id: 'kimi_cli',
    name: 'Kimi Code',
    intro:
      '月之暗面出品的命令行 AI 助手，能读写代码、跑命令、自己规划多步任务。',
    installCommand: 'npm install -g @moonshot-ai/kimi-code',
    docsUrl: 'https://github.com/MoonshotAI/kimi-code',
  },
  {
    id: 'claude_cli',
    name: 'Claude Code',
    intro: 'Anthropic 出品的命令行 AI 助手，擅长理解整个项目后动手改代码。',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'opencode_cli',
    name: 'opencode',
    intro: '开源的命令行 AI 助手，可以接多家模型，社区活跃、玩法多。',
    installCommand: 'npm install -g opencode-ai',
    docsUrl: 'https://opencode.ai/docs/',
  },
  {
    id: 'codex_cli',
    name: 'Codex CLI',
    intro: 'OpenAI 出品的命令行 AI 助手，在终端里直接用自然语言让它写代码。',
    installCommand: 'npm install -g @openai/codex',
    docsUrl: 'https://github.com/openai/codex',
  },
  {
    id: 'codebuddy_cli',
    name: 'CodeBuddy Code',
    intro: '腾讯云出品的命令行 AI 助手，中文友好，终端、IDE 里都能用。',
    installCommand: 'npm install -g @tencent-ai/codebuddy-code',
    docsUrl: 'https://www.codebuddy.ai/docs/cli/quickstart',
  },
]

function CliCard({ entry }: { entry: CliGuideEntry }) {
  const [copied, setCopied] = useState(false)

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(entry.installCommand)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 剪贴板不可用（权限被拒等）：命令文本本来就可选中，静默降级
    }
  }

  return (
    <li
      data-testid="cli-guide-card"
      className="rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] p-3.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--dn-fg)]">
          {entry.name}
        </h2>
        <a
          href={entry.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-0.5 text-xs text-[var(--dn-accent)] hover:underline"
        >
          官方文档
          <Icon name="external" size={12} />
        </a>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dn-muted)]">
        {entry.intro}
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[var(--dn-radius-sm)] bg-[var(--dn-code-bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--dn-fg)]">
          {entry.installCommand}
        </code>
        <button
          type="button"
          onClick={() => void copyInstallCommand()}
          className="inline-flex shrink-0 items-center gap-1 rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-bg)] px-2.5 py-1.5 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)]"
        >
          {copied ? (
            <>
              已复制
              <Icon name="done" size={12} />
            </>
          ) : (
            '复制'
          )}
        </button>
      </div>
    </li>
  )
}

export function CliGuidePage() {
  return (
    <div className="dn-scroll h-full overflow-y-auto bg-[var(--dn-bg)] px-4 py-6">
      <div className="mx-auto max-w-xl">
        <h1 className="text-base font-semibold text-[var(--dn-fg)]">
          先装一个 AI 助手，就能开始用了
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dn-muted)]">
          Dionysus 本身不带「大脑」，需要一个 AI
          助手程序来干活。下面五个任选其一：
          把安装命令粘贴到终端里执行，装好后重新打开本面板即可。
        </p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {CLI_GUIDES.map((entry) => (
            <CliCard key={entry.id} entry={entry} />
          ))}
        </ul>
        <p className="mt-4 text-xs text-[var(--dn-muted)]">
          不知道选哪个？装 Kimi Code 或 Claude Code 都不错。装了好几个也没关系，
          之后可以在设置里随时换。
        </p>
      </div>
    </div>
  )
}
