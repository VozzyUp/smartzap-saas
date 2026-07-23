import { describe, expect, it } from 'vitest'
import { buildDashboardMetrics } from './dashboard-metrics'

describe('buildDashboardMetrics', () => {
  it('uses one status policy for totals, active campaigns, and the chart', () => {
    const metrics = buildDashboardMetrics([
      {
        sent: 10,
        delivered: 8,
        read: 4,
        failed: 1,
        status: 'Enviando',
        created_at: '2026-07-22T12:00:00.000Z',
      },
      {
        sent: 20,
        delivered: 19,
        read: 17,
        failed: 0,
        status: 'scheduled',
        created_at: '2026-07-22T12:00:00.000Z',
      },
      {
        sent: 999,
        delivered: 999,
        read: 999,
        failed: 999,
        status: 'Rascunho',
        created_at: '2026-07-22T12:00:00.000Z',
      },
    ], new Date('2026-07-23T12:00:00.000Z'))

    expect(metrics.totalSent).toBe(30)
    expect(metrics.totalDelivered).toBe(27)
    expect(metrics.totalRead).toBe(21)
    expect(metrics.totalFailed).toBe(1)
    expect(metrics.activeCampaigns).toBe(2)
    expect(metrics.chartData.find((point) => point.name === '22/07')).toMatchObject({
      sent: 30,
      delivered: 27,
      read: 21,
      failed: 1,
      active: 2,
    })
  })
})
