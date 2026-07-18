/**
 * WhatsApp Media Message Builders
 * 
 * Builders for Image, Video, Audio, Document, Sticker, and Location messages
 */

import {
  ImageMessagePayload,
  VideoMessagePayload,
  AudioMessagePayload,
  DocumentMessagePayload,
  StickerMessagePayload,
  LocationMessagePayload,
  ReactionMessagePayload,
} from './types'

// =============================================================================
// IMAGE
// =============================================================================

export interface BuildImageMessageOptions {
  to: string
  mediaId?: string
  mediaUrl?: string
  caption?: string
  replyToMessageId?: string
}

/**
 * Build an image message payload
 * Max size: 5MB (JPEG, PNG)
 */
export function buildImageMessage(options: BuildImageMessageOptions): ImageMessagePayload {
  if (!options.mediaId && !options.mediaUrl) {
    throw new Error('Either mediaId or mediaUrl must be provided')
  }

  const payload: ImageMessagePayload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'image',
    image: {
      ...(options.mediaId ? { id: options.mediaId } : { link: options.mediaUrl }),
      caption: options.caption,
    },
  }

  if (options.replyToMessageId) {
    payload.context = { message_id: options.replyToMessageId }
  }

  return payload
}

// =============================================================================
// VIDEO
// =============================================================================

export interface BuildVideoMessageOptions {
  to: string
  mediaId?: string
  mediaUrl?: string
  caption?: string
  replyToMessageId?: string
}

/**
 * Build a video message payload
 * Max size: 16MB (MP4, 3GPP with H.264 codec)
 */
export function buildVideoMessage(options: BuildVideoMessageOptions): VideoMessagePayload {
  if (!options.mediaId && !options.mediaUrl) {
    throw new Error('Either mediaId or mediaUrl must be provided')
  }

  const payload: VideoMessagePayload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'video',
    video: {
      ...(options.mediaId ? { id: options.mediaId } : { link: options.mediaUrl }),
      caption: options.caption,
    },
  }

  if (options.replyToMessageId) {
    payload.context = { message_id: options.replyToMessageId }
  }

  return payload
}

// =============================================================================
// AUDIO
// =============================================================================

export interface BuildAudioMessageOptions {
  to: string
  mediaId?: string
  mediaUrl?: string
  replyToMessageId?: string
}

/**
 * Build an audio message payload
 * Max size: 16MB (MP3, M4A, AAC, OGG with OPUS codec)
 * Note: OGG/OPUS under 512KB will display with voice message play icon
 */
export function buildAudioMessage(options: BuildAudioMessageOptions): AudioMessagePayload {
  if (!options.mediaId && !options.mediaUrl) {
    throw new Error('Either mediaId or mediaUrl must be provided')
  }

  const payload: AudioMessagePayload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'audio',
    audio: {
      ...(options.mediaId ? { id: options.mediaId } : { link: options.mediaUrl }),
    },
  }

  if (options.replyToMessageId) {
    payload.context = { message_id: options.replyToMessageId }
  }

  return payload
}

// =============================================================================
// DOCUMENT
// =============================================================================

export interface BuildDocumentMessageOptions {
  to: string
  mediaId?: string
  mediaUrl?: string
  filename: string // Required
  caption?: string
  replyToMessageId?: string
}

/**
 * Build a document message payload
 * Max size: 100MB
 */
export function buildDocumentMessage(options: BuildDocumentMessageOptions): DocumentMessagePayload {
  if (!options.mediaId && !options.mediaUrl) {
    throw new Error('Either mediaId or mediaUrl must be provided')
  }

  if (!options.filename) {
    throw new Error('Filename is required for document messages')
  }

  const payload: DocumentMessagePayload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'document',
    document: {
      ...(options.mediaId ? { id: options.mediaId } : { link: options.mediaUrl }),
      filename: options.filename,
      caption: options.caption,
    },
  }

  if (options.replyToMessageId) {
    payload.context = { message_id: options.replyToMessageId }
  }

  return payload
}

// =============================================================================
// STICKER
// =============================================================================

export interface BuildStickerMessageOptions {
  to: string
  mediaId?: string
  mediaUrl?: string
  replyToMessageId?: string
}

/**
 * Build a sticker message payload
 * Format: WebP only
 * Max size: 100KB (static), 500KB (animated)
 */
export function buildStickerMessage(options: BuildStickerMessageOptions): StickerMessagePayload {
  if (!options.mediaId && !options.mediaUrl) {
    throw new Error('Either mediaId or mediaUrl must be provided')
  }

  const payload: StickerMessagePayload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'sticker',
    sticker: {
      ...(options.mediaId ? { id: options.mediaId } : { link: options.mediaUrl }),
    },
  }

  if (options.replyToMessageId) {
    payload.context = { message_id: options.replyToMessageId }
  }

  return payload
}

// =============================================================================
// LOCATION
// =============================================================================

