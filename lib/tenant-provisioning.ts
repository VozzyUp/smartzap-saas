import { getSupabaseAdmin } from '@/lib/supabase'

function slugFromEmail(email: string) {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'tenant'
  return `${local}-${Math.random().toString(36).slice(2, 7)}`
}

export async function provisionTenantForUser(
  userId: string, emailForName: string,
): Promise<{ tenantId: string; created: boolean }> {
  const db = getSupabaseAdmin()!
  const existing = await db.from('tenant_members')
    .select('tenant_id').eq('user_id', userId).maybeSingle()
  if (existing.data?.tenant_id) {
    return { tenantId: existing.data.tenant_id, created: false }
  }
  const { data: trialPlan } = await db.from('plans').select('id').eq('slug', 'trial').single()
  const inserted = await db.from('tenants').insert({
    name: emailForName, slug: slugFromEmail(emailForName), status: 'trialing',
    trial_ends_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    plan_id: trialPlan?.id ?? null,
  }).select('id').single()
  const tenantId = (inserted as any).data?.id
  await db.from('tenant_members').insert({ tenant_id: tenantId, user_id: userId, role: 'owner' })
  return { tenantId, created: true }
}
