import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { getPlanUsage } from '@/lib/plan-usage'

export async function GET() {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const data = await getPlanUsage(ctx.tenantId)
  return NextResponse.json(data)
}