export interface BuildLocationMessageOptions {
  to: string
  latitude: number
  longitude: number
  name?: string
  address?: string
  replyToMessageId?: string
}

/**
 * Build a location message payload
 */
export function buildLocationMessage(options: BuildLocationMessageOptions): LocationMessagePayload {
  const payload: LocationMessagePayload = {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'location',
    location: {
      latitude: options.latitude,
      longitude: options.longitude,
      name: options.name,
      address: options.address,
    },
  }

  if (options.replyToMessageId) {
    payload.context = { message_id: options.replyToMessageId }
  }

  return payload
}

// =============================================================================
// REACTION
// =============================================================================

export interface BuildReactionMessageOptions {
  to: string
  messageId: string
  emoji: string // Empty string to remove reaction
}

/**
 * Build a reaction message payload
 */
export function buildReactionMessage(options: BuildReactionMessageOptions): ReactionMessagePayload {
  return {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'reaction',
    reaction: {
      message_id: options.messageId,
      emoji: options.emoji,
    },
  }
}

// =============================================================================
// META MEDIA UPLOAD / DOWNLOAD (transport)
// =============================================================================

/**
 * Faz upload de um buffer de mídia para a Meta (WhatsApp Cloud API),
 * retornando o media_id a ser usado nos builders acima (mediaId).
 */
export async function uploadMediaToMeta(params: {
  phoneNumberId: string
  accessToken: string
  buffer: Buffer | Uint8Array
  contentType: string
  filename?: string
}): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  try {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', params.contentType)
    const bytes = new Uint8Array(params.buffer)
    form.append('file', new Blob([bytes], { type: params.contentType }), params.filename ?? 'file')
    const res = await fetch(`https://graph.facebook.com/v24.0/${params.phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}` },
      body: form,
    })
    const body = (await res.json().catch(() => null)) as any
    if (!res.ok) {
      return { ok: false, status: res.status, error: body?.error?.message || `HTTP ${res.status}` }
    }
    const id = String(body?.id || '').trim()
    if (!id) return { ok: false, status: res.status, error: 'Resposta sem media_id' }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Baixa uma mídia recebida da Meta: resolve a URL temporária via metadata
 * e então baixa os bytes com o mesmo token.
 */
export async function downloadMetaMedia(params: {
  mediaId: string
  accessToken: string
}): Promise<
  { ok: true; buffer: Buffer; mime: string; size: number } | { ok: false; status: number; error: string }
> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v24.0/${params.mediaId}`, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    })
    const meta = (await metaRes.json().catch(() => null)) as any
    if (!metaRes.ok || !meta?.url) {
      return { ok: false, status: metaRes.status, error: meta?.error?.message || 'sem url de mídia' }
    }
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${params.accessToken}` } })
    if (!binRes.ok) return { ok: false, status: binRes.status, error: `download HTTP ${binRes.status}` }
    const buffer = Buffer.from(await binRes.arrayBuffer())
    return {
      ok: true,
      buffer,
      mime: meta.mime_type || 'application/octet-stream',
      size: Number(meta.file_size) || buffer.length,
    }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

// =============================================================================
// MEDIA CAROUSEL (2-10 cards)
// =============================================================================

export interface CarouselCard {
  header: {
    type: 'image' | 'video'
    mediaId?: string
    mediaUrl?: string
  }
  body: string
  action: {
    buttonText: string
    url: string
  }
}

export interface BuildCarouselOptions {
  to: string
  cards: CarouselCard[]
  replyToMessageId?: string
}

/**
 * Build a media carousel message
 * WhatsApp limits: 2-10 cards, all headers must be same type
 */
export function buildCarouselMessage(options: BuildCarouselOptions) {
  if (options.cards.length < 2 || options.cards.length > 10) {
    throw new Error('Carousel must have between 2 and 10 cards')
  }

  // Validate all headers are same type
  const headerType = options.cards[0].header.type
  for (const card of options.cards) {
    if (card.header.type !== headerType) {
      throw new Error('All carousel cards must have the same header type')
    }
  }

  // Note: This is a simplified representation
  // The actual API structure for carousels is more complex
  // and may require template-based approach
  return {
    messaging_product: 'whatsapp',
    to: options.to,
    type: 'interactive',
    interactive: {
      type: 'carousel',
      action: {
        carousel_cards: options.cards.map((card, index) => ({
          card_index: index,
          components: [
            {
              type: 'HEADER',
              parameters: [{
                type: card.header.type,
                [card.header.type]: card.header.mediaId 
                  ? { id: card.header.mediaId }
                  : { link: card.header.mediaUrl },
              }],
            },
            {
              type: 'BODY',
              parameters: [{ type: 'text', text: card.body }],
            },
            {
              type: 'BUTTON',
              sub_type: 'url',
              index: 0,
              parameters: [{ type: 'text', text: card.action.buttonText }],
            },
          ],
        })),
      },
    },
    ...(options.replyToMessageId && { context: { message_id: options.replyToMessageId } }),
  }
}
