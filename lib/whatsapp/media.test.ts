import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildImageMessage,
  buildVideoMessage,
  buildAudioMessage,
  buildDocumentMessage,
  buildStickerMessage,
  buildLocationMessage,
  buildReactionMessage,
  buildCarouselMessage,
  uploadMediaToMeta,
  downloadMetaMedia,
} from './media'

// =============================================================================
// buildImageMessage
// =============================================================================
describe('buildImageMessage', () => {
  it('deve construir payload com mediaId', () => {
    const result = buildImageMessage({ to: '+5511999999999', mediaId: 'img123' })
    expect(result).toEqual({
      messaging_product: 'whatsapp',
      to: '+5511999999999',
      type: 'image',
      image: { id: 'img123', caption: undefined },
    })
  })

  it('deve construir payload com mediaUrl', () => {
    const result = buildImageMessage({ to: '+5511999999999', mediaUrl: 'https://example.com/img.jpg' })
    expect(result.image.link).toBe('https://example.com/img.jpg')
    expect(result.image.id).toBeUndefined()
  })

  it('deve preferir mediaId quando ambos são informados', () => {
    const result = buildImageMessage({
      to: '+5511999999999',
      mediaId: 'img123',
      mediaUrl: 'https://example.com/img.jpg',
    })
    expect(result.image.id).toBe('img123')
    expect(result.image.link).toBeUndefined()
  })

  it('deve incluir caption quando informado', () => {
    const result = buildImageMessage({
      to: '+5511999999999',
      mediaId: 'img123',
      caption: 'Foto do produto',
    })
    expect(result.image.caption).toBe('Foto do produto')
  })

  it('deve lançar erro quando nem mediaId nem mediaUrl são informados', () => {
    expect(() =>
      buildImageMessage({ to: '+5511999999999' })
    ).toThrow('Either mediaId or mediaUrl must be provided')
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const result = buildImageMessage({
      to: '+5511999999999',
      mediaId: 'img123',
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })

  it('não deve incluir context quando replyToMessageId não é informado', () => {
    const result = buildImageMessage({ to: '+5511999999999', mediaId: 'img123' })
    expect(result.context).toBeUndefined()
  })
})

// =============================================================================
// buildVideoMessage
// =============================================================================
describe('buildVideoMessage', () => {
  it('deve construir payload com mediaId', () => {
    const result = buildVideoMessage({ to: '+5511999999999', mediaId: 'vid123' })
    expect(result.messaging_product).toBe('whatsapp')
    expect(result.type).toBe('video')
    expect(result.video.id).toBe('vid123')
  })

  it('deve construir payload com mediaUrl', () => {
    const result = buildVideoMessage({ to: '+5511999999999', mediaUrl: 'https://example.com/vid.mp4' })
    expect(result.video.link).toBe('https://example.com/vid.mp4')
  })

  it('deve incluir caption quando informado', () => {
    const result = buildVideoMessage({
      to: '+5511999999999',
      mediaId: 'vid123',
      caption: 'Vídeo do produto',
    })
    expect(result.video.caption).toBe('Vídeo do produto')
  })

  it('deve lançar erro quando nem mediaId nem mediaUrl são informados', () => {
    expect(() =>
      buildVideoMessage({ to: '+5511999999999' })
    ).toThrow('Either mediaId or mediaUrl must be provided')
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const result = buildVideoMessage({
      to: '+5511999999999',
      mediaId: 'vid123',
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })
})

// =============================================================================
// buildAudioMessage
// =============================================================================
describe('buildAudioMessage', () => {
  it('deve construir payload com mediaId', () => {
    const result = buildAudioMessage({ to: '+5511999999999', mediaId: 'aud123' })
    expect(result.messaging_product).toBe('whatsapp')
    expect(result.type).toBe('audio')
    expect(result.audio.id).toBe('aud123')
  })

  it('deve marcar explicitamente a mídia como nota de voz', () => {
    const result = buildAudioMessage({
      to: '+5511999999999',
      mediaId: 'aud123',
      voice: true,
    })

    expect(result.audio.voice).toBe(true)
  })

  it('deve construir payload com mediaUrl', () => {
    const result = buildAudioMessage({ to: '+5511999999999', mediaUrl: 'https://example.com/audio.mp3' })
    expect(result.audio.link).toBe('https://example.com/audio.mp3')
  })

  it('deve lançar erro quando nem mediaId nem mediaUrl são informados', () => {
    expect(() =>
      buildAudioMessage({ to: '+5511999999999' })
    ).toThrow('Either mediaId or mediaUrl must be provided')
  })

  it('não deve ter propriedade caption (áudio não suporta)', () => {
    const result = buildAudioMessage({ to: '+5511999999999', mediaId: 'aud123' })
    expect(result.audio).not.toHaveProperty('caption')
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const result = buildAudioMessage({
      to: '+5511999999999',
      mediaId: 'aud123',
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })
})

// =============================================================================
// buildDocumentMessage
// =============================================================================
describe('buildDocumentMessage', () => {
  it('deve construir payload com mediaId e filename', () => {
    const result = buildDocumentMessage({
      to: '+5511999999999',
      mediaId: 'doc123',
      filename: 'relatorio.pdf',
    })
    expect(result.messaging_product).toBe('whatsapp')
    expect(result.type).toBe('document')
    expect(result.document.id).toBe('doc123')
    expect(result.document.filename).toBe('relatorio.pdf')
  })

  it('deve construir payload com mediaUrl', () => {
    const result = buildDocumentMessage({
      to: '+5511999999999',
      mediaUrl: 'https://example.com/doc.pdf',
      filename: 'doc.pdf',
    })
    expect(result.document.link).toBe('https://example.com/doc.pdf')
  })

  it('deve incluir caption quando informado', () => {
    const result = buildDocumentMessage({
      to: '+5511999999999',
      mediaId: 'doc123',
      filename: 'relatorio.pdf',
      caption: 'Relatório mensal',
    })
    expect(result.document.caption).toBe('Relatório mensal')
  })

  it('deve lançar erro quando nem mediaId nem mediaUrl são informados', () => {
    expect(() =>
      buildDocumentMessage({ to: '+5511999999999', filename: 'doc.pdf' })
    ).toThrow('Either mediaId or mediaUrl must be provided')
  })

  it('deve lançar erro quando filename não é informado', () => {
    expect(() =>
      buildDocumentMessage({
        to: '+5511999999999',
        mediaId: 'doc123',
        filename: '',
      })
    ).toThrow('Filename is required')
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const result = buildDocumentMessage({
      to: '+5511999999999',
      mediaId: 'doc123',
      filename: 'doc.pdf',
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })
})

// =============================================================================
// buildStickerMessage
// =============================================================================
describe('buildStickerMessage', () => {
  it('deve construir payload com mediaId', () => {
    const result = buildStickerMessage({ to: '+5511999999999', mediaId: 'stk123' })
    expect(result.messaging_product).toBe('whatsapp')
    expect(result.type).toBe('sticker')
    expect(result.sticker.id).toBe('stk123')
  })

  it('deve construir payload com mediaUrl', () => {
    const result = buildStickerMessage({ to: '+5511999999999', mediaUrl: 'https://example.com/sticker.webp' })
    expect(result.sticker.link).toBe('https://example.com/sticker.webp')
  })

  it('deve lançar erro quando nem mediaId nem mediaUrl são informados', () => {
    expect(() =>
      buildStickerMessage({ to: '+5511999999999' })
    ).toThrow('Either mediaId or mediaUrl must be provided')
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const result = buildStickerMessage({
      to: '+5511999999999',
      mediaId: 'stk123',
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })
})

// =============================================================================
// buildLocationMessage
// =============================================================================
describe('buildLocationMessage', () => {
  it('deve construir payload com latitude e longitude', () => {
    const result = buildLocationMessage({
      to: '+5511999999999',
      latitude: -23.5505,
      longitude: -46.6333,
    })
    expect(result).toEqual({
      messaging_product: 'whatsapp',
      to: '+5511999999999',
      type: 'location',
      location: {
        latitude: -23.5505,
        longitude: -46.6333,
        name: undefined,
        address: undefined,
      },
    })
  })

  it('deve incluir name e address quando informados', () => {
    const result = buildLocationMessage({
      to: '+5511999999999',
      latitude: -23.5505,
      longitude: -46.6333,
      name: 'Praça da Sé',
      address: 'São Paulo, SP',
    })
    expect(result.location.name).toBe('Praça da Sé')
    expect(result.location.address).toBe('São Paulo, SP')
  })

  it('deve aceitar coordenadas zero (ponto nulo, Golfo da Guiné)', () => {
    const result = buildLocationMessage({
      to: '+5511999999999',
      latitude: 0,
      longitude: 0,
    })
    expect(result.location.latitude).toBe(0)
    expect(result.location.longitude).toBe(0)
  })

  it('deve aceitar coordenadas negativas', () => {
    const result = buildLocationMessage({
      to: '+5511999999999',
      latitude: -90,
      longitude: -180,
    })
    expect(result.location.latitude).toBe(-90)
    expect(result.location.longitude).toBe(-180)
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const result = buildLocationMessage({
      to: '+5511999999999',
      latitude: -23.5505,
      longitude: -46.6333,
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })
})

// =============================================================================
// buildReactionMessage
// =============================================================================
describe('buildReactionMessage', () => {
  it('deve construir payload de reação com emoji', () => {
    const result = buildReactionMessage({
      to: '+5511999999999',
      messageId: 'wamid.msg123',
      emoji: '👍',
    })
    expect(result).toEqual({
      messaging_product: 'whatsapp',
      to: '+5511999999999',
      type: 'reaction',
      reaction: {
        message_id: 'wamid.msg123',
        emoji: '👍',
      },
    })
  })

  it('deve aceitar string vazia para remover reação', () => {
    const result = buildReactionMessage({
      to: '+5511999999999',
      messageId: 'wamid.msg123',
      emoji: '',
    })
    expect(result.reaction.emoji).toBe('')
  })

  it('deve aceitar diversos emojis', () => {
    const emojis = ['❤️', '😂', '🎉', '🔥', '👏']
    for (const emoji of emojis) {
      const result = buildReactionMessage({
        to: '+5511999999999',
        messageId: 'wamid.msg123',
        emoji,
      })
      expect(result.reaction.emoji).toBe(emoji)
    }
  })
})

// =============================================================================
// buildCarouselMessage
// =============================================================================
describe('buildCarouselMessage', () => {
  const makeCard = (type: 'image' | 'video' = 'image', index = 0) => ({
    header: { type, mediaId: `media_${index}` },
    body: `Produto ${index}`,
    action: { buttonText: `Comprar ${index}`, url: `https://example.com/${index}` },
  })

  it('deve construir payload com 2 cards (mínimo)', () => {
    const result = buildCarouselMessage({
      to: '+5511999999999',
      cards: [makeCard('image', 0), makeCard('image', 1)],
    })
    expect(result.messaging_product).toBe('whatsapp')
    expect(result.type).toBe('interactive')
    expect(result.interactive.type).toBe('carousel')
    expect(result.interactive.action.carousel_cards).toHaveLength(2)
  })

  it('deve construir payload com 10 cards (máximo)', () => {
    const cards = Array.from({ length: 10 }, (_, i) => makeCard('image', i))
    const result = buildCarouselMessage({ to: '+5511999999999', cards })
    expect(result.interactive.action.carousel_cards).toHaveLength(10)
  })

  it('deve lançar erro com menos de 2 cards', () => {
    expect(() =>
      buildCarouselMessage({ to: '+5511999999999', cards: [makeCard()] })
    ).toThrow('between 2 and 10 cards')
  })

  it('deve lançar erro com mais de 10 cards', () => {
    const cards = Array.from({ length: 11 }, (_, i) => makeCard('image', i))
    expect(() =>
      buildCarouselMessage({ to: '+5511999999999', cards })
    ).toThrow('between 2 and 10 cards')
  })

  it('deve lançar erro com 0 cards', () => {
    expect(() =>
      buildCarouselMessage({ to: '+5511999999999', cards: [] })
    ).toThrow('between 2 and 10 cards')
  })

  it('deve lançar erro quando tipos de header são diferentes', () => {
    expect(() =>
      buildCarouselMessage({
        to: '+5511999999999',
        cards: [makeCard('image', 0), makeCard('video', 1)],
      })
    ).toThrow('same header type')
  })

  it('deve aceitar todos os cards com header tipo "video"', () => {
    const cards = [makeCard('video', 0), makeCard('video', 1)]
    const result = buildCarouselMessage({ to: '+5511999999999', cards })
    expect(result.interactive.action.carousel_cards).toHaveLength(2)
  })

  it('deve indexar cards corretamente (card_index)', () => {
    const cards = [makeCard('image', 0), makeCard('image', 1), makeCard('image', 2)]
    const result = buildCarouselMessage({ to: '+5511999999999', cards })
    result.interactive.action.carousel_cards.forEach((card: { card_index: number }, i: number) => {
      expect(card.card_index).toBe(i)
    })
  })

  it('deve construir componentes HEADER, BODY e BUTTON para cada card', () => {
    const cards = [makeCard('image', 0), makeCard('image', 1)]
    const result = buildCarouselMessage({ to: '+5511999999999', cards })

    const firstCard = result.interactive.action.carousel_cards[0]
    const types = firstCard.components.map((c: { type: string }) => c.type)
    expect(types).toEqual(['HEADER', 'BODY', 'BUTTON'])
  })

  it('deve usar mediaId no header quando informado', () => {
    const cards = [makeCard('image', 0), makeCard('image', 1)]
    const result = buildCarouselMessage({ to: '+5511999999999', cards })

    const headerComponent = result.interactive.action.carousel_cards[0].components[0]
    expect(headerComponent.parameters[0].image).toEqual({ id: 'media_0' })
  })

  it('deve usar mediaUrl no header quando mediaId não é informado', () => {
    const cards = [
      {
        header: { type: 'image' as const, mediaUrl: 'https://example.com/img.jpg' },
        body: 'Produto',
        action: { buttonText: 'Comprar', url: 'https://example.com' },
      },
      {
        header: { type: 'image' as const, mediaUrl: 'https://example.com/img2.jpg' },
        body: 'Produto 2',
        action: { buttonText: 'Comprar', url: 'https://example.com/2' },
      },
    ]
    const result = buildCarouselMessage({ to: '+5511999999999', cards })

    const headerComponent = result.interactive.action.carousel_cards[0].components[0]
    expect(headerComponent.parameters[0].image).toEqual({ link: 'https://example.com/img.jpg' })
  })

  it('deve incluir context quando replyToMessageId é informado', () => {
    const cards = [makeCard('image', 0), makeCard('image', 1)]
    const result = buildCarouselMessage({
      to: '+5511999999999',
      cards,
      replyToMessageId: 'wamid.abc',
    })
    expect(result.context).toEqual({ message_id: 'wamid.abc' })
  })

  it('não deve incluir context quando replyToMessageId não é informado', () => {
    const cards = [makeCard('image', 0), makeCard('image', 1)]
    const result = buildCarouselMessage({ to: '+5511999999999', cards })
    expect(result.context).toBeUndefined()
  })
})

// =============================================================================
// uploadMediaToMeta
// =============================================================================
describe('uploadMediaToMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deve montar multipart certo e chamar /media, retornando {ok:true,id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'media_abc123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadMediaToMeta({
      phoneNumberId: 'phone123',
      accessToken: 'token123',
      buffer: Buffer.from('fake-bytes'),
      contentType: 'image/jpeg',
      filename: 'foto.jpg',
    })

    expect(result).toEqual({ ok: true, id: 'media_abc123' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v24.0/phone123/media')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer token123' })
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('messaging_product')).toBe('whatsapp')
    expect(form.get('type')).toBeNull()
    const file = form.get('file') as File
    expect(file).toBeTruthy()
    expect(file.name).toBe('foto.jpg')
    expect(file.type).toBe('image/jpeg')
  })

  it('deve preservar codecs=opus no Content-Type do campo file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'media_voice' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await uploadMediaToMeta({
      phoneNumberId: 'phone123',
      accessToken: 'token123',
      buffer: Buffer.from('ogg-opus-bytes'),
      contentType: 'audio/ogg; codecs=opus',
      filename: 'voice.ogg',
    })

    const form = fetchMock.mock.calls[0][1].body as FormData
    expect(form.get('type')).toBeNull()
    const file = form.get('file') as File
    expect(file.type).toBe('audio/ogg; codecs=opus')
  })

  it('deve usar "file" como filename padrão quando não informado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'media_xyz' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await uploadMediaToMeta({
      phoneNumberId: 'phone123',
      accessToken: 'token123',
      buffer: Buffer.from('bytes'),
      contentType: 'application/pdf',
    })

    const form = fetchMock.mock.calls[0][1].body as FormData
    const file = form.get('file') as File
    expect(file.name).toBe('file')
  })

  it('deve retornar {ok:false,status,error} quando !res.ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid parameter' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadMediaToMeta({
      phoneNumberId: 'phone123',
      accessToken: 'token123',
      buffer: Buffer.from('bytes'),
      contentType: 'image/jpeg',
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid parameter' })
  })

  it('deve retornar {ok:false} quando a resposta não tem id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadMediaToMeta({
      phoneNumberId: 'phone123',
      accessToken: 'token123',
      buffer: Buffer.from('bytes'),
      contentType: 'image/jpeg',
    })

    expect(result.ok).toBe(false)
    expect((result as any).error).toBe('Resposta sem media_id')
  })

  it('deve retornar {ok:false,status:0,error} quando fetch lança exceção', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadMediaToMeta({
      phoneNumberId: 'phone123',
      accessToken: 'token123',
      buffer: Buffer.from('bytes'),
      contentType: 'image/jpeg',
    })

    expect(result).toEqual({ ok: false, status: 0, error: 'network down' })
  })
})

