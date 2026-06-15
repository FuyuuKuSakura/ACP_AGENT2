import { useSettingsStore } from '@/stores/settingsStore'
import { panelWidthClasses } from '@/lib/layout'
import Live2DViewer from '../Live2D/Live2DViewer'
import CharacterDialogBox from '../Character/CharacterDialogBox'
import ToolPanel from '../Tools/ToolPanel'

export default function RightPanel() {
  const { live2dEnabled } = useSettingsStore()

  return (
    <aside
      className={`hidden ${panelWidthClasses()} flex-shrink-0 flex-col border-l border-dionysus-subtle-border bg-dionysus-background/80 backdrop-blur-xl xl:flex`}
    >
      <div className="flex h-14 flex-shrink-0 items-center border-b border-dionysus-subtle-border px-4">
        <h2 className="text-base font-semibold text-dionysus-text-primary">
          角色陪伴
        </h2>
      </div>
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Dialogue bubble sits above the character to feel like speech. */}
        <CharacterDialogBox />
        <div className="relative min-h-[45%] flex-1">
          <Live2DViewer enabled={live2dEnabled} />
        </div>
        <ToolPanel />
      </div>
    </aside>
  )
}
