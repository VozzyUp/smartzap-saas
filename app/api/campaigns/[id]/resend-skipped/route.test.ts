import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  campaigns: [
    { id: 'camp-1', tenant_id: 'tenant-A', template_name: 'promo', template_variables: null },
  ] as any[],
}))

vi.mock('@upstash/workflow', () => ({ Client: class {} }))
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: async () => ({ tenantId: 'tenant-B' }),
}))
vi.mock('@/lib/supabase-db', () => ({
  templateDb: { getByName: vi.fn(), upsert: vi.fn() },
  campaignDb: { updateStatus: vi.fn() },
}))
vi.mock('@/lib/whatsapp-credentials', () => ({ getWhatsAppCredentials: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        update: () => chain,
        eq: (k: string, v: unknown) => {
          filters[k] = v
          return chain
        },
        maybeSingle: async () => run(),
        single: async () => run(),
      }
      function run() {
        m.calls.push({ table, filters: { ...filters } })
        if (table !== 'campaigns') return { data: null, error: null }
        const row = m.campaigns.find(
          (c) => c.id === filters.id && (!('tenant_id' in filters) || c.tenant_id === filters.tenant_id),
        )
        return { data: row ?? null, error: null }
      }
      return chain
    },
  },
}))

import { POST } from './route'

describe('POST /api/campaigns/[id]/resend-skipped (isolamento por conta)', () => {
  beforeEach(() => {
    m.calls.length = 0
  })

  it('recusa com 404 campanha de outra conta e não consulta mais nada', async () => {
    const res = await POST(new Request('http://x'), { params: Promise.resolve({ id: 'camp-1' }) } as any)
    expect(res.status).toBe(404)
    expect(m.calls).toHaveLength(1)
    expect(m.calls[0].table).toBe('campaigns')
    expect(m.calls[0].filters.tenant_id).toBe('tenant-B')
  })
})
