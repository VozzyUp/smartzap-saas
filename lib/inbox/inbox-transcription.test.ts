import { describe, it, expect, vi, beforeEach } from 'vitest'

const transcribeAudio = vi.fn()
const downloadMetaMedia = vi.fn()
const getCreds = vi.fn()
const updateSpy = vi.fn()
const eqCalls: Array<[string, unknown]> = []

vi.mock('@/lib/ai/transcription', () => ({ transcribeAudio: (...a: unknown[]) => transcribeAudio(...a) }))
vi.mock('@/lib/whatsapp/media', () => ({ downloadMetaMedia: (...a: unknown[]) => downloadMetaMedia(...a) }))
vi.mock('@/lib/whatsapp-credentials', () => ({ getWhatsAppCredentialsForNumber: (...a: unknown[]) => getCreds(...a) }))
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: (v: unknown) => {
        updateSpy(v)
        const chain: any = {
          eq: (k: string, val: unknown) => {
            eqCalls.push([k, val])
            return chain
          },
          then: (r: any) => r({ error: null }),
        }
        return chain
      },
    }),
  }),
}))

import { ensureAudioTranscriptions } from './inbox-transcription'

const audioMsg = (over: Record<string, unknown> = {}) =>
  ({
    id: 'm1',
    direction: 'inbound',
    message_type: 'audio',
    content: '',
    media_mime: 'audio/ogg; codecs=opus',
    payload: { media_id: 'media-1', phone_number_id: 'pn1' },
    ...over,
  }) as any

describe('ensureAudioTranscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eqCalls.length = 0
    getCreds.mockResolvedValue({ accessToken: 'tok', phoneNumberId: 'pn1', businessAccountId: 'b' })
    downloadMetaMedia.mockResolvedValue({ ok: true, buffer: Buffer.from('x'), mime: 'audio/ogg; codecs=opus', size: 1 })
    transcribeAudio.mockResolvedValue({ text: 'quero o preço', provider: 'openai' })
  })

  it('transcreve áudio recebido sem transcrição, grava no payload filtrando por tenant e devolve a mensagem atualizada', async () => {
    const out = await ensureAudioTranscriptions('t1', [audioMsg()])
    expect(getCreds).toHaveBeenCalledWith('t1', 'pn1')
    expect(downloadMetaMedia).toHaveBeenCalledWith({ mediaId: 'media-1', accessToken: 'tok' })
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', mimeType: 'audio/ogg; codecs=opus' }))
    const saved = updateSpy.mock.calls[0][0].payload
    expect(saved.media_id).toBe('media-1')
    expect(saved.transcription).toMatchObject({ text: 'quero o preço', provider: 'openai' })
    expect(saved.transcription.at).toBeTruthy()
    expect(eqCalls).toContainEqual(['tenant_id', 't1'])
    expect(eqCalls).toContainEqual(['id', 'm1'])
    expect((out[0].payload as any).transcription.text).toBe('quero o preço')
  })

  it('é idempotente: mensagem com transcrição ou com erro registrado não é processada de novo', async () => {
    const a = audioMsg({ payload: { transcription: { text: 'já' } } })
    const b = audioMsg({ id: 'm2', payload: { media_id: 'x', transcription_error: 'no_provider' } })
    const out = await ensureAudioTranscriptions('t1', [a, b])
    expect(transcribeAudio).not.toHaveBeenCalled()
    expect(downloadMetaMedia).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(out).toEqual([a, b])
  })

  it('ignora texto, áudio enviado por nós e áudio com legenda', async () => {
    const msgs = [
      audioMsg({ id: 'a', message_type: 'text' }),
      audioMsg({ id: 'b', direction: 'outbound' }),
      audioMsg({ id: 'c', content: 'legenda' }),
    ]
    await ensureAudioTranscriptions('t1', msgs)
    expect(transcribeAudio).not.toHaveBeenCalled()
  })

  it('falha da transcrição grava transcription_error e não lança', async () => {
    transcribeAudio.mockResolvedValue({ error: 'no_provider' })
    const out = await ensureAudioTranscriptions('t1', [audioMsg()])
    expect(updateSpy.mock.calls[0][0].payload.transcription_error).toBe('no_provider')
    expect((out[0].payload as any).transcription).toBeUndefined()
  })

  it('falha no download não lança e registra erro', async () => {
    downloadMetaMedia.mockResolvedValue({ ok: false, status: 400, error: 'x' })
    const out = await ensureAudioTranscriptions('t1', [audioMsg()])
    expect(transcribeAudio).not.toHaveBeenCalled()
    expect(updateSpy.mock.calls[0][0].payload.transcription_error).toBe('download_failed')
    expect(out).toHaveLength(1)
  })

  it('sem media_id no payload registra erro sem chamar a Meta', async () => {
    await ensureAudioTranscriptions('t1', [audioMsg({ payload: {} })])
    expect(downloadMetaMedia).not.toHaveBeenCalled()
    expect(updateSpy.mock.calls[0][0].payload.transcription_error).toBe('no_media_id')
  })

  it('sem credenciais do WhatsApp registra erro e segue', async () => {
    getCreds.mockResolvedValue(null)
    await ensureAudioTranscriptions('t1', [audioMsg()])
    expect(updateSpy.mock.calls[0][0].payload.transcription_error).toBe('no_credentials')
  })

  it('exceção inesperada não propaga e devolve as mensagens originais', async () => {
    transcribeAudio.mockRejectedValue(new Error('boom'))
    const out = await ensureAudioTranscriptions('t1', [audioMsg()])
    expect(out).toHaveLength(1)
  })
})
