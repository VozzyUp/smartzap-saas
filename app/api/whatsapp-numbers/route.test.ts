import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let ctxMock: any = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ctxMock),
}))

const listMock = vi.fn(async () => [{ phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', display_label: null, display_phone_number: '+55 11 99999-9999', is_active: true }])
const addMock = vi.fn(async () => ({}))
const mirrorMock = vi.fn(async () => {})
const resolveMock = vi.fn(async () => null as string | null)
const refreshDisplayMock = vi.fn(async () => null as string | null)
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  listWhatsAppNumbers: (...a: any[]) => listMock(...a),
  addWhatsAppNumber: (...a: any[]) => addMock(...a),
  mirrorActiveToSettings: (...a: any[]) => mirrorMock(...a),
  resolveTenantByPhoneNumberId: (...a: any[]) => resolveMock(...a),
  refreshWhatsAppNumberDisplayPhoneNumber: (...a: any[]) => refreshDisplayMock(...a),
}))

const canAddMock = vi.fn(async () => ({ allowed: true, limit: 5, current: 1 }))
vi.mock('@/lib/plan-limits', () => ({
  canAddWhatsAppNumber: (...a: any[]) => canAddMock(...a),
  planLimitResponse: (dimension: string, r: any) =>
    new Response(JSON.stringify({ error: 'plan_limit', dimension, limit: r.limit, current: r.current }), { status: 403 }),
}))

vi.mock('@/lib/server-http', () => ({
  fetchWithTimeout: vi.fn(async () => ({
    ok: true,
    json: async () => ({ display_phone_number: '+551199999999', verified_name: 'Test' }),
  })),
  safeJson: vi.fn(async () => ({ display_phone_number: '+551199999999', verified_name: 'Test' })),
  isAbortError: () => false,
}))

const subscribeMock = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/meta-webhook-subscription', () => ({
  subscribeWabaToWebhook: (...a: any[]) => subscribeMock(...a),
}))
vi.mock('@/lib/verify-token', () => ({ getVerifyToken: async () => 'vt_1' }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.vsmart.com' }))

import { GET, POST } from './route'

describe('GET /api/whatsapp-numbers', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    listMock.mockClear()
  })

  it('401 sem sessão', async () => {
    ctxMock = null
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('200 com lista de números (sem access_token no payload)', async () => {
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(listMock).toHaveBeenCalledWith('t1')
    expect(body.numbers).toEqual([{ phone_number_id: 'pn_1', tenant_id: 't1', business_account_id: 'ba_1', display_label: null, display_phone_number: '+55 11 99999-9999', is_active: true }])
    expect(JSON.stringify(body)).not.toContain('access_token')
  })

  it('enriquece nÃºmeros antigos sem telefone de exibiÃ§Ã£o', async () => {
    listMock.mockResolvedValueOnce([
      { phone_number_id: 'pn_legacy', tenant_id: 't1', business_account_id: 'ba_1', display_label: null, display_phone_number: null, is_active: true },
    ])
    refreshDisplayMock.mockResolvedValueOnce('+55 11 98888-7777')

    const res = await GET()
    const body = await res.json()

    expect(refreshDisplayMock).toHaveBeenCalledWith('t1', 'pn_legacy')
    expect(body.numbers[0].display_phone_number).toBe('+55 11 98888-7777')
  })
})

describe('POST /api/whatsapp-numbers', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    addMock.mockClear(); mirrorMock.mockClear(); canAddMock.mockClear(); resolveMock.mockClear(); subscribeMock.mockClear()
    resolveMock.mockResolvedValue(null)
    canAddMock.mockResolvedValue({ allowed: true, limit: 5, current: 1 })
    subscribeMock.mockResolvedValue({ ok: true })
  })

  it('401 sem sessão', async () => {
    ctxMock = null
    const req = new NextRequest('http://localhost/api/whatsapp-numbers', { method: 'POST', body: JSON.stringify({}) })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('403 plan_limit quando no limite (número novo)', async () => {
    canAddMock.mockResolvedValueOnce({ allowed: false, limit: 1, current: 1 })
    const req = new NextRequest('http://localhost/api/whatsapp-numbers', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_2', businessAccountId: 'ba_2', accessToken: 'tok' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error).toBe('plan_limit')
    expect(addMock).not.toHaveBeenCalled()
  })

  it('200 e chama addWhatsAppNumber + mirrorActiveToSettings quando válido', async () => {
    const req = new NextRequest('http://localhost/api/whatsapp-numbers', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_2', businessAccountId: 'ba_2', accessToken: 'tok', displayLabel: 'Loja 2' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(addMock).toHaveBeenCalledWith('t1', {
      phoneNumberId: 'pn_2',
      businessAccountId: 'ba_2',
      accessToken: 'tok',
      displayLabel: 'Loja 2',
      displayPhoneNumber: '+551199999999',
    })
    expect(mirrorMock).toHaveBeenCalledWith('t1')
  })

  it('assina o webhook do WABA automaticamente ao adicionar e retorna webhookSubscribed=true', async () => {
    const req = new NextRequest('http://localhost/api/whatsapp-numbers', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_2', businessAccountId: 'ba_2', accessToken: 'tok' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(subscribeMock).toHaveBeenCalledWith({
      wabaId: 'ba_2',
      accessToken: 'tok',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })
    expect(body.webhookSubscribed).toBe(true)
  })

  it('falha ao assinar webhook NÃO derruba o cadastro (retorna 200 com webhookSubscribed=false)', async () => {
    subscribeMock.mockResolvedValueOnce({ ok: false, error: 'Application does not have permission' })
    const req = new NextRequest('http://localhost/api/whatsapp-numbers', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_2', businessAccountId: 'ba_2', accessToken: 'tok' }),
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(addMock).toHaveBeenCalled()
    expect(body.webhookSubscribed).toBe(false)
    expect(body.webhookError).toContain('permission')
  })

  it('não checa o gate quando o número já é do tenant (reconexão)', async () => {
    resolveMock.mockResolvedValueOnce('t1')
    const req = new NextRequest('http://localhost/api/whatsapp-numbers', {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId: 'pn_1', businessAccountId: 'ba_1', accessToken: 'tok' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(canAddMock).not.toHaveBeenCalled()
    expect(addMock).toHaveBeenCalled()
  })
})
