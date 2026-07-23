/**
 * core-host 角色素材库 / persona voice 客制化处理器单测（纯 node，假 webview）：
 * - persona_list_request：loader 枚举 + voice 段 + touchZones + 头像路径；
 * - persona_update_request：runtime YAML 只写 diff 键、写后可被 loader 深合并解析；
 * - voice_preview_request：TemplateRewriter 改写 + voice 增量试听未保存编辑；
 * - character_list_request：素材扫描 + per-device 展示模式 + 默认角色设置值；
 * - settings_update_request：白名单键校验 + 宿主写入器注入。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ClientMessage, ServerMessage } from '@dionysus/protocol'

import { makeTestHost, FakeWebview, type TestHostContext } from './test-utils.js'

/** makeTestHost 的 assetsDir 默认值（fixture persona 写到这里即为 builtin 来源）。 */
function builtinPersonasDir(ctx: TestHostContext): string {
  return join(ctx.storageDir, 'no-such-assets', 'personas', 'builtin')
}

const FIXTURE_YAML = `id: test_char
name: 测试角色
description: 处理器测试用角色。
tone_rules:
  keyword_replacements:
    您: 博士
voice:
  tone: 冷淡
  catchphrases:
    - ……嗯。
  taboos:
    - 禁词
  examples:
    - plain: 任务完成。
      styled: 任务完成，博士。
  rewriter_prompt: '请以「{tone}」的语气改写。'
companion:
  touch_zones:
    head:
      expression: 惊讶
      lines:
        - 博士，有事吗？
`

async function seedBuiltinPersona(ctx: TestHostContext): Promise<void> {
  await mkdir(builtinPersonasDir(ctx), { recursive: true })
  await writeFile(join(builtinPersonasDir(ctx), 'test_char.yaml'), FIXTURE_YAML, 'utf8')
}

function msg<T extends ClientMessage['type']>(
  type: T,
  payload: Extract<ClientMessage, { type: T }>['payload'],
  traceId = 't-1',
): ClientMessage {
  return { v: 1, type, traceId, ts: Date.now(), payload } as ClientMessage
}

function ofType<T extends ServerMessage['type']>(
  received: ServerMessage[],
  type: T,
): Extract<ServerMessage, { type: T }>[] {
  return received.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
}

