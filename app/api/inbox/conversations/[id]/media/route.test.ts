// @vitest-environment node
//
// Este arquivo precisa do ambiente `node` (não `jsdom`, o default do repo):
// o FormData/File do jsdom não é compatível com o parsing de multipart do
// NextRequest (baseado em undici) — `request.formData()` falhava com
// "Invalid multipart body" sob jsdom mesmo com um corpo multipart válido.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let ctxMock: any = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: vi.fn(async () => ctxMock),
}))

const getConversationByIdMock = vi.fn()
const createMessageMock = vi.fn()
vi.mock('@/lib/inbox/inbox-db', () => ({
  getConversationById: (...args: unknown[]) => getConversationByIdMock(...args),
  createMessage: (...args: unknown[]) => createMessageMock(...args),
}))

const getWhatsAppCredentialsForNumberMock = vi.fn()
vi.mock('@/lib/whatsapp-credentials', () => ({
  getWhatsAppCredentialsForNumber: (...args: unknown[]) => getWhatsAppCredentialsForNumberMock(...args),
}))

const uploadMediaToMetaMock = vi.fn()
const downloadMetaMediaMock = vi.fn()
vi.mock('@/lib/whatsapp/media', () => ({
  uploadMediaToMeta: (...args: unknown[]) => uploadMediaToMetaMock(...args),
  downloadMetaMedia: (...args: unknown[]) => downloadMetaMediaMock(...args),
}))

const sendWhatsAppMediaMock = vi.fn()
vi.mock('@/lib/whatsapp-send', () => ({
  sendWhatsAppMedia: (...args: unknown[]) => sendWhatsAppMediaMock(...args),
}))

const storeOutboundMediaMock = vi.fn()
vi.mock('@/lib/inbox/inbox-media', () => ({
  storeOutboundMedia: (...args: unknown[]) => storeOutboundMediaMock(...args),
}))

const remuxToOggOpusMock = vi.fn()
vi.mock('@/lib/audio/voice-remux', () => ({
  remuxToOggOpus: (...args: unknown[]) => remuxToOggOpusMock(...args),
}))

const updateEqEqMock = vi.fn()
const supabaseAdminMock = {
  from: vi.fn(() => ({
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: updateEqEqMock,
      })),
    })),
  })),
}
const getSupabaseAdminMock = vi.fn(() => supabaseAdminMock)
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdminMock(...args),
}))

import { POST } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(formData: FormData) {
  return new NextRequest('http://localhost/api/inbox/conversations/conv_1/media', {
    method: 'POST',
    body: formData,
  })
}

const conversation = {
  id: 'conv_1',
  tenant_id: 't1',
  phone: '+5511999999999',
  whatsapp_number_id: 'pn_1',
}

const credentials = {
  phoneNumberId: 'pn_1',
  businessAccountId: 'ba_1',
  accessToken: 'token_abc',
}

function oggOpusMono(): Buffer {
  const packet = Buffer.from([
    ...Buffer.from('OpusHead'),
    1, 1, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0,
  ])
  const header = Buffer.alloc(28)
  header.write('OggS', 0, 'ascii')
  header[26] = 1
  header[27] = packet.length
  return Buffer.concat([header, packet])
}

