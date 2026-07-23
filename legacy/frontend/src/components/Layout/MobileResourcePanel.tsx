import { useLayoutStore } from '@/stores/layoutStore'
import SessionSettingsPanel from './SessionSettingsPanel'

interface MobileResourcePanelProps {
  sendMessage: (message: unknown) => boolean
}

export default function MobileResourcePanel({ sendMessage }: MobileResourcePanelProps) {
  const { isResourcePanelOpen, setResourcePanelOpen } = useLayoutStore()

  if (!isResourcePanelOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div
        className="flex-1 bg-black/40"
        onClick={() => setResourcePanelOpen(false)}
        aria-hidden="true"
      />
      <SessionSettingsPanel
        sendMessage={sendMessage}
        open
        className="h-full border-l border-dionysus-subtle-border"
      />
    </div>
  )
}
