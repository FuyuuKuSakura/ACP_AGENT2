/**
 * 角色素材库扫描器（architecture.md §7）。
 *
 * 合并两个来源为 CharacterAsset[]（用户目录同名 id 覆盖出厂）：
 * - 出厂：`<extensionUri>/assets/`
 *   - Live2D：`live2d/<name>/*.model3.json`（文件名不硬编码，kal'tsit 的
 *     model3.json 是中文名「凯尔希直播版1.model3.json」，按后缀扫描）
 *   - 静态立绘：`personas/*.yaml`（顶层）声明的 persona，配 `personas/avatars/<id>.<img>`
 *     或 `personas/default_avatars/<规范化 id>.<img>` 的图片
 * - 用户：`<globalStorageUri>/character-library/`（§7：`<name>/*.model3.json…`
 *   或 `<name>/portrait/*.png` + `<name>.yaml`）
 *
 * 纯 fs 实现、零 vscode 运行时依赖：调用方（core-host / webview-provider）
 * 传 `vscode.Uri.fsPath` 即可；返回值中的 modelUrl/portraitUrls 为相对各自
 * 素材根的 POSIX 相对路径，由宿主解析为可加载 URL（asWebviewUri / /assets/*）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { DEFAULT_EMOTION } from '@dionysus/client-core'
import type { CharacterAsset, CharacterAssetSource } from '@dionysus/client-core'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MODEL3_SUFFIX = '.model3.json'

/** 用户素材目录名（globalStorageUri 下） */
export const USER_LIBRARY_DIRNAME = 'character-library'

export interface AssetLibraryRoots {
  /** 内嵌 assets/ 的绝对路径（extensionUri.fsPath + '/assets'） */
  builtinAssetsDir: string
  /** 用户素材目录绝对路径（globalStorageUri.fsPath + '/character-library'），可缺省 */
  userLibraryDir?: string
}

