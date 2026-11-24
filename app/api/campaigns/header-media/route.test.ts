// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const ctxMock = vi.fn(async () => ({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false }) as any)
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => ctxMock() }))
const credsMock = vi.fn(async () => ({ phoneNumberId: 'pn1', accessToken: 'tok', businessAccountId: 'ba' }) as any)
vi.mock('@/lib/whatsapp-credentials', () => ({ getWhatsAppCredentials: (...a: any[]) => credsMock(...a) }))
const uploadMock = vi.fn(async () => ({ ok: true, id: 'media-123' }) as any)
vi.mock('@/lib/whatsapp/media', () => ({ uploadMediaToMeta: (...a: any[]) => uploadMock(...a) }))

import { POST } from './route'

function req(file: File | null, format: string | null) {
  const fd = new FormData()
  if (file) fd.set('file', file)
  if (format) fd.set('format', format)
  return new NextRequest('http://x/api/campaigns/header-media', { method: 'POST', body: fd })
}
const png = (size = 1000) => new File([new Uint8Array(size)], 'a.png', { type: 'image/png' })

describe('POST /api/campaigns/header-media', () => {
  beforeEach(() => {
    uploadMock.mockClear()
    credsMock.mockClear()
    ctxMock.mockResolvedValue({ tenantId: 't1', userId: 'u1', isPlatformAdmin: false })
    uploadMock.mockResolvedValue({ ok: true, id: 'media-123' })
    credsMock.mockResolvedValue({ phoneNumberId: 'pn1', accessToken: 'tok', businessAccountId: 'ba' })
  })

  it('401 sem sessão', async () => {
    ctxMock.mockResolvedValueOnce(null)
    expect((await POST(req(png(), 'IMAGE'))).status).toBe(401)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('sobe a imagem com as credenciais do tenant e devolve o media id', async () => {
    const res = await POST(req(png(), 'IMAGE'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, mediaId: 'media-123' })
    expect(credsMock).toHaveBeenCalledWith('t1')
    expect(uploadMock.mock.calls[0][0]).toMatchObject({ phoneNumberId: 'pn1', accessToken: 'tok', contentType: 'image/png' })
  })

  it('400 sem arquivo ou sem formato', async () => {
    expect((await POST(req(null, 'IMAGE'))).status).toBe(400)
    expect((await POST(req(png(), null))).status).toBe(400)
  })

  it('422 para tipo errado (PDF em cabeçalho de imagem)', async () => {
    const pdf = new File([new Uint8Array(100)], 'a.pdf', { type: 'application/pdf' })
    const res = await POST(req(pdf, 'IMAGE'))
    expect(res.status).toBe(422)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('422 para imagem acima de 5 MB', async () => {
    const res = await POST(req(png(5_000_001), 'IMAGE'))
    expect(res.status).toBe(422)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('aceita vídeo MP4 e recusa vídeo acima de 16 MB', async () => {
    const ok = new File([new Uint8Array(2000)], 'v.mp4', { type: 'video/mp4' })
    expect((await POST(req(ok, 'VIDEO'))).status).toBe(200)
    const big = new File([new Uint8Array(16_000_001)], 'v.mp4', { type: 'video/mp4' })
    expect((await POST(req(big, 'VIDEO'))).status).toBe(422)
  })

  it('409 quando o WhatsApp não está configurado', async () => {
    credsMock.mockResolvedValueOnce(null)
    expect((await POST(req(png(), 'IMAGE'))).status).toBe(409)
  })

  it('502 com mensagem quando a Meta recusa o upload', async () => {
    uploadMock.mockResolvedValueOnce({ ok: false, error: 'boom' })
    const res = await POST(req(png(), 'IMAGE'))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/boom/)
  })
})
