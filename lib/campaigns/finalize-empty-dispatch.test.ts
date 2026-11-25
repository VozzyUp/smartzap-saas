import { describe, it, expect } from 'vitest'
import { finalizeCampaignWithNoRecipients } from './finalize-empty-dispatch'

function fakeClient() {
  const calls: { values?: Record<string, unknown>; eq: Array<[string, string]>; statuses?: string[] } = { eq: [] }
  const chain: any = {
    eq: (c: string, v: string) => (calls.eq.push([c, v]), chain),
    in: async (_c: string, v: string[]) => ((calls.statuses = v), { error: null }),
  }
  return { calls, client: { from: () => ({ update: (v: Record<string, unknown>) => ((calls.values = v), chain) }) } }
}

describe('finalizeCampaignWithNoRecipients', () => {
  it('leva a campanha a estado final com completed_at, no tenant certo', async () => {
    const { calls, client } = fakeClient()
    await finalizeCampaignWithNoRecipients(client as any, 't1', 'c1', '2026-01-01T00:00:00.000Z')
    expect(calls.values).toMatchObject({ status: 'Concluído', completed_at: '2026-01-01T00:00:00.000Z' })
    expect(calls.eq).toContainEqual(['id', 'c1'])
    expect(calls.eq).toContainEqual(['tenant_id', 't1'])
    expect(calls.statuses).toContain('Enviando')
    expect(calls.statuses).not.toContain('Cancelado')
  })
})
