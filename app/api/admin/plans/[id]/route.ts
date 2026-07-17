import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

const FIELDS = ['max_contacts', 'max_templates', 'max_campaigns_per_month', 'max_whatsapp_numbers', 'price_cents'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const { id } = await params
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const body = await req.json().catch(() => null)
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const f of FIELDS) {
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
