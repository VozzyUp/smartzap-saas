import { describe, it, expect, vi, beforeEach } from 'vitest'

const { exchangeCodeForSession, provisionTenantForUser } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  provisionTenantForUser: vi.fn(),
}))

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession },
  }),
}))

vi.mock('@/lib/tenant-provisioning', () => ({
  provisionTenantForUser,
}))

import { GET } from './route'
import { NextRequest } from 'next/server'

function makeRequest(url: string) {
  return new NextRequest(url)
}

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset()
    provisionTenantForUser.mockReset()
  })

  it('redireciona para /login quando não há code', async () => {
    const res = await GET(makeRequest('https://app.example.com/api/auth/callback'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('redireciona para /login quando exchangeCodeForSession falha', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } })
    const res = await GET(makeRequest('https://app.example.com/api/auth/callback?code=abc'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
    expect(provisionTenantForUser).not.toHaveBeenCalled()
  })

  it('troca o code por sessão, provisiona tenant e redireciona para /', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'ana@empresa.com' } },
      error: null,
    })
    provisionTenantForUser.mockResolvedValueOnce({ tenantId: 't1', created: true })

    const res = await GET(makeRequest('https://app.example.com/api/auth/callback?code=abc'))

    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc')
    expect(provisionTenantForUser).toHaveBeenCalledWith('u1', 'ana@empresa.com')
    expect(res.status).toBe(307)
    const location = res.headers.get('location')
    expect(location).toBe('https://app.example.com/')
  })
})
