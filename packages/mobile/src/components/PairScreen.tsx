/**
 * 配对页（architecture.md §8 P0）：扫码直达（hash 带 pair token 时 App 自动
 * 换票）+ 手动输码兜底。文案固定含「手机需与电脑连接同一个 Wi-Fi」（§6.4）。
 */
import { useState } from 'react'

export interface PairScreenProps {
  /** 正在进行自动配对（hash 带 token） */
  pairing: boolean
  /** 上一轮配对/连接失败原因 */
  error?: string | null
  onSubmitManual(token: string): void
}

export function PairScreen({ pairing, error, onSubmitManual }: PairScreenProps) {
  const [manual, setManual] = useState('')

  return (
    <div
      data-testid="pair-screen"
      className="flex h-full flex-col items-center justify-center px-6"
    >
      <h1 className="mb-2 text-xl font-semibold">连接 Dionysus</h1>
      <p className="mb-6 text-center text-sm text-[var(--dn-muted)]">
        手机需与电脑连接同一个 Wi-Fi。
        <br />
        在 VS Code 中执行「Dionysus: 显示配对二维码」，用手机扫码即可连接。
      </p>
      {pairing ? (
        <p data-testid="pair-progress" className="flex items-center gap-2 text-sm">
          <span className="dn-loader" aria-hidden />
          正在配对…
        </p>
      ) : (
        <>
          {error && (
            <p
              data-testid="pair-error"
              role="alert"
              className="mb-4 rounded-[var(--dn-radius-md)] bg-[var(--dn-error)] px-3 py-2 text-sm text-white"
            >
              {error}
            </p>
          )}
          <div className="w-full max-w-xs">
            <p className="mb-2 text-center text-xs text-[var(--dn-muted)]">
              扫码没跳转？把二维码链接里 #/pair/ 后面的配对码贴进来：
            </p>
            <input
              data-testid="pair-manual-input"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="配对码"
              className="mb-2 w-full rounded-[var(--dn-radius-md)] border border-[var(--dn-border)] bg-[var(--dn-panel-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--dn-accent)]"
            />
            <button
              type="button"
              data-testid="pair-manual-submit"
              disabled={!manual.trim()}
              onClick={() => onSubmitManual(manual.trim())}
              className="w-full rounded-[var(--dn-radius-md)] bg-[var(--dn-button-bg)] px-3 py-2.5 text-sm text-[var(--dn-button-fg)] disabled:cursor-not-allowed disabled:bg-[var(--dn-button-secondary-bg)] disabled:text-[var(--dn-muted)]"
            >
              配对
            </button>
          </div>
        </>
      )}
      <p className="mt-8 text-center text-xs text-[var(--dn-muted)]">
        连不上？检查电脑防火墙 / 路由器 AP 隔离；离开期间请保持电脑唤醒。
      </p>
    </div>
  )
}
