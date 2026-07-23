/**
 * core-host 陪伴层装配单测（OBS-4 修复；纯 node + FakeAdapter/FakeWebview）：
 * - supervisor.mode 缺省 template：装配 createCompanion 并挂进 SessionManager，
 *   FakeAdapter 回合产出 companion_message + emotion_update 广播；
 *   （测试环境无素材库 → DEFAULT_PERSONA：模板均单候选、TemplateRewriter 恒等，
 *   文案/情绪完全确定）
 * - audienceCount=0（无客户端连接）时 supervisor 不生成 global 播报
 *   （引擎的会话级台词不受观众判定约束，仍有 session scope 台词）；
 * - supervisor.mode='disabled' 时不装配陪伴层（host.companion 为 null）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServerMessage } from '@dionysus/protocol'

import { FakeWebview, makeTestHost, successTurnScript, until, type TestHostContext } from './test-utils.js'

function userInput(sessionId: string) {
  return {
    v: 1 as const,
    type: 'user_input' as const,
    sessionId,
    ts: Date.now(),
    payload: { text: 'hi', attachments: [], mode: 'normal' as const },
  }
}

describe('core-host 陪伴层装配（OBS-4）', () => {
  let ctx: TestHostContext | null = null
  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
  })

  it('template 模式（默认）：FakeAdapter 回合产出 companion_message + emotion_update 广播', async () => {
    ctx = await makeTestHost({ adapterScripts: [successTurnScript('结果')] })
    expect(ctx.host.companion).not.toBeNull()
    expect(ctx.host.companion?.supervisor.mode).toBe('template')
    const chat = new FakeWebview()
    ctx.host.attachWebview('webview:chat', chat)

    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    await ctx.host.handleClientMessage('webview:chat', userInput(meta.id))

    // 引擎回合完成台词（session）与 supervisor 回合末播报（global）几乎同时入队：
    // 事件循环时序决定两候选在同一出队窗口合并（聚合句 allSuccess）或分两次出队
    // （引擎句先行，supervisor 句经 minIntervalMs=3s 仲裁后补发）。两条路径的
    // 文案/情绪/来源标注均由 DEFAULT_PERSONA 单候选模板决定，完全确定。
    await until(() => chat.ofType('companion_message').some((m) => m.payload.scope === 'global'), 6000)
    // 等最后一个候选出队完毕再断言全集
    await until(() => chat.ofType('emotion_update').length === chat.ofType('companion_message').length)

    const lines = chat.ofType('companion_message')
    for (const line of lines) {
      expect(line.payload).toMatchObject({
        emotion: 'neutral',
        sourceSessionId: meta.id,
        sourceTitle: '新会话', // 播报出队于自动标题之前（finalizeTurn 尾部才改题）
      })
    }
    const pairs = lines.map((m) => `${m.payload.scope}:${m.payload.text}`)
    expect([
      ['global:全部 1 个会话均已完成。'], // 同窗口合并：scheduler_templates.allSuccess
      ['session:任务已完成。', 'global:会话状态有更新。'], // 分两次出队：引擎句 + supervisor changed 句
    ]).toContainEqual(pairs)

    // 每条播报伴随一条 emotion_update（同一出队口成对外发）
    const emotions = chat.ofType('emotion_update')
    expect(emotions).toHaveLength(lines.length)
    for (const e of emotions) {
      expect(e.payload).toMatchObject({ emotion: 'neutral', confidence: 1 })
    }
  })

  it('audienceCount=0 时 supervisor 不生成 global 播报（引擎会话级台词不受影响）', async () => {
    ctx = await makeTestHost({ adapterScripts: [successTurnScript('结果')] })
    // 不接任何 webview：hub.clientCount === 0；经 spy 观察广播流
    const broadcastSpy = vi.spyOn(ctx.host.hub, 'broadcast')

    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    await ctx.host.handleClientMessage('test-client', userInput(meta.id))
    // 回合结束 + 引擎会话级台词出队
    await until(() =>
      broadcastSpy.mock.calls.some(([m]) => (m as ServerMessage).type === 'companion_message'),
    )
    // 跨过一个 minIntervalMs=3s 出队窗口：supervisor 若有候选此时必已外发
    await new Promise((resolve) => setTimeout(resolve, 3200))

    const companionMsgs = broadcastSpy.mock.calls
      .map(([m]) => m as ServerMessage)
      .filter((m): m is Extract<ServerMessage, { type: 'companion_message' }> => m.type === 'companion_message')
    expect(companionMsgs.length).toBeGreaterThan(0)
    expect(companionMsgs.every((m) => m.payload.scope === 'session')).toBe(true)
  })

  it("supervisor.mode='disabled' 时不装配陪伴层", async () => {
    ctx = await makeTestHost({
      settings: { 'supervisor.mode': 'disabled' },
      adapterScripts: [successTurnScript('结果')],
    })
    expect(ctx.host.companion).toBeNull()
    const chat = new FakeWebview()
    ctx.host.attachWebview('webview:chat', chat)

    const meta = await ctx.host.manager.createSession({ adapterId: 'kimi_cli' })
    await ctx.host.handleClientMessage('webview:chat', userInput(meta.id))
    await until(() => chat.ofType('agent_complete').length > 0)
    // 回合管线 flush 后仍无任何陪伴消息
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(chat.ofType('companion_message')).toHaveLength(0)
    expect(chat.ofType('emotion_update')).toHaveLength(0)
  })
})
