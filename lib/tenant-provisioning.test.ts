import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertTenant = vi.fn()
const insertMember = vi.fn()
const selectMember = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: selectMember }) }),
      insert: (row: any) => ({
        select: () => ({
          single: () => (t === 'tenants' ? insertTenant(row) : insertMember(row)),
        }),
      }),
    }),
  }),
}))

import { provisionTenantForUser } from '@/lib/tenant-provisioning'

describe('provisionTenantForUser', () => {
  beforeEach(() => {
    insertTenant.mockReset(); insertMember.mockReset(); selectMember.mockReset()
  })

  it('retorna o tenant existente se o usuário já é membro', async () => {
    selectMember.mockResolvedValueOnce({ data: { tenant_id: 't1' }, error: null })
    const r = await provisionTenantForUser('u1', 'a@b.com')
    expect(r).toEqual({ tenantId: 't1', created: false })
    expect(insertTenant).not.toHaveBeenCalled()
  })

  it('cria tenant e membership no 1º login', async () => {
    selectMember.mockResolvedValueOnce({ data: null, error: null })
    insertTenant.mockResolvedValueOnce({ data: { id: 'new-t' }, error: null })
    insertMember.mockResolvedValueOnce({ data: null, error: null })
    const r = await provisionTenantForUser('u1', 'ana@empresa.com')
    expect(r.created).toBe(true)
    expect(r.tenantId).toBe('new-t')
  })

  it('grava trial_ends_at ~3 dias no futuro ao criar tenant novo', async () => {
    const before = Date.now() + 3 * 24 * 60 * 60 * 1000 - 5000
    const after = Date.now() + 3 * 24 * 60 * 60 * 1000 + 5000
    selectMember.mockResolvedValueOnce({ data: null, error: null })
    insertTenant.mockResolvedValueOnce({ data: { id: 'new-t' }, error: null })
    insertMember.mockResolvedValueOnce({ data: null, error: null })
    await provisionTenantForUser('u-novo', 'novo@empresa.com')
    const payload = insertTenant.mock.calls[0][0]
    expect(payload.trial_ends_at).toBeDefined()
    const ts = new Date(payload.trial_ends_at).getTime()
    expect(ts).toBeGreaterThan(before)
    expect(ts).toBeLessThan(after)
  })
})
