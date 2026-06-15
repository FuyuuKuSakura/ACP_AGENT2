import { create } from 'zustand'

export type NavItem = 'sessions' | 'themes' | 'character' | 'settings'
type MobileView = 'session-list' | 'chat'

interface LayoutState {
  // Desktop / global navigation
  activeNav: NavItem
  setActiveNav: (nav: NavItem) => void

  // Collapsible panels
  isSessionListOpen: boolean
  toggleSessionList: () => void
  setSessionListOpen: (open: boolean) => void

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

export const useLayoutStore = create<LayoutState>()((set) => ({
  activeNav: 'sessions',
  setActiveNav: (activeNav) => set({ activeNav }),

  isSessionListOpen: true,
  toggleSessionList: () => set((state) => ({ isSessionListOpen: !state.isSessionListOpen })),
  setSessionListOpen: (isSessionListOpen) => set({ isSessionListOpen }),

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
}))
