/**
 * persona voice 客制化表单（ux-core-flows.md §5.5）：自创角色本质是填五个字段——
 * tone / catchphrases / taboos / examples / rewriter_prompt（高级折叠），
 * 外加可选的 name/description。表单状态为本组件内部 state（按 persona 切换经
 * React key 重置）；「试听」「保存」经 props 回调交给容器走协议。
 * 全部色值走 VS Code 主题变量（--dn-* token，ADR-20）。
 */
import { useState } from 'react'

import type {
  PersonaSummary,
  PersonaVoiceUpdate,
  VoiceExample,
} from '@dionysus/protocol'

import { Icon } from '../Icon.js'

export interface VoiceFormValues {
  name: string
  description: string
  voice: PersonaVoiceUpdate
}

export interface VoiceFormProps {
  persona: PersonaSummary
  saving: boolean
  /** 保存：容器发 persona_update_request */
  onSave(personaId: string, values: VoiceFormValues): void
  /** 试听：容器发 voice_preview_request，resolve 改写结果（携带未保存的表单编辑） */
  onPreview(
    personaId: string,
    text: string,
    voice: PersonaVoiceUpdate,
  ): Promise<{ rewritten: string; error?: string }>
}

/** 逐行 textarea ↔ string[]（空行丢弃） */
function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const inputCls =
  'w-full rounded-[var(--dn-radius-sm)] border border-[var(--dn-input-border)] bg-[var(--dn-input-bg)] px-2 py-1 text-[var(--dn-input-fg)] outline-none focus:border-[var(--dn-focus-border)]'
const labelCls = 'mb-1 block text-xs font-semibold text-[var(--dn-muted)]'

