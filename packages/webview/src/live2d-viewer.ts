/**
 * live2d-viewer — Live2D 正式加载器（Phase 4，提炼自 Phase 1 的 live2d-spike.ts）。
 *
 * spike 复用点（三个 R-1 踩坑的解法，逐条沿用）：
 * 1. `@pixi/unsafe-eval` side-effect import：§7 CSP 模板禁止 'unsafe-eval'，pixi v7
 *    的 ShaderSystem 默认用 new Function 生成 uniform 同步代码，不打补丁在 webview
 *    里直接抛错；
 * 2. 自构造 Cubism4ModelSettings 并覆写 resolveURL：pixi-live2d-display 的
 *    resolveURL 走 @pixi/utils 的 url.resolve，无法解析 VS Code webview 的资源 URL
 *    （authority 带 %2B 被错误切成 host=file），改为「字符串目录拼接 + 分段
 *    encodeURIComponent」完全绕开；
 * 3. live2dcubismcore.min.js 以经典 script（带 nonce）先于 ESM bundle 加载，
 *    在 window 上挂 Live2DCubismCore 全局（由 extension webview-provider 注入，
 *    本模块只检测不加载）。
 *
 * 防御性设置沿用 v2/spike：强制 WEBGL_LEGACY + BatchRenderer 单纹理，规避某些
 * WebGL 上下文上报 0 纹理单元导致 batch renderer 崩溃的问题。
 *
 * 「显式动作/表情文件清单」回退：出厂 kal'tsit 的 model3.json 未声明
 * Motions/Expressions 段（动作文件存在于目录但未被引用）。加载器允许调用方传入
 * 显式清单（persona YAML 的 live2d.expression_files / motion_files），在自构造
 * settings 前注入 FileReferences，之后 model.motion()/expression() 原生可用；
 * 清单未提供或模型无对应资源时，play 一律静默跳过（返回 false），不抛错。
 *
 * 注意：本模块被 Live2DViewer 静态 import，pixi 打进主 bundle——extension 的
 * findBundleAssets 只认单入口 JS，禁止对本模块做动态 import 分包。
 */
import * as PIXI from 'pixi.js'
import { BatchRenderer, ENV, settings } from 'pixi.js'
// 踩坑解法 1（见文件头注释）
import '@pixi/unsafe-eval'
// 仅类型：值经 loadCubism4Module 动态加载（见下）
import type { Cubism4ModelSettings, Live2DModel } from 'pixi-live2d-display/cubism4'

import type { Live2DManifestEntry } from './components/companion/config.js'

settings.PREFER_ENV = ENV.WEBGL_LEGACY
BatchRenderer.defaultMaxTextures = 1

// pixi-live2d-display 通过 window.PIXI 注册 ticker 等插件（v2/spike 同款做法）
;(window as unknown as Record<string, unknown>).PIXI = PIXI

/**
 * pixi-live2d-display/cubism4 在模块加载时就要求 window.Live2DCubismCore 存在
 * （否则 import 即抛错）。运行时由宿主经典 script 注入，因此这里只在确认
 * runtime 就绪后动态 import；vite 配置 inlineDynamicImports 保证产物仍是单
 * bundle（extension 的 findBundleAssets 只认单入口 JS），同时 jsdom 测试
 * 不执行到动态 import 就不会触发该检查。
 */
type Cubism4Module = typeof import('pixi-live2d-display/cubism4')
let cubism4ModulePromise: Promise<Cubism4Module> | null = null
function loadCubism4Module(): Promise<Cubism4Module> {
  cubism4ModulePromise ??= import('pixi-live2d-display/cubism4')
  return cubism4ModulePromise
}

/** Live2D Cubism 4 runtime（经典 script 注入的全局）是否就绪。 */
export function isLive2DRuntimeReady(): boolean {
  return (
    typeof (window as unknown as Record<string, unknown>).Live2DCubismCore !== 'undefined'
  )
}

export interface Live2DLoadOptions {
  /** asWebviewUri 注入的 model3.json URL */
  modelUrl: string
  /** 显式表情清单（model3.json 无 Expressions 段时注入；name=表情名，file=相对模型目录） */
  expressionFiles?: Live2DManifestEntry[]
  /** 显式动作清单（model3.json 无 Motions 段时注入；name=动作组名） */
  motionFiles?: Live2DManifestEntry[]
  /** persona live2d.scale 缩放系数（在按画布自适应的基础上再乘），默认 0.9 */
  scale?: number
}

export interface Live2DHandle {
  readonly app: PIXI.Application
  readonly model: Live2DModel
  /** 可用表情名集合（模型声明 + 显式清单注入）；用于静默跳过判断 */
  readonly expressions: ReadonlySet<string>
  /** 可用动作组名集合 */
  readonly motions: ReadonlySet<string>
  /** 播表情；无对应资源静默跳过，返回是否实际触发播放 */
  playExpression(name?: string): Promise<boolean>
  /** 播动作组；无对应资源静默跳过，返回是否实际触发播放 */
  playMotion(group?: string): Promise<boolean>
  resize(width: number, height: number): void
  destroy(): void
}

