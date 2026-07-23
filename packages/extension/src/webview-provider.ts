/**
 * webview 容器（architecture.md §6.1 / §7）：editor panel（聊天主面板）+
 * sidebar webview（QQ 式会话列表）。
 *
 * - 两个视图共用同一份 @dionysus/webview 产物（vite 单 bundle），视图角色经
 *   内联 init 脚本 `window.__DIONYSUS_INIT__` 下发（见 WebviewInit）；
 * - CSP 沿用 §7 模板（connect-src 是 model3.json/.moc3 XHR 的必需项）；
 * - localResourceRoots 覆盖 webview 产物、出厂 assets/、用户角色素材库（§7）；
 * - 每个 webview 创建即 host.attachWebview 接入传输层与 BroadcastHub，
 *   session_digest_update 广播由此直达 sidebar（列表数据源，§6.6）。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

import * as vscode from 'vscode'

import type { DisplayMode } from '@dionysus/client-core'
import QRCode from 'qrcode'

import type { CoreHost } from './core-host.js'
import { getLanAddress } from './lan-server.js'

export const CHAT_VIEW_TYPE = 'dionysus.chat'
export const SESSION_LIST_VIEW_TYPE = 'dionysus.sessionList'
export const SETTINGS_VIEW_TYPE = 'dionysus.settings'

/** postMessage 通道的固定 clientId（WebviewTransport 语义：clientId 固定，§6.2） */
export const CHAT_CLIENT_ID = 'webview:chat'
export const SIDEBAR_CLIENT_ID = 'webview:sidebar'
export const SETTINGS_CLIENT_ID = 'webview:settings'

/**
 * webview 启动时经内联脚本注入的初始化数据（window.__DIONYSUS_INIT__）。
 * Wave 2 webview 侧据此区分视图角色并渲染对应界面；随后的业务消息走
 * protocol 的 hello/handshake 通道。
 */
export interface WebviewInit {
  /** 传输层固定 clientId（标注消息来源，如「来自 sidebar」） */
  clientId: string
  /** 视图角色：chat = editor 聊天主面板；sidebar = 会话列表；settings = 角色与素材库设置 */
  role: 'chat' | 'sidebar' | 'settings'
  /** 未检测到任何 CLI：webview 显示安装引导页而非聊天界面 */
  needCliGuide: boolean
  /** 出厂 assets/ 的 asWebviewUri（role='settings'/'chat' 注入；设置页拼 avatarPath，chat 由 uriResolver 响应直给 URL） */
  builtinAssetsUri?: string
  /** 用户素材库 character-library/ 的 asWebviewUri（同上） */
  userLibraryUri?: string
  /** 角色展示模式（仅 role='chat' 注入；读 dionysus.character.display.desktop） */
  displayMode?: DisplayMode
  /** chat 面板当前 persona（仅 role='chat' 注入；dionysus.persona.default 为空时按素材库探测结果） */
  personaId?: string
}

/** 依次返回候选路径中第一个真实存在的；都不存在时返回最后一个（便于报错信息指向预期位置） */
function firstExisting(candidates: vscode.Uri[]): vscode.Uri {
  for (const uri of candidates) {
    if (fs.existsSync(uri.fsPath)) {
      return uri
    }
  }
  return candidates[candidates.length - 1]
}

/**
 * webview 前端产物目录。
 * 开发态：extension 与 webview 是 monorepo 兄弟包（packages/webview/dist）；
 * 打包态：vsce 把 webview/dist 内嵌为扩展内 webview-dist/（architecture.md §3）。
 */
export function resolveWebviewDist(context: vscode.ExtensionContext): vscode.Uri {
  return firstExisting([
    vscode.Uri.joinPath(context.extensionUri, 'webview-dist'),
    vscode.Uri.joinPath(context.extensionUri, '..', 'webview', 'dist'),
  ])
}

/**
 * 出厂素材根目录。
 * 打包态：assets/ 内嵌进扩展包；开发态：assets/ 在仓库根（extension 上两级）。
 */
export function resolveAssetsRoot(context: vscode.ExtensionContext): vscode.Uri {
  return firstExisting([
    vscode.Uri.joinPath(context.extensionUri, 'assets'),
    vscode.Uri.joinPath(context.extensionUri, '..', '..', 'assets'),
  ])
}

