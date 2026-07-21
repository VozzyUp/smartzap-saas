import { NextResponse } from 'next/server'
import { getTenantContext } from '@/lib/tenant-context'
import { listCardAutomationLog } from '@/lib/kanban-automation'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const ctx = await getTenantContext()
  if (!ctx?.tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const log = await listCardAutomationLog(ctx.tenantId, id)
  return NextResponse.json({ log })
}
