import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase'
import {
  buildDashboardMetrics,
  type DashboardMetrics,
} from '@/lib/dashboard-metrics'
import { summarizeDashboardContactStats } from '@/lib/dashboard-stats'

export async function getDashboardMetricsForTenant(tenantId: string): Promise<DashboardMetrics> {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase not configured')

  const [campaignsResult, contactsResult] = await Promise.all([
    supabase
      .from('campaigns')
      .select('sent, delivered, read, failed, status, created_at, started_at, last_sent_at, total_recipients')
      .eq('tenant_id', tenantId),
    supabase
      .from('campaign_contacts')
      .select('status')
      .eq('tenant_id', tenantId),
  ])

  if (campaignsResult.error) throw campaignsResult.error
  if (contactsResult.error) throw contactsResult.error

  const campaignMetrics = buildDashboardMetrics(campaignsResult.data || [])
  const contactStats = summarizeDashboardContactStats(contactsResult.data || [])

  return {
    ...campaignMetrics,
    ...contactStats,
    deliveryRate: contactStats.totalSent > 0
      ? Math.round((contactStats.totalDelivered / contactStats.totalSent) * 100)
      : 0,
  }
}
