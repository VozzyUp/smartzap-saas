import { Campaign } from '../types'
import { campaignService } from './campaignService'
import { api } from '@/lib/api'
import {
  formatDashboardStats,
  type DashboardChartDataPoint,
  type DashboardMetrics,
  type DashboardStats,
} from '@/lib/dashboard-metrics'

export type ChartDataPoint = DashboardChartDataPoint
export type { DashboardStats }

export const dashboardService = {
  /**
   * Busca a projeção única do Dashboard pela API. A API e o primeiro render
   * usam a mesma função server-side, evitando números diferentes após a hidratação.
   */
  getStats: async (): Promise<DashboardStats> => {
    const statsFallback: DashboardMetrics = {
      totalSent: 0,
      totalDelivered: 0,
      totalRead: 0,
      totalFailed: 0,
      activeCampaigns: 0,
      deliveryRate: 0,
      chartData: [],
    }

    const metrics = await api.safeGet<DashboardMetrics>('/api/dashboard/stats', statsFallback, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })

    return formatDashboardStats(metrics)
  },

  /** Busca as cinco campanhas recentes, sem cache. */
  getRecentCampaigns: async (): Promise<Campaign[]> => {
    try {
      const result = await campaignService.list({ limit: 5, offset: 0, search: '', status: 'All' })
      return result.data || []
    } catch {
      return []
    }
  },
}
