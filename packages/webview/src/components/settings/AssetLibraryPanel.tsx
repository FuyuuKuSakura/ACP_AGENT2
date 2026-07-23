/**
 * 素材库区（ux-core-flows.md §5.5 / architecture.md §7）：
 * - 已安装素材条目列表（kind 徽标 + 来源徽标）；
 * - per-device 展示模式下拉（desktop/mobile → settings_update_request 写回 settings）；
 * - 默认角色下拉（写回 dionysus.persona.default；空 = 自动按素材探测）。
 */
import type {
  CharacterAssetEntry,
  DisplayModeSetting,
  PersonaSummary,
} from '@dionysus/protocol'

export interface AssetLibraryPanelProps {
  characters: CharacterAssetEntry[]
  display: { desktop: DisplayModeSetting; mobile: DisplayModeSetting }
  /** dionysus.persona.default 原始设置值；空串 = 自动 */
  defaultPersonaId: string
  /** 默认角色下拉候选（persona_list 摘要） */
  personas: PersonaSummary[]
  onDisplayChange(device: 'desktop' | 'mobile', mode: DisplayModeSetting): void
  onDefaultPersonaChange(personaId: string): void
}

const KIND_LABEL: Record<CharacterAssetEntry['kind'], string> = {
  live2d: 'Live2D',
  static: '静态立绘',
}

const SOURCE_LABEL: Record<CharacterAssetEntry['source'], string> = {
  builtin: '出厂',
  user: '用户',
}

const selectCls =
  'rounded-[var(--dn-radius-sm)] border border-[var(--dn-input-border)] bg-[var(--dn-input-bg)] px-2 py-1 text-[var(--dn-input-fg)] outline-none focus:border-[var(--dn-focus-border)]'

function DisplayModeSelect({
  testId,
  value,
  onChange,
}: {
  testId: string
  value: DisplayModeSetting
  onChange(mode: DisplayModeSetting): void
}) {
  return (
    <select
      data-testid={testId}
      className={selectCls}
      value={value}
      onChange={(e) => onChange(e.target.value as DisplayModeSetting)}
    >
      <option value="live2d">Live2D 动态模型</option>
      <option value="static">静态立绘</option>
    </select>
  )
}

export function AssetLibraryPanel({
  characters,
  display,
  defaultPersonaId,
  personas,
  onDisplayChange,
  onDefaultPersonaChange,
}: AssetLibraryPanelProps) {
  return (
    <div data-testid="asset-library" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-[var(--dn-muted)]">
            桌面端展示
          </span>
          <DisplayModeSelect
            testId="display-desktop"
            value={display.desktop}
            onChange={(m) => onDisplayChange('desktop', m)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-[var(--dn-muted)]">
            手机端展示
          </span>
          <DisplayModeSelect
            testId="display-mobile"
            value={display.mobile}
            onChange={(m) => onDisplayChange('mobile', m)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-[var(--dn-muted)]">
            默认角色
          </span>
          <select
            data-testid="default-persona"
            className={selectCls}
            value={defaultPersonaId}
            onChange={(e) => onDefaultPersonaChange(e.target.value)}
          >
            <option value="">自动（按已安装素材）</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul data-testid="asset-list" className="flex flex-col gap-1">
        {characters.length === 0 && (
          <li
            data-testid="asset-empty"
            className="text-sm text-[var(--dn-muted)]"
          >
            未检测到角色素材。把模型目录放进 globalStorage 的 character-library/
            即可添加。
          </li>
        )}
        {characters.map((c) => (
          <li
            key={c.id}
            data-testid={`asset-item-${c.id}`}
            className="flex items-center gap-2 rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] px-2 py-1.5"
          >
            {/* 亲密性分组（design-principles.md §6 V7）：名称 + personaId + kind
                徽标成组靠左（主名称突出），来源徽标独立靠右 */}
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="truncate text-sm font-medium text-[var(--dn-fg)]">
                {c.name}
              </span>
              <span className="truncate text-xs text-[var(--dn-muted)]">
                {c.personaId}
              </span>
              <span
                data-testid={`asset-kind-${c.id}`}
                className="flex-none self-center rounded-[var(--dn-radius-sm)] bg-[var(--dn-badge-bg)] px-1.5 py-0.5 text-xs text-[var(--dn-badge-fg)]"
              >
                {KIND_LABEL[c.kind]}
              </span>
            </span>
            <span className="flex-none rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-secondary-bg)] px-1.5 py-0.5 text-xs text-[var(--dn-button-secondary-fg)]">
              {SOURCE_LABEL[c.source]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
