import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const resolveTenantMock = vi.fn()
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  resolveTenantByPhoneNumberId: (...a: any[]) => resolveTenantMock(...a),
}))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({}),
  supabase: {},
}))
// lib/builder/workflow-conversations.ts tem `import "server-only"`, que lança
// fora do build do Next (o pacote depende de aliasing do webpack que o Vitest
// não replica) — mockar em vez de deixar carregar o arquivo real.
vi.mock('@/lib/builder/workflow-conversations', () => ({
  getPendingConversation: vi.fn(async () => null),
}))

import { POST } from './route'

describe('webhook route — resolução de tenant', () => {
  beforeEach(() => {
    resolveTenantMock.mockReset()
    delete process.env.META_APP_SECRET
  })

  it('retorna 200 ignorado quando nenhum entry tem phone_number_id', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: {} } }] }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.reason).toBe('no_phone_number_id')
    expect(resolveTenantMock).not.toHaveBeenCalled()
  })

  it('retorna 200 ignorado quando phone_number_id não está mapeado', async () => {
    resolveTenantMock.mockResolvedValueOnce(null)
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { metadata: { phone_number_id: 'pn_desconhecido' } } }] }],
    }
    const req = new NextRequest('http://localhost/api/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    const res = await POST(req)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.reason).toBe('unknown_phone_number_id')
    expect(resolveTenantMock).toHaveBeenCalledWith('pn_desconhecido')
  })
})
