import { useLayoutStore } from '@/stores/layoutStore'
import SettingsPanel from './SettingsPanel'

export default function MobileResourcePanel() {
  const { isResourcePanelOpen, setResourcePanelOpen } = useLayoutStore()

  return (
    <div className="md:hidden">
      <SettingsPanel
        isOpen={isResourcePanelOpen}
        onClose={() => setResourcePanelOpen(false)}
        initialTab="agent"
      />
    </div>
  )
}
