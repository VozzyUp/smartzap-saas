/**
 * Fase 5A — Task 6: POST /api/inbox/conversations/[id]/media
 *
 * Envia mídia (imagem/áudio/vídeo/documento) a partir de um arquivo
 * anexado (multipart/form-data), pelo número da conversa, persistindo no
 * inbox. Fluxo:
 *   1. Autentica (getTenantContext) e valida o multipart (tamanho + mime).
 *   2. Carrega a conversa escopada por tenant e resolve as credenciais do
 *      número que a atende (Fase 4, `getWhatsAppCredentialsForNumber`).
 *   3. Sobe o buffer à Meta (`uploadMediaToMeta`, T2) → media_id.
 *   4. Envia via `sendWhatsAppMedia` (lib/whatsapp-send.ts) usando o builder
 *      do tipo (lib/whatsapp/media.ts).
 *   5. Persiste a mensagem outbound no inbox e, em seguida, o arquivo no
 *      bucket privado (`storeOutboundMedia`, T3), atualizando `media_path`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getConversationById, createMessage } from '@/lib/inbox/inbox-db'
import { getWhatsAppCredentialsForNumber } from '@/lib/whatsapp-credentials'
import { uploadMediaToMeta } from '@/lib/whatsapp/media'
import { sendWhatsAppMedia } from '@/lib/whatsapp-send'
import { storeOutboundMedia } from '@/lib/inbox/inbox-media'
import { remuxToOggOpus } from '@/lib/audio/voice-remux'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { InboxMessageType } from '@/types'

interface RouteParams {
  params: Promise<{ id: string }>
}

// Limites de validação (Global Constraints do plano Fase 5A)
const MAX_SIZE_BY_TYPE: Record<'image' | 'video' | 'audio' | 'document', number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}

// Whitelist de mimes suportados pela WhatsApp Cloud API por categoria
const ALLOWED_MIME_BY_TYPE: Record<'image' | 'video' | 'audio' | 'document', string[]> = {
  image: ['image/jpeg', 'image/png'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg', 'audio/opus'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
  ],
}

function messageTypeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}

/**
 * UPDATE pós-criação dos campos de mídia escopado por tenant+id — mesmo
 * padrão usado pela Task 4 (`persistMediaPending` em inbox-webhook.ts),
 * pois `CreateInboxMessageDTO` (types.ts) não expõe os campos de mídia
 * novos (T1) e a RPC/DTO de criação de mensagem não foi alterada.
 */
