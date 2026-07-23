export type DashboardContactStatusRow = {
  status: string | null
}

export type DashboardContactStats = {
  totalSent: number
  totalDelivered: number
  totalRead: number
  totalFailed: number
}

export function summarizeDashboardContactStats(
  contacts: DashboardContactStatusRow[]
): DashboardContactStats {
  return contacts.reduce<DashboardContactStats>((totals, contact) => {
    const status = String(contact.status || '').trim().toLowerCase()

    if (status === 'sent' || status === 'delivered' || status === 'read') {
      totals.totalSent += 1
    }
    if (status === 'delivered' || status === 'read') {
      totals.totalDelivered += 1
    }
    if (status === 'read') {
      totals.totalRead += 1
    }
    if (status === 'failed') {
      totals.totalFailed += 1
    }

    return totals
  }, {
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalFailed: 0,
  })
}
