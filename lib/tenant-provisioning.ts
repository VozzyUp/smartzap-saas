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
  const inserted = await db.from('tenants').insert({
    name: emailForName, slug: slugFromEmail(emailForName), status: 'trialing',
  }).select('id').single()
  const tenantId = (inserted as any).data?.id
  await db.from('tenant_members').insert({ tenant_id: tenantId, user_id: userId, role: 'owner' })
  return { tenantId, created: true }
}
