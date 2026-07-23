import 'server-only'

import { getSupabaseAdmin } from '@/lib/supabase'
import {
  buildDashboardMetrics,
  type DashboardMetrics,
} from '@/lib/dashboard-metrics'

export async function getDashboardMetricsForTenant(tenantId: string): Promise<DashboardMetrics> {
  const supabase = getSupabaseAdmin()
  if (!supabase) throw new Error('Supabase not configured')

  const { data, error } = await supabase
    .from('campaigns')
    .select('sent, delivered, read, failed, status, created_at, started_at, last_sent_at, total_recipients')
    .eq('tenant_id', tenantId)

  if (error) throw error
  return buildDashboardMetrics(data || [])
}
