import { describe, expect, it } from 'vitest'

import { PLACEHOLDER_TEXT } from './index.js'

describe('@dionysus/webview placeholder', () => {
  it('exposes placeholder text', () => {
    expect(PLACEHOLDER_TEXT).toContain('placeholder')
  })
})
