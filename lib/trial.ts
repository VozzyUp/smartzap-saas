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
  } catch {
    return false
  }
}
