import { createClient } from '@/lib/supabase-server'

export type TenantContext = {
  tenantId: string | null
  userId: string
  isPlatformAdmin: boolean
}

export async function getTenantContext(): Promise<TenantContext | null> {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return null
  const [{ data: tenantId }, { data: isAdmin }] = await Promise.all([
    supa.rpc('current_tenant_id'),
    supa.rpc('is_platform_admin', { uid: user.id }),
  ])
  return { tenantId: (tenantId as string) ?? null, userId: user.id, isPlatformAdmin: !!isAdmin }
}
