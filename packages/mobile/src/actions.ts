/**
 * actions — C→S 发送助手（与 webview chatActions 同构，信封直发）。
 * 用户消息不做本地乐观追加：core 广播 user_message_echo 后经 dispatch 落
 * sessionStore，多端时序一致。
 */
import {
  useSessionStore,
  type ClientTransport,
} from '@dionysus/client-core'
import type { InputMode } from '@dionysus/protocol'

/** 发送用户输入；「离开模式」开启时 mode='yolo'（走既有 user_input.mode，无协议改动）。 */
export function sendUserInput(
  transport: ClientTransport,
  sessionId: string,
  text: string,
  mode: InputMode = 'normal',
): void {
  transport.send({
    v: 1,
    type: 'user_input',
    sessionId,
    ts: Date.now(),
    payload: { text, attachments: [], mode },
  })
}

/** 打断当前回合。 */
export function sendInterrupt(
  transport: ClientTransport,
  sessionId: string,
): void {
  transport.send({
    v: 1,
    type: 'interrupt',
    sessionId,
    ts: Date.now(),
    payload: { reason: 'user_request' },
  })
}

/** 选项组点击。 */
export function sendOptionSelected(
  transport: ClientTransport,
  sessionId: string,
  selectedId: string,
  selectedLabel: string,
): void {
  transport.send({
    v: 1,
    type: 'option_selected',
    sessionId,
    ts: Date.now(),
    payload: { selectedId, selectedLabel },
  })
}

/** 新建会话（首屏 + 按钮）；digest 广播带回新会话后自动切入。 */
export function sendNewSession(transport: ClientTransport): void {
  useSessionStore.getState().expectNewSession()
  transport.send({ v: 1, type: 'new_session', ts: Date.now(), payload: {} })
}

/** 进入会话时拉取最近历史（刷新恢复消息流）。 */
export function sendHistoryRequest(
  transport: ClientTransport,
  sessionId: string,
  limit = 50,
): void {
  transport.send({
    v: 1,
    type: 'history_request',
    ts: Date.now(),
    payload: { sessionId, limit },
  })
}
