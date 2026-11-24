/**
 * Transcrição de áudio recebido (WhatsApp) para a IA conseguir "ouvir" o lead.
 *
 * Provedor escolhido pelas chaves que a CONTA tem em `settings`:
 *   1. OpenAI (`openai_api_key`)  -> /v1/audio/transcriptions
 *   2. Google (`google_api_key`)  -> Gemini generateContent com áudio inline
 * A Anthropic NÃO transcreve áudio; mesmo que o provedor de texto da conta seja
 * Anthropic, a transcrição usa OpenAI ou Gemini. Nunca lança; nunca loga áudio,
 * chave nem a transcrição completa.
 */
import { settingsDb } from '@/lib/supabase-db'
import { DEFAULT_MODEL_ID } from '@/lib/ai/model'

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const TIMEOUT_MS = 45_000
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
const OPENAI_MODEL = 'gpt-4o-mini-transcribe'
const OPENAI_FALLBACK_MODEL = 'whisper-1'
const GEMINI_PROMPT = 'Transcreva este áudio em português. Devolva somente o texto falado, sem comentários, aspas ou marcações.'

export type TranscriptionProvider = 'openai' | 'google'
export type TranscriptionResult = { text: string; provider: TranscriptionProvider } | { error: string }

const EXT_BY_MIME: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
}

/** `audio/ogg; codecs=opus` -> `audio/ogg` + nome de arquivo com extensão que o provedor reconhece. */
export function normalizeAudioMime(raw: string | null | undefined): { mime: string; filename: string } {
  const mime = String(raw || '').split(';')[0].trim().toLowerCase() || 'audio/ogg'
  return { mime, filename: `audio.${EXT_BY_MIME[mime] ?? 'ogg'}` }
}

async function readKey(tenantId: string, key: string): Promise<string | null> {
  try {
    const v = await settingsDb.get(tenantId, key)
    const s = typeof v === 'string' ? v.trim() : ''
    return s || null
  } catch {
    return null
  }
}

function isModelMissing(status: number, body: any): boolean {
  const code = String(body?.error?.code || '')
  return code === 'model_not_found' || (status === 404 && /model/i.test(String(body?.error?.message || ''))) || status === 404
}

async function openaiOnce(apiKey: string, model: string, bytes: Uint8Array, mime: string, filename: string, signal: AbortSignal) {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], filename, { type: mime }))
  form.append('model', model)
  form.append('language', 'pt')
  form.append('response_format', 'json')
  const res = await fetch(OPENAI_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal })
  const body: any = await res.json().catch(() => null)
  return { res, body }
}

async function viaOpenAI(apiKey: string, bytes: Uint8Array, mime: string, filename: string, signal: AbortSignal): Promise<TranscriptionResult> {
  let { res, body } = await openaiOnce(apiKey, OPENAI_MODEL, bytes, mime, filename, signal)
  if (!res.ok && isModelMissing(res.status, body)) {
    ;({ res, body } = await openaiOnce(apiKey, OPENAI_FALLBACK_MODEL, bytes, mime, filename, signal))
  }
  if (!res.ok) return { error: `openai_http_${res.status}` }
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  return text ? { text, provider: 'openai' } : { error: 'empty_transcription' }
}

async function viaGemini(apiKey: string, bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<TranscriptionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL_ID}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: mime, data: Buffer.from(bytes).toString('base64') } }] }],
    }),
    signal,
  })
  const body: any = await res.json().catch(() => null)
  if (!res.ok) return { error: `google_http_${res.status}` }
  const parts: any[] = body?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim()
  return text ? { text, provider: 'google' } : { error: 'empty_transcription' }
}

export async function transcribeAudio(params: {
  tenantId: string
  audio: Buffer | ArrayBuffer
  mimeType: string | null | undefined
}): Promise<TranscriptionResult> {
  try {
    const bytes = params.audio instanceof ArrayBuffer ? new Uint8Array(params.audio) : new Uint8Array(params.audio)
    if (bytes.byteLength === 0) return { error: 'empty_audio' }
    if (bytes.byteLength > MAX_AUDIO_BYTES) return { error: 'too_large' }

    const [openaiKey, googleKey] = await Promise.all([
      readKey(params.tenantId, 'openai_api_key'),
      readKey(params.tenantId, 'google_api_key'),
    ])
    if (!openaiKey && !googleKey) return { error: 'no_provider' }

    const { mime, filename } = normalizeAudioMime(params.mimeType)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      return openaiKey
        ? await viaOpenAI(openaiKey, bytes, mime, filename, controller.signal)
        : await viaGemini(googleKey as string, bytes, mime, controller.signal)
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { error: 'timeout' }
    return { error: 'transcription_failed' }
  }
}
