'use server'

import { cache } from 'react'
import { createClient } from '@/lib/supabase-server'
import { getTenantContext } from '@/lib/tenant-context'
import { formatDashboardStats } from '@/lib/dashboard-metrics'
import { getDashboardMetricsForTenant } from '@/lib/dashboard-metrics.server'
import type { DashboardStats } from '@/services/dashboardService'
import type { Campaign } from '@/types'

/**
 * Busca o primeiro render do Dashboard. As métricas e a rota HTTP usam a
 * mesma projeção para que a hidratação não altere os números apresentados.
 */
export const getDashboardData = cache(async (): Promise<{
  stats: DashboardStats
  recentCampaigns: Campaign[]
}> => {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) {
    return {
      stats: {
        sent24h: '0',
        deliveryRate: '0%',
        activeCampaigns: '0',
        failedMessages: '0',
        chartData: [],
      },
      recentCampaigns: [],
    }
  }

  const supabase = await createClient()
  const [metrics, campaignsResult] = await Promise.all([
    getDashboardMetricsForTenant(ctx.tenantId),
    supabase
      .from('campaigns')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return {
    stats: formatDashboardStats(metrics),
    recentCampaigns: (campaignsResult.data || []).map(mapCampaignFromDb),
  }
})

function mapCampaignFromDb(dbCampaign: any): Campaign {
  return {
    id: dbCampaign.id,
    name: dbCampaign.name,
    templateName: dbCampaign.template_name || '',
    status: dbCampaign.status,
    recipients: dbCampaign.total_recipients || 0,
    sent: dbCampaign.sent || 0,
    delivered: dbCampaign.delivered || 0,
    read: dbCampaign.read || 0,
    skipped: dbCampaign.skipped || 0,
    failed: dbCampaign.failed || 0,
    createdAt: dbCampaign.created_at,
    startedAt: dbCampaign.started_at,
    completedAt: dbCampaign.completed_at,
    scheduledAt: dbCampaign.scheduled_at,
    lastSentAt: dbCampaign.last_sent_at,
    folderId: dbCampaign.folder_id,
    tags: [],
  }
}
