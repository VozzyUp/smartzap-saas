/**
 * Estado leve do sweep de follow-up (sem migração): contador de falhas de envio e
 * "motivo já registrado". Redis quando disponível; senão memória do processo.
 * Chaves incluem o momento de entrada do cartão na fase, então valem por entrada.
 */

import { redis } from '@/lib/redis'

export const FOLLOWUP_MAX_ATTEMPTS = 3
const TTL_SECONDS = 7 * 24 * 60 * 60

const memCounts = new Map<string, number>()
const memFlags = new Set<string>()

export function __resetFollowupState(): void {
  memCounts.clear()
  memFlags.clear()
}

/** Soma 1 falha e devolve o total. */
export async function incrementFollowupFailure(key: string): Promise<number> {
  const k = `kanban:followup:fail:${key}`
  if (redis) {
    try {
      const n = await redis.incr(k)
      await redis.expire(k, TTL_SECONDS)
      return Number(n)
    } catch {
      // cai para memória
    }
  }
  const n = (memCounts.get(k) ?? 0) + 1
  memCounts.set(k, n)
  return n
}

export async function clearFollowupFailure(key: string): Promise<void> {
  const k = `kanban:followup:fail:${key}`
  memCounts.delete(k)
  if (redis) {
    try {
      await redis.del(k)
    } catch {
      // ignora
    }
  }
}

/** true na primeira vez que o motivo é registrado para essa chave; false nas seguintes. */
export async function markFollowupReasonOnce(key: string): Promise<boolean> {
  const k = `kanban:followup:reason:${key}`
  if (redis) {
    try {
      const r = await redis.set(k, '1', { nx: true, ex: TTL_SECONDS })
      return r !== null && r !== undefined
    } catch {
      // cai para memória
    }
  }
  if (memFlags.has(k)) return false
  memFlags.add(k)
  return true
}
