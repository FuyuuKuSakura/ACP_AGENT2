/**
 * R-1 Live2D spike（architecture.md §13 / roadmap Phase 1）。
 * 验证 pixi.js@7 + pixi-live2d-display（cubism4）能在 VS Code webview 的
 * 严格 CSP（§7 模板）下加载并渲染 kal'tsit 模型。
 *
 * 降级与限制说明：
 * - 不使用 pixi workers / OffscreenCanvas：VS Code webview 的 CSP 模板只允许
 *   `worker-src blob:`，且模型渲染一帧不需要 worker，直接走主线程 canvas。
 * - 沿用 v2 Live2DViewer 的防御性设置（legacy/frontend Live2DViewer.tsx）：
 *   强制 WEBGL_LEGACY 并限制 BatchRenderer 纹理单元数，规避某些 WebGL 上下文
 *   上报 0 纹理单元导致 batch renderer 崩溃的问题；Live2D 单模型只需一张纹理。
 * - 出厂 model3.json 未声明 Motions/Expressions 段（动作文件存在但未引用），
 *   spike 只渲染静态模型（autoUpdate 开启，物理/眨眼仍由模型内置组驱动），
 *   不调用 motion()/expression()。
 */
import * as PIXI from 'pixi.js'
import { BatchRenderer, ENV, settings } from 'pixi.js'
import { Cubism4ModelSettings, Live2DModel } from 'pixi-live2d-display/cubism4'
// 踩坑记录（R-1）：§7 CSP 模板禁止 'unsafe-eval'，而 pixi v7 的 ShaderSystem
// 默认用 new Function 生成 uniform 同步代码，在 webview 里直接抛
// "Current environment does not allow unsafe-eval"。按官方方案引入
// @pixi/unsafe-eval（自 7.1 起 side-effect import 即自动打补丁，
// 改用逐字段赋值同步 uniform，不再需要 eval）。
import '@pixi/unsafe-eval'

settings.PREFER_ENV = ENV.WEBGL_LEGACY
BatchRenderer.defaultMaxTextures = 1

// pixi-live2d-display 通过 window.PIXI 注册 ticker 等插件（v2 同款做法）
;(window as unknown as Record<string, unknown>).PIXI = PIXI

/**
 * 踩坑记录（R-1）：pixi-live2d-display 的 ModelSettings.resolveURL 走
 * @pixi/utils 的 url.resolve（Node url 移植版正则解析），无法解析 VS Code
 * webview 的资源 URL —— authority 里带 %2B（file+.vscode-resource.vscode-cdn.net）
 * 会被错误切成 host=file、%2B... 进 path，导致 moc3/纹理 XHR 打到不存在的
 * 主机（status=0，报 "Network error."），而同样的 URL 用 fetch 是 200。
 * 绕过方案：model3.json 自己 fetch（已验证可用），手工构造 Cubism4ModelSettings
 * 并用「字符串目录拼接 + 分段 encodeURIComponent」覆写 resolveURL，
 * 完全绕开 pixi 的 url.resolve。
 */
function createSettings(modelUrl: string, json: object): Cubism4ModelSettings {
  const baseDir = modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1)
  const s = new Cubism4ModelSettings({
    ...json,
    url: modelUrl,
  } as ConstructorParameters<typeof Cubism4ModelSettings>[0])
  s.resolveURL = (p: string) =>
    baseDir + p.split('/').map((seg) => encodeURIComponent(seg)).join('/')
  return s
}

export interface SpikeResult {
  ok: boolean
  detail: string
}

/**
 * 在 container 内创建 pixi 画布并加载 modelUrl 指向的 model3.json。
 * 成功渲染首帧后 resolve；任何加载/渲染失败都会 reject 并附原因。
 */
export async function runLive2DSpike(
  container: HTMLElement,
  modelUrl: string,
): Promise<SpikeResult> {
  if (typeof (window as unknown as Record<string, unknown>).Live2DCubismCore === 'undefined') {
    throw new Error('Live2DCubismCore 未加载（live2dcubismcore.min.js 必须先于 bundle 执行）')
  }

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

  const resp = await fetch(modelUrl)
  if (!resp.ok) {
    throw new Error(`model3.json 加载失败: HTTP ${resp.status} ${modelUrl}`)
  }
  const modelSettings = createSettings(modelUrl, await resp.json())

  const model = (await Live2DModel.from(modelSettings, {
    autoInteract: false,
    autoUpdate: true,
  })) as Live2DModel

  app.stage.addChild(model)

  // 模型原始尺寸很大（全身立绘），按屏幕比例缩放到画布内
  const scale = Math.min(app.screen.width / model.width, app.screen.height / model.height) * 0.9
  model.scale.set(scale)
  model.anchor.set(0.5, 0.5)
  model.x = app.screen.width / 2
  model.y = app.screen.height / 2

  // 显式渲染一帧，确保首帧已上屏（ticker 之后会继续驱动物理/眨眼）
  app.render()

  const bounds = model.getBounds()
  return {
    ok: true,
    detail:
      `模型已渲染：${Math.round(bounds.width)}x${Math.round(bounds.height)}px，` +
      `scale=${scale.toFixed(3)}，PIXI ${PIXI.VERSION}`,
  }
}
