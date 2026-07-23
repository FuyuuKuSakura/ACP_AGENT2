/**
 * App — mobile 根组件：主题初始化、配对状态机、WS 传输接线、hash 路由分屏。
 *
 * 接线（architecture.md §9.2/§9.3）：
 * - 有 device token → 建 WsTransport → onMessage 走 pipeline → hello/handshake
 *   → 每次（重）连成功发 persona_list/session_list，handshake 后 sync 补拉；
 * - reconnecting 首次重试时 GET /api/health 探测：401 → 清 token 跳配对页；
 * - visibilitychange → transport.handleVisibilityChange() 立即重连。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useSessionStore } from '@dionysus/client-core'

import { ChatScreen } from './components/ChatScreen.js'
import { PairScreen } from './components/PairScreen.js'
import { SessionListScreen } from './components/SessionListScreen.js'
import { SettingsScreen } from './components/SettingsScreen.js'
import { StatusScreen } from './components/StatusScreen.js'
import {
  getDeviceToken,
  handleUnauthorized,
  pairWithServer,
  probeDeviceToken,
  wsUrl,
} from './pairing.js'
import { makeMessagePipeline } from './pipeline.js'
import { navigate, useHashRoute } from './router.js'
import { useConnectionStore } from './stores/connectionStore.js'
import { noteReconnected } from './stores/returnSummaryStore.js'
import { initTheme } from './theme.js'
import { WsTransport } from './transport/wsTransport.js'

export default function App() {
  const route = useHashRoute()
  const [deviceToken, setDeviceToken] = useState<string | null>(getDeviceToken)
  const [transport, setTransport] = useState<WsTransport | null>(null)
  const [pairing, setPairing] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)
  const connectedOnceRef = useRef(false)

  // 三态主题初始化（含 system 跟随）
  useEffect(() => initTheme(), [])

  const doPair = useCallback(async (pairToken: string) => {
    setPairing(true)
    setPairError(null)
    const res = await pairWithServer(pairToken)
    setPairing(false)
    if (res.ok) {
      setDeviceToken(res.deviceToken)
    } else {
      setPairError(
        res.reason === 'invalid_token'
          ? '配对码无效或已过期，请回 VS Code 重新扫码'
          : '无法连接电脑，请确认手机与电脑在同一 Wi-Fi 下',
      )
    }
  }, [])

  // 扫码直达：#/pair/<token> 自动换票（随后 replaceState 抹掉，见 pairing.ts）
  const routePairToken = route.name === 'pair' ? route.pairToken : undefined
  useEffect(() => {
    if (routePairToken && !pairing) void doPair(routePairToken)
  }, [routePairToken, pairing, doPair])

  // 解除配对 / 401 清 token 后同步本地状态（localStorage 已清，此处清 state）
  useEffect(() => {
    if (route.name === 'pair' && !route.pairToken && deviceToken && !pairing) {
      setDeviceToken(null)
    }
  }, [route, deviceToken, pairing])

  // WS 传输生命周期跟随 deviceToken
  useEffect(() => {
    if (!deviceToken) return
    const t = new WsTransport({
      url: () => wsUrl(deviceToken),
      helloMessage: () => ({
        v: 1,
        type: 'hello',
        ts: Date.now(),
        payload: { minVersion: 1, maxVersion: 1 },
      }),
    })
    t.onMessage(makeMessagePipeline(t, deviceToken))
    t.onOpen(() => {
      // 重连（非首连）开启归来摘要识别窗口（§6.3）
      if (connectedOnceRef.current) noteReconnected()
      connectedOnceRef.current = true
      t.send({ v: 1, type: 'persona_list_request', ts: Date.now(), payload: {} })
      t.send({ v: 1, type: 'session_list_request', ts: Date.now(), payload: {} })
    })
    t.onConnectionChange((state) => {
      useConnectionStore.getState().setConnection(state, t.attempts)
      // WS 首次重试时探测 token 有效性（浏览器 WS 拿不到 401，借 HTTP 区分）
      if (state === 'reconnecting' && t.attempts === 1) {
        void probeDeviceToken(deviceToken).then((r) => {
          if (r === 'unauthorized') {
            t.disconnect()
            handleUnauthorized()
            setDeviceToken(null)
          }
        })
      }
    })
    const onVisibility = () => t.handleVisibilityChange()
    document.addEventListener('visibilitychange', onVisibility)
    t.connect()
    setTransport(t)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      t.disconnect()
      setTransport(null)
    }
  }, [deviceToken])

  // 新会话自动切入（expectNewSession 后 digest 带回 → currentSessionId 变化）
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const prevSessionRef = useRef(currentSessionId)
  useEffect(() => {
    const prev = prevSessionRef.current
    prevSessionRef.current = currentSessionId
    if (currentSessionId && currentSessionId !== prev && route.name === 'list') {
      navigate({ name: 'chat', sessionId: currentSessionId })
    }
  }, [currentSessionId, route.name])

  if (!deviceToken || !transport || route.name === 'pair') {
    return (
      <PairScreen
        pairing={pairing || Boolean(routePairToken)}
        error={pairError}
        onSubmitManual={(token) => void doPair(token)}
      />
    )
  }

  switch (route.name) {
    case 'chat':
      return <ChatScreen sessionId={route.sessionId} transport={transport} />
    case 'status':
      return <StatusScreen sessionId={route.sessionId} />
    case 'settings':
      return <SettingsScreen />
    case 'list':
    default:
      return <SessionListScreen transport={transport} />
  }
}
