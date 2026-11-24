import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const ctxMock = vi.fn(async () => ({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false }) as any)
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => ctxMock() }))
const getMock = vi.fn()
const setMock = vi.fn(async () => {})
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: { get: (...a: any[]) => getMock(...a), set: (...a: any[]) => setMock(...a) },
}))

import { GET, POST } from './route'

const post = (body: unknown) =>
  POST(new NextRequest('http://x/api/settings/campaign-daily-limit', { method: 'POST', body: JSON.stringify(body) }))

describe('/api/settings/campaign-daily-limit', () => {
  beforeEach(() => {
    getMock.mockReset()
    setMock.mockClear()
    ctxMock.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false })
  })

  it('GET sem sessão: 401', async () => {
    ctxMock.mockResolvedValueOnce(null)
    expect((await GET()).status).toBe(401)
  })

  it('GET devolve 0 quando não configurado, filtrando pelo tenant', async () => {
    getMock.mockResolvedValue(null)
    const res = await GET()
    expect(await res.json()).toEqual({ ok: true, limit: 0 })
    expect(getMock).toHaveBeenCalledWith('t1', 'campaign_daily_limit')
  })

  it('GET devolve o limite salvo', async () => {
    getMock.mockResolvedValue('25')
    expect(await (await GET()).json()).toEqual({ ok: true, limit: 25 })
  })

  it('POST salva inteiro positivo no tenant da sessão', async () => {
    const res = await post({ limit: 30 })
    expect(res.status).toBe(200)
    expect(setMock).toHaveBeenCalledWith('t1', 'campaign_daily_limit', '30')
    expect(await res.json()).toEqual({ ok: true, limit: 30 })
  })

  it('POST 0 ou vazio desliga o limite', async () => {
    await post({ limit: 0 })
    expect(setMock).toHaveBeenCalledWith('t1', 'campaign_daily_limit', '0')
  })

  it('POST valor inválido: 422 e não grava', async () => {
    const res = await post({ limit: 'abc' })
    expect(res.status).toBe(422)
    expect(setMock).not.toHaveBeenCalled()
    expect((await post({ limit: -3 })).status).toBe(422)
    expect((await post({ limit: 2_000_000 })).status).toBe(422)
  })

  it('POST sem sessão: 401', async () => {
    ctxMock.mockResolvedValueOnce(null)
    expect((await post({ limit: 5 })).status).toBe(401)
    expect(setMock).not.toHaveBeenCalled()
  })
})