describe('POST /api/inbox/conversations/[id]/media', () => {
  beforeEach(() => {
    ctxMock = { tenantId: 't1', userId: 'u1', isPlatformAdmin: false }
    vi.clearAllMocks()
    getConversationByIdMock.mockResolvedValue(conversation)
    getWhatsAppCredentialsForNumberMock.mockResolvedValue(credentials)
    getSupabaseAdminMock.mockReturnValue(supabaseAdminMock)
    updateEqEqMock.mockResolvedValue({ data: null, error: null })
    downloadMetaMediaMock.mockResolvedValue({
      ok: true,
      buffer: oggOpusMono(),
      mime: 'audio/ogg; codecs=opus',
      size: 47,
    })
  })

  it('401 sem sessão', async () => {
    ctxMock = null
    const fd = new FormData()
    fd.set('file', new File(['abc'], 'photo.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(401)
    expect(uploadMediaToMetaMock).not.toHaveBeenCalled()
  })

  it('400 quando o arquivo excede o tamanho máximo do tipo (imagem > 5MB)', async () => {
    const bigBuffer = new Uint8Array(5 * 1024 * 1024 + 1)
    const fd = new FormData()
    fd.set('file', new File([bigBuffer], 'photo.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(400)
    expect(uploadMediaToMetaMock).not.toHaveBeenCalled()
  })

  it('400 quando o mime type não está na whitelist', async () => {
    const fd = new FormData()
    fd.set('file', new File(['abc'], 'app.exe', { type: 'application/x-msdownload' }))
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(400)
    expect(uploadMediaToMetaMock).not.toHaveBeenCalled()
  })

  it('400 quando nenhum arquivo é enviado', async () => {
    const fd = new FormData()
    fd.set('caption', 'oi')
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(400)
  })

  it('404 quando a conversa não existe ou não é do tenant', async () => {
    getConversationByIdMock.mockResolvedValue(null)
    const fd = new FormData()
    fd.set('file', new File(['abc'], 'photo.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(404)
  })

  it('409 quando não há credenciais WhatsApp para o número da conversa', async () => {
    getWhatsAppCredentialsForNumberMock.mockResolvedValue(null)
    const fd = new FormData()
    fd.set('file', new File(['abc'], 'photo.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(409)
    expect(uploadMediaToMetaMock).not.toHaveBeenCalled()
  })

  it('502 quando uploadMediaToMeta falha', async () => {
    uploadMediaToMetaMock.mockResolvedValue({ ok: false, status: 500, error: 'meta down' })
    const fd = new FormData()
    fd.set('file', new File(['abc'], 'photo.jpg', { type: 'image/jpeg' }))
    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(502)
    expect(sendWhatsAppMediaMock).not.toHaveBeenCalled()
  })

  it('sucesso: sobe à Meta, envia, persiste a mensagem outbound com media_path -> 200', async () => {
    uploadMediaToMetaMock.mockResolvedValue({ ok: true, id: 'media_123' })
    sendWhatsAppMediaMock.mockResolvedValue({ success: true, messageId: 'wamid.abc' })
    createMessageMock.mockResolvedValue({
      id: 'msg_1',
      tenant_id: 't1',
      conversation_id: 'conv_1',
      direction: 'outbound',
      content: 'legenda',
      message_type: 'image',
    })
    storeOutboundMediaMock.mockResolvedValue('t1/conv_1/msg_1.jpg')

    const fd = new FormData()
    fd.set('file', new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' }))
    fd.set('caption', 'legenda')

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })

    expect(uploadMediaToMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pn_1',
        accessToken: 'token_abc',
        contentType: 'image/jpeg',
        filename: 'photo.jpg',
      })
    )

    expect(sendWhatsAppMediaMock).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        to: '+5511999999999',
        type: 'image',
        mediaId: 'media_123',
        caption: 'legenda',
        credentials,
      })
    )

    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 't1',
        conversation_id: 'conv_1',
        direction: 'outbound',
        content: 'legenda',
        message_type: 'image',
        whatsapp_message_id: 'wamid.abc',
        delivery_status: 'sent',
      })
    )

    expect(storeOutboundMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        mime: 'image/jpeg',
        filename: 'photo.jpg',
      })
    )

    expect(supabaseAdminMock.from).toHaveBeenCalledWith('inbox_messages')
    expect(updateEqEqMock).toHaveBeenCalled()
  })

  it('storeOutboundMedia falhando ainda retorna 200 (mensagem já enviada; marca media_status=failed)', async () => {
    uploadMediaToMetaMock.mockResolvedValue({ ok: true, id: 'media_123' })
    sendWhatsAppMediaMock.mockResolvedValue({ success: true, messageId: 'wamid.abc' })
    createMessageMock.mockResolvedValue({ id: 'msg_1' })
    storeOutboundMediaMock.mockRejectedValue(new Error('bucket boom'))

    const fd = new FormData()
    fd.set('file', new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' }))

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(200)
    expect(updateEqEqMock).toHaveBeenCalled()
  })

  it('voice=true remuxa para ogg/opus antes de enviar como nota de voz (Fase 5B)', async () => {
    remuxToOggOpusMock.mockResolvedValue({
      buffer: oggOpusMono(),
      mime: 'audio/ogg; codecs=opus',
      remuxed: true,
    })
    uploadMediaToMetaMock.mockResolvedValue({ ok: true, id: 'media_voice' })
    sendWhatsAppMediaMock.mockResolvedValue({ success: true, messageId: 'wamid.voice' })
    createMessageMock.mockResolvedValue({ id: 'msg_voice' })
    storeOutboundMediaMock.mockResolvedValue('t1/conv_1/msg_voice.ogg')

    const fd = new FormData()
    fd.set('file', new File(['webm-bytes'], 'voice.webm', { type: 'audio/webm' }))
    fd.set('voice', 'true')

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })

    expect(remuxToOggOpusMock).toHaveBeenCalledTimes(1)
    expect(remuxToOggOpusMock).toHaveBeenCalledWith(expect.any(Buffer), 'audio/webm')

    expect(uploadMediaToMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'audio/ogg; codecs=opus',
        filename: 'voice.ogg',
      })
    )

    expect(sendWhatsAppMediaMock).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        type: 'audio',
        mediaId: 'media_voice',
        filename: 'voice.ogg',
        voice: true,
      })
    )

    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ message_type: 'audio' })
    )

    expect(storeOutboundMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: 'audio/ogg; codecs=opus',
        filename: 'voice.ogg',
      })
    )

    // Perf: o envio não deve re-baixar a mídia da Meta para "validar" — isso
    // era um round-trip inteiro a mais por nota de voz (andaime de diagnóstico).
    expect(downloadMetaMediaMock).not.toHaveBeenCalled()
  })

  it('voice=true não envia o áudio original quando a normalização para OGG/Opus falha', async () => {
    remuxToOggOpusMock.mockResolvedValue({
      buffer: Buffer.from('audio-original'),
      mime: 'audio/mp4',
      remuxed: false,
    })

    const fd = new FormData()
    fd.set('file', new File(['audio-original'], 'voice.m4a', { type: 'audio/mp4' }))
    fd.set('voice', 'true')

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toContain('OGG/Opus')
    expect(uploadMediaToMetaMock).not.toHaveBeenCalled()
    expect(sendWhatsAppMediaMock).not.toHaveBeenCalled()
  })

  it('502 quando a Meta rejeita o envio e nao persiste uma mensagem como enviada', async () => {
    uploadMediaToMetaMock.mockResolvedValue({ ok: true, id: 'media_123' })
    sendWhatsAppMediaMock.mockResolvedValue({
      success: false,
      error: 'Media upload has failed',
      details: { error: { code: 131053 } },
    })

    const fd = new FormData()
    fd.set('file', new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' }))

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toContain('Media upload has failed')
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(storeOutboundMediaMock).not.toHaveBeenCalled()
  })

  it('502 quando a Meta responde sucesso sem messageId', async () => {
    uploadMediaToMetaMock.mockResolvedValue({ ok: true, id: 'media_123' })
    sendWhatsAppMediaMock.mockResolvedValue({ success: true })

    const fd = new FormData()
    fd.set('file', new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' }))

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toContain('message_id')
    expect(createMessageMock).not.toHaveBeenCalled()
    expect(storeOutboundMediaMock).not.toHaveBeenCalled()
  })

  it('sem voice: audio comum da 5A nao aciona remux (sem regressao)', async () => {
    uploadMediaToMetaMock.mockResolvedValue({ ok: true, id: 'media_1' })
    sendWhatsAppMediaMock.mockResolvedValue({ success: true, messageId: 'wamid.audio' })
    createMessageMock.mockResolvedValue({ id: 'msg_audio' })
    storeOutboundMediaMock.mockResolvedValue('t1/conv_1/msg_audio.mp3')

    const fd = new FormData()
    fd.set('file', new File(['mp3-bytes'], 'audio.mp3', { type: 'audio/mpeg' }))

    const res = await POST(makeRequest(fd), makeParams('conv_1'))
    expect(res.status).toBe(200)

    expect(remuxToOggOpusMock).not.toHaveBeenCalled()
    expect(uploadMediaToMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'audio/mpeg', filename: 'audio.mp3' })
    )
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ message_type: 'audio' })
    )
  })
})
