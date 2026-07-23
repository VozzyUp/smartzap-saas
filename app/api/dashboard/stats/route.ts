import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getDashboardMetricsForTenant } from '@/lib/dashboard-metrics.server'

// Dados por tenant via cookie: nunca deixar o Next reutilizar um snapshot entre contas.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const ctx = await getTenantContext()
    if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    return NextResponse.json(await getDashboardMetricsForTenant(ctx.tenantId))
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
