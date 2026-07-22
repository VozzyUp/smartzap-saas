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

  it('faz DUAS chamadas: 1) inscrição BARE (sem nenhum parâmetro), 2) campos + override_callback_uri juntos — a Meta rejeita com erro #100 se a chamada de override não for precedida por uma inscrição prévia totalmente vazia (confirmado na doc oficial e em casos reais de terceiros com o mesmo erro)', async () => {
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
    expect(init1.body === undefined || init1.body === '').toBe(true)

    const [url2, init2] = fetchWithTimeout.mock.calls[1]
    expect(url2).toContain('/waba_1/subscribed_apps')
    const body2 = new URLSearchParams(String(init2.body))
    const fields = (body2.get('subscribed_fields') || '').split(',')
    expect(fields).toContain('messages')
    expect(fields).toContain('smb_message_echoes')
    expect(body2.get('override_callback_uri')).toBe('https://app.vsmart.com/api/webhook')
    expect(body2.get('verify_token')).toBe('vt_1')
  })

  it('retorna ok=false com a mensagem de erro da Meta quando a inscrição bare (1ª chamada) falha, sem tentar a 2ª', async () => {
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

  it('quando a 2ª chamada (messages+smb_message_echoes) falha, tenta um FALLBACK só com "messages" — se esse funcionar, retorna ok=true (smb_message_echoes pode não estar habilitado pro App na Meta ainda; não trava o essencial por causa do extra)', async () => {
    fetchWithTimeout
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // 1) bare
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Before override the current callback uri...' } }),
      }) // 2) messages+smb_message_echoes falha
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // 3) fallback só messages funciona

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })

    expect(result.ok).toBe(true)
    expect(fetchWithTimeout).toHaveBeenCalledTimes(3)

    const [, init3] = fetchWithTimeout.mock.calls[2]
    const body3 = new URLSearchParams(String(init3.body))
    expect(body3.get('subscribed_fields')).toBe('messages')
    expect(body3.get('override_callback_uri')).toBe('https://app.vsmart.com/api/webhook')
  })

  it('quando fields="messages" é passado explicitamente (número API oficial), assina só messages — sem tentar smb_message_echoes nem fallback', async () => {
    fetchWithTimeout
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // 1) bare
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // 2) override só messages

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
      fields: 'messages',
    })

    expect(result.ok).toBe(true)
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2)

    const [, init2] = fetchWithTimeout.mock.calls[1]
    const body2 = new URLSearchParams(String(init2.body))
    expect(body2.get('subscribed_fields')).toBe('messages')
  })

  it('quando fields="messages" é passado explicitamente e a 2ª chamada falha, NÃO tenta fallback (já é o mínimo) — retorna ok=false direto', async () => {
    fetchWithTimeout
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // 1) bare
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Before override the current callback uri...' } }),
      }) // 2) override só messages falha

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
      fields: 'messages',
    })

    expect(result.ok).toBe(false)
    expect(fetchWithTimeout).toHaveBeenCalledTimes(2)
  })

  it('retorna ok=false quando a 2ª chamada E o fallback (só messages) também falham', async () => {
    fetchWithTimeout
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // 1) bare
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Before override the current callback uri...' } }),
      }) // 2) messages+smb_message_echoes falha
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'Permission denied entirely' } }),
      }) // 3) fallback também falha

    const result = await subscribeWabaToWebhook({
      wabaId: 'waba_1',
      accessToken: 'tok_1',
      callbackUrl: 'https://app.vsmart.com/api/webhook',
      verifyToken: 'vt_1',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Permission denied entirely')
    expect(fetchWithTimeout).toHaveBeenCalledTimes(3)
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
