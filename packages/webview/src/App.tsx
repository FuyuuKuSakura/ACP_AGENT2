/**
 * App — webview 入口组件与宿主桥接（architecture.md §7）。
 *
 * - 视图角色经 extension 注入的 window.__DIONYSUS_INIT__ 区分（chat / sidebar）；
 * - createVsCodeTransport 以 acquireVsCodeApi().postMessage 实现 client-core 的
 *   ClientTransport；收帧经 parseServerMessage 校验后回调；
 * - role='chat' 且 needCliGuide 时渲染 CLI 安装引导页（ux-core-flows.md §5 步骤 1）。
 */
import type { ClientMessage, ServerMessage } from '@dionysus/protocol'
import { parseServerMessage } from '@dionysus/protocol'
import type { ClientTransport, DisplayMode } from '@dionysus/client-core'
import { useSettingsStore } from '@dionysus/client-core'

import { ChatApp } from './components/chat/ChatApp.js'
import { companionConfigFromInit, useCompanionConfigStore } from './components/companion/index.js'
import type { CompanionConfigInput } from './components/companion/index.js'
import { CliGuidePage } from './components/guide/CliGuidePage.js'
import { SettingsApp } from './components/settings/index.js'
import { SidebarApp } from './components/sidebar/index.js'

/** extension webview-provider 注入的初始化数据（与 WebviewInit 对齐）。 */
export interface DionysusInit {
  clientId: string
  role: 'chat' | 'sidebar' | 'settings'
  needCliGuide: boolean
  /**
   * 角色展示模式（Wave2-B 协商字段：extension 读 dionysus.character.display.desktop
   * 后注入；缺失时保持 settingsStore 默认 'live2d'）。
   */
  displayMode?: DisplayMode
  /**
   * 当前 persona 的展示素材与 companion 配置（Wave2-B 协商字段：extension 经
   * asWebviewUri 解析 modelUrl/portraitUrls 后与 persona YAML 的 live2d/touch_zones
   * 一并注入）。缺失时消费中立 DEFAULT_COMPANION_CONFIG（见 companion/config.ts），
   * 陪伴区降级为静态立绘占位，待 persona RPC 补齐后接线。
   */
  companion?: CompanionConfigInput
  /**
   * 当前 persona id（Phase 4：extension 注入，dionysus.persona.default 或素材库探测
   * 结果）。chat 面板挂载后发 persona_list_request，按此 id 选中 persona 并把
   * 素材 URL / live2d / touchZones 灌进 companion store（见 companion/personaSync.ts）。
   */
  personaId?: string
}

/** acquireVsCodeApi 的最小结构（VS Code webview 注入的全局函数）。 */
interface VsCodeApi {
  postMessage(message: unknown): void
}

declare global {
  interface Window {
    __DIONYSUS_INIT__?: DionysusInit
    acquireVsCodeApi?: () => VsCodeApi
  }
}

const DEFAULT_INIT: DionysusInit = {
  clientId: 'webview:chat',
  role: 'chat',
  needCliGuide: false,
}

/** 读取宿主注入的初始化数据；缺失（纯浏览器开发态）时回退 chat 默认值。 */
export function readDionysusInit(): DionysusInit {
  return window.__DIONYSUS_INIT__ ?? DEFAULT_INIT
}

/**
 * 把 init 的可选字段应用到 stores（main.tsx 在渲染前调用一次）：
 * displayMode → settingsStore；companion → companionConfigStore（逐键回退中立默认）。
 */
export function applyInitToStores(init: DionysusInit): void {
  if (init.displayMode) {
    useSettingsStore.getState().setDisplayMode(init.displayMode)
  }
  if (init.companion) {
    useCompanionConfigStore.getState().setConfig(companionConfigFromInit(init.companion))
  }
}

/**
 * 以 vscodeApi.postMessage 实现 ClientTransport。
 * 非 VS Code 环境（无 acquireVsCodeApi）返回空实现：消息只进 console，
 * 便于纯浏览器/vitest 下渲染界面。
 */
export function createVsCodeTransport(): ClientTransport {
  const api = window.acquireVsCodeApi?.()
  if (!api) {
    return {
      send(msg: ClientMessage) {
        console.warn('[dionysus] 无 acquireVsCodeApi，消息未发送：', msg.type)
      },
      onMessage() {
        /* 无宿主，永不收到消息 */
      },
    }
  }
  return {
    send(msg: ClientMessage) {
      api.postMessage(msg)
    },
    onMessage(cb: (msg: ServerMessage) => void) {
      window.addEventListener('message', (event: MessageEvent) => {
        try {
          cb(parseServerMessage(event.data))
        } catch {
          // 非协议帧（如宿主自身的其他 postMessage）容错忽略
        }
      })
    },
  }
}

export interface AppProps {
  init: DionysusInit
  transport: ClientTransport
}

export default function App({ init, transport }: AppProps) {
  if (init.role === 'sidebar') {
    return (
      <SidebarApp
        transport={transport}
        // 点击会话项：请宿主聚焦聊天面板并切换会话（core-host 回单播 session_switched）
        onSelectSession={(sessionId) =>
          transport.send({ v: 1, type: 'focus_session', ts: Date.now(), payload: { sessionId } })
        }
      />
    )
  }
  if (init.role === 'settings') {
    return <SettingsApp transport={transport} />
  }
  if (init.needCliGuide) {
    return <CliGuidePage />
  }
  return <ChatApp clientId={init.clientId} transport={transport} personaId={init.personaId} />
}
