import { describe, it, expect } from 'vitest'
import { buildCampaignContactUpsertRows } from './resend-skipped-rows'

describe('buildCampaignContactUpsertRows', () => {
  it('inclui tenant_id do contexto em todas as linhas', () => {
    const rows = buildCampaignContactUpsertRows(
      [
        { id: 'a', status: 'pending' },
        { id: 'b', status: 'skipped' },
      ],
      'tenant-1'
    )
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.tenant_id === 'tenant-1')).toBe(true)
  })

  it('o tenant do contexto prevalece sobre um tenant_id vindo na linha', () => {
    const rows = buildCampaignContactUpsertRows([{ id: 'a', tenant_id: 'outro' } as any], 'tenant-1')
    expect(rows[0].tenant_id).toBe('tenant-1')
  })

  it('descarta linhas sem id válido', () => {
    const rows = buildCampaignContactUpsertRows([{ id: '' }, { id: 5 as any }, null, undefined, { id: 'ok' }], 't')
    expect(rows.map((r) => r.id)).toEqual(['ok'])
  })
})
