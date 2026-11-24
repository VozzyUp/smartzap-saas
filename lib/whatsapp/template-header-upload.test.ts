import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  TEMPLATE_HEADER_LIMITS,
  guessHeaderMimeType,
  validateTemplateHeaderFile,
  uploadTemplateHeaderSample,
  TemplateHeaderUploadError,
} from './template-header-upload'

const TOKEN = 'EAAG_super_secret_token_123'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateTemplateHeaderFile', () => {
  it('aceita imagem PNG e JPEG dentro do limite', () => {
    expect(validateTemplateHeaderFile({ format: 'IMAGE', fileName: 'a.png', size: 1000, mimeType: 'image/png' }).ok).toBe(true)
    expect(validateTemplateHeaderFile({ format: 'IMAGE', fileName: 'a.jpg', size: 1000, mimeType: 'image/jpeg' }).ok).toBe(true)
  })

  it('aceita vídeo MP4 de 16 MB (limite da Meta)', () => {
    const r = validateTemplateHeaderFile({ format: 'VIDEO', fileName: 'v.mp4', size: TEMPLATE_HEADER_LIMITS.VIDEO.maxBytes, mimeType: 'video/mp4' })
    expect(r.ok).toBe(true)
    expect(TEMPLATE_HEADER_LIMITS.VIDEO.maxBytes).toBe(16_000_000)
  })

  it('rejeita vídeo um byte acima do limite com mensagem em português', () => {
    const r = validateTemplateHeaderFile({ format: 'VIDEO', fileName: 'v.mp4', size: TEMPLATE_HEADER_LIMITS.VIDEO.maxBytes + 1, mimeType: 'video/mp4' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/muito grande/i)
  })

  it('rejeita imagem acima de 5 MB', () => {
    const r = validateTemplateHeaderFile({ format: 'IMAGE', fileName: 'a.png', size: 5_000_001, mimeType: 'image/png' })
    expect(r.ok).toBe(false)
  })

  it('rejeita tipo inválido (webp como imagem, mov como vídeo)', () => {
    const img = validateTemplateHeaderFile({ format: 'IMAGE', fileName: 'a.webp', size: 10, mimeType: 'image/webp' })
    const vid = validateTemplateHeaderFile({ format: 'VIDEO', fileName: 'a.mov', size: 10, mimeType: 'video/quicktime' })
    expect(img.ok).toBe(false)
    expect(vid.ok).toBe(false)
    if (!img.ok) expect(img.error).toMatch(/tipo/i)
  })

  it('rejeita arquivo vazio e formato desconhecido', () => {
    expect(validateTemplateHeaderFile({ format: 'IMAGE', fileName: 'a.png', size: 0, mimeType: 'image/png' }).ok).toBe(false)
    expect(validateTemplateHeaderFile({ format: 'AUDIO' as any, fileName: 'a.mp3', size: 10, mimeType: 'audio/mpeg' }).ok).toBe(false)
  })

  it('infere o MIME pela extensão quando o navegador não informa', () => {
    expect(guessHeaderMimeType('Foto Promoção.JPG', '')).toBe('image/jpeg')
    expect(guessHeaderMimeType('x.mp4', 'application/octet-stream')).toBe('video/mp4')
    const r = validateTemplateHeaderFile({ format: 'VIDEO', fileName: 'promo.mp4', size: 10, mimeType: '' })
    expect(r.ok).toBe(true)
  })

  it('aceita PDF como documento', () => {
    expect(validateTemplateHeaderFile({ format: 'DOCUMENT', fileName: 'c.pdf', size: 1000, mimeType: 'application/pdf' }).ok).toBe(true)
  })
})

