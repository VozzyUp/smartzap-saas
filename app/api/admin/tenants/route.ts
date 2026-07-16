import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { createClient } from '@/lib/supabase-server'

export async function GET() {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  // A RPC checa is_platform_admin(auth.uid()) internamente (defesa em profundidade),
  // então precisa do client de SESSÃO — com service role, auth.uid() é NULL e a RPC
  // lançaria 'forbidden'. A RPC é SECURITY DEFINER, então acessa as tabelas com
  // privilégio próprio, sem depender de RLS do caller.
  const supa = await createClient()
  const { data, error } = await supa.rpc('admin_list_tenants')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tenants: data ?? [] })
}
