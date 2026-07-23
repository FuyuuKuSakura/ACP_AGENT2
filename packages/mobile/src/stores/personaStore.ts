/**
 * personaStore — persona 列表与会话→persona 映射（mobile 本地 store）。
 *
 * messageRouter 不消费 persona_list_response / session_list_response（桌面端
 * 由 settings/companion 视图各自处理），mobile 在消息管线 dispatch 之前拦截
 * 这两类响应落本 store：
 * - 列表头像（persona avatarPath → /assets/*?token=）；
 * - 角色抽屉的静态立绘与角色名（陪伴归属：当前聚焦会话的 persona_id，
 *   architecture.md §7；缺省回退 persona.default/列表首个）。
 */
import { create } from 'zustand'

import type {
  PersonaSummary,
  SessionMeta,
} from '@dionysus/protocol'

export interface PersonaEntry {
  id: string
  name: string
  /** 头像（已解析为可加载 URL） */
  avatarUrl?: string
  /** emotion → 立绘 URL（已解析） */
  portraitUrls?: Record<string, string>
}

export interface PersonaStoreState {
  personas: Record<string, PersonaEntry>
  /** personaId 插入序（default 回退取首个） */
  personaIds: string[]
  /** sessionId → personaId（session_list_response 提供） */
  sessionPersona: Record<string, string>

  applyPersonaList(personas: PersonaSummary[]): void
  applySessionList(sessions: SessionMeta[]): void
  reset(): void
}

export const usePersonaStore = create<PersonaStoreState>()((set) => ({
  personas: {},
  personaIds: [],
  sessionPersona: {},

  applyPersonaList(personas) {
    set((s) => {
      const next = { ...s.personas }
      const ids = [...s.personaIds]
      for (const p of personas) {
        next[p.id] = {
          id: p.id,
          name: p.name,
          avatarUrl: p.avatarPath,
          portraitUrls: p.portraitUrls,
        }
        if (!ids.includes(p.id)) ids.push(p.id)
      }
      return { personas: next, personaIds: ids }
    })
  },

  applySessionList(sessions) {
    set((s) => {
      const sessionPersona = { ...s.sessionPersona }
      for (const m of sessions) sessionPersona[m.id] = m.personaId
      return { sessionPersona }
    })
  },

  reset() {
    set({ personas: {}, personaIds: [], sessionPersona: {} })
  },
}))

/** 会话的 persona（缺省回退列表首个 = 服务端 default 顺序）。 */
export function selectPersonaForSession(
  s: Pick<PersonaStoreState, 'personas' | 'personaIds' | 'sessionPersona'>,
  sessionId: string | null,
): PersonaEntry | undefined {
  const personaId = sessionId ? s.sessionPersona[sessionId] : undefined
  if (personaId && s.personas[personaId]) return s.personas[personaId]
  const first = s.personaIds[0]
  return first ? s.personas[first] : undefined
}
