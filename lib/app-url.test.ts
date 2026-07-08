import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAppUrl } from '@/lib/app-url'

describe('getAppUrl', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL
  beforeEach(() => { delete process.env.NEXT_PUBLIC_APP_URL })
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL
    else process.env.NEXT_PUBLIC_APP_URL = original
  })

  it('usa NEXT_PUBLIC_APP_URL quando definida', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vozzyup.com.br'
    expect(getAppUrl()).toBe('https://app.vozzyup.com.br')
  })

  it('remove barra final', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vozzyup.com.br/'
    expect(getAppUrl()).toBe('https://app.vozzyup.com.br')
  })

  it('usa o fallbackOrigin quando a env não está setada', () => {
    expect(getAppUrl('https://tunnel.example.com')).toBe('https://tunnel.example.com')
  })

  it('prioriza a env sobre o fallbackOrigin', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.vozzyup.com.br'
    expect(getAppUrl('https://tunnel.example.com')).toBe('https://app.vozzyup.com.br')
  })

  it('cai para localhost quando nada está definido', () => {
    expect(getAppUrl()).toBe('http://localhost:3000')
  })
})
