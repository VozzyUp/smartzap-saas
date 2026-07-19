import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsertMock = vi.fn()
const fromMock = vi.fn(() => ({ upsert: upsertMock }))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: any[]) => fromMock(...args) },
}))

import { recordStatusEvent } from './whatsapp-status-events'

describe('recordStatusEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertMock.mockReturnValue({
      select: () => ({
        limit: async () => ({ data: [{ id: 'event_1' }], error: null }),
      }),
    })
  })

  it('persiste o tenant que recebeu o webhook', async () => {
    await recordStatusEvent({
      tenantId: 'tenant_1',
      messageId: 'wamid.1',
      status: 'sent',
      eventTsIso: '2026-07-19T00:00:00.000Z',
      eventTsRaw: '1784419200',
    })

    expect(fromMock).toHaveBeenCalledWith('whatsapp_status_events')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_1' }),
      { onConflict: 'dedupe_key' }
    )
  })
})
