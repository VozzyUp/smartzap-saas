import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const requireMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({ requirePlatformAdmin: () => requireMock() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({}) }))

import { GET, PATCH } from './route'

const params = Promise.resolve({ id: 't1' })
const patchReq = (body: unknown) => ({ json: async () => body }) as any

const forbidden = { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
const admin = { ok: true, ctx: {} }

describe('admin/tenants/[id] gate + validação', () => {
  beforeEach(() => requireMock.mockReset())

  it('GET não-admin → 403', async () => {
    requireMock.mockResolvedValue(forbidden)
    const res = await GET({} as any, { params })
    expect(res.status).toBe(403)
  })

  it('PATCH não-admin → 403', async () => {
    requireMock.mockResolvedValue(forbidden)
    const res = await PATCH(patchReq({ status: 'suspended' }), { params })
    expect(res.status).toBe(403)
  })

  it('PATCH status inválido → 400', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await PATCH(patchReq({ status: 'banido' }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_status')
  })

  it('PATCH sem campos → 400 nothing_to_update', async () => {
    requireMock.mockResolvedValue(admin)
    const res = await PATCH(patchReq({}), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('nothing_to_update')
  })
})
