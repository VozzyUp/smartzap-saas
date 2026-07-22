import { describe, expect, it, vi, beforeEach } from 'vitest'

const fetchWithTimeout = vi.fn()
vi.mock('@/lib/server-http', () => ({
  fetchWithTimeout: (...a: unknown[]) => fetchWithTimeout(...a),
  safeJson: async (res: any) => res.json(),
}))

import {
  isMessagesSubscribed,
  normalizeSubscribedFields,
  subscribeWabaToWebhook,
  getWabaWebhookStatus,
} from '@/lib/meta-webhook-subscription'

describe('meta-webhook-subscription helpers', () => {
  it('normalizeSubscribedFields deve deduplicar e juntar campos de múltiplos apps', () => {
    const fields = normalizeSubscribedFields([
      { id: '1', subscribed_fields: ['messages', 'message_template_status_update'] },
      { id: '2', subscribed_fields: ['messages'] },
      { id: '3', subscribed_fields: [] },
    ])

    expect(fields).toContain('messages')
    expect(fields).toContain('message_template_status_update')
    // dedupe
    expect(fields.filter((f) => f === 'messages').length).toBe(1)
  })

  it('isMessagesSubscribed deve retornar true quando houver messages em qualquer app', () => {
    expect(isMessagesSubscribed([{ subscribed_fields: ['messages'] }])).toBe(true)
    expect(isMessagesSubscribed([{ subscribed_fields: ['foo'] }])).toBe(false)
    expect(isMessagesSubscribed([])).toBe(false)
  })
})

describe('subscribeWabaToWebhook', () => {
  beforeEach(() => fetchWithTimeout.mockReset())

  it('faz POST em subscribed_apps do WABA com messages + override_callback_uri e verify_token', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchWithTimeout.mock.calls[0]
    expect(url).toContain('/waba_1/subscribed_apps')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok_1')
    const body = String(init.body)
    expect(body).toContain('subscribed_fields=messages')
    expect(body).toContain('override_callback_uri=')
    expect(body).toContain('verify_token=vt_1')
  })

  it('retorna ok=false com a mensagem de erro da Meta quando o POST falha', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Application does not have permission' } }),
    })

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('permission')
  })
})

describe('getWabaWebhookStatus', () => {
  beforeEach(() => fetchWithTimeout.mockReset())

  it('retorna messagesSubscribed=true quando o app tem o campo messages', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'app_1', subscribed_fields: ['messages'], override_callback_uri: 'https://app.vsmart.com/api/webhook' }] }),
    })

    const result = await getWabaWebhookStatus({ wabaId: 'waba_1', accessToken: 'tok_1' })

    expect(result.ok).toBe(true)
    expect(result.messagesSubscribed).toBe(true)
    expect(result.overrideCallbackUri).toContain('/api/webhook')
  })

  it('retorna messagesSubscribed=false quando não há assinatura', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    const result = await getWabaWebhookStatus({ wabaId: 'waba_1', accessToken: 'tok_1' })

    expect(result.ok).toBe(true)
    expect(result.messagesSubscribed).toBe(false)
  })

  it('retorna ok=false quando a Meta rejeita a consulta', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Invalid token' } }) })

    const result = await getWabaWebhookStatus({ wabaId: 'waba_1', accessToken: 'tok_1' })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Invalid token')
  })
})
