import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export type Plan = {
  id: string; slug: string; name: string
  max_whatsapp_numbers: number | null
  max_contacts: number | null
  max_templates: number | null
  max_campaigns_per_month: number | null
}
export type GateResult = { allowed: boolean; limit: number | null; current: number }

const PLAN_COLS = 'id, slug, name, max_whatsapp_numbers, max_contacts, max_templates, max_campaigns_per_month'
// Fail-closed máximo: se nem o trial resolver, nada é permitido.
const ZERO_PLAN: Plan = { id: '', slug: 'trial', name: 'Trial', max_whatsapp_numbers: 0, max_contacts: 0, max_templates: 0, max_campaigns_per_month: 0 }

export async function getTenantPlan(tenantId: string): Promise<Plan> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return ZERO_PLAN
    const { data: tenant } = await db.from('tenants').select('plan_id').eq('id', tenantId).single()
    const planId = (tenant as { plan_id?: string } | null)?.plan_id
    if (planId) {
      const { data: plan } = await db.from('plans').select(PLAN_COLS).eq('id', planId).single()
      if (plan) return plan as unknown as Plan
    }
    const { data: trial } = await db.from('plans').select(PLAN_COLS).eq('slug', 'trial').single()
    return (trial as unknown as Plan) ?? ZERO_PLAN
  } catch (e) {
    console.warn('[plan-limits] getTenantPlan falhou, usando fail-closed:', e)
    return ZERO_PLAN
  }
}

async function countRows(table: string, tenantId: string, thisMonth = false): Promise<number> {
  try {
    const db = getSupabaseAdmin()
    if (!db) return Number.MAX_SAFE_INTEGER // fail-closed: trata como cheio
    let q = db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    if (thisMonth) {
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
      q = q.gte('created_at', start)
    }
    const { count } = await q
    return count ?? Number.MAX_SAFE_INTEGER
  } catch (e) {
    console.warn(`[plan-limits] contagem de ${table} falhou, fail-closed:`, e)
    return Number.MAX_SAFE_INTEGER
  }
}

function gate(limit: number | null, current: number, delta = 1): GateResult {
  if (limit === null) return { allowed: true, limit: null, current }
  return { allowed: current + delta <= limit, limit, current }
}

export async function canAddWhatsAppNumber(tenantId: string): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_whatsapp_numbers, await countRows('whatsapp_phone_numbers', tenantId))
}
export async function canAddContacts(tenantId: string, quantidade = 1): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_contacts, await countRows('contacts', tenantId), quantidade)
}
export async function canCreateTemplate(tenantId: string, quantidade = 1): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_templates, await countRows('templates', tenantId), quantidade)
}
export async function canStartCampaign(tenantId: string): Promise<GateResult> {
  const plan = await getTenantPlan(tenantId)
  return gate(plan.max_campaigns_per_month, await countRows('campaigns', tenantId, true))
}

export function planLimitResponse(dimension: string, r: GateResult): NextResponse {
  return NextResponse.json({ error: 'plan_limit', dimension, limit: r.limit, current: r.current }, { status: 403 })
}
