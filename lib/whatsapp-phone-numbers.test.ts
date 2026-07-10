import { describe, it, expect, vi, beforeEach } from 'vitest'

const upsertFn = vi.fn()
const selectByPhoneFn = vi.fn()
const selectByTokenFn = vi.fn()
const selectByTenantFn = vi.fn()
const updateFn = vi.fn()
const deleteFn = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== 'whatsapp_phone_numbers') throw new Error(`unexpected table ${table}`)
      return {
        upsert: (row: any, opts: any) => ({ error: null, ...upsertFn(row, opts) }),
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: () =>
              col === 'phone_number_id' ? selectByPhoneFn(val)
              : col === 'flows_webhook_token' ? selectByTokenFn(val)
              : selectByTenantFn(val),
          }),
        }),
        update: (patch: any) => ({ eq: () => updateFn(patch) }),
        delete: () => ({ eq: () => deleteFn() }),
      }
    },
  }),
}))

import {
  upsertWhatsAppPhoneNumber,
  resolveTenantByPhoneNumberId,
  resolveTenantByFlowsWebhookToken,
  getOrCreateFlowsWebhookToken,
  clearWhatsAppPhoneNumber,
} from '@/lib/whatsapp-phone-numbers'

describe('whatsapp-phone-numbers', () => {
  beforeEach(() => {
    upsertFn.mockReset(); selectByPhoneFn.mockReset()
    selectByTokenFn.mockReset(); selectByTenantFn.mockReset()
    updateFn.mockReset(); deleteFn.mockReset()
  })

  it('upsertWhatsAppPhoneNumber faz upsert com onConflict phone_number_id', async () => {
    upsertFn.mockReturnValueOnce({ error: null })
    await upsertWhatsAppPhoneNumber('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1' })
    expect(upsertFn).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1' }),
      expect.objectContaining({ onConflict: 'phone_number_id' })
    )
  })

  it('resolveTenantByPhoneNumberId retorna tenant_id quando encontra', async () => {
    selectByPhoneFn.mockResolvedValueOnce({ data: { tenant_id: 't1' }, error: null })
    const r = await resolveTenantByPhoneNumberId('pn_1')
    expect(r).toBe('t1')
  })

  it('resolveTenantByPhoneNumberId retorna null quando não encontra', async () => {
    selectByPhoneFn.mockResolvedValueOnce({ data: null, error: null })
    const r = await resolveTenantByPhoneNumberId('pn_desconhecido')
    expect(r).toBeNull()
  })

  it('resolveTenantByFlowsWebhookToken retorna tenant_id quando encontra', async () => {
    selectByTokenFn.mockResolvedValueOnce({ data: { tenant_id: 't2' }, error: null })
    const r = await resolveTenantByFlowsWebhookToken('fwh_abc')
    expect(r).toBe('t2')
  })

  it('getOrCreateFlowsWebhookToken retorna token existente sem gerar novo', async () => {
    selectByTenantFn.mockResolvedValueOnce({ data: { flows_webhook_token: 'fwh_existing' }, error: null })
    const r = await getOrCreateFlowsWebhookToken('t1')
    expect(r).toBe('fwh_existing')
    expect(updateFn).not.toHaveBeenCalled()
  })

  it('getOrCreateFlowsWebhookToken gera e persiste quando ausente', async () => {
    selectByTenantFn.mockResolvedValueOnce({ data: { flows_webhook_token: null }, error: null })
    updateFn.mockReturnValueOnce({ error: null })
    const r = await getOrCreateFlowsWebhookToken('t1')
    expect(r).toMatch(/^fwh_[a-f0-9]{32}$/)
    expect(updateFn).toHaveBeenCalledWith(expect.objectContaining({ flows_webhook_token: r }))
  })

  it('getOrCreateFlowsWebhookToken lança se o tenant não tem linha ainda', async () => {
    selectByTenantFn.mockResolvedValueOnce({ data: null, error: null })
    await expect(getOrCreateFlowsWebhookToken('t-sem-linha')).rejects.toThrow()
  })

  it('clearWhatsAppPhoneNumber deleta a linha do tenant', async () => {
    deleteFn.mockReturnValueOnce({ error: null })
    await clearWhatsAppPhoneNumber('t1')
    expect(deleteFn).toHaveBeenCalled()
  })
})
