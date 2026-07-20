import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTenantContext: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  range: vi.fn(),
}))

vi.mock('@/lib/tenant-context', () => ({ getTenantContext: mocks.getTenantContext }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))

import { GET } from './route'

describe('GET /api/submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const query: any = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      ilike: vi.fn(() => query),
      eq: mocks.eq,
      range: mocks.range,
    }
    mocks.from.mockReturnValue(query)
    mocks.eq.mockReturnValue(query)
    mocks.range.mockResolvedValue({ data: [], count: 0, error: null })
  })

  it('recusa listagem sem um tenant autenticado', async () => {
    mocks.getTenantContext.mockResolvedValue(null)

    const response = await GET(new Request('http://localhost/api/submissions'))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('limita as submissões ao tenant autenticado', async () => {
    mocks.getTenantContext.mockResolvedValue({ tenantId: 'tenant-a' })

    const response = await GET(new Request('http://localhost/api/submissions'))

    expect(response.status).toBe(200)
    expect(mocks.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a')
  })
})