/** model3.json FileReferences 的最小结构（注入/读取用，其余字段透传）。 */
interface Model3Json {
  FileReferences: {
    Moc: string
    Textures: string[]
    Motions?: Record<string, { File: string }[]>
    Expressions?: { Name: string; File: string }[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

/**
 * 踩坑解法 2（见文件头注释）：自构造 Cubism4ModelSettings 并覆写 resolveURL，
 * 绕开 pixi 的 url.resolve 对 webview 资源 URL 的错误解析。
 */
function createSettings(
  Ctor: Cubism4Module['Cubism4ModelSettings'],
  modelUrl: string,
  json: Model3Json,
): Cubism4ModelSettings {
  const baseDir = modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1)
  const s = new Ctor({
    ...json,
    url: modelUrl,
  } as ConstructorParameters<Cubism4Module['Cubism4ModelSettings']>[0])
  s.resolveURL = (p: string) =>
    baseDir + p.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return s
}

/**
 * 显式清单回退注入：model3.json 未声明 Motions/Expressions 段时（如出厂
 * kal'tsit），把 persona 提供的文件清单写进 FileReferences，使
 * model.motion()/expression() 原生可用。模型已声明的段不覆盖。
 */
function injectManifestFallback(json: Model3Json, options: Live2DLoadOptions): void {
  const refs = json.FileReferences
  if (!refs.Expressions && options.expressionFiles && options.expressionFiles.length > 0) {
    refs.Expressions = options.expressionFiles.map((e) => ({ Name: e.name, File: e.file }))
  }
  if (!refs.Motions && options.motionFiles && options.motionFiles.length > 0) {
    const motions: Record<string, { File: string }[]> = {}
    for (const entry of options.motionFiles) {
      ;(motions[entry.name] ??= []).push({ File: entry.file })
    }
    refs.Motions = motions
  }
}

/** 从 settings 读取可用表情/动作名（声明 + 注入后的全集），供静默跳过判断。 */
function readAvailable(settings: Cubism4ModelSettings): {
  expressions: Set<string>
  motions: Set<string>
} {
  const s = settings as unknown as {
    expressions?: { Name?: string }[]
    motions?: Record<string, unknown[]>
  }
  const expressions = new Set<string>()
  for (const e of s.expressions ?? []) {
    if (e.Name) expressions.add(e.Name)
  }
  return { expressions, motions: new Set(Object.keys(s.motions ?? {})) }
}

/**
 * 在 container 内创建 pixi 画布并加载 options.modelUrl 指向的 model3.json。
 * 成功渲染首帧后 resolve Live2DHandle；加载/渲染失败 reject（调用方降级静态立绘）。
 */
export async function loadLive2D(
  container: HTMLElement,
  options: Live2DLoadOptions,
): Promise<Live2DHandle> {
  // 踩坑解法 3（见文件头注释）：runtime 由宿主以经典 script 预注入
  if (!isLive2DRuntimeReady()) {
    throw new Error('Live2DCubismCore 未加载（live2dcubismcore.min.js 必须先于 bundle 执行）')
  }
  const { Cubism4ModelSettings, Live2DModel } = await loadCubism4Module()

  const width = Math.max(1, container.clientWidth || 480)
  const height = Math.max(1, container.clientHeight || 640)
  const app = new PIXI.Application({
    width,
    height,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })
  const view = app.view as HTMLCanvasElement
  view.style.display = 'block'
  view.style.width = '100%'
  view.style.height = '100%'
  container.appendChild(view)

  const resp = await fetch(options.modelUrl)
  if (!resp.ok) {
    throw new Error(`model3.json 加载失败: HTTP ${resp.status} ${options.modelUrl}`)
  }
  const json = (await resp.json()) as Model3Json
  injectManifestFallback(json, options)
  const modelSettings = createSettings(Cubism4ModelSettings, options.modelUrl, json)

  const model = (await Live2DModel.from(modelSettings, {
    autoInteract: false,
    autoUpdate: true,
  })) as Live2DModel

  app.stage.addChild(model)

  // 模型的自然尺寸（scale=1 时测一次）。PIXI 的 model.width/height 含当前 scale，
  // layout 若每次重读会把上次缩放复利进新 scale——侧栏开合等 resize 场景会越放越大/越小。
  let naturalW = model.width
  let naturalH = model.height

  const layout = (w: number, h: number) => {
    // 极端情况下模型未完成首帧布局时尺寸为 0，惰性补测一次
    if (!(naturalW > 0) || !(naturalH > 0)) {
      naturalW = model.width || 1
      naturalH = model.height || 1
    }
    const scale = Math.min(w / naturalW, h / naturalH) * (options.scale ?? 0.9)
    model.scale.set(scale)
    // 设计要求 2：角色底部锚定（水平居中、模型脚底贴画布底），不垂直居中；
    // scale<1 留出的余量全部落在模型头顶上方，兼作气泡锚点间距
    model.anchor.set(0.5, 1)
    model.x = w / 2
    model.y = h
  }
  layout(app.screen.width, app.screen.height)

  // 显式渲染一帧，确保首帧已上屏（ticker 之后会继续驱动物理/眨眼）
  app.render()

  const { expressions, motions } = readAvailable(modelSettings)

  return {
    app,
    model,
    expressions,
    motions,

    async playExpression(name) {
      // 模型无对应资源（含 persona 映射了但模型未声明/清单未提供）一律静默跳过
      if (!name || !expressions.has(name)) return false
      try {
        return await model.expression(name)
      } catch {
        return false
      }
    },

    async playMotion(group) {
      if (!group || !motions.has(group)) return false
      try {
        return await model.motion(group)
      } catch {
        return false
      }
    },

    resize(w, h) {
      if (w <= 0 || h <= 0) return
      app.renderer.resize(w, h)
      // renderer.resize(autoDensity=true) 会把 canvas style 覆写为 px 尺寸，
      // 与容器的 100% 布局冲突（侧栏开合时画布被拉伸成色带）——改回百分比
      view.style.width = '100%'
      view.style.height = '100%'
      layout(w, h)
      // webview 隐藏时 rAF 暂停、ticker 不驱动渲染；resize 后必须显式重绘一帧，
      // 否则缓冲区残留旧帧被新尺寸拉伸（用户可见的横色带）
      app.render()
    },

    destroy() {
      app.destroy(true, { children: true })
    },
  }
}
