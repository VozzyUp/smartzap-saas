/**
 * Fase 5A — Inbox Media
 *
 * Persistência de mídia do inbox no Supabase Storage (bucket privado
 * `wa-inbox-media`). Mídia recebida (inbound) é baixada da Meta e
 * armazenada; mídia enviada (outbound) é armazenada a partir do buffer
 * já enviado à Meta. Leitura é sempre via URL assinada curta, escopada
 * por tenant.
 */

import { getSupabaseAdmin } from '@/lib/supabase'
import { downloadMetaMedia } from '@/lib/whatsapp/media'

const BUCKET = 'wa-inbox-media'
const DEFAULT_SIGNED_URL_TTL_SECONDS = 300

/**
 * Deriva a extensão de arquivo a partir do MIME type.
 * Cobre os mimes comuns retornados pela WhatsApp Cloud API.
 */
export function extFromMime(mime: string | null | undefined): string {
  const m = String(mime || '').toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/amr': 'amr',
    'audio/aac': 'aac',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
  }
  return map[m] || 'bin'
}

function getClient() {
  const client = getSupabaseAdmin()
  if (!client) {
    throw new Error('Supabase admin client not configured. Check SUPABASE_SECRET_KEY env var.')
  }
  return client
}

async function markMediaStatus(tenantId: string, messageId: string, status: 'ready' | 'failed', extra?: Record<string, unknown>) {
  const supabase = getClient()
  await supabase
    .from('inbox_messages')
    .update({ media_status: status, ...extra })
    .eq('tenant_id', tenantId)
    .eq('id', messageId)
}

/**
 * Baixa uma mídia recebida da Meta e persiste no bucket privado do inbox,
 * atualizando a mensagem correspondente. Nunca relança: em caso de erro
 * (download ou upload), marca `media_status='failed'` na mensagem.
 */
export async function storeInboundMedia(params: {
  tenantId: string
  conversationId: string
  messageId: string
  mediaId: string
  accessToken: string
}): Promise<void> {
  const { tenantId, conversationId, messageId, mediaId, accessToken } = params

  const downloaded = await downloadMetaMedia({ mediaId, accessToken })
  if (!downloaded.ok) {
    console.error('[InboxMedia] Falha ao baixar mídia da Meta:', downloaded.error)
    await markMediaStatus(tenantId, messageId, 'failed')
    return
  }

  const { buffer, mime, size } = downloaded
  const ext = extFromMime(mime)
  const path = `${tenantId}/${conversationId}/${messageId}.${ext}`

  try {
    const supabase = getClient()
    const up = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      upsert: true,
    })
    if (up.error) {
      console.error('[InboxMedia] Falha ao subir mídia no bucket:', up.error)
      await markMediaStatus(tenantId, messageId, 'failed')
      return
    }

    await markMediaStatus(tenantId, messageId, 'ready', {
      media_path: path,
      media_mime: mime,
      media_size: size,
    })
  } catch (e) {
    console.error('[InboxMedia] Erro inesperado ao persistir mídia:', e)
    await markMediaStatus(tenantId, messageId, 'failed')
  }
}

/**
 * Armazena um buffer de mídia enviada (outbound) no bucket privado do
 * inbox. Retorna o `media_path` persistido.
 */
export async function storeOutboundMedia(params: {
  tenantId: string
  conversationId: string
  messageId: string
  buffer: Buffer
  mime: string
  filename?: string
}): Promise<string> {
  const { tenantId, conversationId, messageId, buffer, mime } = params
  const ext = extFromMime(mime)
  const path = `${tenantId}/${conversationId}/${messageId}.${ext}`

  const supabase = getClient()
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: true,
  })
  if (up.error) {
    throw new Error(`Falha ao subir mídia outbound no bucket: ${up.error.message}`)
  }

  return path
}

/**
 * Gera uma URL assinada curta para a mídia de uma mensagem, escopada por
 * tenant. Retorna `null` se a mensagem não existir, não pertencer ao
 * tenant, ou não tiver mídia associada.
 */
export async function getSignedMediaUrl(
  tenantId: string,
  messageId: string,
  expiresIn: number = DEFAULT_SIGNED_URL_TTL_SECONDS
): Promise<string | null> {
  const supabase = getClient()

  const { data: message } = await supabase
    .from('inbox_messages')
    .select('media_path')
    .eq('tenant_id', tenantId)
    .eq('id', messageId)
    .maybeSingle()

  const path = message?.media_path
  if (!path) return null

  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
  if (signed.error || !signed.data?.signedUrl) return null

  return signed.data.signedUrl
}
