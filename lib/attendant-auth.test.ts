import { describe, it, expect, vi, beforeEach } from 'vitest'

const selectFn = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      if (t !== 'attendant_tokens') throw new Error(`unexpected table ${t}`)
      return { select: () => ({ eq: () => ({ maybeSingle: selectFn }) }) }
    },
  }),
}))

import { resolveTenantByAttendantToken } from '@/lib/attendant-auth'

describe('resolveTenantByAttendantToken', () => {
  beforeEach(() => selectFn.mockReset())

  it('retorna null para token nulo/vazio (sem ir ao banco)', async () => {
    expect(await resolveTenantByAttendantToken(null)).toBeNull()
    expect(await resolveTenantByAttendantToken('')).toBeNull()
    expect(selectFn).not.toHaveBeenCalled()
  })

  it('retorna tenant_id para token ativo sem expiração', async () => {
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: true, expires_at: null }, error: null })
    expect(await resolveTenantByAttendantToken('tok_valid')).toBe('t1')
  })

  it('retorna tenant_id para token ativo com expiração no futuro', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: true, expires_at: future }, error: null })
    expect(await resolveTenantByAttendantToken('tok_valid')).toBe('t1')
  })

  it('retorna null para token inativo', async () => {
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: false, expires_at: null }, error: null })
    expect(await resolveTenantByAttendantToken('tok_inactive')).toBeNull()
  })

  it('retorna null para token expirado', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString()
    selectFn.mockResolvedValueOnce({ data: { tenant_id: 't1', is_active: true, expires_at: past }, error: null })
    expect(await resolveTenantByAttendantToken('tok_expired')).toBeNull()
  })

  it('retorna null para token inexistente', async () => {
    selectFn.mockResolvedValueOnce({ data: null, error: null })
    expect(await resolveTenantByAttendantToken('tok_none')).toBeNull()
  })
})
