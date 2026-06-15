import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, X } from 'lucide-react'

export default function QRCodeButton() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null)

  const url = typeof window !== 'undefined' ? window.location.origin : ''

  useEffect(() => {
    if (!open || !buttonRef.current) return
    const updatePos = () => {
      const rect = buttonRef.current!.getBoundingClientRect()
      setPos({
        bottom: window.innerHeight - rect.bottom,
        left: rect.right + 8,
      })
    }
    updatePos()
    window.addEventListener('resize', updatePos)
    window.addEventListener('scroll', updatePos, true)
    return () => {
      window.removeEventListener('resize', updatePos)
      window.removeEventListener('scroll', updatePos, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const popup = (
    <div
      className="fixed z-[200] w-64 rounded-2xl border border-dionysus-glass-border bg-dionysus-glass-bg p-4 shadow-xl backdrop-blur-xl"
      style={pos ? { bottom: pos.bottom, left: pos.left } : {}}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-dionysus-text-primary">扫码连接</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-dionysus-text-secondary hover:bg-dionysus-glass-highlight hover:text-dionysus-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {url ? (
        <>
          <img
            src={`/api/server/qr?url=${encodeURIComponent(url)}`}
            alt="QR"
            className="mx-auto block h-44 w-44 rounded-lg bg-white object-contain p-2"
          />
          <div className="mt-2 break-all text-center text-xs text-dionysus-text-secondary">
            {url}
          </div>
        </>
      ) : (
        <div className="py-4 text-center text-xs text-dionysus-text-secondary">无法获取地址</div>
      )}
    </div>
  )

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="连接二维码"
        className="flex h-11 w-11 items-center justify-center rounded-xl text-dionysus-text-secondary transition-colors hover:bg-dionysus-glass-highlight hover:text-dionysus-primary"
      >
        <QrCode className="h-5 w-5" />
      </button>

      {open && createPortal(popup, document.body)}
    </div>
  )
}
