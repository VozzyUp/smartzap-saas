import 'server-only'

import { Client as QStashClient } from '@upstash/qstash'
import { getAppUrl } from '@/lib/app-url'

export const FOLLOWUP_SWEEP_SCHEDULE_ID = 'kanban-followup-sweep'

/**
 * Registra o QStash Schedule global (não por-tenant) que dispara o sweep de
 * follow-up a cada hora. Idempotente: o scheduleId é fixo, então chamar de novo
 * atualiza o mesmo schedule em vez de criar outro.
 */
export async function registerFollowupSweepSchedule(): Promise<string> {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error('QSTASH_TOKEN not configured')
  }

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN })
  const secret = process.env.KANBAN_FOLLOWUP_SWEEP_SECRET

  const schedule = await qstash.schedules.create({
    destination: `${getAppUrl()}/api/kanban/followup-sweep`,
    cron: '0 * * * *',
    scheduleId: FOLLOWUP_SWEEP_SCHEDULE_ID,
    headers: secret ? { 'x-workflow-secret': secret } : undefined,
    retries: 2,
  })

  return schedule.scheduleId
}

let registered = false

export function __resetFollowupScheduleMemo(): void {
  registered = false
}

/**
 * Garante o cron do sweep (chamado ao salvar regras de follow-up). Best-effort:
 * nunca lança; devolve se o schedule está registrado. Memoizado por processo.
 */
export async function ensureFollowupSweepSchedule(): Promise<boolean> {
  if (registered) return true
  try {
    await registerFollowupSweepSchedule()
    registered = true
    return true
  } catch (e) {
    console.error('[Kanban] Falha ao registrar o schedule do follow-up:', e instanceof Error ? e.message : 'erro')
    return false
  }
}