// =============================================================================
// downloadMetaMedia
// =============================================================================
describe('downloadMetaMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('deve baixar metadata e depois os bytes, retornando {ok:true,buffer,mime,size}', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/xyz',
          mime_type: 'image/jpeg',
          file_size: 12345,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('fake-image-bytes').buffer,
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadMetaMedia({ mediaId: 'mid_1', accessToken: 'token123' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v24.0/mid_1')
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer token123' } })
    expect(fetchMock.mock.calls[1][0]).toBe('https://lookaside.fbsbx.com/whatsapp_business/attachments/xyz')
    expect(fetchMock.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer token123' } })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mime).toBe('image/jpeg')
      expect(result.size).toBe(12345)
      expect(Buffer.isBuffer(result.buffer)).toBe(true)
      expect(result.buffer.toString()).toBe('fake-image-bytes')
    }
  })

  it('deve retornar {ok:false} quando a metadata falha', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Media not found' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadMetaMedia({ mediaId: 'mid_bad', accessToken: 'token123' })

    expect(result).toEqual({ ok: false, status: 404, error: 'Media not found' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deve retornar {ok:false} quando a metadata não tem url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ mime_type: 'image/jpeg' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadMetaMedia({ mediaId: 'mid_1', accessToken: 'token123' })

    expect(result.ok).toBe(false)
  })

  it('deve retornar {ok:false} quando o download dos bytes falha', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ url: 'https://lookaside.fbsbx.com/attachments/xyz', mime_type: 'image/jpeg' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadMetaMedia({ mediaId: 'mid_1', accessToken: 'token123' })

    expect(result).toEqual({ ok: false, status: 500, error: 'download HTTP 500' })
  })

  it('deve retornar {ok:false,status:0,error} quando fetch lança exceção', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadMetaMedia({ mediaId: 'mid_1', accessToken: 'token123' })

    expect(result).toEqual({ ok: false, status: 0, error: 'network down' })
  })
})
