import { describe, it, expect, vi, beforeEach } from 'vitest'

const inserts: Array<Record<string, unknown>> = []
let campaignTenant: string | null = 'tenant-from-db'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: campaignTenant ? { tenant_id: campaignTenant } : null }),
            }),
          }),
        }
      }
      return {
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row)
          return { error: null }
        },
      }
    },
  },
}))

import { emitWorkflowTrace } from './workflow-trace'

describe('persistência de campaign_trace_events', () => {
  beforeEach(() => {
    inserts.length = 0
    campaignTenant = 'tenant-from-db'
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('grava tenant_id informado pelo chamador', async () => {
    await emitWorkflowTrace({ traceId: 't', campaignId: 'camp-a', tenantId: 'tenant-x', phase: 'start' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].tenant_id).toBe('tenant-x')
  })

  it('resolve o tenant pela campanha quando o chamador não informa', async () => {
    await emitWorkflowTrace({ traceId: 't', campaignId: 'camp-b', phase: 'start' })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].tenant_id).toBe('tenant-from-db')
  })

  it('não grava linha sem tenant_id', async () => {
    campaignTenant = null
    await emitWorkflowTrace({ traceId: 't', campaignId: 'camp-c', phase: 'start' })
    expect(inserts).toHaveLength(0)
  })
})
