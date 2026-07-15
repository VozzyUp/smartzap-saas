import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const { data, error } = await db.from('plans').select('*').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data ?? [] })
}
