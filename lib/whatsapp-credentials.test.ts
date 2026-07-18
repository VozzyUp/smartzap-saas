import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActiveWhatsAppNumberMock = vi.fn()
const getWhatsAppNumberByPhoneIdMock = vi.fn()
const getAllSettingsMock = vi.fn()

vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  getActiveWhatsAppNumber: (...args: any[]) => getActiveWhatsAppNumberMock(...args),
  getWhatsAppNumberByPhoneId: (...args: any[]) => getWhatsAppNumberByPhoneIdMock(...args),
}))

vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    getAll: (...args: any[]) => getAllSettingsMock(...args),
  },
}))

import { getWhatsAppCredentials, getWhatsAppCredentialsForNumber } from '@/lib/whatsapp-credentials'

describe('whatsapp-credentials', () => {
  beforeEach(() => {
    getActiveWhatsAppNumberMock.mockReset()
    getWhatsAppNumberByPhoneIdMock.mockReset()
    getAllSettingsMock.mockReset()
  })

  it('getWhatsAppCredentials: ativo com token -> retorna credenciais do ativo (nao le settings)', async () => {
    getActiveWhatsAppNumberMock.mockResolvedValueOnce({
      phone_number_id: 'pn_1',
      tenant_id: 't1',
      business_account_id: 'ba_1',
      access_token: 'tok_1',
      display_label: null,
      is_active: true,
    })

    const r = await getWhatsAppCredentials('t1')

    expect(r).toEqual({ phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok_1' })
    expect(getAllSettingsMock).not.toHaveBeenCalled()
  })

  it('getWhatsAppCredentials: ativo null -> fallback settings', async () => {
    getActiveWhatsAppNumberMock.mockResolvedValueOnce(null)
    getAllSettingsMock.mockResolvedValueOnce({
      phoneNumberId: 'pn_legacy',
      businessAccountId: 'ba_legacy',
      accessToken: 'tok_legacy',
      isConnected: true,
    })

    const r = await getWhatsAppCredentials('t1')

    expect(getAllSettingsMock).toHaveBeenCalledWith('t1')
    expect(r).toEqual({ phoneNumberId: 'pn_legacy', businessAccountId: 'ba_legacy', accessToken: 'tok_legacy' })
  })

  it('getWhatsAppCredentials: ativo sem access_token (linha parcial) -> fallback settings', async () => {
    getActiveWhatsAppNumberMock.mockResolvedValueOnce({
      phone_number_id: 'pn_1',
      tenant_id: 't1',
      business_account_id: 'ba_1',
      access_token: null,
      display_label: null,
      is_active: true,
    })
    getAllSettingsMock.mockResolvedValueOnce({
      phoneNumberId: 'pn_legacy',
      businessAccountId: 'ba_legacy',
      accessToken: 'tok_legacy',
      isConnected: true,
    })

    const r = await getWhatsAppCredentials('t1')

    expect(getAllSettingsMock).toHaveBeenCalledWith('t1')
    expect(r).toEqual({ phoneNumberId: 'pn_legacy', businessAccountId: 'ba_legacy', accessToken: 'tok_legacy' })
  })

  it('getWhatsAppCredentialsForNumber("pn_2") -> credenciais de pn_2', async () => {
    getWhatsAppNumberByPhoneIdMock.mockResolvedValueOnce({
      phone_number_id: 'pn_2',
      tenant_id: 't1',
      business_account_id: 'ba_2',
      access_token: 'tok_2',
      display_label: 'Secundário',
      is_active: false,
    })

    const r = await getWhatsAppCredentialsForNumber('t1', 'pn_2')

    expect(getWhatsAppNumberByPhoneIdMock).toHaveBeenCalledWith('t1', 'pn_2')
    expect(r).toEqual({ phoneNumberId: 'pn_2', businessAccountId: 'ba_2', accessToken: 'tok_2' })
    expect(getActiveWhatsAppNumberMock).not.toHaveBeenCalled()
  })

  it('getWhatsAppCredentialsForNumber(null) -> delega ao ativo/legado', async () => {
    getActiveWhatsAppNumberMock.mockResolvedValueOnce({
      phone_number_id: 'pn_1',
      tenant_id: 't1',
      business_account_id: 'ba_1',
      access_token: 'tok_1',
      display_label: null,
      is_active: true,
    })

    const r = await getWhatsAppCredentialsForNumber('t1', null)

    expect(getWhatsAppNumberByPhoneIdMock).not.toHaveBeenCalled()
    expect(getActiveWhatsAppNumberMock).toHaveBeenCalledWith('t1')
    expect(r).toEqual({ phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok_1' })
  })
})
