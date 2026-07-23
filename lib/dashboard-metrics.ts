export interface DashboardCampaignMetric {
  sent: number | null
  delivered: number | null
  read: number | null
  failed: number | null
  status: string | null
  created_at: string | null
  started_at?: string | null
  last_sent_at?: string | null
  total_recipients?: number | null
}

export interface DashboardChartDataPoint {
  name: string
  sent: number
  read: number
  delivered: number
  failed: number
  active: number
}

export interface DashboardMetrics {
  totalSent: number
  totalDelivered: number
  totalRead: number
  totalFailed: number
  activeCampaigns: number
  deliveryRate: number
  chartData: DashboardChartDataPoint[]
}

const ACTIVE_STATUSES = new Set(['enviando', 'agendado', 'sending', 'scheduled'])
const DRAFT_STATUSES = new Set(['rascunho', 'draft'])

function normalizedStatus(status: string | null): string {
  return String(status || '').trim().toLowerCase()
}

function isIncludedCampaign(campaign: DashboardCampaignMetric): boolean {
  return !DRAFT_STATUSES.has(normalizedStatus(campaign.status))
}

function isActiveCampaign(campaign: DashboardCampaignMetric): boolean {
  return ACTIVE_STATUSES.has(normalizedStatus(campaign.status))
}

export function buildDashboardMetrics(
  campaigns: DashboardCampaignMetric[],
  now: Date = new Date(),
): DashboardMetrics {
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - 29)
  start.setUTCHours(0, 0, 0, 0)

  const chartBuckets = new Map<string, DashboardChartDataPoint>()
  for (let index = 0; index < 30; index += 1) {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + index)
    const key = day.toISOString().slice(0, 10)
    const [, month, date] = key.split('-')
    chartBuckets.set(key, { name: `${date}/${month}`, sent: 0, read: 0, delivered: 0, failed: 0, active: 0 })
  }

  let totalSent = 0
  let totalDelivered = 0
  let totalRead = 0
  let totalFailed = 0
  let activeCampaigns = 0

  for (const campaign of campaigns) {
    if (!isIncludedCampaign(campaign)) continue

    const sent = campaign.sent || 0
    const delivered = campaign.delivered || 0
    const read = campaign.read || 0
    const failed = campaign.failed || 0
    const active = isActiveCampaign(campaign)

    totalSent += sent
    totalDelivered += delivered
    totalRead += read
    totalFailed += failed
    if (active) activeCampaigns += 1

    const rawDate = campaign.last_sent_at || campaign.started_at || campaign.created_at
    if (!rawDate) continue
    const date = new Date(rawDate)
    if (Number.isNaN(date.getTime())) continue
    const bucket = chartBuckets.get(date.toISOString().slice(0, 10))
    if (!bucket) continue

    bucket.sent += sent || campaign.total_recipients || 0
    bucket.delivered += delivered
    bucket.read += read
    bucket.failed += failed
    if (active) bucket.active += 1
  }

  return {
    totalSent,
    totalDelivered,
    totalRead,
    totalFailed,
    activeCampaigns,
    deliveryRate: totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 0,
    chartData: Array.from(chartBuckets.values()),
  }
}

export interface DashboardStats {
  sent24h: string
  deliveryRate: string
  activeCampaigns: string
  failedMessages: string
  chartData: DashboardChartDataPoint[]
}

export function formatDashboardStats(metrics: DashboardMetrics): DashboardStats {
  return {
    sent24h: metrics.totalSent.toLocaleString('pt-BR'),
    deliveryRate: `${metrics.deliveryRate}%`,
    activeCampaigns: String(metrics.activeCampaigns),
    failedMessages: String(metrics.totalFailed),
    chartData: metrics.chartData,
  }
}
