import { describe, it, expect, vi, beforeEach } from 'vitest'

const settingsSet = vi.fn(async () => {})
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { get: vi.fn(), set: (...a: any[]) => settingsSet(...a) } }))

const upsertMock = vi.fn(async () => ({ error: null }))
const deleteEqMock = vi.fn(async () => ({ error: null }))
const selectEqMock = vi.fn(async () => ({ data: null }))
vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => ({
      upsert: upsertMock,
      delete: () => ({ eq: deleteEqMock }),
      select: () => ({ eq: () => ({ maybeSingle: selectEqMock }) }),
    }),
  }),
}))

import { saveCalendarChannel, resolveTenantByChannelToken } from '@/lib/google-calendar'

describe('saveCalendarChannel write-through', () => {
  beforeEach(() => { upsertMock.mockClear(); deleteEqMock.mockClear(); settingsSet.mockClear(); selectEqMock.mockClear() })

  it('faz upsert em google_calendar_channels ao salvar um canal', async () => {
    await saveCalendarChannel('t1', {
      id: 'ch_1', resourceId: 'res_1', token: 'gc_token_abc',
      calendarId: 'primary', createdAt: new Date().toISOString(),
    })
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ channel_token: 'gc_token_abc', tenant_id: 't1', channel_id: 'ch_1', resource_id: 'res_1' }),
      expect.objectContaining({ onConflict: 'channel_token' })
    )
  })

  it('deleta de google_calendar_channels quando channel é null', async () => {
    await saveCalendarChannel('t1', null)
    expect(deleteEqMock).toHaveBeenCalled()
  })
})

describe('resolveTenantByChannelToken', () => {
  beforeEach(() => { selectEqMock.mockClear() })

  it('retorna tenant_id quando encontra o token', async () => {
    selectEqMock.mockResolvedValueOnce({ data: { tenant_id: 't1' } })
    const r = await resolveTenantByChannelToken('gc_token_abc')
    expect(r).toBe('t1')
  })

  it('retorna null quando não encontra', async () => {
    selectEqMock.mockResolvedValueOnce({ data: null })
    const r = await resolveTenantByChannelToken('gc_desconhecido')
    expect(r).toBeNull()
  })
})
