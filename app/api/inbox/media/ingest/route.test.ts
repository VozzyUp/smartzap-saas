import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock do wrapper oficial de verificação de assinatura QStash
// (@upstash/qstash/nextjs). Em produção, `verifySignatureAppRouter` valida o
// header `Upstash-Signature` contra QSTASH_CURRENT_SIGNING_KEY/QSTASH_NEXT_SIGNING_KEY
// e retorna 401 automaticamente quando inválida — aqui simulamos esse contrato.
vi.mock('@upstash/qstash/nextjs', () => ({
  verifySignatureAppRouter: (handler: (request: NextRequest) => Promise<Response>) =>
    async (request: NextRequest) => {
      const signature = request.headers.get('upstash-signature')
      if (signature !== 'valid-signature') {
        return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 })
      }
      return handler(request)
    },
}))

const storeInboundMediaMock = vi.fn()
vi.mock('@/lib/inbox/inbox-media', () => ({
  storeInboundMedia: (...args: unknown[]) => storeInboundMediaMock(...args),
}))

const getWhatsAppCredentialsMock = vi.fn()
vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentials: (...args: unknown[]) => getWhatsAppCredentialsMock(...args),
}))

import { POST } from './route'

function makeRequest(body: unknown, signature: string | null = 'valid-signature') {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (signature) headers.set('upstash-signature', signature)
  return new NextRequest('https://app.example.com/api/inbox/media/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/inbox/media/ingest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assinatura QStash inválida -> 401, não chama storeInboundMedia', async () => {
    const res = await POST(makeRequest({
      tenantId: 't1', conversationId: 'c1', messageId: 'm1', mediaId: 'media_1',
    }, 'bad-signature'))

    expect(res.status).toBe(401)
    expect(storeInboundMediaMock).not.toHaveBeenCalled()
  })

  it('corpo com campo faltando -> 400', async () => {
    const res = await POST(makeRequest({ tenantId: 't1', conversationId: 'c1', messageId: 'm1' }))

    expect(res.status).toBe(400)
    expect(storeInboundMediaMock).not.toHaveBeenCalled()
  })

  it('corpo válido + credencial encontrada -> chama storeInboundMedia com o token resolvido -> 200', async () => {
    getWhatsAppCredentialsMock.mockResolvedValue({
      phoneNumberId: 'pn1',
      businessAccountId: 'ba1',
      accessToken: 'token_abc',
    })
    storeInboundMediaMock.mockResolvedValue(undefined)

    const res = await POST(makeRequest({
      tenantId: 't1', conversationId: 'c1', messageId: 'm1', mediaId: 'media_1',
    }))

    expect(res.status).toBe(200)
    expect(getWhatsAppCredentialsMock).toHaveBeenCalledWith('t1')
    expect(storeInboundMediaMock).toHaveBeenCalledWith({
      tenantId: 't1',
      conversationId: 'c1',
      messageId: 'm1',
      mediaId: 'media_1',
      accessToken: 'token_abc',
    })
  })

  it('sem credencial do tenant -> 200 sem chamar storeInboundMedia (best-effort, evita re-try infinito)', async () => {
    getWhatsAppCredentialsMock.mockResolvedValue(null)

    const res = await POST(makeRequest({
      tenantId: 't1', conversationId: 'c1', messageId: 'm1', mediaId: 'media_1',
    }))

    expect(res.status).toBe(200)
    expect(storeInboundMediaMock).not.toHaveBeenCalled()
  })

  it('storeInboundMedia lançando (inesperado) ainda retorna 200 (nunca re-tentar QStash por download com falha)', async () => {
    getWhatsAppCredentialsMock.mockResolvedValue({
      phoneNumberId: 'pn1',
      businessAccountId: 'ba1',
      accessToken: 'token_abc',
    })
    storeInboundMediaMock.mockRejectedValue(new Error('boom'))

    const res = await POST(makeRequest({
      tenantId: 't1', conversationId: 'c1', messageId: 'm1', mediaId: 'media_1',
    }))

    expect(res.status).toBe(200)
  })
})
