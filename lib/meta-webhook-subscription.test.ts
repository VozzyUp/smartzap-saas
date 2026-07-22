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

  it('faz DUAS chamadas: 1) inscreve os campos, 2) só depois seta o override_callback_uri (a Meta rejeita as duas coisas numa chamada só pra WABA nunca inscrito antes — erro #100)', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })

    expect(result.ok).toBe(true)
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2)

    const [url1, init1] = fetchWithTimeout.mock.calls[0]
    expect(url1).toContain('/waba_1/subscribed_apps')
    expect(init1.method).toBe('POST')
    expect(init1.headers.Authorization).toBe('Bearer tok_1')
    const body1 = new URLSearchParams(String(init1.body))
    const fields = (body1.get('subscribed_fields') || '').split(',')
    expect(fields).toContain('messages')
    expect(fields).toContain('smb_message_echoes')
    expect(body1.get('override_callback_uri')).toBeNull()

    const [url2, init2] = fetchWithTimeout.mock.calls[1]
    expect(url2).toContain('/waba_1/subscribed_apps')
    const body2 = new URLSearchParams(String(init2.body))
    expect(body2.get('override_callback_uri')).toBe('https://app.vsmart.com/api/webhook')
    expect(body2.get('verify_token')).toBe('vt_1')
  })

  it('retorna ok=false com a mensagem de erro da Meta quando a inscrição de campos (1ª chamada) falha, sem tentar o override', async () => {
    fetchWithTimeout.mockResolvedValueOnce({
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
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1)
  })

  it('retorna ok=false quando a inscrição de campos funciona mas o override (2ª chamada) falha', async () => {
    fetchWithTimeout
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Before override the current callback uri...' } }),
      })

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('override')
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2)
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
