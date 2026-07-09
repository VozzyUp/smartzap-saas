import { describe, it, expect, vi } from 'vitest'
const rpcCurrent = vi.fn()
const rpcAdmin = vi.fn()
const getUser = vi.fn()
vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser },
    rpc: (name: string, params?: any) =>
      name === 'current_tenant_id' ? rpcCurrent() :
      name === 'is_platform_admin' ? rpcAdmin(params) : Promise.reject(new Error('unknown rpc')),
  }),
}))

import { getTenantContext } from '@/lib/tenant-context'

describe('getTenantContext', () => {
  it('retorna null quando não há usuário', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect(await getTenantContext()).toBeNull()
  })
  it('retorna tenantId e flags quando há sessão', async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: 'u1' } }, error: null })
    rpcCurrent.mockResolvedValueOnce({ data: 't1', error: null })
    rpcAdmin.mockResolvedValueOnce({ data: false, error: null })
    const ctx = await getTenantContext()
    expect(ctx).toEqual({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false })
    expect(rpcAdmin).toHaveBeenCalledWith({ uid: 'u1' })
  })
})
