import { createClient } from '@/lib/supabase-server'
import { isTrialExpired } from '@/lib/trial'

export type TenantContext = {
  tenantId: string | null
  userId: string
  isPlatformAdmin: boolean
  trialExpired: boolean
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return null
  const [{ data: tenantId }, { data: isAdmin }] = await Promise.all([
    supa.rpc('current_tenant_id'),
    supa.rpc('is_platform_admin', { uid: user.id }),
  ])
  const resolvedTenantId = (tenantId as string) ?? null
  let trialExpired = false
  if (resolvedTenantId && !isAdmin) {
    const { data: tenantRow } = await supa
      .from('tenants').select('trial_ends_at').eq('id', resolvedTenantId).maybeSingle()
    trialExpired = isTrialExpired(tenantRow?.trial_ends_at ?? null)
  }
  return { tenantId: resolvedTenantId, userId: user.id, isPlatformAdmin: !!isAdmin, trialExpired }
}

/**
 * Guard intencional para rotas sem contexto de sessão (webhooks Meta, workers
 * QStash, rotas public/, cron). Até a Fase 2B essas rotas não têm uma forma
 * definida de resolver o tenant a partir do payload/assinatura recebida, então
 * esta função SEMPRE lança — preferimos falhar alto (erro explícito) a
 * silenciosamente atribuir dados a um tenant errado ou a um tenant hardcoded.
 * Quando a Fase 2B implementar a resolução real (ex.: via WABA/phone number
 * id do payload do webhook), substituir o corpo desta função pela lógica de
 * lookup e remover este comentário.
 */
export async function resolveWebhookTenantId(): Promise<string> {
  throw new Error('rota sem contexto de tenant — cobrir na Fase 2B')
}
