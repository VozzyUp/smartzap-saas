import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const db = getSupabaseAdmin()
  if (!db) return NextResponse.json({ plans: [] })
  const { data } = await db
    .from('plans')
    .select('slug, name, price_cents, max_contacts, max_templates, max_campaigns_per_month, max_whatsapp_numbers')
    .eq('is_active', true)
    .order('sort_order')
  return NextResponse.json({ plans: data ?? [] })
}
