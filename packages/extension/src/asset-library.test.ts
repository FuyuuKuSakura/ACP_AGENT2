import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { normalizePersonaId, scanCharacterLibrary } from './asset-library.js'

let root: string
let builtinDir: string
let userDir: string

async function mkdirp(...segments: string[]): Promise<string> {
  const p = path.join(...segments)
  await fs.mkdir(p, { recursive: true })
  return p
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'dionysus-assets-'))
  builtinDir = await mkdirp(root, 'assets')
  userDir = path.join(root, 'character-library') // 默认不创建
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('scanCharacterLibrary — 出厂 assets/', () => {
  it('扫描 live2d/<name>/ 下任意文件名的 *.model3.json（含中文文件名）', async () => {
    const dir = await mkdirp(builtinDir, 'live2d', "kal'tsit")
    await fs.writeFile(path.join(dir, '凯尔希直播版1.model3.json'), '{}')
    await fs.writeFile(path.join(dir, '凯尔希直播版1.moc3'), '')

    const assets = await scanCharacterLibrary({ builtinAssetsDir: builtinDir })
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      id: "kal'tsit:live2d",
      personaId: "kal'tsit",
      kind: 'live2d',
      modelUrl: "live2d/kal'tsit/凯尔希直播版1.model3.json",
      source: 'builtin',
    })
  })

  it('无 model3.json 的目录不产出条目；目录缺失按空处理', async () => {
    await mkdirp(builtinDir, 'live2d', 'empty-char')
    expect(await scanCharacterLibrary({ builtinAssetsDir: builtinDir })).toEqual([])
    expect(await scanCharacterLibrary({ builtinAssetsDir: path.join(root, 'nope') })).toEqual([])
  })

  it('personas/*.yaml + default_avatars 产出 static 条目，id 经规范化匹配头像', async () => {
    await mkdirp(builtinDir, 'personas', 'default_avatars')
    await fs.writeFile(
      path.join(builtinDir, 'personas', "kal'tsit.yaml"),
      "id: kal'tsit\nname: 凯尔希\n",
    )
    await fs.writeFile(path.join(builtinDir, 'personas', 'default_avatars', 'kaltsit.png'), 'png')

    const assets = await scanCharacterLibrary({ builtinAssetsDir: builtinDir })
    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      id: "kal'tsit:static",
      name: '凯尔希',
      kind: 'static',
      portraitUrls: { default: 'personas/default_avatars/kaltsit.png' },
    })
  })

  it('avatars/<id> 优先于 default_avatars；无专属图片的 persona 不产出 static 条目', async () => {
    await mkdirp(builtinDir, 'personas', 'avatars')
    await fs.writeFile(path.join(builtinDir, 'personas', 'exusiai.yaml'), 'id: exusiai\nname: 能天使\n')
    await fs.writeFile(path.join(builtinDir, 'personas', 'no_pic.yaml'), 'id: no_pic\n')
    await fs.writeFile(path.join(builtinDir, 'personas', 'avatars', 'exusiai.png'), 'png')
    // _default.png 存在也不应为 no_pic 批量生成占位角色
    await fs.writeFile(path.join(builtinDir, 'personas', 'avatars', '_default.png'), 'png')

    const assets = await scanCharacterLibrary({ builtinAssetsDir: builtinDir })
    expect(assets.map((a) => a.id)).toEqual(['exusiai:static'])
    expect(assets[0].portraitUrls).toEqual({ default: 'personas/avatars/exusiai.png' })
  })
})

describe('scanCharacterLibrary — 用户 character-library/', () => {
  it('用户 <name>/*.model3.json 与 <name>/portrait/*.png 被识别，portrait 缺 default 时补', async () => {
    const charDir = await mkdirp(userDir, 'mychar', 'portrait')
    await fs.writeFile(path.join(userDir, 'mychar', 'my.model3.json'), '{}')
    await fs.writeFile(path.join(charDir, 'happy.png'), 'png')
    await fs.writeFile(path.join(charDir, 'angry.jpg'), 'jpg')
    await fs.writeFile(path.join(charDir, 'notes.txt'), 'not an image')
    await fs.writeFile(path.join(userDir, 'mychar.yaml'), 'id: mychar\nname: 我的角色\n')

    const assets = await scanCharacterLibrary({ builtinAssetsDir: builtinDir, userLibraryDir: userDir })
    const live2d = assets.find((a) => a.kind === 'live2d')
    const stat = assets.find((a) => a.kind === 'static')
    expect(live2d).toMatchObject({ id: 'mychar:live2d', source: 'user', modelUrl: 'mychar/my.model3.json' })
    expect(stat).toMatchObject({ id: 'mychar:static', name: '我的角色', source: 'user' })
    expect(stat?.portraitUrls?.happy).toBe('mychar/portrait/happy.png')
    expect(stat?.portraitUrls?.default).toBeDefined()
  })

  it('用户目录同名 id 覆盖出厂条目', async () => {
    const dir = await mkdirp(builtinDir, 'live2d', "kal'tsit")
    await fs.writeFile(path.join(dir, '凯尔希直播版1.model3.json'), '{}')
    const userChar = await mkdirp(userDir, "kal'tsit")
    await fs.writeFile(path.join(userChar, 'custom.model3.json'), '{}')

    const assets = await scanCharacterLibrary({ builtinAssetsDir: builtinDir, userLibraryDir: userDir })
    const kaltsit = assets.filter((a) => a.personaId === "kal'tsit")
    expect(kaltsit).toHaveLength(1)
    expect(kaltsit[0]).toMatchObject({ source: 'user', modelUrl: "kal'tsit/custom.model3.json" })
  })

  it('用户目录不存在时只返回出厂条目', async () => {
    const dir = await mkdirp(builtinDir, 'live2d', 'exusiai')
    await fs.writeFile(path.join(dir, '00.model3.json'), '{}')
    const assets = await scanCharacterLibrary({ builtinAssetsDir: builtinDir, userLibraryDir: userDir })
    expect(assets).toHaveLength(1)
    expect(assets[0].source).toBe('builtin')
  })
})

describe('normalizePersonaId', () => {
  it("kal'tsit → kaltsit", () => {
    expect(normalizePersonaId("kal'tsit")).toBe('kaltsit')
  })
})
