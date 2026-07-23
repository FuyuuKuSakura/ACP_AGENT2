import { describe, expect, it } from 'vitest'

import { activate, deactivate } from './index.js'

describe('dionysus-vscode placeholder', () => {
  it('exports activate/deactivate lifecycle hooks', () => {
    expect(typeof activate).toBe('function')
    expect(typeof deactivate).toBe('function')
  })
})
