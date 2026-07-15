import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const requireMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({ requirePlatformAdmin: () => requireMock() }))

// db.from('plans').update(x).eq().select().maybeSingle() → devolve o plano atualizado
const maybeSingle = vi.fn(async () => ({ data: { id: 'p1', max_contacts: 999 }, error: null }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ update: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) }),
  }),
}))

import { PATCH } from './route'

const params = Promise.resolve({ id: 'p1' })
const req = (body: unknown) => ({ json: async () => body }) as any

const forbidden = { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
const admin = { ok: true, ctx: {} }

describe('admin/plans/[id] PATCH gate + validação', () => {
  beforeEach(() => requireMock.mockReset())

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
})
