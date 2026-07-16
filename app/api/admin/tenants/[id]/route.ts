import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'
import { createClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  // admin_tenant_users checa auth.uid() internamente → usar client de sessão
  // (service role tem auth.uid() NULL e a RPC lançaria 'forbidden').
  const supa = await createClient()
  const [{ data: tenant }, { data: users }] = await Promise.all([
    db.from('tenants').select('id, name, slug, status, trial_ends_at, suspended_at, plan_id').eq('id', id).maybeSingle(),
    supa.rpc('admin_tenant_users', { p_tenant_id: id }),
  ])
  if (!tenant) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ tenant, users: users ?? [] })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const body = await req.json().catch(() => null)
  const update: Record<string, unknown> = {}

  if (typeof body?.planSlug === 'string') {
    const { data: plan } = await db.from('plans').select('id').eq('slug', body.planSlug).maybeSingle()
    if (!plan) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
    update.plan_id = plan.id
    if (body.planSlug !== 'trial') update.trial_ends_at = null // promover para pago tira o limite de tempo
  }
  if (typeof body?.status === 'string') {
    if (body.status === 'suspended') { update.status = 'suspended'; update.suspended_at = new Date().toISOString() }
    else if (body.status === 'active') { update.status = 'active'; update.suspended_at = null }
    else return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  const { data, error } = await db.from('tenants').update(update).eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ tenant: data })
}
