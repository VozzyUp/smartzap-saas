import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

function planSlug(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function GET() {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const { data, error } = await db.from('plans').select('*').order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data ?? [] })
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 })

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const slug = planSlug(name)
  if (name.length < 2 || name.length > 80 || !slug) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
  }

  const { data, error } = await db.from('plans').insert({
    name,
    slug,
    sort_order: 9999,
  }).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'name_already_exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ plan: data }, { status: 201 })
}
