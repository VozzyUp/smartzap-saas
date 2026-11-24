import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))

const upsert = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ upsert: (...a: unknown[]) => upsert(...a) }) }),
}))

import { POST } from './route'

const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'a', auth: 'b' } }
const req = (body: unknown) =>
  new Request('http://x/api/push/subscribe', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'ua' } })

beforeEach(() => {
  vi.clearAllMocks()
  upsert.mockResolvedValue({ error: null })
})

describe('POST /api/push/subscribe', () => {
  it('grava a subscription com o tenant_id do usuário logado', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1' })
    const res = await POST(req(sub))
    expect(res.status).toBe(200)
    expect(upsert.mock.calls[0][0]).toMatchObject({ tenant_id: 't1', endpoint: sub.endpoint })
  })

  it('401 sem sessão', async () => {
    getTenantContext.mockResolvedValue(null)
    const res = await POST(req(sub))
    expect(res.status).toBe(401)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('403 quando o usuário não tem tenant', async () => {
    getTenantContext.mockResolvedValue({ tenantId: null, userId: 'u1' })
    const res = await POST(req(sub))
    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('400 para subscription inválida', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1' })
    const res = await POST(req({ endpoint: 'x' }))
    expect(res.status).toBe(400)
  })
})
