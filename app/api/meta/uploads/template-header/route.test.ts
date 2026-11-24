// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authMock = vi.fn(async (_req: any) => null as any)
vi.mock('@/lib/request-auth', () => ({
  requireSessionOrApiKey: (...a: any[]) => authMock(...(a as [any])),
}))
const tenantMock = vi.fn(async () => ({ tenantId: 't1' }) as any)
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: () => tenantMock() }))
const appIdMock = vi.fn(async (_t: string) => '999' as string | null)
vi.mock('@/lib/meta-app-credentials', () => ({ getMetaAppId: (t: string) => appIdMock(t) }))
const credsMock = vi.fn(async (_t: string) => ({ accessToken: 'TOKEN_XYZ', businessAccountId: 'waba' }) as any)
vi.mock('@/lib/whatsapp-credentials', () => ({ getWhatsAppCredentials: (t: string) => credsMock(t) }))

const uploadMock = vi.fn()
vi.mock('@/lib/whatsapp/template-header-upload', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/template-header-upload')>('@/lib/whatsapp/template-header-upload')
  return { ...actual, uploadTemplateHeaderSample: (...a: any[]) => uploadMock(...a) }
})

import { POST } from './route'
import { TemplateHeaderUploadError } from '@/lib/whatsapp/template-header-upload'

function makeReq(opts: { format?: string; name?: string; type?: string; size?: number; noFile?: boolean }) {
  const fd = new FormData()
  if (opts.format !== undefined) fd.set('format', opts.format)
  if (!opts.noFile) {
    const bytes = new Uint8Array(opts.size ?? 10)
    fd.set('file', new File([bytes], opts.name ?? 'a.png', { type: opts.type ?? 'image/png' }))
  }
  return new NextRequest('http://localhost/api/meta/uploads/template-header', { method: 'POST', body: fd })
}

describe('POST /api/meta/uploads/template-header', () => {
  beforeEach(() => {
    authMock.mockReset().mockResolvedValue(null)
    tenantMock.mockReset().mockResolvedValue({ tenantId: 't1' })
    appIdMock.mockReset().mockResolvedValue('999')
    credsMock.mockReset().mockResolvedValue({ accessToken: 'TOKEN_XYZ', businessAccountId: 'waba' })
    uploadMock.mockReset().mockResolvedValue({ handle: 'H123' })
  })

  it('devolve o handle (imagem) usando credenciais do tenant', async () => {
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(200)
    expect((await res.json()).handle).toBe('H123')
    expect(appIdMock).toHaveBeenCalledWith('t1')
    expect(credsMock).toHaveBeenCalledWith('t1')
    const arg = uploadMock.mock.calls[0][0]
    expect(arg.appId).toBe('999')
    expect(arg.accessToken).toBe('TOKEN_XYZ')
    expect(arg.fileName).toBe('a.png')
  })

  it('aceita vídeo de 16 MB e nome com acento/espaço', async () => {
    const res = await POST(makeReq({ format: 'VIDEO', name: 'Promoção Verão.mp4', type: 'video/mp4', size: 16_000_000 }))
    expect(res.status).toBe(200)
    expect(uploadMock.mock.calls[0][0].fileName).toBe('Promoção Verão.mp4')
  })

  it('sessão expirada: repassa a resposta da autenticação sem chamar a Meta', async () => {
    authMock.mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(401)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('sem tenant: 401', async () => {
    tenantMock.mockResolvedValue(null)
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(401)
  })

  it('conta sem ID de aplicativo: 400 com orientação, sem chamar a Meta', async () => {
    appIdMock.mockResolvedValue(null)
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ID do Aplicativo/i)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('sem token de acesso: 400', async () => {
    credsMock.mockResolvedValue({ businessAccountId: 'waba' })
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(400)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('tipo inválido: 400 antes de chamar a Meta', async () => {
    const res = await POST(makeReq({ format: 'VIDEO', name: 'a.mov', type: 'video/quicktime' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/tipo/i)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('arquivo grande demais: 400 antes de chamar a Meta', async () => {
    const res = await POST(makeReq({ format: 'IMAGE', size: 5_000_001 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/muito grande/i)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('formato inválido ou arquivo ausente: 400', async () => {
    expect((await POST(makeReq({ format: 'AUDIO' }))).status).toBe(400)
    expect((await POST(makeReq({ format: 'IMAGE', noFile: true }))).status).toBe(400)
  })

  it('Meta recusa o upload: devolve mensagem amigável com o status do erro', async () => {
    uploadMock.mockRejectedValue(new TemplateHeaderUploadError('A Meta recusou o envio do arquivo.', 502, { error: { code: 100 } }))
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('A Meta recusou o envio do arquivo.')
    expect(JSON.stringify(body)).not.toContain('TOKEN_XYZ')
  })

  it('erro inesperado: 500 genérico sem vazar detalhes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    uploadMock.mockRejectedValue(new Error('boom TOKEN_XYZ'))
    const res = await POST(makeReq({ format: 'IMAGE' }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('TOKEN_XYZ')
  })
})
