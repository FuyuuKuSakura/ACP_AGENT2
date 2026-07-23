import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type NavItem = 'sessions' | 'tools' | 'character' | 'settings'
type MobileView = 'session-list' | 'chat'

interface LayoutState {
  // Desktop / global navigation
  activeNav: NavItem
  setActiveNav: (nav: NavItem) => void

  // Collapsible panels
  isSessionListOpen: boolean
  toggleSessionList: () => void
  setSessionListOpen: (open: boolean) => void

  isToolPanelVisible: boolean
  toggleToolPanel: () => void
  setToolPanelVisible: (visible: boolean) => void

  // Mobile view routing (no browser router)
  mobileView: MobileView
  setMobileView: (view: MobileView) => void

  // Mobile drawers / panels
  isCompanionDrawerOpen: boolean
  setCompanionDrawerOpen: (open: boolean) => void
  toggleCompanionDrawer: () => void

  isResourcePanelOpen: boolean
  setResourcePanelOpen: (open: boolean) => void
  toggleResourcePanel: () => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      activeNav: 'sessions',
      setActiveNav: (activeNav) => set({ activeNav }),

      isSessionListOpen: true,
      toggleSessionList: () => set((state) => ({ isSessionListOpen: !state.isSessionListOpen })),
      setSessionListOpen: (isSessionListOpen) => set({ isSessionListOpen }),

      isToolPanelVisible: true,
      toggleToolPanel: () => set((state) => ({ isToolPanelVisible: !state.isToolPanelVisible })),
      setToolPanelVisible: (isToolPanelVisible) => set({ isToolPanelVisible }),

      mobileView: 'session-list',
      setMobileView: (mobileView) => set({ mobileView }),

      isCompanionDrawerOpen: false,
      setCompanionDrawerOpen: (isCompanionDrawerOpen) => set({ isCompanionDrawerOpen }),
      toggleCompanionDrawer: () =>
        set((state) => ({ isCompanionDrawerOpen: !state.isCompanionDrawerOpen })),

      isResourcePanelOpen: false,
      setResourcePanelOpen: (isResourcePanelOpen) => set({ isResourcePanelOpen }),
      toggleResourcePanel: () =>
        set((state) => ({ isResourcePanelOpen: !state.isResourcePanelOpen })),
    }),
    {
      name: 'dionysus-cache-layout',
      partialize: (state) => ({ isSessionListOpen: state.isSessionListOpen }),
    },
  ),
)
