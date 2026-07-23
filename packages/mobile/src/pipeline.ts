/**
 * 消息管线（mobile 唯一 S→C 汇聚点，main.tsx 接线）：
 *
 * 拦截（mobile 本地职责，messageRouter 不覆盖的消息/时机）：
 * - handshake：dispatch 前捕获 sync 游标，dispatch 后发 sync_request 补拉；
 * - persona_list_response / session_list_response：落 personaStore
 *   （列表头像 + 角色抽屉立绘的数据源）；
 * - companion_message(scope=global)：归来摘要识别落卡。
 *
 * 其余全部走 client-core 的 routeServerMessage + dispatchRouteActions
 * （两端一致性的核心，ADR-18）。
 */
import {
  dispatchRouteActions,
  routeServerMessage,
  type ClientTransport,
} from '@dionysus/client-core'
import type { ServerMessage } from '@dionysus/protocol'

import { assetUrl } from './pairing.js'
import { usePersonaStore } from './stores/personaStore.js'
import { detectReturnSummary } from './stores/returnSummaryStore.js'
import { captureSyncCursors, sendSyncRequests } from './sync.js'

export function makeMessagePipeline(
  transport: ClientTransport,
  deviceToken: string,
): (msg: ServerMessage) => void {
  const resolveAsset = (path: string) => assetUrl(path, deviceToken)

  return (msg: ServerMessage) => {
    if (msg.type === 'handshake') {
      // 关键时序：游标必须在 handshake dispatch（会推进 lastSeq）之前捕获
      const cursors = captureSyncCursors()
      dispatchRouteActions(routeServerMessage(msg))
      const latestSeqs: Record<string, number> = {}
      for (const s of msg.payload.sessions) latestSeqs[s.sessionId] = s.latestSeq
      sendSyncRequests(transport, cursors, latestSeqs)
      return
    }
    if (msg.type === 'persona_list_response') {
      usePersonaStore.getState().applyPersonaList(
        msg.payload.personas.map((p) => ({
          ...p,
          avatarPath: p.avatarPath ? resolveAsset(p.avatarPath) : undefined,
          portraitUrls: p.portraitUrls
            ? Object.fromEntries(
                Object.entries(p.portraitUrls).map(([k, v]) => [
                  k,
                  resolveAsset(v),
                ]),
              )
            : undefined,
        })),
      )
      return
    }
    if (msg.type === 'session_list_response') {
      usePersonaStore.getState().applySessionList(msg.payload.sessions)
      dispatchRouteActions(routeServerMessage(msg))
      return
    }
    if (msg.type === 'companion_message') {
      detectReturnSummary(msg)
    }
    dispatchRouteActions(routeServerMessage(msg))
  }
}
