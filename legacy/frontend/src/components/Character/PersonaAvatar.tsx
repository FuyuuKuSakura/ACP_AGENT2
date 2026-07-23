import { useState, useRef, useCallback } from 'react'
import { Upload, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import clsx from 'clsx'

interface PersonaAvatarProps {
  personaId?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  editable?: boolean
  onUpload?: () => void
}

const sizeClasses = {
  xs: 'h-5 w-5',
  sm: 'h-6 w-6',
  md: 'h-9 w-9',
  lg: 'h-16 w-16',
}

export default function PersonaAvatar({
  personaId: propPersonaId,
  size = 'md',
  className,
  editable = false,
  onUpload,
}: PersonaAvatarProps) {
  const globalPersonaId = useSettingsStore((state) => state.globalPersonaId)
  const personaId = propPersonaId ?? globalPersonaId

  const [cacheBuster, setCacheBuster] = useState(Date.now())
  const [hasError, setHasError] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const src =
    hasError || !personaId ? '/icon.png' : `/api/personas/${personaId}/avatar?t=${cacheBuster}`

  const refresh = useCallback(() => {
    setHasError(false)
    setCacheBuster(Date.now())
  }, [])

  const handleError = useCallback(() => {
    setHasError(true)
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !personaId) return

    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/personas/${personaId}/avatar`, {
        method: 'POST',
        body: form,
      })
      if (res.ok) {
        refresh()
        onUpload?.()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(`上传失败：${data.error || res.statusText}`)
      }
    } catch {
      alert('上传失败')
    } finally {
      setUploading(false)
      setMenuOpen(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleReset = async () => {
    if (!personaId) return
    if (!window.confirm('确定要恢复默认头像吗？')) return

    try {
      const res = await fetch(`/api/personas/${personaId}/avatar`, { method: 'DELETE' })
      if (res.ok) {
        refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(`恢复默认失败：${data.error || res.statusText}`)
      }
    } catch {
      alert('恢复默认失败')
    } finally {
      setMenuOpen(false)
    }
  }

  const avatarImg = (
    <img
      src={src}
      alt="头像"
      onError={handleError}
      className={clsx('cel-avatar', sizeClasses[size], className)}
    />
  )

  if (!editable) {
    return avatarImg
  }

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={uploading}
        className="relative inline-flex rounded-full disabled:opacity-50"
        aria-label="头像菜单"
        aria-haspopup="menu"
      >
        {avatarImg}
      </button>

      {menuOpen && (
        <div
          className="absolute left-1/2 top-full z-50 mt-2 w-32 -translate-x-1/2 rounded-lg border border-dionysus-glass-border bg-dionysus-panel-bg p-1 shadow-lg backdrop-blur-md"
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-dionysus-text-primary transition-colors hover:bg-dionysus-primary/10"
          >
            <Upload className="h-3.5 w-3.5" />
            更换头像
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleReset}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-dionysus-text-primary transition-colors hover:bg-dionysus-primary/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            恢复默认
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={handleFileChange}
      />
    </div>
  )
}
