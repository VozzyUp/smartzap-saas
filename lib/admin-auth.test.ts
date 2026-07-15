import { describe, it, expect, vi, beforeEach } from 'vitest'
const getTenantContext = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))
import { requirePlatformAdmin } from '@/lib/admin-auth'

beforeEach(() => getTenantContext.mockReset())

it('admin passa', async () => {
  getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: true, trialExpired: false, suspended: false })
  const r = await requirePlatformAdmin()
  expect(r.ok).toBe(true)
})
it('não-admin → 403', async () => {
  getTenantContext.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false, trialExpired: false, suspended: false })
  const r = await requirePlatformAdmin()
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.response.status).toBe(403)
})
it('sem contexto → 403', async () => {
  getTenantContext.mockResolvedValue(null)
  const r = await requirePlatformAdmin()
  expect(r.ok).toBe(false)
})
