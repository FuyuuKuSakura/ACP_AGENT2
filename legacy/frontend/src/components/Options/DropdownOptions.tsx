import type { OptionItem } from '@/types/protocol'

interface DropdownOptionsProps {
  options: OptionItem[]
  disabled: boolean
  onSelect: (optionId: string) => void
}

export default function DropdownOptions({ options, disabled, onSelect }: DropdownOptionsProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value) {
      onSelect(e.target.value)
    }
  }

  return (
    <select
      disabled={disabled}
      onChange={handleChange}
      defaultValue=""
      className={`
        w-full max-w-md rounded-lg border border-dionysus-border bg-dionysus-chat-bg px-3 py-2 text-sm text-dionysus-text-primary outline-none
        ${disabled ? 'cursor-not-allowed opacity-60' : 'focus:ring-2 focus:ring-dionysus-primary'}
      `}
    >
      <option value="" disabled>
        请选择…
      </option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
