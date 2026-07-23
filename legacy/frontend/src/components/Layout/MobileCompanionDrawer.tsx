import { AnimatePresence, motion } from 'framer-motion'
import { X, ChevronDown, GripHorizontal } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLayoutStore } from '@/stores/layoutStore'
import Live2DViewer from '../Live2D/Live2DViewer'
import CharacterDialogBox from '../Character/CharacterDialogBox'
import ToolPanel from '../Tools/ToolPanel'

export default function MobileCompanionDrawer() {
  const { live2dEnabled } = useSettingsStore()
  const { isCompanionDrawerOpen, setCompanionDrawerOpen } = useLayoutStore()

  return (
    <AnimatePresence>
      {isCompanionDrawerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCompanionDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 md:hidden"
            aria-hidden="true"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.15}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120) {
                setCompanionDrawerOpen(false)
              }
            }}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl border-t-2 border-dionysus-subtle-border bg-dionysus-panel-bg shadow-2xl md:hidden"
            style={{ height: '80vh', maxHeight: '80vh' }}
            role="dialog"
            aria-modal="true"
            aria-label="角色陪伴"
          >
            {/* Drag handle + header */}
            <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-dionysus-subtle-border px-4">
              <button
                type="button"
                onClick={() => setCompanionDrawerOpen(false)}
                className="flex items-center gap-1 text-dionysus-text-secondary"
                aria-label="收起角色陪伴"
              >
                <GripHorizontal className="h-5 w-5" />
                <ChevronDown className="h-4 w-4" />
              </button>
              <h2 className="text-base font-semibold text-dionysus-text-primary">
                角色陪伴
              </h2>
              <button
                type="button"
                onClick={() => setCompanionDrawerOpen(false)}
                className="cel-button p-2 text-dionysus-text-secondary"
                aria-label="关闭角色陪伴"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Dialog bubble sits above the character */}
            <div className="flex-shrink-0 px-4 pt-3">
              <CharacterDialogBox />
            </div>

            {/* Live2D / character area */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <Live2DViewer enabled={live2dEnabled} />
            </div>

            {/* Bottom toolbar */}
            <div className="flex-shrink-0 border-t border-dionysus-subtle-border px-4 py-3">
              <ToolPanel />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