async function updateMediaFields(
  tenantId: string,
  messageId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseAdmin()
  if (!supabase) return
  const { error } = await supabase
    .from('inbox_messages')
    .update(fields)
    .eq('tenant_id', tenantId)
    .eq('id', messageId)
  if (error) {
    console.error('[InboxMediaSend] Falha ao atualizar campos de mídia:', error.message)
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    const tenantId = ctx.tenantId

    const { id: conversationId } = await params

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
    }

    const file = formData.get('file')
    const captionRaw = formData.get('caption')
    const caption = typeof captionRaw === 'string' ? captionRaw : ''
    const voiceRaw = formData.get('voice')
    const isVoice = voiceRaw === 'true'

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }

    const originalMime = file.type || 'application/octet-stream'
    const messageType = messageTypeFromMime(originalMime)
    const originalFilename = 'name' in file && typeof (file as File).name === 'string' && (file as File).name
      ? (file as File).name
      : `arquivo.${messageType === 'document' ? 'bin' : messageType}`

    let buffer: Buffer = Buffer.from(await file.arrayBuffer())
    let mime = originalMime
    let filename = originalFilename

    // Fase 5B: nota de voz — remux para OGG/Opus antes de qualquer validação
    // de whitelist/tamanho, pois o áudio gravado no navegador (ex.: webm/opus)
    // não está na whitelist de mimes aceitos pela Cloud API. Fail-safe: se o
    // remux degradar (ffmpeg ausente/erro), `remuxed:false` e seguimos com o
    // áudio original (pode falhar a whitelist normalmente, como antes da 5B).
    if (isVoice && originalMime.startsWith('audio/')) {
      const r = await remuxToOggOpus(buffer, originalMime)
      const remuxedBaseMime = r.mime.toLowerCase().split(';')[0].trim()
      if (!r.remuxed || remuxedBaseMime !== 'audio/ogg') {
        return NextResponse.json(
          {
            error: 'Não foi possível converter a gravação para OGG/Opus. Tente gravar novamente.',
          },
          { status: 422 }
        )
      }
      buffer = r.buffer
      mime = r.mime
      filename = remuxedBaseMime === 'audio/ogg' ? 'voice.ogg' : originalFilename
    }

    const baseMime = mime.toLowerCase().split(';')[0].trim()
    if (!ALLOWED_MIME_BY_TYPE[messageType].includes(baseMime)) {
      return NextResponse.json(
        { error: `Unsupported mime type for ${messageType}: ${mime}` },
        { status: 400 }
      )
    }

    if (buffer.length > MAX_SIZE_BY_TYPE[messageType]) {
      return NextResponse.json(
        {
          error: `File too large for ${messageType}: ${buffer.length} bytes (max ${MAX_SIZE_BY_TYPE[messageType]})`,
        },
        { status: 400 }
      )
    }

    // Conversa escopada por tenant
    const conversation = await getConversationById(tenantId, conversationId)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Credenciais pelo número da conversa (Fase 4)
    const credentials = await getWhatsAppCredentialsForNumber(
      tenantId,
      conversation.whatsapp_number_id ?? null
    )
    if (!credentials) {
      return NextResponse.json(
        { error: 'WhatsApp credentials not configured for this conversation' },
        { status: 409 }
      )
    }

    // Upload à Meta → media_id
    const uploaded = await uploadMediaToMeta({
      phoneNumberId: credentials.phoneNumberId,
      accessToken: credentials.accessToken,
      buffer,
      contentType: mime,
      filename,
    })
    if (!uploaded.ok) {
      return NextResponse.json(
        { error: `Failed to upload media to Meta: ${uploaded.error}` },
        { status: 502 }
      )
    }

    // Envio via WhatsApp (builder do tipo + media_id), pelo número resolvido
    const sendResult = await sendWhatsAppMedia(tenantId, {
      to: conversation.phone,
      type: messageType,
      mediaId: uploaded.id,
      caption: caption || undefined,
      filename,
      voice: isVoice,
      credentials,
    })

    if (!sendResult.success || !sendResult.messageId) {
      const reason = sendResult.success
        ? 'Meta response did not include message_id'
        : sendResult.error || 'Unknown error'
      return NextResponse.json(
        { error: `Failed to send media via WhatsApp: ${reason}` },
        { status: 502 }
      )
    }

    // Persiste a mensagem outbound primeiro (para ter o messageId)
    const message = await createMessage({
      tenant_id: tenantId,
      conversation_id: conversationId,
      direction: 'outbound',
      content: caption || '',
      message_type: messageType as InboxMessageType,
      whatsapp_message_id: sendResult.messageId,
      delivery_status: sendResult.error ? 'failed' : 'sent',
    })

    // Persiste o arquivo no bucket privado do inbox e grava o media_path.
    // Best-effort: se falhar, a mensagem já foi enviada/persistida — marca
    // media_status='failed' em vez de derrubar a resposta da rota.
    try {
      const mediaPath = await storeOutboundMedia({
        tenantId,
        conversationId,
        messageId: message.id,
        buffer,
        mime,
        filename,
      })

      await updateMediaFields(tenantId, message.id, {
        media_status: 'ready',
        media_mime: mime,
        media_filename: filename,
        media_size: buffer.length,
        media_path: mediaPath,
      })
    } catch (storageError) {
      console.error('[InboxMediaSend] Falha ao persistir mídia outbound no bucket:', storageError)
      await updateMediaFields(tenantId, message.id, {
        media_status: 'failed',
        media_mime: mime,
        media_filename: filename,
        media_size: buffer.length,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[POST /api/inbox/conversations/[id]/media]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
