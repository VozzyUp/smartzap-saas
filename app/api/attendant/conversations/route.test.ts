import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const resolveMock = vi.fn()
vi.mock('@/lib/attendant-auth', () => ({ resolveTenantByAttendantToken: (...a: any[]) => resolveMock(...a) }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }),
}))

import { GET } from './route'

describe('attendant/conversations — gate de token', () => {
  it('401 sem token válido', async () => {
    resolveMock.mockResolvedValueOnce(null)
    const res = await GET(new NextRequest('http://localhost/api/attendant/conversations'))
    expect(res.status).toBe(401)
  })

  it('200 com token válido, filtra por tenant_id', async () => {
    resolveMock.mockResolvedValueOnce('tenant-123')
    const res = await GET(new NextRequest('http://localhost/api/attendant/conversations?token=abc'))
    expect(res.status).toBe(200)
    expect(resolveMock).toHaveBeenCalledWith('abc')
  })
})
