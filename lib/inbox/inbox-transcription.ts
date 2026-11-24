/**
 * Transcrição de áudios recebidos, executada no início de /api/ai/respond
 * (antes de a IA montar o contexto). Roda no worker da fila, depois do debounce,
 * então não atrasa a gravação da mensagem nem a resposta ao webhook da Meta.
 *
 * O resultado fica em `inbox_messages.payload` (sem migração):
 *   payload.transcription = { text, provider, at }   ou   payload.transcription_error
 * Idempotente: mensagem que já tem uma das duas marcas não é processada de novo.
 * Nunca lança: falha de transcrição não impede a IA de responder.
 */
import { getSupabaseAdmin } from '@/lib/supabase'
import { downloadMetaMedia } from '@/lib/whatsapp/media'
import { getWhatsAppCredentialsForNumber } from '@/lib/whatsapp-credentials'
import { transcribeAudio } from '@/lib/ai/transcription'
import type { InboxMessage } from '@/types'

const MAX_PER_RUN = 5

type Payload = Record<string, any>

function needsTranscription(m: InboxMessage): boolean {
  if (m.direction !== 'inbound' || m.message_type !== 'audio') return false
  if (typeof m.content === 'string' && m.content.trim()) return false
  const p = (m.payload || {}) as Payload
  return !p.transcription && !p.transcription_error
}

async function savePayload(tenantId: string, messageId: string, payload: Payload): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    if (!supabase) return
    const { error } = await supabase
      .from('inbox_messages')
      .update({ payload })
      .eq('tenant_id', tenantId)
      .eq('id', messageId)
    if (error) console.error('[AudioTranscription] Falha ao gravar payload:', error.message)
  } catch (e) {
    console.error('[AudioTranscription] Erro ao gravar payload:', e instanceof Error ? e.message : e)
  }
}

async function transcribeOne(tenantId: string, m: InboxMessage): Promise<InboxMessage> {
  const base: Payload = { ...((m.payload || {}) as Payload) }
  const fail = async (reason: string): Promise<InboxMessage> => {
    const payload = { ...base, transcription_error: reason }
    await savePayload(tenantId, m.id, payload)
    return { ...m, payload }
  }

  const mediaId = typeof base.media_id === 'string' ? base.media_id : ''
  if (!mediaId) return fail('no_media_id')

  const creds = await getWhatsAppCredentialsForNumber(
    tenantId,
    typeof base.phone_number_id === 'string' ? base.phone_number_id : null
  )
  if (!creds?.accessToken) return fail('no_credentials')

  const media = await downloadMetaMedia({ mediaId, accessToken: creds.accessToken })
  if (!media.ok) return fail('download_failed')

  const result = await transcribeAudio({ tenantId, audio: media.buffer, mimeType: media.mime || m.media_mime })
  if ('error' in result) {
    console.warn(`[AudioTranscription] msg=${m.id} sem transcrição: ${result.error}`)
    return fail(result.error)
  }

  const payload = {
    ...base,
    transcription: { text: result.text, provider: result.provider, at: new Date().toISOString() },
  }
  await savePayload(tenantId, m.id, payload)
  console.log(`[AudioTranscription] msg=${m.id} ok (${result.provider}): "${result.text.slice(0, 60)}"`)
  return { ...m, payload }
}

export async function ensureAudioTranscriptions(tenantId: string, messages: InboxMessage[]): Promise<InboxMessage[]> {
  try {
    const pending = messages.filter(needsTranscription).slice(-MAX_PER_RUN)
    if (pending.length === 0) return messages
    const done = new Map<string, InboxMessage>()
    await Promise.all(
      pending.map(async (m) => {
        try {
          done.set(m.id, await transcribeOne(tenantId, m))
        } catch (e) {
          console.error('[AudioTranscription] Erro inesperado:', e instanceof Error ? e.message : e)
        }
      })
    )
    return messages.map((m) => done.get(m.id) ?? m)
  } catch (e) {
    console.error('[AudioTranscription] Erro inesperado:', e instanceof Error ? e.message : e)
    return messages
  }
}
