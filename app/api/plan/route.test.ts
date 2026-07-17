import { describe, it, expect, vi, beforeEach } from 'vitest'
const getTenantContext = vi.fn()
const getPlanUsage = vi.fn()
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => getTenantContext() }))
vi.mock('@/lib/plan-usage', () => ({ getPlanUsage: (...a: any[]) => getPlanUsage(...a) }))
import { GET } from './route'

beforeEach(() => { getTenantContext.mockReset(); getPlanUsage.mockReset() })

it('sem sessão → 401', async () => {
  getTenantContext.mockResolvedValue(null)
  const res = await GET()
  expect(res.status).toBe(401)
})
it('com tenant → 200 com uso', async () => {
  getTenantContext.mockResolvedValue({ tenantId: 't1', isPlatformAdmin: false })
  getPlanUsage.mockResolvedValue({ plan: { slug: 'trial' }, usage: {}, trial: {} })
  const res = await GET()
  expect(res.status).toBe(200)
  expect((await res.json()).plan.slug).toBe('trial')
})
