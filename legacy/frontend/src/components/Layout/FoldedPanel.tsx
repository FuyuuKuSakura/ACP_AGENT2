import type { ReactNode } from 'react'
import clsx from 'clsx'

interface FoldedPanelProps {
  children: ReactNode
  className?: string
  innerClassName?: string
  /**
   * Which diagonal corners get the larger fold.
   * Default matches the design: top-right + bottom-left large,
   * top-left + bottom-right small.
   */
  largeCorners?: 'tr-bl' | 'tl-br'
  /** Background tint applied to the clipped inner surface. */
  bg?: string
  /** Border color class for the panel edge. */
  borderColor?: string
  /** Size of the large folded corner cut-out (px). */
  largeFold?: number
  /** Size of the small folded corner cut-out (px). */
  smallFold?: number
  /** Render the gold triangular accent on the large folded corners. */
  accent?: boolean
  as?: keyof React.JSX.IntrinsicElements
}

export default function FoldedPanel({
  children,
  className,
  innerClassName,
  largeCorners = 'tr-bl',
  bg = 'bg-dionysus-card-bg',
  borderColor = 'border-black/8',
  largeFold = 20,
  smallFold = 8,
  accent = true,
  as: Component = 'div',
}: FoldedPanelProps) {
  const isTrBl = largeCorners === 'tr-bl'

  const large = largeFold
  const small = smallFold

  const tl = isTrBl ? small : large
  const tr = isTrBl ? large : small
  const br = isTrBl ? small : large
  const bl = isTrBl ? large : small

  const clipPath = `polygon(
    ${tl}px 0,
    calc(100% - ${tr}px) 0,
    100% ${tr}px,
    100% calc(100% - ${br}px),
    calc(100% - ${br}px) 100%,
    ${bl}px 100%,
    0 calc(100% - ${bl}px),
    0 ${tl}px
  )`

  const accentStyle = { width: large, height: large }
  const trClip = 'polygon(100% 0, 0 0, 100% 100%)'
  const blClip = 'polygon(0 100%, 0 0, 100% 100%)'
  const tlClip = 'polygon(0 0, 100% 0, 0 100%)'
  const brClip = 'polygon(100% 100%, 0 100%, 100% 0)'

  return (
    <Component className={clsx('relative flex flex-col', className)}>
      {/* Clipped inner surface: translucent mask with transparent folded corners */}
      <div
        className={clsx(
          'relative flex flex-1 flex-col overflow-hidden border',
          borderColor,
          bg,
          innerClassName,
        )}
        style={{ clipPath }}
      >
        {children}
      </div>

      {/* Gold triangular accent on the large folded corners */}
      {accent && (
        <>
          <div
            className="pointer-events-none absolute z-10 bg-dionysus-fold-accent"
            style={{
              ...accentStyle,
              top: 0,
              right: 0,
              clipPath: isTrBl ? trClip : tlClip,
            }}
          />
          <div
            className="pointer-events-none absolute z-10 bg-dionysus-fold-accent"
            style={{
              ...accentStyle,
              bottom: 0,
              left: 0,
              clipPath: isTrBl ? blClip : brClip,
            }}
          />
        </>
      )}
    </Component>
  )
}
