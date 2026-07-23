/**
 * core-host AI 助手清单 / 模型配置处理器单测（纯 node）：
 * - adapter_list_request：合并 adapters record（settings ∪ 探测合成）逐条标注
 *   installed / supportsModel / 当前 model；codex 的 model 是死配置按
 *   supportsModel=false 呈现（extract/adapters.md §5.3/§7.7）；
 * - adapter_model_update_request：未知助手拒绝；未注入写入器回 ok=false；
 *   只设 model 时补全 type/command 整体回写 dionysus.adapters（防残缺条目）；
 *   空串 = 清除（model 写 null）。
 */
import { afterEach, describe, expect, it } from 'vitest'

import type { AdapterConfig } from '@dionysus/core'
import type { ClientMessage, ServerMessage } from '@dionysus/protocol'

import { installedCli, makeTestHost, missingCli, type TestHostContext } from './test-utils.js'

function msg<T extends ClientMessage['type']>(
  type: T,
  payload: Extract<ClientMessage, { type: T }>['payload'],
  traceId = 't-1',
): ClientMessage {
  return { v: 1, type, traceId, ts: Date.now(), payload } as ClientMessage
}

function ofType<T extends ServerMessage['type']>(
  received: ServerMessage[],
  type: T,
): Extract<ServerMessage, { type: T }>[] {
  return received.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
}

describe('core-host adapter_list / adapter_model_update 处理器', () => {
  let ctx: TestHostContext | null = null
  let received: ServerMessage[] = []
  const CLIENT = 'settings-client'

  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
    received = []
  })

  async function setup(options: Parameters<typeof makeTestHost>[0] = {}): Promise<TestHostContext> {
    ctx = await makeTestHost({
      detections: [
        installedCli('kimi_cli', 'kimi'),
        installedCli('claude_cli', 'claude'),
        installedCli('codex_cli', 'codex'),
        missingCli('opencode_cli', 'opencode'),
      ],
      ...options,
    })
    ctx.host.hub.registerClient(CLIENT, (m) => received.push(m))
    return ctx
  }

  it('adapter_list_request：按探测顺序列出合成条目，标注 installed / supportsModel / model', async () => {
    await setup({
      settings: {
        // fakeReader 的键为 'dionysus.' 之后的段路径（同 ConfigReader 约定）
        adapters: {
          claude_cli: { type: 'claude_code_cli', command: 'claude', model: 'claude-sonnet-4-5' },
        },
      },
    })
    await ctx!.host.handleClientMessage(CLIENT, msg('adapter_list_request', {}))
    const res = ofType(received, 'adapter_list_response')[0]
    expect(res.payload.defaultAdapterId).toBe('kimi_cli')
    expect(res.payload.adapters).toEqual([
      // kimi CLI 支持 `-m, --model <model>`（策略 supportsModel=true）
      { id: 'kimi_cli', command: 'kimi', installed: true, supportsModel: true, model: '' },
      // settings 里的 model 原样呈现
      { id: 'claude_cli', command: 'claude', installed: true, supportsModel: true, model: 'claude-sonnet-4-5' },
      // codex 的 model 是死配置（extract §5.3），按不支持呈现
      { id: 'codex_cli', command: 'codex', installed: true, supportsModel: false, model: '' },
      // 未安装的 CLI 不进合成 adapters record，故不出现在清单里（任务约定：列出已安装 adapter）
    ])
  })

  it('adapter_model_update_request：未知助手拒绝；未注入写入器回 ok=false', async () => {
    await setup()
    await ctx!.host.handleClientMessage(
      CLIENT,
      msg('adapter_model_update_request', { adapterId: 'no_such', model: 'x' }),
    )
    expect(ofType(received, 'adapter_model_update_response')[0].payload.ok).toBe(false)

    await ctx!.host.handleClientMessage(
      CLIENT,
      msg('adapter_model_update_request', { adapterId: 'claude_cli', model: 'claude-sonnet-4-5' }),
    )
    const res = ofType(received, 'adapter_model_update_response')[1]
    expect(res.payload.ok).toBe(false)
    expect(res.payload.error).toContain('未配置设置写入')
  })

  it('adapter_model_update_request：合成条目只设 model 时补全 type/command 整体回写', async () => {
    await setup()
    const writes: Record<string, AdapterConfig>[] = []
    ctx!.host.setAdaptersWriter(async (adapters) => {
      writes.push(structuredClone(adapters))
    })
    await ctx!.host.handleClientMessage(
      CLIENT,
      msg('adapter_model_update_request', { adapterId: 'claude_cli', model: ' claude-sonnet-4-5 ' }),
    )
    expect(ofType(received, 'adapter_model_update_response')[0].payload.ok).toBe(true)
    // model 去空白；type/command 从探测合成条目补全，不出现残缺条目
    expect(writes[0].claude_cli).toEqual({
      type: 'claude_code_cli',
      command: 'claude',
      model: 'claude-sonnet-4-5',
    })
  })

  it('adapter_model_update_request：保留 settings 已有条目的其余键；空串清除为 null', async () => {
    await setup({
      settings: {
        adapters: {
          claude_cli: {
            type: 'claude_code_cli',
            command: 'claude',
            model: 'old-model',
            outputFormat: 'stream-json',
          },
        },
      },
    })
    const writes: Record<string, AdapterConfig>[] = []
    ctx!.host.setAdaptersWriter(async (adapters) => {
      writes.push(structuredClone(adapters))
    })
    await ctx!.host.handleClientMessage(
      CLIENT,
      msg('adapter_model_update_request', { adapterId: 'claude_cli', model: '' }),
    )
    expect(ofType(received, 'adapter_model_update_response')[0].payload.ok).toBe(true)
    expect(writes[0].claude_cli).toEqual({
      type: 'claude_code_cli',
      command: 'claude',
      model: null,
      outputFormat: 'stream-json',
    })
  })
})