/**
 * mobile 前端产物目录（lan-server 静态托管根，§6.3）。
 * 打包态：vsce 内嵌为扩展内 mobile-dist/；开发态：packages/mobile/dist。
 * mobile 包尚未构建时两个候选都不存在——返回的路径仅作约定传给 lan-server，
 * 由 lan-server 对缺失产物回 404 兜底页。
 */
export function resolveMobileDist(context: vscode.ExtensionContext): vscode.Uri {
  return firstExisting([
    vscode.Uri.joinPath(context.extensionUri, 'mobile-dist'),
    vscode.Uri.joinPath(context.extensionUri, '..', 'mobile', 'dist'),
  ])
}

/** 用户角色素材库目录（globalStorageUri/character-library，§7） */
export function resolveCharacterLibrary(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(context.globalStorageUri, 'character-library')
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

/** 在 webview 产物目录中定位 vite 构建出的入口 JS 与 CSS（文件名带 hash，运行时扫描） */
function findBundleAssets(distUri: vscode.Uri): { script: vscode.Uri; styles: vscode.Uri[] } {
  const assetsDir = path.join(distUri.fsPath, 'assets')
  const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []
  const scriptFile = files.find((f) => f.endsWith('.js'))
  if (!scriptFile) {
    throw new Error(`webview bundle 未找到（${assetsDir} 下无 .js），请先构建 @dionysus/webview`)
  }
  return {
    script: vscode.Uri.joinPath(distUri, 'assets', scriptFile),
    styles: files
      .filter((f) => f.endsWith('.css'))
      .map((f) => vscode.Uri.joinPath(distUri, 'assets', f)),
  }
}

/** 序列化 init 数据为安全的内联 JS 字面量（防 `</script>` 逃逸） */
function initScriptJson(init: WebviewInit): string {
  return JSON.stringify(init).replace(/</g, '\\u003c')
}

function buildHtml(
  webview: vscode.Webview,
  assets: { script: vscode.Uri; styles: vscode.Uri[]; cubismCore: vscode.Uri },
  init: WebviewInit,
  nonce: string,
  title: string,
): string {
  const scriptUri = webview.asWebviewUri(assets.script)
  const cubismCoreUri = webview.asWebviewUri(assets.cubismCore)
  const styleTags = assets.styles
    .map((s) => `<link rel="stylesheet" href="${webview.asWebviewUri(s)}">`)
    .join('\n    ')

  // CSP 模板按 architecture.md §7（R-1 spike 验收基线）：
  // connect-src 是 model3.json/.moc3/motion3.json XHR 加载的必需项；
  // worker-src blob: 保留给 pixi 潜在的 worker 需求。
  const csp = [
    `default-src 'none'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `connect-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data: blob:`,
    `media-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `worker-src blob:`,
  ].join('; ')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${title}</title>
    ${styleTags}
  </head>
  <body>
    <div id="root" data-view-role="${init.role}"></div>
    <script nonce="${nonce}">window.__DIONYSUS_INIT__ = ${initScriptJson(init)};</script>
    <!-- Live2D Cubism 4 runtime：以带 nonce 的经典脚本先于 ESM bundle 执行，
         在 window 上挂 Live2DCubismCore 全局（pixi-live2d-display/cubism4 依赖它） -->
    <script nonce="${nonce}" src="${cubismCoreUri}"></script>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`
}

interface WebviewContainerOptions {
  context: vscode.ExtensionContext
  host: CoreHost
  clientId: string
  role: WebviewInit['role']
  title: string
}

/** 两个容器共用的装配：options / localResourceRoots / html / 传输接入。 */
function setupWebview(webview: vscode.Webview, opts: WebviewContainerOptions): { dispose(): void } {
  const webviewDist = resolveWebviewDist(opts.context)
  const assetsRoot = resolveAssetsRoot(opts.context)
  const characterLibrary = resolveCharacterLibrary(opts.context)

  webview.options = {
    enableScripts: true,
    // architecture.md §7：覆盖 webview 产物、出厂 assets/、用户角色素材库
    localResourceRoots: [webviewDist, assetsRoot, characterLibrary],
  }

  const bundle = findBundleAssets(webviewDist)
  const cubismCore = vscode.Uri.joinPath(webviewDist, 'live2dcubismcore.min.js')
  const init: WebviewInit = {
    clientId: opts.clientId,
    role: opts.role,
    needCliGuide: opts.host.needCliGuide,
    // 设置页需要把 persona 头像相对路径拼成可加载 URL（§7 localResourceRoots 已覆盖两根目录）；
    // chat 面板同样注入两根（陪伴区素材 URL 主要由 uriResolver 响应直给，两根留作兜底/调试）
    ...(opts.role === 'settings' || opts.role === 'chat'
      ? {
          builtinAssetsUri: webview.asWebviewUri(assetsRoot).toString(),
          userLibraryUri: webview.asWebviewUri(characterLibrary).toString(),
        }
      : {}),
    // chat 面板陪伴区数据源（Phase 4）：展示模式 + 当前 persona
    // （配置优先，为空用 core-host 装配时的素材库探测结果；persona 切换后重开面板生效）
    ...(opts.role === 'chat'
      ? {
          displayMode: opts.host.configService.config.character.display.desktop,
          personaId: opts.host.defaultPersonaId,
        }
      : {}),
  }
  webview.html = buildHtml(
    webview,
    { ...bundle, cubismCore },
    init,
    getNonce(),
    opts.title,
  )

  // asWebviewUri 只能在本层执行：注入 per-clientId 的 uriResolver，
  // core-host 的 persona_list/character_list 响应经它补全素材 URL
  return opts.host.attachWebview(opts.clientId, webview, {
    uriResolver: (fsPath) => webview.asWebviewUri(vscode.Uri.file(fsPath)).toString(),
  })
}

/**
 * 聊天主面板（editor panel，单例）：openChat 命令打开/聚焦。
 * retainContextWhenHidden：切走标签页不丢会话视图状态。
 */
export class ChatPanelController {
  private panel: vscode.WebviewPanel | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: CoreHost,
  ) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      CHAT_VIEW_TYPE,
      'Dionysus 聊天',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    const attachment = setupWebview(panel.webview, {
      context: this.context,
      host: this.host,
      clientId: CHAT_CLIENT_ID,
      role: 'chat',
      title: 'Dionysus 聊天',
    })
    panel.onDidDispose(
      () => {
        attachment.dispose()
        this.panel = null
      },
      null,
      this.context.subscriptions,
    )
    this.panel = panel
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = null
  }
}

/**
 * 设置面板（editor panel，单例）：「角色与素材库设置」（ux-core-flows.md §5.5）。
 * - 视图角色 role='settings'，HTML 注入 __DIONYSUS_INIT__ 的模式与 chat/sidebar 相同；
 * - 构造函数自注册 dionysus.openSettings 命令并注入 settings 写入器
 *   （settings_update_request → vscode.workspace 写 settings.json，Global 作用域）。
 */
export class SettingsPanelController {
  private panel: vscode.WebviewPanel | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: CoreHost,
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand('dionysus.openSettings', () => this.reveal()),
      { dispose: () => this.dispose() },
    )
    host.setSettingsWriter(async (key, value) => {
      await vscode.workspace
        .getConfiguration('dionysus')
        .update(key, value, vscode.ConfigurationTarget.Global)
    })
    // adapter_model_update_request 的写入器：整体回写 dionysus.adapters 对象
    // （条目补全由 core-host 完成，防残缺条目）
    host.setAdaptersWriter(async (adapters) => {
      await vscode.workspace
        .getConfiguration('dionysus')
        .update('adapters', adapters, vscode.ConfigurationTarget.Global)
    })
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      SETTINGS_VIEW_TYPE,
      '角色与素材库设置',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    const attachment = setupWebview(panel.webview, {
      context: this.context,
      host: this.host,
      clientId: SETTINGS_CLIENT_ID,
      role: 'settings',
      title: '角色与素材库设置',
    })
    panel.onDidDispose(
      () => {
        attachment.dispose()
        this.panel = null
      },
      null,
      this.context.subscriptions,
    )
    this.panel = panel
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = null
  }
}

/**
 * sidebar 会话列表（architecture.md §6.6，ADR-14）：QQ 式富列表的容器。
 * 富列表 UI 由 webview 包实现（Wave 2）；数据源为 BroadcastHub 广播的
 * session_digest_update，经 host.attachWebview 注册后直达本视图。
 */
export class SessionListViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = SESSION_LIST_VIEW_TYPE

  private view: vscode.WebviewView | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: CoreHost,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    const attachment = setupWebview(view.webview, {
      context: this.context,
      host: this.host,
      clientId: SIDEBAR_CLIENT_ID,
      role: 'sidebar',
      title: 'Dionysus 会话',
    })
    view.onDidDispose(() => {
      attachment.dispose()
      this.view = null
    })
  }
}

// ---------------------------------------------------------------------------
// 配对二维码弹层（architecture.md §6.4，时序见 §9.2）
// ---------------------------------------------------------------------------

export const PAIRING_QR_VIEW_TYPE = 'dionysus.pairingQr'

/** 二维码 token 剩余不足该秒数时自动换发重渲染（§6.4） */
const QR_AUTO_REFRESH_SECONDS = 30

/** 弹层渲染状态：可配对（二维码）或纯指引（服务未运行 / Remote 不可用）。 */
type PairingViewState =
  | { kind: 'qr'; url: string; expiresAt: number; note?: string }
  | { kind: 'guidance'; text: string }

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 配对弹层 HTML（自包含，不加载 React bundle）：
 * - 二维码内容为 `http://<LAN-IP>:<port>/#/pair/<token>`——pair token 放 URL
 *   fragment，不进浏览器历史/Referer/服务器日志（ADR-15）；
 * - TTL 倒计时由内联脚本驱动，剩余 <30s 自动 postMessage 换发重渲染
 *   （旧 token 立即失效），另有手动刷新按钮；
 * - 文案固定含「手机需与电脑连接同一个 Wi-Fi」与排障入口（防火墙/AP 隔离，R-3）；
 * - CSP 收紧到 inline style + nonce 脚本，二维码为内联 SVG（qrcode 包生成，
 *   纯 JS 无原生依赖，体积小于自绘 PNG 管线）。
 */
function buildPairingHtml(state: PairingViewState, qrSvg: string | null, nonce: string): string {
  const csp = [
    `default-src 'none'`,
    `style-src 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ')

  const ttlSeconds =
    state.kind === 'qr' ? Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000)) : 0

  const body =
    state.kind === 'qr'
      ? `
    <div class="qr-box">${qrSvg ?? ''}</div>
    <p class="url">${escapeHtml(state.url)}</p>
    <p>二维码有效期剩余 <b id="ttl">${ttlSeconds}</b> 秒，到期前会自动刷新。</p>
    <p><button id="refresh">手动刷新二维码</button></p>
    ${state.note ? `<p class="note">${escapeHtml(state.note)}</p>` : ''}`
      : `
    <p class="note">${escapeHtml(state.text)}</p>`

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>手机配对</title>
    <style>
      body { font-family: var(--vscode-font-family, system-ui, sans-serif); color: var(--vscode-foreground);
             max-width: 26em; margin: 2em auto; line-height: 1.7; text-align: center; }
      .qr-box { display: inline-block; background: #fff; padding: 12px; border-radius: 8px; line-height: 0; }
      .url { font-size: 0.85em; word-break: break-all; opacity: 0.8; }
      .note { color: var(--vscode-descriptionForeground); }
      button { padding: 4px 14px; cursor: pointer; }
      details { text-align: left; margin-top: 1.5em; }
      summary { cursor: pointer; }
    </style>
  </head>
  <body>
    <h2>扫码配对手机</h2>
    ${body}
    <p>手机需与电脑连接<b>同一个 Wi-Fi</b>。</p>
    <details>
      <summary>扫不上 / 打不开？排障指引</summary>
      <ul>
        <li>确认手机与电脑在同一局域网（关闭手机流量，排除访客网络 / AP 隔离）；</li>
        <li>确认电脑防火墙放行了上面地址中的端口；</li>
        <li>二维码过期会自动刷新，也可以点「手动刷新二维码」换一个新的再扫；</li>
        <li>离开期间请保持电脑唤醒、VS Code 不退出，否则手机端会断开。</li>
      </ul>
    </details>
    <script nonce="${nonce}">
      (function () {
        var ttlEl = document.getElementById('ttl');
        if (!ttlEl) return;
        var vscode = acquireVsCodeApi();
        var remaining = ${ttlSeconds};
        var timer = setInterval(function () {
          remaining -= 1;
          ttlEl.textContent = String(Math.max(remaining, 0));
          if (remaining <= ${QR_AUTO_REFRESH_SECONDS}) {
            clearInterval(timer);
            vscode.postMessage({ type: 'refresh' });
          }
        }, 1000);
        var btn = document.getElementById('refresh');
        if (btn) btn.addEventListener('click', function () {
          clearInterval(timer);
          vscode.postMessage({ type: 'refresh' });
        });
      })();
    </script>
  </body>
</html>`
}

/**
 * 「Dionysus: 显示配对二维码」命令的真实实现（§6.4；构造函数自注册命令，
 * 与 SettingsPanelController 的 openSettings 同款装配模式）：
 * - `lan.enabled=false` 时先弹确认框，确认后自动写回配置（热重启生效，
 *   无需手动编辑 settings.json）；
 * - Remote-SSH / WSL / Dev Container：优先 `vscode.env.asExternalUri` 拿端口
 *   转发地址生成二维码；不可用则显示「需 SSH 隧道/暂不支持」指引，
 *   而非一个必失败的二维码（§6.3 Remote 边界）；
 * - 二维码始终使用 lan-server 实际绑定端口（EADDRINUSE 递增后亦然）。
 */
export class PairingQrPanelController {
  private panel: vscode.WebviewPanel | null = null

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: CoreHost,
  ) {
    context.subscriptions.push(
      vscode.commands.registerCommand('dionysus.showPairingQr', () => void this.reveal()),
      { dispose: () => this.dispose() },
    )
  }

  async reveal(): Promise<void> {
    // 开启引导（§6.4）：lan.enabled=false → 确认后自动写回配置
    if (!this.host.configService.config.lan.enabled) {
      const choice = await vscode.window.showInformationMessage(
        '需要开启局域网连接才能让手机访问，是否开启？仅在可信网络（如家里 Wi-Fi）下开启。',
        { modal: true },
        '开启并显示二维码',
      )
      if (choice !== '开启并显示二维码') return
      await vscode.workspace
        .getConfiguration('dionysus')
        .update('lan.enabled', true, vscode.ConfigurationTarget.Global)
    }
    // 配置热重启异步生效：等 lan-server 落定（running/disabled）再渲染
    const deadline = Date.now() + 3000
    while (this.host.lan.state === 'stopped' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    this.showPanel()
    await this.render()
  }

  dispose(): void {
    this.panel?.dispose()
    this.panel = null
  }

  private showPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside)
      return
    }
    const panel = vscode.window.createWebviewPanel(
      PAIRING_QR_VIEW_TYPE,
      '手机配对',
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    )
    panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if ((raw as { type?: unknown } | null)?.type === 'refresh') void this.render()
      },
      null,
      this.context.subscriptions,
    )
    panel.onDidDispose(
      () => {
        this.panel = null
      },
      null,
      this.context.subscriptions,
    )
    this.panel = panel
  }

  /** 计算当前弹层状态（签发新 pair token；Remote 走 asExternalUri 或降级指引）。 */
  private async computeState(): Promise<PairingViewState> {
    const lan = this.host.lan
    if (lan.state === 'disabled') {
      return {
        kind: 'guidance',
        text:
          lan.disabledReason === 'port-taken-by-dionysus'
            ? '局域网端口已被另一个 VS Code 窗口的 Dionysus 占用，请到那个窗口使用配对二维码。'
            : '局域网端口 8765–8775 均被占用，手机连接服务启动失败。请释放端口后重试。',
      }
    }
    if (lan.state !== 'running' || lan.port === null) {
      return { kind: 'guidance', text: '局域网服务未运行。请确认 dionysus.lan.enabled 已开启后重试。' }
    }

    const { token, expiresAt } = this.host.pairing.issueToken()
    if (vscode.env.remoteName) {
      try {
        const external = await vscode.env.asExternalUri(
          vscode.Uri.parse(`http://127.0.0.1:${lan.port}`),
        )
        return {
          kind: 'qr',
          url: `${external.toString().replace(/\/$/, '')}/#/pair/${token}`,
          expiresAt,
          note: '当前为远程开发环境：二维码使用 VS Code 端口转发地址，请将转发端口设为公开并放行防火墙。',
        }
      } catch {
        return {
          kind: 'guidance',
          text: '检测到远程开发环境（Remote-SSH / WSL / Dev Container）：当前无法获得可扫码的转发地址，移动端需自行配置 SSH 隧道，暂不支持直接扫码配对。',
        }
      }
    }
    return { kind: 'qr', url: `http://${getLanAddress()}:${lan.port}/#/pair/${token}`, expiresAt }
  }

  private async render(): Promise<void> {
    if (!this.panel) return
    const state = await this.computeState()
    let qrSvg: string | null = null
    if (state.kind === 'qr') {
      qrSvg = await QRCode.toString(state.url, { type: 'svg', margin: 1, width: 220 })
    }
    this.panel.webview.html = buildPairingHtml(state, qrSvg, getNonce())
  }
}
