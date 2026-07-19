import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTenantContext: vi.fn(),
  insert: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
}))
const { getTenantContext, insert, limit, select, from } = mocks

vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => mocks.getTenantContext() }))

select.mockImplementation(() => ({ limit }))
from.mockImplementation(() => ({
  insert: (row: unknown) => {
    insert(row)
    return { select }
  },
  select,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { set: vi.fn() } }))
vi.mock('@/lib/flow-templates', () => ({ getFlowTemplateByKey: vi.fn(() => null) }))

import { POST } from './route'

describe('POST /api/flows', () => {
  beforeEach(() => {
    getTenantContext.mockReset()
    insert.mockReset()
    limit.mockReset()
    getTenantContext.mockResolvedValue({ tenantId: 'tenant-1' })
    limit.mockResolvedValue({
      data: [{ id: 'fl_1', name: 'Meu MiniApp', status: 'DRAFT', spec: {}, created_at: '2026-07-18T00:00:00.000Z' }],
      error: null,
    })
  })

  it('associa o MiniApp ao tenant autenticado', async () => {
    const response = await POST(new Request('http://localhost/api/flows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Meu MiniApp' }),
    }))

    expect(response.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant-1', name: 'Meu MiniApp' }))
  })

  it('rejeita usuário sem tenant', async () => {
    getTenantContext.mockResolvedValue(null)
    const response = await POST(new Request('http://localhost/api/flows', {
      method: 'POST',
      body: JSON.stringify({ name: 'Meu MiniApp' }),
    }))
    expect(response.status).toBe(401)
  })
})
