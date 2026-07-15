import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))

const orderMock = vi.fn(async () => ({ data: [{ id: 'p1', name: 'Trial', sort_order: 0 }], error: null }))
const selectMock = vi.fn(() => ({ order: orderMock }))
const fromMock = vi.fn(() => ({ select: selectMock }))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: fromMock }) }))

import { GET } from './route'

describe('GET /api/admin/plans', () => {
  beforeEach(() => {
    getTenantContext.mockReset()
    orderMock.mockClear()
    selectMock.mockClear()
    fromMock.mockClear()
  })

  it('não-admin → 403', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false, trialExpired: false, suspended: false })
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('admin → 200 com lista de planos', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: true, trialExpired: false, suspended: false })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.plans).toEqual([{ id: 'p1', name: 'Trial', sort_order: 0 }])
  })
})
