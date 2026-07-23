/**
 * companion/config — 陪伴区 persona 配置的数据源（webview 本地 store）。
 *
 * 数据流（architecture.md §7 陪伴归属规则 + ADR-16 触摸纯前端决策）：
 * persona 的展示素材 URL（modelUrl/portraitUrls，需宿主 asWebviewUri 解析）与
 * companion 段（live2d 表情/动作映射、touch_zones）由 extension 经
 * `window.__DIONYSUS_INIT__.companion` 注入，main.tsx 调 applyInitToStores 落本 store。
 *
 * 注意：本 store 放 webview 包而非 client-core 的 settingsStore——文件所有权约束下
 * 不改 client-core；displayMode 仍读 client-core settingsStore。
 *
 * init 未注入 companion 字段时（Wave2-B 的 persona RPC 补齐前），消费
 * DEFAULT_COMPANION_CONFIG——与 core DEFAULT_PERSONA 的中立结构同形
 * （空 live2d 映射、空 touch_zones），此时陪伴区降级为静态立绘占位。
 */
import { create } from 'zustand'

/** 显式动作/表情文件清单条目（model3.json 未声明 Motions/Expressions 段时回退注入） */
export interface Live2DManifestEntry {
  /** 表情名 / 动作组名（playExpression/playMotion 的入参） */
  name: string
  /** 相对模型目录的文件路径，如 `待机动耳朵.motion3.json` */
  file: string
}

/** persona companion.touch_zones 的单区配置（ADR-16，纯前端消费） */
export interface TouchZoneConfig {
  expression?: string
  lines: string[]
}

/** persona companion.live2d 段的 webview 消费面（宽松透传的子集） */
export interface Live2DConfig {
  /** emotion → Live2D 表情名 */
  expressions: Record<string, string>
  /** emotion/语义 → Live2D 动作组名 */
  motions: Record<string, string>
  defaultExpression?: string
  /** 模型缩放系数（persona live2d.scale） */
  scale?: number
  expressionFiles: Live2DManifestEntry[]
  motionFiles: Live2DManifestEntry[]
}

export interface CompanionConfig {
  personaId: string
  name: string
  /** asWebviewUri 解析后的 model3.json URL（有 live2d 素材时存在） */
  modelUrl?: string
  /** emotion → asWebviewUri 解析后的立绘 URL（有 static 素材时存在） */
  portraitUrls?: Record<string, string>
  live2d: Live2DConfig
  touchZones: Record<string, TouchZoneConfig>
}

/** 中立默认（与 core DEFAULT_PERSONA 的 companion 段同形，零角色专属内容） */
export const DEFAULT_COMPANION_CONFIG: CompanionConfig = {
  personaId: 'default',
  name: '默认助手',
  live2d: { expressions: {}, motions: {}, expressionFiles: [], motionFiles: [] },
  touchZones: {},
}

/** init.companion 的宽松输入形（全部可选，逐键回退中立默认） */
export interface CompanionConfigInput {
  personaId?: string
  name?: string
  modelUrl?: string
  portraitUrls?: Record<string, string>
  live2d?: {
    expressions?: Record<string, string>
    motions?: Record<string, string>
    defaultExpression?: string
    scale?: number
    expressionFiles?: Live2DManifestEntry[]
    motionFiles?: Live2DManifestEntry[]
  }
  touchZones?: Record<string, { expression?: string; lines?: string[] }>
}

/** init 输入 → CompanionConfig（逐键回退 DEFAULT_COMPANION_CONFIG，容错缺失段） */
export function companionConfigFromInit(input: CompanionConfigInput): CompanionConfig {
  const d = DEFAULT_COMPANION_CONFIG
  const touchZones: Record<string, TouchZoneConfig> = {}
  for (const [zone, cfg] of Object.entries(input.touchZones ?? {})) {
    touchZones[zone] = { expression: cfg.expression, lines: cfg.lines ?? [] }
  }
  return {
    personaId: input.personaId ?? d.personaId,
    name: input.name ?? d.name,
    modelUrl: input.modelUrl,
    portraitUrls: input.portraitUrls,
    live2d: {
      expressions: input.live2d?.expressions ?? {},
      motions: input.live2d?.motions ?? {},
      defaultExpression: input.live2d?.defaultExpression,
      scale: input.live2d?.scale,
      expressionFiles: input.live2d?.expressionFiles ?? [],
      motionFiles: input.live2d?.motionFiles ?? [],
    },
    touchZones,
  }
}

export interface CompanionConfigStoreState {
  config: CompanionConfig
  setConfig(config: CompanionConfig): void
  reset(): void
}

export const useCompanionConfigStore = create<CompanionConfigStoreState>()((set) => ({
  config: DEFAULT_COMPANION_CONFIG,

  setConfig(config) {
    set({ config })
  },

  reset() {
    set({ config: DEFAULT_COMPANION_CONFIG })
  },
}))
