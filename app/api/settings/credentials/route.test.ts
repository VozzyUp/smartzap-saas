import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false })),
}))
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: () => true }))
const saveAllMock = vi.fn(async () => {})
const setMock = vi.fn(async () => {})
vi.mock('@/lib/supabase-db', () => ({
  settingsDb: {
    getAll: vi.fn(),
    saveAll: (...a: any[]) => saveAllMock(...a),
    set: (...a: any[]) => setMock(...a),
  },
}))
const addMock = vi.fn(async () => {})
const mirrorMock = vi.fn(async () => {})
const getActiveMock = vi.fn(async () => ({ phone_number_id: 'pn_ativo', tenant_id: 't1', business_account_id: 'ba', access_token: 'tok', display_label: null, is_active: true }))
const removeMock = vi.fn(async () => {})
const listMock = vi.fn(async () => [] as any[])
// resolveTenantByPhoneNumberId devolve o próprio tenant → o número já é do tenant
// (reconexão), então o gate de plano da Fase 3A não trata como número novo e não bloqueia.
const resolveMock = vi.fn(async () => 't1')
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  addWhatsAppNumber: (...a: any[]) => addMock(...a),
  mirrorActiveToSettings: (...a: any[]) => mirrorMock(...a),
  getActiveWhatsAppNumber: (...a: any[]) => getActiveMock(...a),
  removeWhatsAppNumber: (...a: any[]) => removeMock(...a),
  listWhatsAppNumbers: (...a: any[]) => listMock(...a),
  resolveTenantByPhoneNumberId: (...a: any[]) => resolveMock(...a),
}))
vi.mock('@/lib/server-http', () => ({
  fetchWithTimeout: vi.fn(async () => ({
    ok: true,
    json: async () => ({ display_phone_number: '+551199999999', verified_name: 'Test', quality_rating: 'GREEN' }),
  })),
  safeJson: vi.fn(async () => ({ display_phone_number: '+551199999999', verified_name: 'Test', quality_rating: 'GREEN' })),
  isAbortError: () => false,
}))

import { POST, DELETE } from './route'

describe('settings/credentials write-through', () => {
  beforeEach(() => {
    addMock.mockClear(); mirrorMock.mockClear(); saveAllMock.mockClear(); setMock.mockClear()
    getActiveMock.mockClear(); removeMock.mockClear(); listMock.mockClear()
    getActiveMock.mockResolvedValue({ phone_number_id: 'pn_ativo', tenant_id: 't1', business_account_id: 'ba', access_token: 'tok', display_label: null, is_active: true })
    listMock.mockResolvedValue([])
  })

  it('POST grava o token na tabela via addWhatsAppNumber e espelha em settings', async () => {
    const req = new NextRequest('http://localhost/api/settings/credentials', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' }),
    })
    await POST(req)
    expect(addMock).toHaveBeenCalledWith('t1', {
      phoneNumberId: 'pn_1',
      businessAccountId: 'ba_1',
      accessToken: 'tok',
      displayPhoneNumber: '+551199999999',
    })
    expect(mirrorMock).toHaveBeenCalledWith('t1')
  })

  it('DELETE remove só o número ativo (não apaga todos) e espelha', async () => {
    await DELETE()
    expect(removeMock).toHaveBeenCalledWith('t1', 'pn_ativo')
    expect(mirrorMock).toHaveBeenCalledWith('t1')
  })

  it('DELETE limpa metaApp só quando não sobra número', async () => {
    listMock.mockResolvedValueOnce([]) // nenhum número restante
    await DELETE()
    expect(setMock).toHaveBeenCalledWith('t1', 'metaAppId', '')
    expect(setMock).toHaveBeenCalledWith('t1', 'metaAppSecret', '')
  })

  it('DELETE NÃO limpa metaApp quando ainda sobram números', async () => {
    listMock.mockResolvedValueOnce([{ phone_number_id: 'pn_2' }]) // sobra um
    await DELETE()
    expect(setMock).not.toHaveBeenCalledWith('t1', 'metaAppId', '')
  })
})
