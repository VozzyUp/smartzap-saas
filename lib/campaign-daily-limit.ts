/**
 * Limite diário de disparo de campanhas (por conta).
 *
 * Setting `campaign_daily_limit` (tabela settings, por tenant): inteiro; ausente/0 = sem limite.
 * O saldo do dia é DERIVADO de campaign_contacts (sent_at / sending_at do dia), sem contador
 * próprio, para não divergir do que realmente foi enviado.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const DAILY_LIMIT_SETTING_KEY = 'campaign_daily_limit'
/** Fuso do "dia" da conta. O produto é BR e o Brasil não tem horário de verão desde 2019. */
export const DAILY_LIMIT_TIMEZONE = 'America/Sao_Paulo'
/** Hora local em que a continuação do dia seguinte é disparada. */
export const DAILY_LIMIT_RESUME_HOUR = 9
const MAX_LIMIT = 1_000_000

export function parseDailyLimit(raw: unknown): number {
  if (raw === null || raw === undefined) return 0
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_LIMIT, Math.floor(n))
}

/** Offset (ms) do fuso em relação ao UTC no instante dado (local = utc + offset). */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

function localYmd(at: Date, timeZone: string) {
  const local = new Date(at.getTime() + tzOffsetMs(at, timeZone))
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() }
}

/** Instante (UTC) em que o dia local atual começou. */
export function getDayStartUtc(now: Date, timeZone = DAILY_LIMIT_TIMEZONE): Date {
  const { y, m, d } = localYmd(now, timeZone)
  const approx = new Date(Date.UTC(y, m, d))
  return new Date(approx.getTime() - tzOffsetMs(approx, timeZone))
}

/** Instante (UTC) das 9h locais do dia seguinte. */
export function getNextRunAt(now: Date, timeZone = DAILY_LIMIT_TIMEZONE, hour = DAILY_LIMIT_RESUME_HOUR): Date {
  const { y, m, d } = localYmd(now, timeZone)
  const approx = new Date(Date.UTC(y, m, d + 1, hour))
  return new Date(approx.getTime() - tzOffsetMs(approx, timeZone))
}

/** null = sem limite. Caso contrário, quantos envios ainda cabem hoje (>= 0). */
export function computeDailyBalance(limit: number, sentToday: number): number | null {
  if (!limit || limit <= 0) return null
  return Math.max(0, limit - Math.max(0, sentToday))
}

export function planDailySend<T>(eligible: T[], balance: number | null): { send: T[]; deferred: number } {
  if (balance === null) return { send: eligible, deferred: 0 }
  const send = eligible.slice(0, Math.max(0, balance))
  return { send, deferred: eligible.length - send.length }
}

/**
 * Envios de campanha da conta no dia: linhas com sent_at no dia + linhas em 'sending' no dia
 * (reservadas por um workflow em andamento, para dois disparos simultâneos não estourarem o limite).
 */
export async function countSentToday(
  client: Pick<SupabaseClient, 'from'>,
  tenantId: string,
  dayStart: Date
): Promise<number> {
  const iso = dayStart.toISOString()
  const sent: any = await (client as any)
    .from('campaign_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('sent_at', iso)
  if (sent.error) throw sent.error

  const sending: any = await (client as any)
    .from('campaign_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'sending')
    .gte('sending_at', iso)
  if (sending.error) throw sending.error

  return (sent.count ?? 0) + (sending.count ?? 0)
}

export interface DailyDispatchPlan<T> {
  limited: boolean
  limit: number
  sentToday: number
  balance: number | null
  send: T[]
  deferred: number
  /** Quando reprogramar o restante (null se nada foi adiado). */
  nextRunAt: Date | null
}

/**
 * Decide quem envia agora e quem fica para amanhã. `eligible` deve conter apenas contatos
 * ainda pendentes (quem já foi enviado/locked nunca entra: é isso que garante idempotência).
 */
export async function planDailyDispatch<T>(params: {
  tenantId: string
  eligible: T[]
  now: Date
  getLimit: (tenantId: string) => Promise<number>
  count: (tenantId: string, dayStart: Date) => Promise<number>
}): Promise<DailyDispatchPlan<T>> {
  const { tenantId, eligible, now } = params
  const limit = await params.getLimit(tenantId)
  if (!limit) {
    return { limited: false, limit: 0, sentToday: 0, balance: null, send: eligible, deferred: 0, nextRunAt: null }
  }
  const sentToday = await params.count(tenantId, getDayStartUtc(now))
  const balance = computeDailyBalance(limit, sentToday)
  const { send, deferred } = planDailySend(eligible, balance)
  return {
    limited: true,
    limit,
    sentToday,
    balance,
    send,
    deferred,
    nextRunAt: deferred > 0 ? getNextRunAt(now) : null,
  }
}
