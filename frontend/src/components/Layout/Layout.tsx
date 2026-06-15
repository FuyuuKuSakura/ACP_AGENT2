import { useEffect, useState } from 'react'
import { useThemeStore } from '@/stores/themeStore'
import { loadAllThemes } from '@/lib/theme'
import NavSidebar from './NavSidebar'
import SessionList from './SessionList'
import RightPanel from './RightPanel'
import Header from './Header'
import MobileCompanionDrawer from './MobileCompanionDrawer'
import MobileResourcePanel from './MobileResourcePanel'
import ChatContainer from '../Chat/ChatContainer'
import ChatInput from '../Input/ChatInput'
import ToolHUD from '../Tools/ToolHUD'
import SettingsPanel from './SettingsPanel'
import ThemeStudio from './ThemeStudio'

interface LayoutProps {
  sendMessage: (message: unknown) => boolean
  connected?: boolean
}

export default function Layout({ sendMessage, connected = false }: LayoutProps) {
  const { setAvailableThemes } = useThemeStore()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isThemeStudioOpen, setIsThemeStudioOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'appearance' | 'persona' | 'agent'>('appearance')

  useEffect(() => {
    loadAllThemes().then(setAvailableThemes).catch(() => {
      // Fallback: keep default theme
    })
  }, [setAvailableThemes])

  return (
    <div className="flex h-full w-full overflow-hidden bg-elaw-background">
      {/* Desktop / tablet: leftmost navigation */}
      <NavSidebar />

      {/* Session list column */}
      <SessionList sendMessage={sendMessage} />

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          connected={connected}
          onSettingsClick={() => {
            setSettingsTab('appearance')
            setIsSettingsOpen(true)
          }}
        />
        <main className="relative flex flex-1 flex-col overflow-hidden">
          <ChatContainer sendMessage={sendMessage} />
          <ToolHUD />
          <ChatInput sendMessage={sendMessage} />
        </main>
      </div>

      {/* Right: companion + todo/status */}
      <RightPanel />

      {/* Mobile overlays */}
      <MobileCompanionDrawer />
      <MobileResourcePanel />

      {/* Global settings / theme studio modals */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsTab}
        onOpenThemeStudio={() => {
          setIsSettingsOpen(false)
          setIsThemeStudioOpen(true)
        }}
      />
      <ThemeStudio isOpen={isThemeStudioOpen} onClose={() => setIsThemeStudioOpen(false)} />
    </div>
  )
}