export function VoiceForm({
  persona,
  saving,
  onSave,
  onPreview,
}: VoiceFormProps) {
  const [name, setName] = useState(persona.name)
  const [description, setDescription] = useState(persona.description)
  const [tone, setTone] = useState(persona.voice.tone)
  const [catchphrasesText, setCatchphrasesText] = useState(
    persona.voice.catchphrases.join('\n'),
  )
  const [taboosText, setTaboosText] = useState(persona.voice.taboos.join('\n'))
  const [examples, setExamples] = useState<VoiceExample[]>(
    persona.voice.examples,
  )
  const [rewriterPrompt, setRewriterPrompt] = useState(
    persona.voice.rewriterPrompt,
  )

  const [previewInput, setPreviewInput] = useState('')
  const [previewOutput, setPreviewOutput] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  function currentVoice(): PersonaVoiceUpdate {
    return {
      tone,
      catchphrases: linesToList(catchphrasesText),
      taboos: linesToList(taboosText),
      examples: examples.filter((e) => e.plain.trim() && e.styled.trim()),
      rewriterPrompt,
    }
  }

  function updateExample(index: number, patch: Partial<VoiceExample>): void {
    setExamples(examples.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  async function handlePreview(): Promise<void> {
    if (!previewInput.trim() || previewing) return
    setPreviewing(true)
    setPreviewError(null)
    try {
      const result = await onPreview(persona.id, previewInput, currentVoice())
      setPreviewOutput(result.rewritten)
      setPreviewError(result.error ?? null)
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div data-testid="voice-form" className="flex flex-col gap-3">
      <div>
        <label className={labelCls} htmlFor="vf-name">
          角色名称
        </label>
        <input
          id="vf-name"
          data-testid="vf-name"
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="vf-description">
          角色简介
        </label>
        <textarea
          id="vf-description"
          data-testid="vf-description"
          className={inputCls}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="vf-tone">
          语气描述（一句话，如「冷静克制，偶尔毒舌」）
        </label>
        <input
          id="vf-tone"
          data-testid="vf-tone"
          className={inputCls}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="vf-catchphrases">
          口头禅 / 句尾口癖（逐行一条）
        </label>
        <textarea
          id="vf-catchphrases"
          data-testid="vf-catchphrases"
          className={inputCls}
          rows={3}
          value={catchphrasesText}
          onChange={(e) => setCatchphrasesText(e.target.value)}
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="vf-taboos">
          绝不会说的话（逐行一条，用于改写结果校验）
        </label>
        <textarea
          id="vf-taboos"
          data-testid="vf-taboos"
          className={inputCls}
          rows={3}
          value={taboosText}
          onChange={(e) => setTaboosText(e.target.value)}
        />
      </div>

      <div>
        <div className={labelCls}>改写样例（平淡汇报 → 角色口吻，3-5 对）</div>
        <div className="flex flex-col gap-2">
          {examples.map((example, i) => (
            <div
              key={i}
              data-testid={`vf-example-${i}`}
              className="flex items-center gap-2"
            >
              <input
                data-testid={`vf-example-plain-${i}`}
                className={inputCls}
                placeholder="平淡汇报"
                value={example.plain}
                onChange={(e) => updateExample(i, { plain: e.target.value })}
              />
              <span
                className="inline-flex shrink-0 text-[var(--dn-muted)]"
                aria-hidden
              >
                <Icon name="arrow-right" size={14} />
              </span>
              <input
                data-testid={`vf-example-styled-${i}`}
                className={inputCls}
                placeholder="角色口吻"
                value={example.styled}
                onChange={(e) => updateExample(i, { styled: e.target.value })}
              />
              <button
                type="button"
                data-testid={`vf-example-remove-${i}`}
                className="shrink-0 rounded-[var(--dn-radius-sm)] px-2 py-1 text-[var(--dn-error)] hover:bg-[var(--dn-button-secondary-bg)]"
                onClick={() => setExamples(examples.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            data-testid="vf-example-add"
            className="self-start rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-secondary-bg)] px-2 py-1 text-[var(--dn-button-secondary-fg)]"
            onClick={() =>
              setExamples([...examples, { plain: '', styled: '' }])
            }
          >
            + 添加样例
          </button>
        </div>
      </div>

      <details
        data-testid="vf-advanced"
        className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] p-2"
      >
        <summary className="cursor-pointer text-xs font-semibold text-[var(--dn-muted)]">
          高级：改写提示词（LLM 模式，可留空用默认；支持 {'{tone}'}{' '}
          {'{examples}'} 占位符）
        </summary>
        <textarea
          data-testid="vf-rewriter-prompt"
          className={`${inputCls} mt-2 font-[var(--dn-font-mono)]`}
          rows={4}
          value={rewriterPrompt}
          onChange={(e) => setRewriterPrompt(e.target.value)}
        />
      </details>

      <div className="rounded-[var(--dn-radius-sm)] border border-[var(--dn-border)] p-2">
        <div className={labelCls}>
          试听：输入一句平淡汇报，实时听当前口吻（不保存也生效）
        </div>
        <div className="flex items-center gap-2">
          <input
            data-testid="vf-preview-input"
            className={inputCls}
            placeholder="例如：会话 A 的任务完成了。"
            value={previewInput}
            onChange={(e) => setPreviewInput(e.target.value)}
          />
          <button
            type="button"
            data-testid="vf-preview-button"
            disabled={!previewInput.trim() || previewing}
            className="shrink-0 rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-bg)] px-3 py-1 text-[var(--dn-button-fg)] disabled:opacity-50"
            onClick={() => void handlePreview()}
          >
            {previewing ? '改写中…' : '试听'}
          </button>
        </div>
        {previewOutput !== null && (
          <div
            data-testid="vf-preview-output"
            className="mt-2 rounded-[var(--dn-radius-sm)] bg-[var(--dn-code-bg)] px-2 py-1 text-sm"
          >
            {previewOutput}
          </div>
        )}
        {previewError && (
          <div
            data-testid="vf-preview-error"
            className="mt-2 text-xs text-[var(--dn-error)]"
          >
            试听失败：{previewError}
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="vf-save"
        disabled={saving || !name.trim()}
        className="self-start rounded-[var(--dn-radius-sm)] bg-[var(--dn-button-bg)] px-4 py-1.5 font-semibold text-[var(--dn-button-fg)] disabled:opacity-50"
        onClick={() =>
          onSave(persona.id, { name, description, voice: currentVoice() })
        }
      >
        {saving ? '保存中…' : '保存'}
      </button>
    </div>
  )
}
