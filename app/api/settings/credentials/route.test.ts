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
const clearMock = vi.fn(async () => {})
// resolveTenantByPhoneNumberId devolve o próprio tenant → o número já é do tenant
// (reconexão), então o gate de plano da Fase 3A não trata como número novo e não bloqueia.
const resolveMock = vi.fn(async () => 't1')
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  addWhatsAppNumber: (...a: any[]) => addMock(...a),
  mirrorActiveToSettings: (...a: any[]) => mirrorMock(...a),
  clearWhatsAppPhoneNumber: (...a: any[]) => clearMock(...a),
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
    addMock.mockClear(); mirrorMock.mockClear(); clearMock.mockClear(); saveAllMock.mockClear(); setMock.mockClear()
  })

  it('POST grava o token na tabela via addWhatsAppNumber e espelha em settings', async () => {
    const req = new NextRequest('http://localhost/api/settings/credentials', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' }),
    })
    await POST(req)
    expect(addMock).toHaveBeenCalledWith('t1', { phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' })
    expect(mirrorMock).toHaveBeenCalledWith('t1')
  })

  it('DELETE limpa whatsapp_phone_numbers', async () => {
    await DELETE()
    expect(clearMock).toHaveBeenCalledWith('t1')
  })
})
