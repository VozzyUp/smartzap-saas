import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))

const orderMock = vi.fn(async () => ({ data: [{ id: 'p1', name: 'Trial', sort_order: 0 }], error: null }))
const selectMock = vi.fn(() => ({ order: orderMock }))
const insertSingleMock = vi.fn(async () => ({ data: { id: 'p2', name: 'Empresarial', slug: 'empresarial' }, error: null }))
const insertMock = vi.fn(() => ({ select: () => ({ single: insertSingleMock }) }))
const fromMock = vi.fn(() => ({ select: selectMock, insert: insertMock }))
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({ from: fromMock }) }))

import { GET, POST } from './route'

describe('GET /api/admin/plans', () => {
  beforeEach(() => {
    getTenantContext.mockReset()
    orderMock.mockClear()
    selectMock.mockClear()
    fromMock.mockClear()
    insertMock.mockClear()
    insertSingleMock.mockClear()
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

  it('admin cria plano com slug derivado do nome', async () => {
    getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: true, trialExpired: false, suspended: false })
    const req = { json: async () => ({ name: 'Empresarial' }) } as Request
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Empresarial', slug: 'empresarial' }))
  })
})
