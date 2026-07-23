/**
 * companion/personaSync — chat 面板的陪伴区 persona 数据接线（Phase 4）。
 *
 * 数据流：chat role 挂载后发 persona_list_request → 按 init.personaId 选中 persona
 * → modelUrl/portraitUrls/live2d/touchZones/name 灌进 useCompanionConfigStore，
 * 替换 DEFAULT_COMPANION_CONFIG 占位。素材 URL 已由 extension 经 asWebviewUri
 * 解析（core-host 的 per-clientId uriResolver），webview 直接消费。
 *
 * persona 切换（设置页改默认角色 / selectPersona 命令）后重开面板生效——
 * 本 hook 只在挂载时拉取一次，不做热切换。
 */
import { useEffect } from 'react'

import type { ClientTransport } from '@dionysus/client-core'

import { companionConfigFromInit, useCompanionConfigStore } from './config.js'

/**
 * 挂载时拉取 persona 列表并填充陪伴区配置。
 * @param personaId init.personaId（extension 注入的当前 persona）；未匹配时回退列表首个
 */
export function usePersonaCompanionConfig(transport: ClientTransport, personaId?: string): void {
  useEffect(() => {
    transport.onMessage((msg) => {
      if (msg.type !== 'persona_list_response') return
      const selected = msg.payload.personas.find((p) => p.id === personaId) ?? msg.payload.personas[0]
      if (!selected) return
      useCompanionConfigStore.getState().setConfig(
        companionConfigFromInit({
          personaId: selected.id,
          name: selected.name,
          ...(selected.modelUrl ? { modelUrl: selected.modelUrl } : {}),
          ...(selected.portraitUrls ? { portraitUrls: selected.portraitUrls } : {}),
          ...(selected.live2d ? { live2d: selected.live2d } : {}),
          touchZones: selected.touchZones,
        }),
      )
    })
    transport.send({ v: 1, type: 'persona_list_request', ts: Date.now(), payload: {} })
  }, [transport, personaId])
}
