import { describe, expect, it } from 'vitest'

import { CORE_PACKAGE } from './index.js'

describe('@dionysus/core placeholder', () => {
  it('exposes its package name', () => {
    expect(CORE_PACKAGE).toBe('@dionysus/core')
  })
})
