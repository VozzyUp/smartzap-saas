import { CampaignStatus, type Campaign } from '@/types'
import { DAILY_LIMIT_TIMEZONE, getDayStartUtc } from '@/lib/campaign-daily-limit'

/**
 * Rótulo para campanha que está esperando o próximo dia (limite diário de envios):
 * "Em andamento: X de Y enviados, próximos Z amanhã". Retorna null para agendamento comum.
 */
export function getDailyContinuationLabel(
  campaign: Pick<Campaign, 'status' | 'recipients' | 'sent' | 'delivered' | 'read' | 'failed' | 'scheduledAt'>,
  now: Date = new Date()
): string | null {
  if (campaign.status !== CampaignStatus.SCHEDULED || !campaign.scheduledAt) return null
  const sent = Math.max(campaign.sent ?? 0, campaign.delivered ?? 0, campaign.read ?? 0)
  const recipients = campaign.recipients ?? 0
  const remaining = recipients - sent - (campaign.failed ?? 0)
  if (sent <= 0 || remaining <= 0) return null

  const when = new Date(campaign.scheduledAt)
  const tomorrowStart = getDayStartUtc(new Date(getDayStartUtc(now).getTime() + 36 * 3600 * 1000))
  const isTomorrow = getDayStartUtc(when).getTime() === tomorrowStart.getTime()
  const whenText = isTomorrow
    ? 'amanhã'
    : `em ${new Intl.DateTimeFormat('pt-BR', { timeZone: DAILY_LIMIT_TIMEZONE, day: '2-digit', month: '2-digit' }).format(when)}`
  return `Em andamento: ${sent} de ${recipients} enviados, próximos ${remaining} ${whenText}`
}
