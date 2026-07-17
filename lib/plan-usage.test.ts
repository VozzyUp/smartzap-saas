import { describe, it, expect, vi, beforeEach } from 'vitest'
const getTenantPlan = vi.fn()
const getUsageCounts = vi.fn()
vi.mock('@/lib/plan-limits', () => ({
  getTenantPlan: (...a: any[]) => getTenantPlan(...a),
  getUsageCounts: (...a: any[]) => getUsageCounts(...a),
}))
const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }),
}))
import { getPlanUsage } from '@/lib/plan-usage'

const PLAN = { id: 'p', slug: 'trial', name: 'Trial', price_cents: null, max_contacts: 100, max_templates: 3, max_campaigns_per_month: 2, max_whatsapp_numbers: 1 }

beforeEach(() => { getTenantPlan.mockReset(); getUsageCounts.mockReset(); maybeSingle.mockReset() })

it('monta uso vs limite por dimensão', async () => {
  getTenantPlan.mockResolvedValue(PLAN)
  getUsageCounts.mockResolvedValue({ contacts: 40, templates: 3, campaignsMonth: 1, whatsappNumbers: 1 })
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: null } })
  const r = await getPlanUsage('t1')
  expect(r.plan.slug).toBe('trial')
  expect(r.usage.contacts).toEqual({ used: 40, limit: 100 })
  expect(r.usage.templates).toEqual({ used: 3, limit: 3 })
})

it('limite null vira ilimitado', async () => {
  getTenantPlan.mockResolvedValue({ ...PLAN, slug: 'pro', name: 'Pro', max_templates: null })
  getUsageCounts.mockResolvedValue({ contacts: 5, templates: 999, campaignsMonth: 0, whatsappNumbers: 1 })
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: null } })
  const r = await getPlanUsage('t1')
  expect(r.usage.templates).toEqual({ used: 999, limit: null })
})

it('trial daysLeft calculado (futuro)', async () => {
  getTenantPlan.mockResolvedValue(PLAN)
  getUsageCounts.mockResolvedValue({ contacts: 0, templates: 0, campaignsMonth: 0, whatsappNumbers: 0 })
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60_000).toISOString()
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: future } })
  const r = await getPlanUsage('t1')
  expect(r.trial.daysLeft).toBe(3) // ceil de ~2 dias
})

it('sem trial → daysLeft null', async () => {
  getTenantPlan.mockResolvedValue(PLAN)
  getUsageCounts.mockResolvedValue({ contacts: 0, templates: 0, campaignsMonth: 0, whatsappNumbers: 0 })
  maybeSingle.mockResolvedValue({ data: { trial_ends_at: null } })
  const r = await getPlanUsage('t1')
  expect(r.trial.daysLeft).toBeNull()
})
