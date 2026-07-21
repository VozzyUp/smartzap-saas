import 'server-only'

import { Client as QStashClient } from '@upstash/qstash'
import { getAppUrl } from '@/lib/app-url'

/**
 * Registra o QStash Schedule global (não por-tenant) que dispara o sweep de
 * follow-up a cada hora. Roda uma vez no deploy — não tem UI/tabela própria
 * porque é infraestrutura fixa do app, no mesmo espírito de
 * lib/builder/workflow-schedule.ts (mas sem tracking de reagendamento: só
 * existe UM schedule global, criado uma vez).
 */
export async function registerFollowupSweepSchedule(): Promise<string> {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error('QSTASH_TOKEN not configured')
  }

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN })
  const baseUrl = getAppUrl()
  const secret = process.env.KANBAN_FOLLOWUP_SWEEP_SECRET

  const schedule = await qstash.publishJSON({
    url: `${baseUrl}/api/kanban/followup-sweep`,
    cron: '0 * * * *',
    headers: secret ? { 'x-workflow-secret': secret } : undefined,
    retries: 2,
  })

  return schedule.messageId
}
