import { describe, expect, it } from 'vitest'
import { summarizeDashboardContactStats } from './dashboard-stats'

describe('summarizeDashboardContactStats', () => {
  it('conta enviados e entregues de forma cumulativa quando o contato foi lido', () => {
    const stats = summarizeDashboardContactStats([
      { status: 'sent' },
      { status: 'delivered' },
      { status: 'read' },
      { status: 'failed' },
      { status: 'pending' },
    ])

    expect(stats).toEqual({
      totalSent: 3,
      totalDelivered: 2,
      totalRead: 1,
      totalFailed: 1,
    })
  })
})
