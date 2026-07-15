import { describe, it, expect, vi, beforeEach } from 'vitest'

const single = vi.fn() // para .single() (tenants→plan_id, plans→plan)
const count = vi.fn()  // para count queries (contacts/templates/campaigns/whatsapp_phone_numbers)

// Mock encadeável adaptado ao padrão do repo (ver lib/tenant-provisioning.test.ts):
// builder cujos métodos de filtro retornam ele mesmo, single() é terminal síncrono,
// e o builder é "awaitable" (thenable real) para as queries de contagem.
vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const b: any = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    b.gte = vi.fn(() => b)
    b.single = vi.fn(() => single(table))
    // thenable real: `await q` nas queries de contagem resolve via count(table)
    b.then = (resolve: any, reject: any) => Promise.resolve(count(table)).then(resolve, reject)
    return b
  }
  return { getSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }) }
})

import {
  getTenantPlan,
  canAddContacts,
  canCreateTemplate,
  canStartCampaign,
  canAddWhatsAppNumber,
  planLimitResponse,
} from '@/lib/plan-limits'

const PLAN_TRIAL = { id: 'p-trial', slug: 'trial', name: 'Trial', max_whatsapp_numbers: 1, max_contacts: 100, max_templates: 3, max_campaigns_per_month: 2 }
const PLAN_PRO = { id: 'p-pro', slug: 'pro', name: 'Pro', max_whatsapp_numbers: 3, max_contacts: 50000, max_templates: null, max_campaigns_per_month: null }

beforeEach(() => { single.mockReset(); count.mockReset() })

describe('getTenantPlan', () => {
  it('devolve o plano do tenant', async () => {
    single.mockImplementation((table: string) =>
      table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    expect((await getTenantPlan('t1')).slug).toBe('trial')
  })

  it('plan_id nulo cai no trial', async () => {
    single.mockImplementation((table: string) =>
      table === 'tenants' ? { data: { plan_id: null } } : { data: PLAN_TRIAL })
    const plan = await getTenantPlan('t1')
    expect(plan.slug).toBe('trial')
  })

  it('erro/tenant inexistente cai no trial', async () => {
    single.mockImplementation((table: string) =>
      table === 'tenants' ? { data: null } : { data: PLAN_TRIAL })
    const plan = await getTenantPlan('t1')
    expect(plan.slug).toBe('trial')
  })

  it('se nem o trial resolver, retorna plano sintético fail-closed (todos os limites 0)', async () => {
    single.mockImplementation((table: string) =>
      table === 'tenants' ? { data: { plan_id: null } } : { data: null })
    const plan = await getTenantPlan('t1')
    expect(plan.max_whatsapp_numbers).toBe(0)
    expect(plan.max_contacts).toBe(0)
    expect(plan.max_templates).toBe(0)
    expect(plan.max_campaigns_per_month).toBe(0)
  })
})

describe('canAddContacts', () => {
  it('abaixo do limite permite', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 50 }))
    const r = await canAddContacts('t1', 1)
    expect(r).toEqual({ allowed: true, limit: 100, current: 50 })
  })

  it('no limite bloqueia', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 100 }))
    const r = await canAddContacts('t1', 1)
    expect(r.allowed).toBe(false)
  })

  it('acima do limite bloqueia', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 150 }))
    const r = await canAddContacts('t1', 1)
    expect(r.allowed).toBe(false)
  })

  it('respeita quantidade > 1', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 95 }))
    expect((await canAddContacts('t1', 5)).allowed).toBe(true)
    expect((await canAddContacts('t1', 6)).allowed).toBe(false)
  })
})

describe('limite NULL (ilimitado)', () => {
  it('canCreateTemplate ilimitado sempre permite', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-pro' } } : { data: PLAN_PRO })
    count.mockImplementation(() => ({ count: 9999 }))
    const r = await canCreateTemplate('t1')
    expect(r).toEqual({ allowed: true, limit: null, current: 9999 })
  })

  it('canStartCampaign ilimitado sempre permite', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-pro' } } : { data: PLAN_PRO })
    count.mockImplementation(() => ({ count: 9999 }))
    const r = await canStartCampaign('t1')
    expect(r.allowed).toBe(true)
  })
})

describe('canAddWhatsAppNumber', () => {
  it('abaixo do limite permite', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 0 }))
    expect((await canAddWhatsAppNumber('t1')).allowed).toBe(true)
  })

  it('no limite bloqueia', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 1 }))
    expect((await canAddWhatsAppNumber('t1')).allowed).toBe(false)
  })
})

describe('canStartCampaign', () => {
  it('conta o mês corrente e bloqueia no limite', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 2 }))
    const r = await canStartCampaign('t1')
    expect(r.allowed).toBe(false)
    expect(r).toEqual({ allowed: false, limit: 2, current: 2 })
  })

  it('abaixo do limite permite', async () => {
    single.mockImplementation((table: string) => table === 'tenants' ? { data: { plan_id: 'p-trial' } } : { data: PLAN_TRIAL })
    count.mockImplementation(() => ({ count: 1 }))
    const r = await canStartCampaign('t1')
    expect(r.allowed).toBe(true)
  })
})

describe('planLimitResponse', () => {
  it('devolve 403 com o payload de plan_limit', async () => {
    const res = planLimitResponse('contacts', { allowed: false, limit: 100, current: 100 })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'plan_limit', dimension: 'contacts', limit: 100, current: 100 })
  })
})
