/**
 * webview 正式入口（Phase 3）：读取 window.__DIONYSUS_INIT__，建立
 * ClientTransport，发 hello 完成握手，收消息经 messageRouter + dispatch
 * 进 client-core 各 store，随后按视图角色渲染 App。
 *
 * 两个视图角色（chat / sidebar）共用此接线：业务状态全部落 client-core
 * 的 zustand stores，视图组件经 hook 订阅。
 */
import { createRoot } from 'react-dom/client'

import { dispatchRouteActions, routeServerMessage } from '@dionysus/client-core'

import './theme/vscode.css'
import './index.css'

import App, { applyInitToStores, createVsCodeTransport, readDionysusInit } from './App.js'

const init = readDionysusInit()
const transport = createVsCodeTransport()

// 展示模式与 persona 陪伴配置落 stores（init 可选字段，缺失保持默认）。
applyInitToStores(init)

// S→C：路由为纯函数动作后应用到 stores（唯一副作用汇聚点在 dispatch）。
transport.onMessage((msg) => {
  dispatchRouteActions(routeServerMessage(msg))
})

// C→S：hello 握手，服务端以 handshake 回全量会话快照。
transport.send({ v: 1, type: 'hello', ts: Date.now(), payload: { minVersion: 1, maxVersion: 1 } })

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<App init={init} transport={transport} />)
}
