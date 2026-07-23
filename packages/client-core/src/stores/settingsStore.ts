/**
 * settingsStore — 客户端本地设置：adapter / persona 选择与展示模式
 * （architecture.md §7 按域拆 store）。展示模式类型来自 character.ts
 * 素材库共享类型（§7「角色素材库系统」）。
 */
import { create } from 'zustand'

import type { DisplayMode } from '../character.js'

export interface SettingsStoreState {
  /** 当前选择的 adapter（CLI）；null = 跟随 dionysus.adapter.default */
  adapterId: string | null
  /** 当前选择的 persona；null = 跟随 dionysus.persona.default */
  personaId: string | null
  /** 角色展示模式（per-device：desktop/mobile 均默认 live2d） */
  displayMode: DisplayMode

  setAdapter(adapterId: string | null): void
  setPersona(personaId: string | null): void
  setDisplayMode(mode: DisplayMode): void
  reset(): void
}

const initialState = {
  adapterId: null as string | null,
  personaId: null as string | null,
  displayMode: 'live2d' as DisplayMode,
}

export const useSettingsStore = create<SettingsStoreState>()((set) => ({
  ...initialState,

  setAdapter(adapterId) {
    set({ adapterId })
  },

  setPersona(personaId) {
    set({ personaId })
  },

  setDisplayMode(mode) {
    set({ displayMode: mode })
  },

  reset() {
    set({ ...initialState })
  },
}))