describe('uploadTemplateHeaderSample', () => {
  const base = {
    appId: '12345',
    accessToken: TOKEN,
    fileName: 'Promoção de Verão.mp4',
    mimeType: 'video/mp4',
    bytes: new Uint8Array([1, 2, 3, 4]),
  }

  it('faz as duas etapas (sessão e bytes) e devolve o handle', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:abc123' }))
      .mockResolvedValueOnce(jsonResponse({ h: '4::aW1hZ2U=' }))

    const out = await uploadTemplateHeaderSample({ ...base, fetchImpl })
    expect(out.handle).toBe('4::aW1hZ2U=')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [startUrl, startInit] = fetchImpl.mock.calls[0]
    const u = new URL(String(startUrl))
    expect(u.pathname).toMatch(/^\/v\d+\.\d+\/12345\/uploads$/)
    expect(u.searchParams.get('file_name')).toBe('Promoção de Verão.mp4')
    expect(u.searchParams.get('file_length')).toBe('4')
    expect(u.searchParams.get('file_type')).toBe('video/mp4')
    expect(startInit.method).toBe('POST')

    const [transferUrl, transferInit] = fetchImpl.mock.calls[1]
    expect(String(transferUrl)).toMatch(/\/v\d+\.\d+\/upload:abc123$/)
    expect(transferInit.headers.Authorization).toBe(`OAuth ${TOKEN}`)
    expect(transferInit.headers.file_offset).toBe('0')
    expect(transferInit.body).toEqual(base.bytes)
  })

  it('dois envios seguidos geram sessões independentes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:1' }))
      .mockResolvedValueOnce(jsonResponse({ h: 'H1' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:2' }))
      .mockResolvedValueOnce(jsonResponse({ h: 'H2' }))
    const a = await uploadTemplateHeaderSample({ ...base, fetchImpl })
    const b = await uploadTemplateHeaderSample({ ...base, fetchImpl })
    expect([a.handle, b.handle]).toEqual(['H1', 'H2'])
  })

  it('erro da Meta na sessão: mensagem amigável, original no log, sem token', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: `Invalid OAuth access token ${TOKEN}`, code: 190 } }, 400))

    const p = uploadTemplateHeaderSample({ ...base, fetchImpl })
    await expect(p).rejects.toBeInstanceOf(TemplateHeaderUploadError)
    const err = (await p.catch((e) => e)) as TemplateHeaderUploadError
    expect(err.status).toBe(502)
    expect(err.userMessage).toMatch(/Meta/)
    expect(err.userMessage).not.toContain(TOKEN)

    const logged = JSON.stringify(errSpy.mock.calls)
    expect(logged).toContain('Invalid OAuth access token')
    expect(logged).not.toContain(TOKEN)
  })

  it('erro da Meta ao enviar bytes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:abc' }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'Session has expired', code: 100 } }, 400))
    const err = (await uploadTemplateHeaderSample({ ...base, fetchImpl }).catch((e) => e)) as TemplateHeaderUploadError
    expect(err).toBeInstanceOf(TemplateHeaderUploadError)
    expect(err.status).toBe(502)
  })

  it('falha se a resposta não traz id de sessão ou handle', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const noId = vi.fn().mockResolvedValueOnce(jsonResponse({ id: 'xyz' }))
    await expect(uploadTemplateHeaderSample({ ...base, fetchImpl: noId })).rejects.toBeInstanceOf(TemplateHeaderUploadError)

    const noHandle = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'upload:1' }))
      .mockResolvedValueOnce(jsonResponse({}))
    await expect(uploadTemplateHeaderSample({ ...base, fetchImpl: noHandle })).rejects.toBeInstanceOf(TemplateHeaderUploadError)
  })

  it('tempo esgotado vira mensagem amigável (504) sem vazar token', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const abort = Object.assign(new Error(`aborted ${TOKEN}`), { name: 'AbortError' })
    const fetchImpl = vi.fn().mockRejectedValueOnce(abort)
    const err = (await uploadTemplateHeaderSample({ ...base, fetchImpl }).catch((e) => e)) as TemplateHeaderUploadError
    expect(err.status).toBe(504)
    expect(err.userMessage).toMatch(/tempo|timeout/i)
    expect(err.userMessage).not.toContain(TOKEN)
  })

  it('falha de rede vira mensagem amigável (502)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
    const err = (await uploadTemplateHeaderSample({ ...base, fetchImpl }).catch((e) => e)) as TemplateHeaderUploadError
    expect(err.status).toBe(502)
    expect(err.userMessage).toMatch(/Meta/)
  })
})
