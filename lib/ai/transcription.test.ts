import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const settingsGet = vi.fn()
vi.mock('@/lib/supabase-db', () => ({ settingsDb: { get: (...a: unknown[]) => settingsGet(...a) } }))

import { transcribeAudio, normalizeAudioMime } from './transcription'

const fetchMock = vi.fn()
const audio = Buffer.from('fake-audio-bytes')

function keys(map: Record<string, string | null>) {
  settingsGet.mockImplementation(async (_t: string, k: string) => map[k] ?? null)
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) })

describe('normalizeAudioMime', () => {
  it('remove o sufixo de codecs e devolve extensão', () => {
    expect(normalizeAudioMime('audio/ogg; codecs=opus')).toEqual({ mime: 'audio/ogg', filename: 'audio.ogg' })
    expect(normalizeAudioMime('audio/mpeg')).toEqual({ mime: 'audio/mpeg', filename: 'audio.mp3' })
    expect(normalizeAudioMime('')).toEqual({ mime: 'audio/ogg', filename: 'audio.ogg' })
  })
})

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sem nenhuma chave devolve no_provider e não chama a rede', async () => {
    keys({})
    expect(await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg' })).toEqual({ error: 'no_provider' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('usa a OpenAI quando há chave, com modelo, idioma e arquivo audio.ogg', async () => {
    keys({ openai_api_key: 'sk-x', google_api_key: 'g-x' })
    fetchMock.mockResolvedValueOnce(ok({ text: ' quero o preço ' }))
    const r = await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg; codecs=opus' })
    expect(r).toEqual({ text: 'quero o preço', provider: 'openai' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.headers.Authorization).toBe('Bearer sk-x')
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('language')).toBe('pt')
    expect((form.get('file') as File).name).toBe('audio.ogg')
    expect((form.get('file') as File).type).toBe('audio/ogg')
    expect(settingsGet).toHaveBeenCalledWith('t1', 'openai_api_key')
  })

  it('cai para whisper-1 quando o modelo novo não existe', async () => {
    keys({ openai_api_key: 'sk-x' })
    fetchMock
      .mockResolvedValueOnce(fail(404, { error: { code: 'model_not_found', message: 'nope' } }))
      .mockResolvedValueOnce(ok({ text: 'oi' }))
    const r = await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg' })
    expect(r).toEqual({ text: 'oi', provider: 'openai' })
    expect((fetchMock.mock.calls[1][1].body as FormData).get('model')).toBe('whisper-1')
  })

  it('usa Gemini quando só há chave Google', async () => {
    keys({ google_api_key: 'g-x' })
    fetchMock.mockResolvedValueOnce(ok({ candidates: [{ content: { parts: [{ text: 'olá, tudo bem' }] } }] }))
    const r = await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg; codecs=opus' })
    expect(r).toEqual({ text: 'olá, tudo bem', provider: 'google' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('generativelanguage.googleapis.com')
    expect(String(url)).toContain(':generateContent')
    expect(String(url)).not.toContain('g-x')
    expect(init.headers['x-goog-api-key']).toBe('g-x')
    const body = JSON.parse(init.body)
    const inline = body.contents[0].parts.find((p: any) => p.inline_data)
    expect(inline.inline_data.mime_type).toBe('audio/ogg')
    expect(inline.inline_data.data).toBe(audio.toString('base64'))
  })

  it('erro HTTP do provedor vira { error } sem lançar', async () => {
    keys({ openai_api_key: 'sk-x' })
    fetchMock.mockResolvedValueOnce(fail(500, { error: { message: 'boom' } }))
    const r = await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg' })
    expect(r).toHaveProperty('error')
    expect(JSON.stringify(r)).not.toContain('sk-x')
  })

  it('exceção de rede/timeout vira { error } sem lançar', async () => {
    keys({ openai_api_key: 'sk-x' })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const r = await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg' })
    expect(r).toEqual({ error: 'timeout' })
  })

  it('texto vazio do provedor é erro empty_transcription', async () => {
    keys({ openai_api_key: 'sk-x' })
    fetchMock.mockResolvedValueOnce(ok({ text: '   ' }))
    expect(await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg' })).toEqual({ error: 'empty_transcription' })
  })

  it('rejeita áudio acima de 25 MB sem chamar a rede', async () => {
    keys({ openai_api_key: 'sk-x' })
    const big = Buffer.alloc(25 * 1024 * 1024 + 1)
    expect(await transcribeAudio({ tenantId: 't1', audio: big, mimeType: 'audio/ogg' })).toEqual({ error: 'too_large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falha ao ler configurações não lança', async () => {
    settingsGet.mockRejectedValue(new Error('db'))
    expect(await transcribeAudio({ tenantId: 't1', audio, mimeType: 'audio/ogg' })).toEqual({ error: 'no_provider' })
  })
})
