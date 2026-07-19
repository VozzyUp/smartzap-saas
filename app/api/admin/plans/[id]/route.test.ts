import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const requireMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({ requirePlatformAdmin: () => requireMock() }))

// db.from('plans').update(x).eq().select().maybeSingle() → devolve o plano atualizado
const maybeSingle = vi.fn(async () => ({ data: { id: 'p1', max_contacts: 999 }, error: null }))
const tenantCount = vi.fn(async () => ({ count: 0, error: null }))
const deleteMaybeSingle = vi.fn(async () => ({ data: { id: 'p1' }, error: null }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'tenants') return { select: () => ({ eq: tenantCount }) }
      return {
        update: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }),
        delete: () => ({ eq: () => ({ select: () => ({ maybeSingle: deleteMaybeSingle }) }) }),
      }
    },
  }),
}))

import { DELETE, PATCH } from './route'

const params = Promise.resolve({ id: 'p1' })
const req = (body: unknown) => ({ json: async () => body }) as any

const forbidden = { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
const admin = { ok: true, ctx: {} }

describe('admin/plans/[id] PATCH gate + validação', () => {
  beforeEach(() => {
    requireMock.mockReset()
    tenantCount.mockReset()
    deleteMaybeSingle.mockReset()
    tenantCount.mockResolvedValue({ count: 0, error: null })
    deleteMaybeSingle.mockResolvedValue({ data: { id: 'p1' }, error: null })
  })

  it('não-admin → 403', async () => {
    requireMock.mockResolvedValue(forbidden)
    const res = await PATCH(req({ max_contacts: 100 }), { params })
    expect(res.status).toBe(403)
  })

  it('valor não-inteiro → 400', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await PATCH(req({ max_contacts: 'muitos' }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_max_contacts')
  })

  it('negativo → 400', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await PATCH(req({ max_templates: -5 }), { params })
    expect(res.status).toBe(400)
  })

  it('sem campos válidos → 400 nothing_to_update', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await PATCH(req({}), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('nothing_to_update')
  })

  it('null (ilimitado) e inteiro válido → 200', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await PATCH(req({ max_templates: null, max_contacts: 5000 }), { params })
    expect(res.status).toBe(200)
  })

  it('blocks deletion while tenants still use the plan', async () => {
    requireMock.mockResolvedValue(admin)
    tenantCount.mockResolvedValueOnce({ count: 2, error: null })
    const res = await DELETE(new Request('http://localhost'), { params })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'plan_in_use', tenants: 2 })
  })

  it('deletes a plan without tenants', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await DELETE(new Request('http://localhost'), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
  })
})
