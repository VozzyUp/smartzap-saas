import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  selectEq: vi.fn(),
  inPhones: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))

import { getActiveSuppressionsByPhone, upsertPhoneSuppression } from './phone-suppressions'

describe('phone suppressions tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.from.mockReturnValue({ select: mocks.select, upsert: mocks.upsert })
    mocks.select.mockReturnValue({ eq: mocks.selectEq })
    mocks.selectEq.mockReturnValue({ in: mocks.inPhones })
    mocks.inPhones.mockResolvedValue({ data: [], error: null })
    mocks.upsert.mockResolvedValue({ error: null })
  })

  it('busca supressoes somente no tenant solicitado', async () => {
    await getActiveSuppressionsByPhone('tenant-a', ['+5511999999999'])

    expect(mocks.from).toHaveBeenCalledWith('phone_suppressions')
    expect(mocks.selectEq).toHaveBeenCalledWith('tenant_id', 'tenant-a')
  })

  it('persiste a supressao no tenant e usa conflito composto', async () => {
    await upsertPhoneSuppression({
      tenantId: 'tenant-a',
      phone: '+5511999999999',
      reason: 'opt_out',
    })

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-a', phone: '+5511999999999' }),
      { onConflict: 'tenant_id,phone' },
    )
  })
})
