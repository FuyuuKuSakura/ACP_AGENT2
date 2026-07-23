/**
 * Icon — 全产品统一的 inline SVG 图标体系（设计要求：禁止 emoji）。
 *
 * 不引图标字体 / npm 图标包：全部手绘几何路径，风格统一——
 * 16×16 viewBox、1.5px 描边、圆角端点/圆角连接、stroke/fill = currentColor
 * （继承 VS Code 主题色，随 --dn-* token 变色）。
 * 测试以 `data-icon` 属性断言图标身份，不断言图形内容。
 */
import type { ReactNode } from 'react'

export type IconName =
  // 会话/聚合状态
  | 'running'
  | 'waiting_option'
  | 'done'
  | 'error'
  | 'idle'
  | 'close'
  // 工具卡片 kind
  | 'tool-read'
  | 'tool-edit'
  | 'tool-bash'
  | 'tool-search'
  | 'tool-other'
  // 通用 UI 符号（design-principles.md §6 V3：替代 ■ ▸ ▾ ▴ ＋ → ↗ 文字符号）
  | 'stop'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'plus'
  | 'arrow-right'
  | 'external'
  | 'checkbox'
  // 情绪徽记（emotion_update 联动，几何/配色区分而非脸部图案）
  | 'emotion-happy'
  | 'emotion-calm'
  | 'emotion-confident'
  | 'emotion-neutral'
  | 'emotion-bored'
  | 'emotion-worried'
  | 'emotion-surprised'
  | 'emotion-annoyed'
  | 'emotion-thinking'
  | 'emotion-working'
  | 'emotion-success'
  | 'emotion-error'
  | 'emotion-idle'

const STROKE_ICONS: Record<IconName, ReactNode> = {
  // 旋转弧圈：270° 开环弧 + 圆角端点，缺口示意「进行中」
  running: <path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />,
  // 警示三角内含点线（待决策，最高视觉优先级）
  waiting_option: (
    <>
      <path d="M8 2.6 14.3 13.2H1.7Z" />
      <path d="M8 6.4v3" />
      <circle cx="8" cy="11.2" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // 对勾圆
  done: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.3 8.2 7.2 10.2 10.8 6" />
    </>
  ),
  // 叉圆
  error: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
    </>
  ),
  // 几何月牙（休眠；描边版新月，非 emoji 月亮）
  idle: <path d="M14 8.5A6 6 0 1 1 7.5 2a4.7 4.7 0 0 0 6.5 6.5Z" />,
  // 关闭叉
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  // 文档形（折角 + 两行正文）
  'tool-read': (
    <>
      <path d="M4.5 2.5H9l2.5 2.5v8.5h-7Z" />
      <path d="M9 2.5V5h2.5" />
      <path d="M6 8.5h4M6 11h4" />
    </>
  ),
  // 笔形（斜置铅笔）
  'tool-edit': <path d="M11.3 2a1.9 1.9 0 1 1 2.7 2.7L5 13.7l-3.7 1 1-3.7Z" />,
  // 终端 >_ 形
  'tool-bash': (
    <>
      <path d="M3 4.5 7 8l-4 3.5" />
      <path d="M9 12h4" />
    </>
  ),
  // 放大镜
  'tool-search': (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10.2 10.2 13.5 13.5" />
    </>
  ),
  // 扳手剪影（other 工具兜底）
  'tool-other': (
    <path d="M9.8 4.2a.67.67 0 0 0 0 .93l1.07 1.07a.67.67 0 0 0 .93 0l2.51-2.51a4 4 0 0 1-5.29 5.29l-4.61 4.61a1.41 1.41 0 0 1-2-2l4.61-4.61a4 4 0 0 1 5.29-5.29l-2.51 2.51Z" />
  ),
  // --- 通用 UI 符号 ---------------------------------------------------------
  // 实心小方块（打断/停止；唯一实色块，与描边图标形成「终态」对比）
  stop: (
    <rect
      x="4"
      y="4"
      width="8"
      height="8"
      rx="1.2"
      fill="currentColor"
      stroke="none"
    />
  ),
  // 右尖角（折叠态，展开时旋转 90°）
  'chevron-right': <path d="M6 3.5 10.5 8 6 12.5" />,
  // 下尖角（展开/收起）
  'chevron-down': <path d="M3.5 6 8 10.5 12.5 6" />,
  // 上尖角
  'chevron-up': <path d="M3.5 10 8 5.5 12.5 10" />,
  // 加号（新建）
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  // 右箭头（成对数据的流向）
  'arrow-right': <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />,
  // 外链（框 + 右上出箭头）
  external: (
    <>
      <path d="M7 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9" />
      <path d="M9.5 3.5h3v3M12.2 3.8 7.5 8.5" />
    </>
  ),
  // 空心方框（todo 待办勾选框，与移动端 StatusScreen 的 checkbox 同源）
  checkbox: <rect x="3" y="3" width="10" height="10" rx="2" />,
  // --- 情绪徽记：几何线条/点阵区分，不画面部表情 -------------------------
  // 上扬弧线（情绪高点）
  'emotion-happy': <path d="M4 9q4 3.5 8 0" />,
  // 平缓水波（情绪平稳）
  'emotion-calm': <path d="M2.5 8q2.7-2.5 5.5 0t5.5 0" />,
  // 双上箭头（自信上行）
  'emotion-confident': <path d="M4 9.5 8 5.5l4 4M4 12.5 8 8.5l4 4" />,
  // 水平直线（中性）
  'emotion-neutral': <path d="M4 8h8" />,
  // 三点省略（无聊/无语）
  'emotion-bored': (
    <>
      <circle cx="4" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // 折线波动（担忧）
  'emotion-worried': <path d="M3 9.5 5 6.5l2 4 2-4 2 4 2-2.5" />,
  // 中空圆环（惊讶的「O」，纯几何环非表情）
  'emotion-surprised': <circle cx="8" cy="8" r="3.2" />,
  // 小锯齿（恼意的毛刺感）
  'emotion-annoyed': <path d="M3.5 10.5 5.5 5l2 5 2-5 2 5 1.5-3" />,
  // 思考泡：两点拖尾 + 空环
  'emotion-thinking': (
    <>
      <circle cx="3.8" cy="12" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="6.3" cy="9.8" r="1" />
      <circle cx="9.8" cy="6" r="2.8" />
    </>
  ),
  // 小齿轮（工作中）
  'emotion-working': (
    <>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2" />
    </>
  ),
  // 对勾（完成汇报）
  'emotion-success': <path d="M4 8.5 7 11.5 12 5" />,
  // 叉圆点（出错汇报；与 waiting_option 警示三角明确区分，design-principles.md §6 V4）
  'emotion-error': (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // 几何月牙（闲置休眠）
  'emotion-idle': <path d="M14 8.5A6 6 0 1 1 7.5 2a4.7 4.7 0 0 0 6.5 6.5Z" />,
}

export interface IconProps {
  name: IconName
  /** 边长 px（viewBox 恒为 16，等比缩放），默认 16 */
  size?: number
  className?: string
  /** 传值后以 role="img" + <title> 暴露无障碍名；缺省 aria-hidden 纯装饰 */
  title?: string
}

export function Icon({ name, size = 16, className, title }: IconProps) {
  return (
    <svg
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      {STROKE_ICONS[name]}
    </svg>
  )
}
