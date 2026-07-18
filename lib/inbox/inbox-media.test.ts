import { describe, it, expect, vi, beforeEach } from 'vitest'

const downloadMetaMediaMock = vi.fn()
vi.mock('@/lib/whatsapp/media', () => ({
  downloadMetaMedia: (...args: unknown[]) => downloadMetaMediaMock(...args),
}))

const uploadMock = vi.fn()
const createSignedUrlMock = vi.fn()
const updateEqEqMock = vi.fn()
const maybeSingleMock = vi.fn()

const supabaseAdminMock = {
  storage: {
    from: vi.fn(() => ({
      upload: uploadMock,
      createSignedUrl: createSignedUrlMock,
    })),
  },
  from: vi.fn(() => ({
    update: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: updateEqEqMock,
      })),
    })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: maybeSingleMock,
        })),
      })),
    })),
  })),
}

const getSupabaseAdminMock = vi.fn(() => supabaseAdminMock)
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: (...args: unknown[]) => getSupabaseAdminMock(...args),
}))

import { storeInboundMedia, storeOutboundMedia, getSignedMediaUrl, extFromMime } from './inbox-media'

describe('extFromMime', () => {
  it('mapeia mimes comuns do WhatsApp', () => {
    expect(extFromMime('image/jpeg')).toBe('jpg')
    expect(extFromMime('image/png')).toBe('png')
    expect(extFromMime('audio/ogg')).toBe('ogg')
    expect(extFromMime('audio/mpeg')).toBe('mp3')
    expect(extFromMime('video/mp4')).toBe('mp4')
    expect(extFromMime('application/pdf')).toBe('pdf')
  })

  it('usa fallback "bin" para mimes desconhecidos', () => {
    expect(extFromMime('application/x-unknown')).toBe('bin')
    expect(extFromMime(undefined)).toBe('bin')
    expect(extFromMime(null)).toBe('bin')
  })
})

describe('storeInboundMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseAdminMock.mockReturnValue(supabaseAdminMock)
  })

  it('em sucesso: baixa da Meta, sobe no path certo e marca media_status=ready', async () => {
    downloadMetaMediaMock.mockResolvedValue({
      ok: true,
      buffer: Buffer.from('fake-bytes'),
      mime: 'image/jpeg',
      size: 10,
    })
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null })
    updateEqEqMock.mockResolvedValue({ data: null, error: null })

    await storeInboundMedia({
      tenantId: 'tenant_1',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      mediaId: 'media_1',
      accessToken: 'token_1',
    })

    expect(downloadMetaMediaMock).toHaveBeenCalledWith({ mediaId: 'media_1', accessToken: 'token_1' })
    expect(supabaseAdminMock.storage.from).toHaveBeenCalledWith('wa-inbox-media')
    expect(uploadMock).toHaveBeenCalledWith(
      'tenant_1/conv_1/msg_1.jpg',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'image/jpeg', upsert: true })
    )
    expect(supabaseAdminMock.from).toHaveBeenCalledWith('inbox_messages')
    expect(updateEqEqMock).toHaveBeenCalled()
  })

  it('em erro de download: marca media_status=failed e não lança', async () => {
    downloadMetaMediaMock.mockResolvedValue({ ok: false, status: 404, error: 'not found' })
    updateEqEqMock.mockResolvedValue({ data: null, error: null })

    await expect(
      storeInboundMedia({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        mediaId: 'media_1',
        accessToken: 'token_1',
      })
    ).resolves.toBeUndefined()

    expect(uploadMock).not.toHaveBeenCalled()
    expect(updateEqEqMock).toHaveBeenCalled()
  })

  it('em erro de upload: marca media_status=failed e não lança', async () => {
    downloadMetaMediaMock.mockResolvedValue({
      ok: true,
      buffer: Buffer.from('fake-bytes'),
      mime: 'image/jpeg',
      size: 10,
    })
    uploadMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    updateEqEqMock.mockResolvedValue({ data: null, error: null })

    await expect(
      storeInboundMedia({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        messageId: 'msg_1',
        mediaId: 'media_1',
        accessToken: 'token_1',
      })
    ).resolves.toBeUndefined()

    expect(updateEqEqMock).toHaveBeenCalled()
  })
})

describe('storeOutboundMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseAdminMock.mockReturnValue(supabaseAdminMock)
  })

  it('sobe o buffer no path certo e retorna o media_path', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null })

    const path = await storeOutboundMedia({
      tenantId: 'tenant_1',
      conversationId: 'conv_1',
      messageId: 'msg_2',
      buffer: Buffer.from('outbound-bytes'),
      mime: 'application/pdf',
      filename: 'doc.pdf',
    })

    expect(supabaseAdminMock.storage.from).toHaveBeenCalledWith('wa-inbox-media')
    expect(uploadMock).toHaveBeenCalledWith(
      'tenant_1/conv_1/msg_2.pdf',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf', upsert: true })
    )
    expect(path).toBe('tenant_1/conv_1/msg_2.pdf')
  })

  it('lança quando o upload falha', async () => {
    uploadMock.mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(
      storeOutboundMedia({
        tenantId: 'tenant_1',
        conversationId: 'conv_1',
        messageId: 'msg_2',
        buffer: Buffer.from('outbound-bytes'),
        mime: 'application/pdf',
      })
    ).rejects.toThrow()
  })
})

describe('getSignedMediaUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSupabaseAdminMock.mockReturnValue(supabaseAdminMock)
  })

  it('retorna null quando a mensagem não é do tenant / não existe', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })

    const url = await getSignedMediaUrl('tenant_1', 'msg_of_other_tenant')

    expect(url).toBeNull()
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it('retorna null quando a mensagem existe mas não tem media_path', async () => {
    maybeSingleMock.mockResolvedValue({ data: { media_path: null }, error: null })

    const url = await getSignedMediaUrl('tenant_1', 'msg_1')

    expect(url).toBeNull()
    expect(createSignedUrlMock).not.toHaveBeenCalled()
  })

  it('com media_path: chama createSignedUrl(path, 300) por padrão e retorna a URL', async () => {
    maybeSingleMock.mockResolvedValue({ data: { media_path: 'tenant_1/conv_1/msg_1.jpg' }, error: null })
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null })

    const url = await getSignedMediaUrl('tenant_1', 'msg_1')

    expect(createSignedUrlMock).toHaveBeenCalledWith('tenant_1/conv_1/msg_1.jpg', 300)
    expect(url).toBe('https://signed.example/x')
  })

  it('respeita expiresIn customizado', async () => {
    maybeSingleMock.mockResolvedValue({ data: { media_path: 'tenant_1/conv_1/msg_1.jpg' }, error: null })
    createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null })

    await getSignedMediaUrl('tenant_1', 'msg_1', 60)

    expect(createSignedUrlMock).toHaveBeenCalledWith('tenant_1/conv_1/msg_1.jpg', 60)
  })
})
