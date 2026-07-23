import { create } from 'zustand'

export interface AdapterInfo {
  adapter_id: string
  enabled: boolean
  command: string
  working_dir: string
  supports_model: boolean
  default: boolean
  model?: string
}

interface AdapterState {
  currentAdapter: string
  availableAdapters: AdapterInfo[]
  loading: boolean
  setCurrentAdapter: (id: string) => void
  fetchAdapters: () => Promise<void>
  switchAdapter: (id: string) => void
}

export const useAdapterStore = create<AdapterState>((set, get) => ({
  currentAdapter: '',
  availableAdapters: [],
  loading: false,
  setCurrentAdapter: (id) => set({ currentAdapter: id }),
  fetchAdapters: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/adapters')
      const data = (await res.json()) as Record<string, AdapterInfo>
      const list = Object.values(data)
      const defaultId =
        list.find((a) => a.default)?.adapter_id || list[0]?.adapter_id || ''
      set({
        availableAdapters: list,
        currentAdapter: get().currentAdapter || defaultId,
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },
  switchAdapter: (id) => {
    set({ currentAdapter: id })
  },
}))
