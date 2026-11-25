/**
 * Guardas de concorrência da rota /api/ai/respond.
 *
 * Garantia: por conversa, no máximo UMA rodada de IA por vez, e uma leva de mensagens
 * recebidas juntas gera UMA resposta só.
 *
 * Peças (todas no Redis; sem Redis o chamador segue em "melhor esforço"):
 * - `ai:processed:{messageId}`  trava atômica (SET NX) por mensagem: ignora entrega duplicada do mesmo job.
 * - `ai:lock:{conversationId}`  trava atômica por conversa (SET NX EX), com valor único por rodada;
 *                               só quem a adquiriu a libera.
 * - `ai:covered:{conversationId}` marcador: ids (whatsapp) das mensagens recebidas que uma rodada já leu.
 *                               Job cuja mensagem já foi coberta sai em silêncio; job que perdeu a trava
 *                               com mensagem NÃO coberta se reagenda (não perde a mensagem).
 */

import { randomUUID } from 'node:crypto'
import { Client } from '@upstash/qstash'
import { redis } from '@/lib/redis'
import { getAppUrl } from '@/lib/app-url'

/** Compatível com maxDuration=300 da rota: se a função morrer, a trava expira sozinha. */
export const CONVERSATION_LOCK_TTL_S = 300
/** Espera antes de um job que perdeu a trava tentar de novo. */
export const RESCHEDULE_DELAY_S = 10
/** 32 x 10s = 320s > TTL da trava: depois disso a trava já expirou, não adianta insistir. */
export const MAX_RESCHEDULE_ATTEMPTS = 32

const DEDUP_TTL_S = 1800
const COVERED_TTL_S = 1800
const COVERED_MAX_IDS = 100

const lockKey = (conversationId: string) => `ai:lock:${conversationId}`
const coveredKey = (conversationId: string) => `ai:covered:${conversationId}`

/** Marca a mensagem como em processamento. true = primeira vez (pode seguir); false = duplicada. */
export async function claimMessage(messageId: string): Promise<boolean> {
  if (!redis) return true
  const res = await redis.set(`ai:processed:${messageId}`, new Date().toISOString(), { nx: true, ex: DEDUP_TTL_S })
  return res !== null && res !== undefined
}

/** Adquire a trava da conversa. Retorna o token da rodada, ou null se outra rodada está em andamento. */
export async function acquireConversationLock(conversationId: string): Promise<string | null> {
  if (!redis) return null
  const token = randomUUID()
  const res = await redis.set(lockKey(conversationId), token, { nx: true, ex: CONVERSATION_LOCK_TTL_S })
  return res !== null && res !== undefined ? token : null
}

const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`

/** Libera a trava somente se ainda for desta rodada (compara o token). Nunca lança. */
export async function releaseConversationLock(conversationId: string, token: string): Promise<void> {
  if (!redis) return
  try {
    await redis.eval(RELEASE_SCRIPT, [lockKey(conversationId)], [token])
  } catch (e) {
    console.error('[AI-RESPOND] Falha ao liberar trava da conversa (expira sozinha pelo TTL):', { conversationId, e })
  }
}

async function readCovered(conversationId: string): Promise<string[]> {
  if (!redis) return []
  const raw = await redis.get<unknown>(coveredKey(conversationId))
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

/** Ids (whatsapp) das mensagens recebidas que as rodadas anteriores já leram. */
export async function getCoveredIds(conversationId: string): Promise<Set<string>> {
  return new Set(await readCovered(conversationId))
}

export async function isMessageCovered(conversationId: string, messageId: string): Promise<boolean> {
  if (!redis) return false
  return (await readCovered(conversationId)).includes(messageId)
}

/** Registra as mensagens recebidas que esta rodada leu. Só a rodada com a trava escreve (sem corrida). */
export async function markCovered(conversationId: string, messageIds: string[]): Promise<void> {
  if (!redis || messageIds.length === 0) return
  const merged = Array.from(new Set([...(await readCovered(conversationId)), ...messageIds])).slice(-COVERED_MAX_IDS)
  await redis.set(coveredKey(conversationId), merged, { ex: COVERED_TTL_S })
}

/** Rodada falhou: desfaz o marcador para que a nova tentativa (QStash) não se julgue "já coberta". */
export async function clearCovered(conversationId: string): Promise<void> {
  if (!redis) return
  try {
    await redis.del(coveredKey(conversationId))
  } catch {
    // melhor esforço
  }
}

/**
 * Reagenda o job no QStash com atraso curto. Sem deduplicationId (o do job original, baseado no
 * messageId, ainda está na janela de 1h e descartaria o reagendamento).
 */
export async function rescheduleRespond(params: {
  conversationId: string
  debounceMs?: number
  messageId?: string
  attempt: number
}): Promise<boolean> {
  const token = process.env.QSTASH_TOKEN
  if (!token) return false
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const apiKey = process.env.SMARTZAP_API_KEY
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
    await new Client({ token }).publishJSON({
      url: `${getAppUrl()}/api/ai/respond`,
      body: {
        conversationId: params.conversationId,
        debounceMs: params.debounceMs,
        messageId: params.messageId,
        attempt: params.attempt,
      },
      delay: RESCHEDULE_DELAY_S,
      retries: 2,
      headers,
    })
    return true
  } catch (e) {
    console.error('[AI-RESPOND] Falha ao reagendar job (QStash):', e)
    return false
  }
}
