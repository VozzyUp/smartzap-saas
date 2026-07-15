import { getSupabaseAdmin } from '@/lib/supabase'

export function isTrialExpired(trialEndsAt: string | null | undefined): boolean {
  if (!trialEndsAt) return false
  return new Date(trialEndsAt).getTime() <= Date.now()
}

export async function isTenantTrialExpired(tenantId: string): Promise<boolean> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return false
    const { data } = await db.from('tenants').select('trial_ends_at').eq('id', tenantId).maybeSingle()
    return isTrialExpired(data?.trial_ends_at ?? null)
  } catch (e) {
    console.warn('[trial] falha ao ler trial_ends_at — tratando como não expirado:', e)
    return false
  }
}

/**
 * Um tenant está "bloqueado" quando o trial expirou OU está suspenso (Fase 3B).
 * Usado nos workers sem sessão (dispatch de campanha, IA no webhook) onde o gate
 * de layout não alcança — uma suspensão deve parar disparos/automações, não só a UI.
 * Lê trial_ends_at e status numa query só. Fail-safe: erro → não bloqueia.
 */
export async function isTenantBlocked(tenantId: string): Promise<boolean> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return false
    const { data } = await db.from('tenants').select('trial_ends_at, status').eq('id', tenantId).maybeSingle()
    if (data?.status === 'suspended') return true
    return isTrialExpired(data?.trial_ends_at ?? null)
  } catch (e) {
    console.warn('[trial] falha ao ler status do tenant — tratando como não bloqueado:', e)
    return false
  }
}
