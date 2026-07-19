import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

const LIMIT_FIELDS = ['max_contacts', 'max_templates', 'max_campaigns_per_month', 'max_whatsapp_numbers', 'price_cents'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const body = await req.json().catch(() => null)
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('name' in (body ?? {})) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 2 || name.length > 80) return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
    update.name = name
  }
  for (const f of LIMIT_FIELDS) {
    if (f in (body ?? {})) {
      const v = body[f]
      if (v === null) update[f] = null                         // ilimitado
      else if (Number.isInteger(v) && v >= 0) update[f] = v     // teto válido
      else return NextResponse.json({ error: `invalid_${f}` }, { status: 400 })
    }
  }
  if (Object.keys(update).length === 1) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
  const { data, error } = await db.from('plans').update(update).eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ plan: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  const { count, error: countError } = await db.from('tenants')
    .select('id', { count: 'exact', head: true }).eq('plan_id', id)
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'plan_in_use', tenants: count }, { status: 409 })
  }

  const { data, error } = await db.from('plans').delete().eq('id', id).select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