interface PersonaInfo {
  id: string
  name?: string
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** 转 POSIX 相对路径（modelUrl/portraitUrls 的存储约定） */
function toPosix(...segments: string[]): string {
  return segments.join('/')
}

/**
 * 从 persona YAML 提取顶层 `id` / `name` 两个标量。
 * 完整 persona 解析（zod 校验、段落合并）是 core persona loader 的职责（Phase 4，
 * ADR-5 一律用 yaml 库）；素材库扫描只需要这两个键用于命名与头像匹配，
 * 这里仅做单行标量提取，不解析任何嵌套结构。
 */
function extractPersonaInfo(yamlText: string, fallbackId: string): PersonaInfo {
  const info: PersonaInfo = { id: fallbackId }
  for (const line of yamlText.split('\n')) {
    const m = /^(id|name):\s*(.+?)\s*$/.exec(line)
    if (m) {
      const value = m[2].replace(/^['"]|['"]$/g, '')
      if (m[1] === 'id') info.id = value
      else info.name = value
    }
  }
  return info
}

/** `kal'tsit` → `kaltsit`：persona id 到 default_avatars 文件名的规范化 */
export function normalizePersonaId(personaId: string): string {
  return personaId.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function readPersonaInfos(personasDir: string): Promise<PersonaInfo[]> {
  const infos: PersonaInfo[] = []
  for (const entry of (await readdirSafe(personasDir)).sort()) {
    if (!entry.endsWith('.yaml')) continue
    try {
      const text = await fs.readFile(path.join(personasDir, entry), 'utf8')
      infos.push(extractPersonaInfo(text, entry.replace(/\.yaml$/, '')))
    } catch {
      // 读不到的 yaml 跳过，不阻断扫描
    }
  }
  return infos
}

function makeAssetId(personaId: string, kind: CharacterAsset['kind']): string {
  return `${personaId}:${kind}`
}

/** 扫描一个 assets 根目录（出厂或用户目录），source 决定覆盖优先级与标记 */
async function scanAssetsRoot(rootDir: string, source: CharacterAssetSource): Promise<CharacterAsset[]> {
  const assets: CharacterAsset[] = []
  const isBuiltin = source === 'builtin'

  // persona 信息（显示名 + 静态立绘的 persona 枚举）
  const personasDir = path.join(rootDir, 'personas')
  const personas = isBuiltin ? await readPersonaInfos(personasDir) : []
  const personaNames = new Map(personas.map((p) => [p.id, p.name]))

  // ── Live2D ────────────────────────────────────────────────────────────
  // 出厂：<root>/live2d/<name>/*.model3.json；用户：<root>/<name>/*.model3.json
  const live2dParents: { parentDir: string; relPrefix: string }[] = isBuiltin
    ? [{ parentDir: path.join(rootDir, 'live2d'), relPrefix: 'live2d' }]
    : [{ parentDir: rootDir, relPrefix: '' }]
  for (const { parentDir, relPrefix } of live2dParents) {
    for (const name of (await readdirSafe(parentDir)).sort()) {
      const charDir = path.join(parentDir, name)
      if (!(await isDir(charDir))) continue
      const modelFile = (await readdirSafe(charDir)).sort().find((f) => f.endsWith(MODEL3_SUFFIX))
      if (!modelFile) continue
      assets.push({
        id: makeAssetId(name, 'live2d'),
        name: personaNames.get(name) ?? name,
        personaId: name,
        kind: 'live2d',
        modelUrl: toPosix(...(relPrefix ? [relPrefix] : []), name, modelFile),
        source,
      })
    }
  }

  // ── 静态立绘 ──────────────────────────────────────────────────────────
  if (isBuiltin) {
    // 出厂：personas/*.yaml 声明的 persona × avatars/default_avatars 图片。
    // 注意：仅当 persona 有「专属」图片时才产出 static 条目；
    // avatars/_default.png 是无角色通用的 UI 兜底，不为它批量生成占位角色。
    for (const persona of personas) {
      const avatarRel = await findBuiltinAvatar(rootDir, persona.id)
      if (!avatarRel) continue
      assets.push({
        id: makeAssetId(persona.id, 'static'),
        name: persona.name ?? persona.id,
        personaId: persona.id,
        kind: 'static',
        portraitUrls: { [DEFAULT_EMOTION]: avatarRel },
        source,
      })
    }
  } else {
    // 用户：<root>/<name>/portrait/*.<img>，emotion 键 = 去扩展名的文件名；
    // 缺 default 键时用排序后的首张补 default。
    for (const name of (await readdirSafe(rootDir)).sort()) {
      const portraitDir = path.join(rootDir, name, 'portrait')
      if (!(await isDir(portraitDir))) continue
      const images = (await readdirSafe(portraitDir))
        .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
        .sort()
      if (images.length === 0) continue
      const portraitUrls: Record<string, string> = {}
      for (const file of images) {
        const emotion = path.basename(file, path.extname(file))
        portraitUrls[emotion] = toPosix(name, 'portrait', file)
      }
      if (!portraitUrls[DEFAULT_EMOTION]) portraitUrls[DEFAULT_EMOTION] = portraitUrls[Object.keys(portraitUrls).sort()[0]]
      const personaName = await readUserPersonaName(rootDir, name)
      assets.push({
        id: makeAssetId(name, 'static'),
        name: personaName ?? name,
        personaId: name,
        kind: 'static',
        portraitUrls,
        source,
      })
    }
  }

  return assets
}

async function findBuiltinAvatar(rootDir: string, personaId: string): Promise<string | undefined> {
  const candidates: string[][] = [
    ['personas', 'avatars', personaId],
    ['personas', 'default_avatars', normalizePersonaId(personaId)],
  ]
  for (const segments of candidates) {
    for (const ext of IMAGE_EXTS) {
      const rel = toPosix(...segments) + ext
      try {
        await fs.access(path.join(rootDir, ...segments) + ext)
        return rel
      } catch {
        // 尝试下一个候选
      }
    }
  }
  return undefined
}

/** 用户目录可选的 `<name>.yaml`，提取显示名 */
async function readUserPersonaName(rootDir: string, name: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(path.join(rootDir, `${name}.yaml`), 'utf8')
    return extractPersonaInfo(text, name).name
  } catch {
    return undefined
  }
}

/**
 * 扫描并合并出厂 + 用户素材。同名 id（`${personaId}:${kind}`）用户覆盖出厂。
 * 返回按 id 排序的数组；目录不存在时按空处理（用户目录默认可不存在）。
 */
export async function scanCharacterLibrary(roots: AssetLibraryRoots): Promise<CharacterAsset[]> {
  const merged = new Map<string, CharacterAsset>()
  for (const asset of await scanAssetsRoot(roots.builtinAssetsDir, 'builtin')) {
    merged.set(asset.id, asset)
  }
  if (roots.userLibraryDir) {
    for (const asset of await scanAssetsRoot(roots.userLibraryDir, 'user')) {
      merged.set(asset.id, asset)
    }
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id))
}
