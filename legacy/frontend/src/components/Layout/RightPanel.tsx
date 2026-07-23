import { useSettingsStore } from '@/stores/settingsStore'
import FoldedPanel from './FoldedPanel'
import Live2DViewer from '../Live2D/Live2DViewer'
import CharacterDialogBox from '../Character/CharacterDialogBox'

interface RightPanelProps {
  className?: string
}

export default function RightPanel({ className = '' }: RightPanelProps) {
  const { live2dEnabled } = useSettingsStore()

  return (
    <FoldedPanel
      as="aside"
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className}`}
      bg="bg-dionysus-floating-bg"
      borderColor="border-white/10"
      innerClassName="cel-dark-card p-4"
    >
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Dialogue bubble sits above the character to feel like speech. */}
        <CharacterDialogBox />
        <div className="relative min-h-[45%] flex-1">
          <Live2DViewer enabled={live2dEnabled} />
        </div>
      </div>
    </FoldedPanel>
  )
}
