import { useEffect, useRef, useState } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { useLayoutStore } from '@/stores/layoutStore'
import { loadAllThemes } from '@/lib/theme'
import NavSidebar from './NavSidebar'
import SessionList from './SessionList'
import RightPanel from './RightPanel'
import Header from './Header'
import MobileCompanionDrawer from './MobileCompanionDrawer'
import MobileCompanionBar from './MobileCompanionBar'
import MobileResourcePanel from './MobileResourcePanel'
import ChatContainer from '../Chat/ChatContainer'
import ChatInput from '../Input/ChatInput'
import ToolHUD from '../Tools/ToolHUD'
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
  const { mobileView } = useLayoutStore()

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
    <div className="flex h-full w-full overflow-hidden">
      {/* Desktop / tablet: leftmost navigation */}
      <div className="hidden md:flex">
        <NavSidebar
          onOpenPalette={handleOpenPalette}
          onOpenPersona={handleOpenPersona}
          onOpenSystemSettings={handleOpenSystemSettings}
          onCloseGlobalPages={closeGlobalPages}
        />
      </div>

      {/* Desktop layout */}
      <div className="hidden flex-1 md:flex">
        <SessionList sendMessage={sendMessage} />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <Header
            connected={connected}
            onSettingsClick={toggleSessionSettings}
          />
          <main className="relative flex flex-1 flex-col overflow-hidden">
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
        <SessionSettingsPanel
          sendMessage={sendMessage}
          className={`${isSessionSettingsOpen ? 'flex' : 'hidden'}`}
        />
        <RightPanel />
      </div>

      {/* Mobile layout */}
      <div className="flex flex-1 md:hidden">
        {mobileView === 'session-list' ? (
          <SessionList sendMessage={sendMessage} />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
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
