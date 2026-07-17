import { getSupabaseAdmin } from '@/lib/supabase'
import { getTenantPlan, getUsageCounts } from '@/lib/plan-limits'

export type UsageDimension = { used: number; limit: number | null }
export type PlanUsage = {
  plan: { slug: string; name: string; price_cents: number | null }
  usage: { contacts: UsageDimension; templates: UsageDimension; campaignsMonth: UsageDimension; whatsappNumbers: UsageDimension }
  trial: { endsAt: string | null; daysLeft: number | null }
}

function daysLeft(endsAt: string | null): number | null {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export async function getPlanUsage(tenantId: string): Promise<PlanUsage> {
  const [plan, counts] = await Promise.all([getTenantPlan(tenantId), getUsageCounts(tenantId)])
  let endsAt: string | null = null
  try {
    const db = getSupabaseAdmin()
    if (db) {
      const { data } = await db.from('tenants').select('trial_ends_at').eq('id', tenantId).maybeSingle()
      endsAt = (data as { trial_ends_at?: string } | null)?.trial_ends_at ?? null
    }
  } catch { endsAt = null }

  return {
    plan: { slug: plan.slug, name: plan.name, price_cents: (plan as { price_cents?: number | null }).price_cents ?? null },
    usage: {
      contacts: { used: counts.contacts, limit: plan.max_contacts },
      templates: { used: counts.templates, limit: plan.max_templates },
      campaignsMonth: { used: counts.campaignsMonth, limit: plan.max_campaigns_per_month },
      whatsappNumbers: { used: counts.whatsappNumbers, limit: plan.max_whatsapp_numbers },
    },
    trial: { endsAt, daysLeft: daysLeft(endsAt) },
  }
}
