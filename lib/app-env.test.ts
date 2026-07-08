import { describe, it, expect, afterEach } from 'vitest'
import { getAppEnv, isProduction } from '@/lib/app-env'

describe('getAppEnv', () => {
  const orig = process.env.APP_ENV
  afterEach(() => {
    if (orig === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = orig
  })

  it('usa APP_ENV quando definida', () => {
    process.env.APP_ENV = 'production'
    expect(getAppEnv()).toBe('production')
    expect(isProduction()).toBe(true)
  })

  it('cai para NODE_ENV quando APP_ENV ausente', () => {
    delete process.env.APP_ENV
    // NODE_ENV em teste normalmente é 'test' → tratado como não-produção
    expect(isProduction()).toBe(false)
  })
})
