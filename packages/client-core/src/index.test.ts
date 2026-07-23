import { describe, expect, it } from 'vitest'

import { CLIENT_CORE_PACKAGE } from './index.js'

describe('@dionysus/client-core placeholder', () => {
  it('exposes its package name', () => {
    expect(CLIENT_CORE_PACKAGE).toBe('@dionysus/client-core')
  })
})
