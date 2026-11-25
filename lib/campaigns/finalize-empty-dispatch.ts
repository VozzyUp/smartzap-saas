import { CampaignStatus } from '@/types'

type UpdateChain = {
  eq: (col: string, val: string) => UpdateChain
  in: (col: string, vals: string[]) => PromiseLike<{ error: unknown }>
}
type CampaignsClient = {
  from: (table: 'campaigns') => { update: (values: Record<string, unknown>) => UpdateChain }
}

/**
 * Disparo em que nenhum contato sobrou para envio (todos pulados no pré-check).
 * O workflow nunca é enfileirado, então ninguém mais finalizaria a campanha:
 * ela ficaria em "Enviando" para sempre. Aqui ela vai para o estado final
 * (Concluído, o mesmo que o workflow usa quando recipients = 0) com completed_at.
 * Só age sobre campanha ainda em andamento/rascunho/agendada.
 */
export async function finalizeCampaignWithNoRecipients(
  client: CampaignsClient,
  tenantId: string,
  campaignId: string,
  now: string = new Date().toISOString()
): Promise<{ error: unknown }> {
  return client
    .from('campaigns')
    .update({ status: CampaignStatus.COMPLETED, completed_at: now, updated_at: now })
    .eq('id', campaignId)
    .eq('tenant_id', tenantId)
    .in('status', [CampaignStatus.SENDING, CampaignStatus.DRAFT, CampaignStatus.SCHEDULED])
}
