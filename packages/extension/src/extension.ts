/**
 * dionysus-vscode 激活入口（architecture.md §6.1）。
 * Phase 3：core-host 装配 → 注册 webview providers / 命令 / StatusBar →
 * CLI 检测引导。Phase 1 的 spike 自动开面板行为已移除（spike 使命完成）。
 */
import * as vscode from 'vscode'

import { detectClis } from './cli-detect.js'
import { registerCommands } from './commands.js'
import { createVscodeConfigReader, createConfigService } from './config.js'
import { createCoreHost } from './core-host.js'
import { FOCUS_SESSION_LIST_COMMAND, SessionStatusBar } from './status-bar.js'
import {
  ChatPanelController,
  PairingQrPanelController,
  SESSION_LIST_VIEW_TYPE,
  SessionListViewProvider,
  SettingsPanelController,
  resolveAssetsRoot,
  resolveMobileDist,
} from './webview-provider.js'

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. 配置服务（唯一引用热更新，ADR-6）
  const configService = createConfigService(createVscodeConfigReader(vscode.workspace))

  // 2. CLI 安装检测（§6.1.1；结果决定 defaultAdapterId 与 needCliGuide）
  const detections = await detectClis()

  // 3. core 装配：SessionManager + JsonlSessionStore + BroadcastHub + 配置注入
  //    （含 Phase 5 移动端链路：PairingManager + WsTransport + lan-server，
  //    lan.enabled=false 时 lan-server 不启动）
  const host = await createCoreHost({
    storageDir: context.globalStorageUri.fsPath,
    assetsDir: resolveAssetsRoot(context).fsPath,
    mobileDistDir: resolveMobileDist(context).fsPath,
    configService,
    detections,
    // dionysus.workingDir 的 ${workspaceFolder} 占位符在此解析（core-host 零 vscode 依赖）；
    // 无工作区时占位符替换为空串，core 按「无默认目录」处理
    resolveWorkingDir: (configured) =>
      configured.replaceAll('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''),
  })
  context.subscriptions.push({ dispose: () => host.dispose() })

  // 新建会话的「选择工作目录」：webview 发 working_dir_pick_request → 弹系统目录选择框
  host.setWorkingDirPickHandler(async (defaultPath) => {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: '选择为工作目录',
      ...(defaultPath ? { defaultUri: vscode.Uri.file(defaultPath) } : {}),
    })
    return uris?.[0]?.fsPath ?? null
  })

  // 4. webview 容器：editor 聊天面板 + sidebar 会话列表 + 设置面板（角色与素材库）
  const chatPanel = new ChatPanelController(context, host)
  // sidebar 点击会话（focus_session）→ 聚焦聊天面板（session_switched 单播由 core-host 负责）
  host.setFocusSessionHandler(() => chatPanel.reveal())
  // SettingsPanelController 构造时自注册 dionysus.openSettings 命令与 settings 写入器
  const settingsPanel = new SettingsPanelController(context, host)
  // PairingQrPanelController 构造时自注册 dionysus.showPairingQr 命令（§6.4 配对弹层）
  const pairingQrPanel = new PairingQrPanelController(context, host)
  context.subscriptions.push(
    { dispose: () => chatPanel.dispose() },
    { dispose: () => settingsPanel.dispose() },
    { dispose: () => pairingQrPanel.dispose() },
    // sidebar 会话列表：retainContextWhenHidden 双保险——视图折叠后 webview 不销毁，
    // 重展开时无需重连重放（digest 驱动的列表不丢状态）
    vscode.window.registerWebviewViewProvider(
      SESSION_LIST_VIEW_TYPE,
      new SessionListViewProvider(context, host),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  )

  // 5. StatusBar 聚合状态面（digest 数据源，点击聚焦会话列表）
  const statusBar = new SessionStatusBar(
    vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100),
  )
  const unsubDigest = host.manager.onMessage((msg) => statusBar.handleMessage(msg))
  context.subscriptions.push(
    statusBar,
    { dispose: unsubDigest },
    vscode.commands.registerCommand(FOCUS_SESSION_LIST_COMMAND, () =>
      vscode.commands.executeCommand(`${SESSION_LIST_VIEW_TYPE}.focus`),
    ),
  )

  // 6. 命令（openChat/newSession/interrupt/selectAdapter/selectPersona/showPairingQr/redetectAgents）
  registerCommands(context, { host, openChat: () => chatPanel.reveal() })

  // 7. settings.json 变更 → 配置服务原地热更新
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('dionysus')) configService.refresh()
    }),
  )

  // 8. 未找到任何 CLI 时引导安装（webview 引导页由 needCliGuide 驱动，此处再给一次明确提示）
  if (host.needCliGuide) {
    void vscode.window
      .showInformationMessage(
        'Dionysus 未检测到任何 AI 助手 CLI。安装 Kimi Code / Claude Code / OpenCode / Codex / CodeBuddy 之一后即可开始对话。',
        '打开安装引导',
      )
      .then((choice) => {
        if (choice === '打开安装引导') chatPanel.reveal()
      })
  }
}

export function deactivate(): void {
  // 常驻资源均挂在 context.subscriptions；CLI 子进程随扩展宿主进程退出而终止
}
