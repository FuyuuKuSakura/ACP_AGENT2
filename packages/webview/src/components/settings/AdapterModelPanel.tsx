/**
 * 「AI 助手与模型」设置区（ux：设置页新增小节；数据源 adapter_list_response）：
 * 每个 adapter 一行——id（默认助手带徽标）+ command + 模型输入框；
 * 「保存」经 adapter_model_update_request 写 dionysus.adapters.<id>.model
 * （留空 = 清除，恢复 CLI 默认模型）。
 * supportsModel=false 的助手（codex 的 model 是死配置，extract/adapters.md §5.3/§7.7）
 * 不渲染输入框，标注「该助手不支持选模型」。
 */
import { useEffect, useState } from 'react'

import type { AdapterListEntry } from '@dionysus/protocol'

export interface AdapterModelPanelProps {
  /** null = 响应未回（加载中） */
  adapters: AdapterListEntry[] | null
  /** 当前生效的默认助手 id（空串 = 无） */
  defaultAdapterId: string
  onSaveModel: (adapterId: string, model: string) => void
}

function AdapterRow({
  entry,
  isDefault,
  onSaveModel,
}: {
  entry: AdapterListEntry
  isDefault: boolean
  onSaveModel: (adapterId: string, model: string) => void
}) {
  const [value, setValue] = useState(entry.model)
  // 响应刷新（保存成功回灌）时同步输入框
  useEffect(() => setValue(entry.model), [entry.model])

  return (
    <li
      data-testid={`adapter-row-${entry.id}`}
      className="flex flex-col gap-1 rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--dn-fg)]">{entry.id}</span>
        {isDefault && (
          <span
            data-testid={`adapter-default-badge-${entry.id}`}
            className="rounded-full bg-[var(--dn-badge-bg)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--dn-badge-fg)]"
          >
            默认
          </span>
        )}
        {!entry.installed && (
          <span className="rounded-full bg-[var(--dn-attention-bg)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--dn-attention-fg)]">
            未安装
          </span>
        )}
        <span className="text-xs text-[var(--dn-muted)]">命令 {entry.command}</span>
      </div>
      {entry.supportsModel ? (
        <div className="flex items-center gap-1.5">
          <input
            data-testid={`adapter-model-input-${entry.id}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="模型名，留空用 CLI 默认模型"
            aria-label={`${entry.id} 的模型`}
            className="min-w-0 flex-1 rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-2 py-1 text-xs text-[var(--dn-fg)] focus:outline-none"
          />
          <button
            type="button"
            data-testid={`adapter-model-save-${entry.id}`}
            disabled={value.trim() === entry.model}
            onClick={() => onSaveModel(entry.id, value.trim())}
            className="flex-none rounded-[var(--dn-radius-sm)] border border-[var(--dn-button-border)] bg-[var(--dn-button-bg)] px-2 py-1 text-xs text-[var(--dn-button-fg)] hover:bg-[var(--dn-button-hover)] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      ) : (
        <div
          data-testid={`adapter-model-unsupported-${entry.id}`}
          className="text-xs text-[var(--dn-muted)]"
        >
          该助手不支持选模型
        </div>
      )}
    </li>
  )
}

export function AdapterModelPanel({ adapters, defaultAdapterId, onSaveModel }: AdapterModelPanelProps) {
  if (adapters === null) {
    return <div className="text-sm text-[var(--dn-muted)]">加载中…</div>
  }
  if (adapters.length === 0) {
    return (
      <div data-testid="adapter-list-empty" className="text-sm text-[var(--dn-muted)]">
        未检测到任何 AI 助手。请先安装 CLI 并运行「Dionysus: 重新检测 AI 助手」。
      </div>
    )
  }
  return (
    <ul data-testid="adapter-model-list" className="flex flex-col gap-2">
      {adapters.map((entry) => (
        <AdapterRow
          key={entry.id}
          entry={entry}
          isDefault={entry.id === defaultAdapterId}
          onSaveModel={onSaveModel}
        />
      ))}
    </ul>
  )
}
