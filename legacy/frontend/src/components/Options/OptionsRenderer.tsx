import type { OptionItem } from '@/types/protocol'
import ButtonGroup from './ButtonGroup'
import DropdownOptions from './DropdownOptions'
import CardList from './CardList'

interface OptionsRendererProps {
  options: OptionItem[]
  uiType: 'button_group' | 'dropdown' | 'card_list' | 'input_confirm'
  disabled: boolean
  onSelect: (optionId: string) => void
}

export default function OptionsRenderer({ options, uiType, disabled, onSelect }: OptionsRendererProps) {
  switch (uiType) {
    case 'dropdown':
      return <DropdownOptions options={options} disabled={disabled} onSelect={onSelect} />
    case 'card_list':
      return <CardList options={options} disabled={disabled} onSelect={onSelect} />
    case 'button_group':
    case 'input_confirm':
    default:
      return <ButtonGroup options={options} disabled={disabled} onSelect={onSelect} />
  }
}
