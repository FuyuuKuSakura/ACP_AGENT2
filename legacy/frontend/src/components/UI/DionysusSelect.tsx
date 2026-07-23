import { ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface DionysusSelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  error?: string | null
  className?: string
  id?: string
}

export default function DionysusSelect({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  error,
  className = '',
  id,
}: DionysusSelectProps) {
  const hasValue = value !== '' && options.some((o) => o.value === value)

  return (
    <div className={`relative ${className}`}>
      <select
        id={id}
        value={value}
        disabled={disabled || options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className={`
          h-10 w-full appearance-none rounded-xl border-2 px-3 py-2 pr-9 text-sm outline-none
          transition-colors
          ${
            error
              ? 'border-dionysus-danger bg-dionysus-danger/10 text-dionysus-danger'
              : 'border-dionysus-subtle-border bg-dionysus-glass-highlight text-dionysus-text-primary focus:border-dionysus-primary'
          }
          ${disabled || options.length === 0 ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
        `}
      >
        {!hasValue && (
          <option value="" disabled>
            {options.length === 0 ? '暂无选项' : placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dionysus-text-secondary"
        aria-hidden="true"
      />
      {error && <p className="mt-1 text-xs text-dionysus-danger">{error}</p>}
    </div>
  )
}