describe('core-host 素材库 / voice 客制化处理器', () => {
  let ctx: TestHostContext | null = null
  let received: ServerMessage[] = []
  const CLIENT = 'settings-client'

  afterEach(async () => {
    await ctx?.cleanup()
    ctx = null
    received = []
  })

  async function setup(): Promise<TestHostContext> {
    ctx = await makeTestHost()
    ctx.host.hub.registerClient(CLIENT, (m) => received.push(m))
    await seedBuiltinPersona(ctx)
    return ctx
  }

  it('persona_list_request → persona 摘要（voice 五字段 + touchZones + description）', async () => {
    ctx = await setup()
    await ctx.host.handleClientMessage(CLIENT, msg('persona_list_request', {}))

    const res = ofType(received, 'persona_list_response')
    expect(res).toHaveLength(1)
    expect(res[0].traceId).toBe('t-1')
    const persona = res[0].payload.personas.find((p) => p.id === 'test_char')
    expect(persona).toBeDefined()
    expect(persona!.name).toBe('测试角色')
    expect(persona!.description).toBe('处理器测试用角色。')
    expect(persona!.voice.tone).toBe('冷淡')
    expect(persona!.voice.catchphrases).toEqual(['……嗯。'])
    expect(persona!.voice.taboos).toEqual(['禁词'])
    expect(persona!.voice.examples).toEqual([{ plain: '任务完成。', styled: '任务完成，博士。' }])
    expect(persona!.voice.rewriterPrompt).toBe('请以「{tone}」的语气改写。')
    expect(persona!.touchZones.head).toEqual({ expression: '惊讶', lines: ['博士，有事吗？'] })
  })

  it('persona_update_request → runtime YAML 只写 diff 键，loader 深合并后生效', async () => {
    ctx = await setup()
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('persona_update_request', {
        personaId: 'test_char',
        voice: { tone: '热情', catchphrases: ['好耶'] },
      }),
    )

    expect(ofType(received, 'persona_update_response')[0].payload).toEqual({ personaId: 'test_char', ok: true })

    // runtime YAML 落点 = loader 的 runtimeDir（character-library/<id>.yaml），只含 diff 键
    const runtimePath = join(ctx.storageDir, 'character-library', 'test_char.yaml')
    const runtimeText = await readFile(runtimePath, 'utf8')
    expect(runtimeText).toContain('tone: 热情')
    expect(runtimeText).toContain('好耶')
    // builtin 已有 id/name/description/taboos，runtime 不回写（避免屏蔽 builtin，§5.4 合并规则）
    expect(runtimeText).not.toContain('测试角色')
    expect(runtimeText).not.toContain('禁词')

    // 深合并生效：list 反映新 tone，同时保留 builtin 的 taboos
    received = []
    await ctx.host.handleClientMessage(CLIENT, msg('persona_list_request', {}))
    const persona = ofType(received, 'persona_list_response')[0].payload.personas.find((p) => p.id === 'test_char')
    expect(persona!.voice.tone).toBe('热情')
    expect(persona!.voice.catchphrases).toEqual(['好耶'])
    expect(persona!.voice.taboos).toEqual(['禁词']) // builtin 键未被屏蔽
    expect(persona!.name).toBe('测试角色')
  })

  it('persona_update_request 支持 name/description 更新与自创角色（补 id/name）', async () => {
    ctx = await setup()
    // 自创角色：builtin 不存在，runtime 文件必须自带 id/name（personaFileSchema 必填）
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('persona_update_request', { personaId: 'my_new_char', name: '新角色', voice: { tone: '元气' } }),
    )
    expect(ofType(received, 'persona_update_response')[0].payload.ok).toBe(true)

    const runtimeText = await readFile(join(ctx.storageDir, 'character-library', 'my_new_char.yaml'), 'utf8')
    expect(runtimeText).toContain('id: my_new_char')
    expect(runtimeText).toContain('name: 新角色')

    received = []
    await ctx.host.handleClientMessage(CLIENT, msg('persona_list_request', {}))
    const created = ofType(received, 'persona_list_response')[0].payload.personas.find((p) => p.id === 'my_new_char')
    expect(created).toBeDefined()
    expect(created!.name).toBe('新角色')
    expect(created!.voice.tone).toBe('元气')
  })

  it('persona_update_request 拒绝路径穿越 personaId', async () => {
    ctx = await setup()
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('persona_update_request', { personaId: '../evil', voice: { tone: 'x' } }),
    )
    const res = ofType(received, 'persona_update_response')[0]
    expect(res.payload.ok).toBe(false)
    expect(res.payload.error).toContain('非法 personaId')
  })

  it('voice_preview_request → TemplateRewriter 改写；voice 增量试听未保存编辑', async () => {
    ctx = await setup()
    // keyword_replacements 确定性改写：您 → 博士
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('voice_preview_request', { personaId: 'test_char', text: '您好的' }),
    )
    const res = ofType(received, 'voice_preview_response')[0]
    expect(res.payload.original).toBe('您好的')
    expect(res.payload.rewritten).toContain('博士')

    // voice 增量：taboos 覆盖后改写结果立即剔除（试听未保存的表单编辑）
    received = []
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('voice_preview_request', { personaId: 'test_char', text: '您好的', voice: { taboos: ['博士'] } }),
    )
    const res2 = ofType(received, 'voice_preview_response')[0]
    expect(res2.payload.rewritten).not.toContain('博士')
  })

  it('voice_preview_request 对不存在的 persona 回 error 字段', async () => {
    ctx = await setup()
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('voice_preview_request', { personaId: 'no_such', text: 'x' }),
    )
    const res = ofType(received, 'voice_preview_response')[0]
    expect(res.payload.rewritten).toBe('')
    expect(res.payload.error).toBeDefined()
  })

  it('character_list_request → 素材条目 + per-device 展示模式 + 默认角色设置值', async () => {
    ctx = await makeTestHost({
      settings: {
        'persona.default': 'test_char',
        'character.display.mobile': 'live2d',
      },
    })
    ctx.host.hub.registerClient(CLIENT, (m) => received.push(m))

    await ctx.host.handleClientMessage(CLIENT, msg('character_list_request', {}))
    const res = ofType(received, 'character_list_response')[0]
    expect(res.traceId).toBe('t-1')
    expect(res.payload.characters).toEqual([]) // 无素材目录时按空处理
    expect(res.payload.display).toEqual({ desktop: 'live2d', mobile: 'live2d' })
    expect(res.payload.defaultPersonaId).toBe('test_char')
  })

  it("默认 persona 探测：persona.default 为空时优先 kal'tsit，配置非空时配置胜出", async () => {
    // 无素材 → 中立默认
    ctx = await makeTestHost()
    expect(ctx.host.defaultPersonaId).toBe('default')

    // 有素材的目录上装配：kal'tsit 优先于扫描序首个（aaa 字母序在前）
    const { createCoreHost } = await import('./core-host.js')
    const { createConfigService } = await import('./config.js')
    const assetsDir = join(ctx.storageDir, 'no-such-assets')
    for (const id of ['aaa', "kal'tsit"]) {
      await mkdir(join(assetsDir, 'live2d', id), { recursive: true })
      await writeFile(join(assetsDir, 'live2d', id, 'm.model3.json'), '{}', 'utf8')
    }
    const host2 = await createCoreHost({
      storageDir: ctx.storageDir,
      assetsDir,
      configService: createConfigService({ get: () => undefined }),
      detections: [],
    })
    expect(host2.defaultPersonaId).toBe("kal'tsit")
    host2.dispose()

    // 配置非空时配置胜出（覆盖 kal'tsit 探测）
    const host3 = await createCoreHost({
      storageDir: ctx.storageDir,
      assetsDir,
      configService: createConfigService({
        get: <T,>(key: string) => (key === 'persona.default' ? ('aaa' as T) : undefined),
      }),
      detections: [],
    })
    expect(host3.defaultPersonaId).toBe('aaa')
    host3.dispose()
  })

  it('uriResolver 注入后 persona_list/character_list 响应携带解析后的素材 URL（per-clientId）', async () => {
    ctx = await setup()
    const assetsDir = join(ctx.storageDir, 'no-such-assets')
    const userLibraryDir = join(ctx.storageDir, 'character-library')

    // builtin live2d 素材：<assetsDir>/live2d/live_char/*.model3.json
    await mkdir(join(assetsDir, 'live2d', 'live_char'), { recursive: true })
    await writeFile(join(assetsDir, 'live2d', 'live_char', 'live_char.model3.json'), '{}', 'utf8')
    // 用户目录 static 素材：character-library/live_char/portrait/*.png
    await mkdir(join(userLibraryDir, 'live_char', 'portrait'), { recursive: true })
    await writeFile(join(userLibraryDir, 'live_char', 'portrait', 'happy.png'), 'png', 'utf8')
    // persona（builtin）：companion.live2d 段（蛇形键，含显式动作清单）
    await writeFile(
      join(builtinPersonasDir(ctx), 'live_char.yaml'),
      `id: live_char
name: 素材角色
description: 带 live2d 与立绘素材的角色。
companion:
  live2d:
    default_expression: 原皮
    expressions:
      happy: 微笑
    motions:
      idle: 待机
    scale: 0.5
    motion_files:
      - name: 待机
        file: 待机.motion3.json
  touch_zones:
    head:
      lines:
        - 别碰。
`,
      'utf8',
    )

    // 带 resolver 的客户端：FakeWebview 经 attachWebview 注入
    const webview = new FakeWebview()
    const attachment = ctx.host.attachWebview(CLIENT, webview, {
      uriResolver: (absPath) => `webview://resolved${absPath}`,
    })

    await ctx.host.handleClientMessage(CLIENT, msg('persona_list_request', {}))
    const persona = webview
      .ofType('persona_list_response')[0]
      .payload.personas.find((p) => p.id === 'live_char')
    expect(persona).toBeDefined()
    expect(persona!.modelUrl).toBe(
      `webview://resolved${join(assetsDir, 'live2d', 'live_char', 'live_char.model3.json')}`,
    )
    expect(persona!.portraitUrls).toEqual({
      default: `webview://resolved${join(userLibraryDir, 'live_char', 'portrait', 'happy.png')}`,
      happy: `webview://resolved${join(userLibraryDir, 'live_char', 'portrait', 'happy.png')}`,
    })
    // live2d 段蛇形键 → camelCase 透传；model_path 键以素材扫描结果为准（此处未声明）
    expect(persona!.live2d).toEqual({
      expressions: { happy: '微笑' },
      motions: { idle: '待机' },
      defaultExpression: '原皮',
      scale: 0.5,
      motionFiles: [{ name: '待机', file: '待机.motion3.json' }],
    })
    expect(persona!.touchZones.head).toEqual({ lines: ['别碰。'] })

    // character_list 同样经 resolver 补 modelUrl
    await ctx.host.handleClientMessage(CLIENT, msg('character_list_request', {}))
    const live2dEntry = webview
      .ofType('character_list_response')[0]
      .payload.characters.find((c) => c.id === 'live_char:live2d')
    expect(live2dEntry!.modelUrl).toBe(persona!.modelUrl)

    // 未注入 resolver 的客户端：保持 Wave2-B 行为，响应不带 URL 字段
    ctx.host.hub.registerClient('no-resolver-client', (m) => received.push(m))
    await ctx.host.handleClientMessage('no-resolver-client', msg('persona_list_request', {}))
    const plain = ofType(received, 'persona_list_response')[0].payload.personas.find(
      (p) => p.id === 'live_char',
    )
    expect(plain).toBeDefined()
    expect(plain!.modelUrl).toBeUndefined()
    expect(plain!.portraitUrls).toBeUndefined()
    // live2d 段与 URL 解析无关，照常透传
    expect(plain!.live2d?.defaultExpression).toBe('原皮')

    // dispose 后 resolver 注销：同 clientId 重绑不带 resolver 即回落
    attachment.dispose()
  })

  it('settings_update_request：未注入写入器回 ok=false；注入后写值并校验展示模式取值', async () => {
    ctx = await setup()
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('settings_update_request', { key: 'character.display.desktop', value: 'static' }),
    )
    expect(ofType(received, 'settings_update_response')[0].payload.ok).toBe(false)

    const writes: Array<{ key: string; value: string }> = []
    ctx.host.setSettingsWriter(async (key, value) => {
      writes.push({ key, value })
    })

    received = []
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('settings_update_request', { key: 'character.display.desktop', value: 'static' }),
    )
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('settings_update_request', { key: 'persona.default', value: 'test_char' }),
    )
    const responses = ofType(received, 'settings_update_response')
    expect(responses.map((r) => r.payload.ok)).toEqual([true, true])
    expect(writes).toEqual([
      { key: 'character.display.desktop', value: 'static' },
      { key: 'persona.default', value: 'test_char' },
    ])

    // 展示模式键只接受 live2d/static
    received = []
    await ctx.host.handleClientMessage(
      CLIENT,
      msg('settings_update_request', { key: 'character.display.mobile', value: '3d' }),
    )
    expect(ofType(received, 'settings_update_response')[0].payload.ok).toBe(false)
  })
})
