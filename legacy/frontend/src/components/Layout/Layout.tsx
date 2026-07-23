import { useEffect, useRef, useState } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { loadAllThemes } from '@/lib/theme'
import { panelWidthClasses } from '@/lib/layout'
import NavSidebar from './NavSidebar'
import SessionList from './SessionList'
import RightPanel from './RightPanel'
import Header from './Header'
import FoldedPanel from './FoldedPanel'
import MobileCompanionDrawer from './MobileCompanionDrawer'
import MobileCompanionBar from './MobileCompanionBar'
import MobileResourcePanel from './MobileResourcePanel'
import ChatContainer from '../Chat/ChatContainer'
import ChatInput from '../Input/ChatInput'
import ToolHUD from '../Tools/ToolHUD'
import ToolPanel from '../Tools/ToolPanel'
import SessionSettingsPanel from './SessionSettingsPanel'
import OverlayPage from '../Pages/OverlayPage'
import PalettePage from '../Pages/PalettePage'
import PersonaPage from '../Pages/PersonaPage'
import SystemSettingsPage from '../Pages/SystemSettingsPage'

interface LayoutProps {
  sendMessage: (message: unknown) => boolean
  connected?: boolean
}

export default function Layout({ sendMessage, connected = false }: LayoutProps) {
  const { setAvailableThemes } = useThemeStore()
  const { mobileView, isToolPanelVisible, toggleToolPanel, toggleResourcePanel } = useLayoutStore()

  const [isPaletteOpen, setIsPaletteOpen] = useState(false)
  const [isPersonaOpen, setIsPersonaOpen] = useState(false)
  const [isSystemSettingsOpen, setIsSystemSettingsOpen] = useState(false)
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false)

  const toggleSessionSettings = () => setIsSessionSettingsOpen((v) => !v)

  const personaCloseGuardRef = useRef<(() => boolean) | null>(null)

  useEffect(() => {
    loadAllThemes().then(setAvailableThemes).catch(() => {
      // Fallback: keep default theme
    })
  }, [setAvailableThemes])

  const closeGlobalPages = () => {
    setIsPaletteOpen(false)
    setIsPersonaOpen(false)
    setIsSystemSettingsOpen(false)
  }

  const handleOpenPalette = () => {
    closeGlobalPages()
    setIsPaletteOpen(true)
  }

  const handleOpenPersona = () => {
    closeGlobalPages()
    setIsPersonaOpen(true)
  }

  const handleOpenSystemSettings = () => {
    closeGlobalPages()
    setIsSystemSettingsOpen(true)
  }

  const handleClosePersona = () => {
    setIsPersonaOpen(false)
  }

  return (
    <div className="flex h-full w-full overflow-hidden md:gap-4 md:p-4">
      {/* Desktop: dark folded nav strip */}
      <FoldedPanel
        className="hidden h-full flex-shrink-0 md:flex"
        bg="bg-dionysus-panel-bg"
        borderColor="border-white/8"
        largeFold={16}
        smallFold={6}
        innerClassName="cel-dark-card"
      >
        <NavSidebar
          onOpenPersona={handleOpenPersona}
          onOpenSystemSettings={handleOpenSystemSettings}
          onCloseGlobalPages={closeGlobalPages}
          onToggleToolPanel={toggleToolPanel}
        />
      </FoldedPanel>

      {/* Desktop: heavy outer frame groups session list + chat; interior stays transparent */}
      <FoldedPanel
        className="hidden min-w-0 flex-1 flex-col md:flex"
        bg="bg-transparent"
        borderColor="border-black/16"
        largeFold={28}
        smallFold={12}
        innerClassName="p-1"
      >
        <div className="flex flex-1 gap-3 overflow-hidden">
          {/* Session list inner folded card */}
          <FoldedPanel
            className="hidden h-full w-56 flex-shrink-0 md:flex"
            bg="bg-dionysus-session-card-bg"
            borderColor="border-black/6"
            largeFold={16}
            smallFold={6}
            innerClassName="cel-light-card"
          >
            <SessionList sendMessage={sendMessage} />
          </FoldedPanel>

          {/* Chat area inner folded card */}
          <FoldedPanel
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
            bg="bg-dionysus-card-bg"
            borderColor="border-black/6"
            largeFold={16}
            smallFold={6}
            innerClassName="cel-light-card"
          >
            <Header
              connected={connected}
              onSettingsClick={toggleSessionSettings}
              settingsActive={isSessionSettingsOpen}
              onOpenPalette={handleOpenPalette}
              onToggleResourcePanel={toggleResourcePanel}
            />

            <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <ChatContainer sendMessage={sendMessage} />
              <ToolHUD />
              <ChatInput sendMessage={sendMessage} />

              {/* Global pages overlay the chat area on desktop */}
              <OverlayPage
                isOpen={isPaletteOpen}
                onClose={() => setIsPaletteOpen(false)}
                title="调色盘"
              >
                <PalettePage />
              </OverlayPage>
              <OverlayPage
                isOpen={isPersonaOpen}
                onClose={handleClosePersona}
                title="角色"
                onBeforeClose={() => personaCloseGuardRef.current?.() ?? true}
              >
                <PersonaPage
                  sendMessage={sendMessage}
                  onCloseGuardChange={(guard) => {
                    personaCloseGuardRef.current = guard
                  }}
                />
              </OverlayPage>
              <OverlayPage
                isOpen={isSystemSettingsOpen}
                onClose={() => setIsSystemSettingsOpen(false)}
                title="系统设置"
              >
                <SystemSettingsPage />
              </OverlayPage>
            </main>
          </FoldedPanel>
        </div>
      </FoldedPanel>

      {/* Desktop: right floating panels - ToolPanel on top, RightPanel below */}
      <div
        className={`relative hidden h-full flex-col md:flex ${panelWidthClasses()}`}
      >
        <div className="flex h-full flex-col gap-4 overflow-hidden">
          {isToolPanelVisible && <ToolPanel className="flex-[40]" />}
          <RightPanel className={isToolPanelVisible ? 'flex-[60]' : 'flex-1'} />
        </div>
        <SessionSettingsPanel
          sendMessage={sendMessage}
          open={isSessionSettingsOpen}
        />
      </div>

      {/* Mobile layout */}
      <div className="flex flex-1 md:hidden">
        {mobileView === 'session-list' ? (
          <div className="flex h-full w-full cel-session-list">
            <SessionList sendMessage={sendMessage} />
          </div>
        ) : (
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Header
              connected={connected}
              showBack
              onSettingsClick={handleOpenSystemSettings}
            />
            <MobileCompanionBar />
            <main className="relative flex flex-1 flex-col overflow-hidden">
              <ChatContainer sendMessage={sendMessage} />
              <ToolHUD />
              <ChatInput sendMessage={sendMessage} />

              <OverlayPage
                isOpen={isPaletteOpen}
                onClose={() => setIsPaletteOpen(false)}
                title="调色盘"
              >
                <PalettePage />
              </OverlayPage>
              <OverlayPage
                isOpen={isPersonaOpen}
                onClose={handleClosePersona}
                title="角色"
                onBeforeClose={() => personaCloseGuardRef.current?.() ?? true}
              >
                <PersonaPage
                  sendMessage={sendMessage}
                  onCloseGuardChange={(guard) => {
                    personaCloseGuardRef.current = guard
                  }}
                />
              </OverlayPage>
              <OverlayPage
                isOpen={isSystemSettingsOpen}
                onClose={() => setIsSystemSettingsOpen(false)}
                title="系统设置"
              >
                <SystemSettingsPage />
              </OverlayPage>
            </main>
          </div>
        )}
      </div>

      {/* Mobile overlays */}
      <MobileCompanionDrawer />
      <MobileResourcePanel sendMessage={sendMessage} />
    </div>
  )
}
