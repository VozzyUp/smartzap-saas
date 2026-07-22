import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let ctxMock: any = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ctxMock),
}))

const getCredsMock = vi.fn()
vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentialsForNumber: (...a: any[]) => getCredsMock(...a),
}))

const getNumberMock = vi.fn()
vi.mock('@/lib/whatsapp-phone-numbers', () => ({
  getWhatsAppNumberByPhoneId: (...a: any[]) => getNumberMock(...a),
}))

const subscribeMock = vi.fn()
const statusMock = vi.fn()
vi.mock('@/lib/meta-webhook-subscription', () => ({
  subscribeWabaToWebhook: (...a: any[]) => subscribeMock(...a),
  getWabaWebhookStatus: (...a: any[]) => statusMock(...a),
}))

vi.mock('@/lib/verify-token', () => ({ getVerifyToken: async () => 'vt_1' }))
vi.mock('@/lib/app-url', () => ({ getAppUrl: () => 'https://app.vsmart.com' }))

import { GET, POST } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/whatsapp-numbers/[id]/webhook — status', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    vi.clearAllMocks()
    getCredsMock.mockResolvedValue({ businessAccountId: 'waba_1', accessToken: 'tok_1', phoneNumberId: 'pn_2' })
  })

  it('401 sem sessão', async () => {
    ctxMock = null
    const res = await GET(new NextRequest('http://localhost/x'), makeParams('pn_2'))
    expect(res.status).toBe(401)
  })

  it('retorna o status da assinatura do webhook do número', async () => {
    statusMock.mockResolvedValue({ ok: true, messagesSubscribed: true, overrideCallbackUri: 'https://app.vsmart.com/api/webhook' })
    const res = await GET(new NextRequest('http://localhost/x'), makeParams('pn_2'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messagesSubscribed).toBe(true)
    expect(body.webhookActive).toBe(true)
    expect(statusMock).toHaveBeenCalledWith({ wabaId: 'waba_1', accessToken: 'tok_1' })
  })

  it('webhookActive=true quando o override_callback_uri já aponta pro V-Smart, mesmo sem messages em subscribed_fields (comportamento real da Meta observado no diagnóstico)', async () => {
    statusMock.mockResolvedValue({ ok: true, messagesSubscribed: false, overrideCallbackUri: 'https://app.vsmart.com/api/webhook' })
    const res = await GET(new NextRequest('http://localhost/x'), makeParams('pn_2'))
    const body = await res.json()
    expect(body.webhookActive).toBe(true)
  })

  it('webhookActive=false quando nem messages nem override apontam pro V-Smart', async () => {
    statusMock.mockResolvedValue({ ok: true, messagesSubscribed: false, overrideCallbackUri: null })
    const res = await GET(new NextRequest('http://localhost/x'), makeParams('pn_2'))
    const body = await res.json()
    expect(body.webhookActive).toBe(false)
  })

  it('400 quando o número não tem credenciais salvas', async () => {
    getCredsMock.mockResolvedValueOnce(null)
    const res = await GET(new NextRequest('http://localhost/x'), makeParams('pn_2'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/whatsapp-numbers/[id]/webhook — ativar', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    vi.clearAllMocks()
    getCredsMock.mockResolvedValue({ businessAccountId: 'waba_1', accessToken: 'tok_1', phoneNumberId: 'pn_2' })
    getNumberMock.mockResolvedValue(null)
  })

  it('sem connection_type salvo (retrocompat): assina messages+smb_message_echoes', async () => {
    subscribeMock.mockResolvedValue({ ok: true })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), makeParams('pn_2'))
    expect(res.status).toBe(200)
    expect(subscribeMock).toHaveBeenCalledWith({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
      fields: 'messages,smb_message_echoes',
    })
  })

  it('connection_type="official_api": assina só messages', async () => {
    getNumberMock.mockResolvedValue({ connection_type: 'official_api' })
    subscribeMock.mockResolvedValue({ ok: true })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), makeParams('pn_2'))
    expect(res.status).toBe(200)
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({ fields: 'messages' }))
  })

  it('connection_type="coexistence": assina messages+smb_message_echoes', async () => {
    getNumberMock.mockResolvedValue({ connection_type: 'coexistence' })
    subscribeMock.mockResolvedValue({ ok: true })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), makeParams('pn_2'))
    expect(res.status).toBe(200)
    expect(subscribeMock).toHaveBeenCalledWith(expect.objectContaining({ fields: 'messages,smb_message_echoes' }))
  })

  it('502 quando a Meta recusa a assinatura, repassando a mensagem', async () => {
    subscribeMock.mockResolvedValue({ ok: false, error: 'Application does not have permission' })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), makeParams('pn_2'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('permission')
  })

  it('502 em coexistência com erro #100 inclui dica sobre o vínculo do app no celular', async () => {
    getNumberMock.mockResolvedValue({ connection_type: 'coexistence' })
    subscribeMock.mockResolvedValue({
      ok: false,
      error: 'Passo 2/2 (override, campos: messages,smb_message_echoes): (#100) Before override the current callback uri, your app must be subscribed to receive messages for WhatsApp Business Account',
    })
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), makeParams('pn_2'))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('vínculo')
  })

  it('400 sem credenciais do número', async () => {
    getCredsMock.mockResolvedValueOnce(null)
    const res = await POST(new NextRequest('http://localhost/x', { method: 'POST' }), makeParams('pn_2'))
    expect(res.status).toBe(400)
  })
})
