import { describe, expect, it } from 'vitest'

import { DEFAULT_EMOTION, resolvePortraitUrl } from './character.js'
import type { CharacterAsset, DisplayMode } from './character.js'

describe('character 共享类型', () => {
  it('CharacterAsset 形状可表达 live2d 与 static 两种形态', () => {
    const live2d: CharacterAsset = {
      id: "kal'tsit:live2d",
      name: '凯尔希',
      personaId: "kal'tsit",
      kind: 'live2d',
      modelUrl: "live2d/kal'tsit/model.model3.json",
      source: 'builtin',
    }
    const stat: CharacterAsset = {
      id: 'kaltsit:static',
      name: '凯尔希',
      personaId: "kal'tsit",
      kind: 'static',
      portraitUrls: { [DEFAULT_EMOTION]: 'personas/default_avatars/kaltsit.png' },
      source: 'builtin',
    }
    const mode: DisplayMode = 'static'
    expect(live2d.modelUrl).toContain('.model3.json')
    expect(stat.portraitUrls?.[DEFAULT_EMOTION]).toContain('kaltsit')
    expect(mode).toBe('static')
  })

  it('resolvePortraitUrl 优先精确命中 emotion', () => {
    const urls = { default: 'a.png', happy: 'b.png' }
    expect(resolvePortraitUrl(urls, 'happy')).toBe('b.png')
  })

  it('resolvePortraitUrl 未知 emotion 回退 default，缺 default 回退排序首键', () => {
    expect(resolvePortraitUrl({ default: 'a.png', happy: 'b.png' }, 'sad')).toBe('a.png')
    expect(resolvePortraitUrl({ happy: 'b.png', angry: 'c.png' }, 'sad')).toBe('c.png')
  })

  it('resolvePortraitUrl 空输入返回 undefined', () => {
    expect(resolvePortraitUrl(undefined, 'happy')).toBeUndefined()
    expect(resolvePortraitUrl({}, 'happy')).toBeUndefined()
  })
})
