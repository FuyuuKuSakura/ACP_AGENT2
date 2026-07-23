/**
 * VS Code 命令注册（architecture.md §6.5）。
 * Phase 3 真实实现：openChat / newSession / interrupt / selectAdapter /
 * selectPersona / redetectAgents。
 * showPairingQr 由 webview-provider.ts 的 PairingQrPanelController 自注册
 * （Phase 5 真实实现，与 SettingsPanelController.openSettings 同款装配模式），
 * 不在此重复注册。
 */
import * as vscode from 'vscode'

import { detectClis, TESTED_VERSIONS, type CliDetection } from './cli-detect.js'
import type { CoreHost } from './core-host.js'

export interface CommandServices {
  host: CoreHost
  /** 打开/聚焦聊天主面板（editor panel） */
  openChat(): void
}

function formatDetectionLine(result: CliDetection): string {
  const tested = TESTED_VERSIONS[result.id] ?? 'unknown'
  if (!result.installed) {
    return `${result.id}（命令 ${result.command}）：未安装`
  }
  const version = result.version ?? '版本未知'
  const testedNote =
    tested === 'unknown' ? '已适配版本暂无记录' : `已适配 ${tested}`
  const warning = result.withinTestedRange
    ? ''
    : '（注意：本机版本超出已适配范围——按「尽力配对」原则不阻断使用，若输出解析异常请升级插件）'
  return `${result.id}（命令 ${result.command}）：本机 ${version}，${testedNote}${warning}`
}

async function redetectAgents(services: CommandServices): Promise<void> {
  const results = await detectClis()
  services.host.refreshDetections(results)
  const installedCount = results.filter((r) => r.installed).length

  const header =
    installedCount === 0
      ? '未检测到任何受支持的 AI 助手 CLI（kimi / claude / opencode / codex / codebuddy）。请先按官方文档安装其一。'
      : `检测到 ${installedCount}/${results.length} 个 AI 助手 CLI：`

  const detail = results.map(formatDetectionLine).join('\n')
  void vscode.window.showInformationMessage(`${header}\n\n${detail}`, {
    modal: true,
  })
}

async function newSession(services: CommandServices): Promise<void> {
  if (services.host.needCliGuide) {
    void vscode.window.showWarningMessage(
      'Dionysus 未检测到任何 AI 助手 CLI。请先安装 Kimi Code / Claude Code / OpenCode / Codex / CodeBuddy 之一，然后运行「Dionysus: 重新检测 AI 助手」。',
    )
    services.openChat() // 面板内显示安装引导页（needCliGuide）
    return
  }
  await services.host.manager.createSession({
    adapterId: services.host.resolveDefaultAdapterId(),
  })
  services.openChat()
}

/** 打断「当前」会话：取最近活动且仍在运行的会话（单聊天面板当前只承载一个焦点会话）。 */
async function interruptCurrent(services: CommandServices): Promise<void> {
  const sessions = await services.host.manager.listSessions()
  const current = sessions
    .filter((s) => s.status === 'running' || s.status === 'waiting_option')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (!current) {
    void vscode.window.showInformationMessage(
      'Dionysus：当前没有运行中的会话。',
    )
    return
  }
  await services.host.manager.interrupt(current.id)
}

/** 选择默认 AI 助手：候选 = 探测到的 CLI（含已适配/本机版本展示，ADR-19），写回 dionysus.adapter.default。 */
async function selectAdapter(services: CommandServices): Promise<void> {
  const items = services.host.detections.map((det) => {
    const tested = TESTED_VERSIONS[det.id] ?? 'unknown'
    const versionNote = det.installed
      ? `本机 ${det.version ?? '版本未知'} · 已适配 ${tested}${det.withinTestedRange ? '' : '（超出已适配范围）'}`
      : '未安装'
    return {
      label: det.id,
      description: det.installed ? det.command : undefined,
      detail: versionNote,
      installed: det.installed,
    }
  })
  const picked = await vscode.window.showQuickPick(items, {
    // 作用域明示：只影响之后新建会话的默认助手；已建会话的绑定在创建时确定
    title: '选择新会话的默认 AI 助手',
    placeHolder: '留空设置 = 自动使用第一个检测到的可用 CLI',
  })
  if (!picked) return
  if (!picked.installed) {
    void vscode.window.showWarningMessage(
      `Dionysus：${picked.label} 未安装，请先安装后再设为默认。`,
    )
    return
  }
  await vscode.workspace
    .getConfiguration('dionysus')
    .update('adapter.default', picked.label, vscode.ConfigurationTarget.Global)
  void vscode.window.showInformationMessage(
    `Dionysus：新会话的默认 AI 助手已切换为 ${picked.label}（已建会话的绑定不变）。`,
  )
}

/** 选择默认角色：候选 = persona loader 枚举（builtin + 用户素材库），写回 dionysus.persona.default。 */
async function selectPersona(services: CommandServices): Promise<void> {
  const personas = await services.host.personaLoader.list()
  if (personas.length === 0) {
    void vscode.window.showWarningMessage(
      'Dionysus：未找到任何角色配置（assets/personas 为空）。',
    )
    return
  }
  const picked = await vscode.window.showQuickPick(
    personas.map((p) => ({
      label: p.name,
      description: p.id,
      detail: p.source === 'builtin' ? '出厂角色' : '用户素材库角色',
      personaId: p.id,
    })),
    { title: '选择新会话的默认角色' },
  )
  if (!picked) return
  await vscode.workspace
    .getConfiguration('dionysus')
    .update(
      'persona.default',
      picked.personaId,
      vscode.ConfigurationTarget.Global,
    )
  void vscode.window.showInformationMessage(
    `Dionysus：新会话的默认角色已切换为 ${picked.label}（已建会话的绑定不变）。`,
  )
}

export function registerCommands(
  context: vscode.ExtensionContext,
  services: CommandServices,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('dionysus.openChat', () =>
      services.openChat(),
    ),
    vscode.commands.registerCommand(
      'dionysus.newSession',
      () => void newSession(services),
    ),
    vscode.commands.registerCommand(
      'dionysus.interrupt',
      () => void interruptCurrent(services),
    ),
    vscode.commands.registerCommand(
      'dionysus.selectAdapter',
      () => void selectAdapter(services),
    ),
    vscode.commands.registerCommand(
      'dionysus.selectPersona',
      () => void selectPersona(services),
    ),
    vscode.commands.registerCommand(
      'dionysus.redetectAgents',
      () => void redetectAgents(services),
    ),
  )
}
